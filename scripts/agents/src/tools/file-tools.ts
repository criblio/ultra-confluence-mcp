import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  resolveSafePath,
  verifyResolvedRealpath,
  isProtectedPath,
} from '../validation/safe-path.js';

/**
 * File system tools for reading and writing files.
 *
 * Every entry point goes through `resolveSafePath` to reject absolute paths,
 * `..` escapes, and protected paths (workflows, lockfiles, the agent's own
 * source, env/key files, etc.). After resolving, we additionally check the
 * realpath to catch symlinks that point outside the working dir.
 *
 * Tools intentionally return a plain `{ success, error }` shape on rejection
 * rather than throwing, so the model sees the failure and adjusts instead of
 * the agent loop terminating.
 */
export function createFileTools(workingDir: string) {
  return {
    readFile: tool({
      description: 'Read the contents of a file (text only, max 1 MiB)',
      inputSchema: z.object({
        filePath: z.string().describe('Path to the file relative to working directory'),
      }),
      execute: async ({ filePath }: { filePath: string }) => {
        const decision = resolveSafePath(workingDir, filePath);
        if (!decision.safe || !decision.resolved) {
          return { success: false, error: decision.reason, path: filePath };
        }
        const realCheck = await verifyResolvedRealpath(workingDir, decision.resolved);
        if (!realCheck.safe) {
          return { success: false, error: realCheck.reason, path: filePath };
        }
        try {
          const stat = await fs.stat(decision.resolved);
          if (!stat.isFile()) {
            return { success: false, error: 'Not a regular file', path: filePath };
          }
          if (stat.size > 1024 * 1024) {
            return {
              success: false,
              error: `File too large for readFile (${stat.size} bytes, limit 1 MiB)`,
              path: filePath,
            };
          }
          const content = await fs.readFile(decision.resolved, 'utf-8');
          return { success: true, content, path: filePath };
        } catch (error) {
          return {
            success: false,
            error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
            path: filePath,
          };
        }
      },
    }),

    writeFile: tool({
      description: 'Write content to a file (creates parent directories if needed)',
      inputSchema: z.object({
        filePath: z.string().describe('Path to the file relative to working directory'),
        content: z.string().describe('Content to write'),
      }),
      execute: async ({ filePath, content }: { filePath: string; content: string }) => {
        const decision = resolveSafePath(workingDir, filePath);
        if (!decision.safe || !decision.resolved) {
          return { success: false, error: decision.reason, path: filePath };
        }
        // Realpath check for the parent dir (the file itself may not exist
        // yet). If parent contains a symlink, that's a problem.
        const parentDir = path.dirname(decision.resolved);
        const parentCheck = await verifyResolvedRealpath(workingDir, parentDir);
        if (!parentCheck.safe) {
          return { success: false, error: parentCheck.reason, path: filePath };
        }
        try {
          await fs.mkdir(parentDir, { recursive: true });
          await fs.writeFile(decision.resolved, content, 'utf-8');
          return {
            success: true,
            path: filePath,
            proposedChange: {
              filePath,
              type: 'create' as const,
              content,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
            path: filePath,
          };
        }
      },
    }),

    listFiles: tool({
      description: 'List files in a directory (non-recursive entries; recursive walk skips hidden dirs, node_modules, and protected paths)',
      inputSchema: z.object({
        dirPath: z.string().default('.').describe('Path to directory'),
        recursive: z.boolean().default(false).describe('List recursively'),
      }),
      execute: async ({ dirPath, recursive }: { dirPath: string; recursive: boolean }) => {
        // `.` is the working dir itself — explicitly allowed for listing only.
        const target = dirPath === '.' ? workingDir : null;
        let rootAbs: string;
        if (target) {
          rootAbs = target;
        } else {
          const decision = resolveSafePath(workingDir, dirPath);
          if (!decision.safe || !decision.resolved) {
            return { success: false, error: decision.reason, files: [] };
          }
          rootAbs = decision.resolved;
        }
        try {
          const files: string[] = [];
          const visit = async (abs: string, prefix: string) => {
            const entries = await fs.readdir(abs, { withFileTypes: true });
            for (const entry of entries) {
              const rel = prefix ? path.join(prefix, entry.name) : entry.name;
              if (isProtectedPath(rel)) continue;
              if (entry.isDirectory()) {
                if (
                  recursive &&
                  !entry.name.startsWith('.') &&
                  entry.name !== 'node_modules'
                ) {
                  await visit(path.join(abs, entry.name), rel);
                }
              } else if (entry.isFile()) {
                files.push(rel);
              }
              // Symlinks: deliberately skipped.
            }
          };
          await visit(rootAbs, '');
          return { success: true, files, count: files.length };
        } catch (error) {
          return {
            success: false,
            error: `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`,
            files: [],
          };
        }
      },
    }),

    fileExists: tool({
      description: 'Check if a file or directory exists',
      inputSchema: z.object({
        filePath: z.string().describe('Path to check'),
      }),
      execute: async ({ filePath }: { filePath: string }) => {
        const decision = resolveSafePath(workingDir, filePath);
        if (!decision.safe || !decision.resolved) {
          return { success: false, error: decision.reason, exists: false, path: filePath };
        }
        try {
          const stats = await fs.stat(decision.resolved);
          return {
            success: true,
            exists: true,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            path: filePath,
          };
        } catch {
          return { success: true, exists: false, path: filePath };
        }
      },
    }),
  };
}
