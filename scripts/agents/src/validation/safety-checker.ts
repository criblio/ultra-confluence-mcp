import { AgentContext, ProposedChange } from '../agents/types.js';
import { isProtectedPath } from './safe-path.js';

/**
 * Safety patterns to detect potentially harmful code/requests.
 *
 * This is a coarse filter. It is NOT the primary defense — the primary
 * defense is path restriction (see safe-path.ts), argv-style shelling (no
 * shell interpolation), and the maintainer label gate at the workflow level.
 * Treat these patterns as defense-in-depth: they catch the most common
 * naive injection attempts and shouldn't be relied on alone.
 */
const HARMFUL_PATTERNS: RegExp[] = [
  // Security bypass
  /bypass.*auth/i,
  /disable.*security/i,
  /remove.*validation/i,
  /skip.*check/i,
  /turn off.*safety/i,
  /ignore (your|previous|the) (rules|instructions|safety)/i,

  // Credential exposure
  /hardcode.*password/i,
  /expose.*secret/i,
  /log.*credential/i,
  /print.*token/i,
  /console\.log\s*\([^)]*(?:token|secret|key|password|credential)/i,

  // Destructive operations
  /\bdelete.*all\b/i,
  /\bdrop\s+(?:database|table)/i,
  /\brm\s+-rf/i,
  /truncate\s+table/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/, // fork bomb shape

  // Code-execution sinks
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /child_process/i,
  /\bexec(?:Sync)?\s*\(/i,
  /\bspawn(?:Sync)?\s*\(/i,
  /\b__import__\b/i,

  // Shell injection metacharacters inside model-written commit/PR text.
  // These are *very* aggressive — only used when scanning model-authored
  // strings that will land in shell-adjacent positions (commit messages,
  // PR titles), not when scanning code changes.
];

/** Shell metacharacters that must never appear in model-written shell args. */
const SHELL_INJECTION_PATTERNS: RegExp[] = [
  /\$\(/, // command substitution
  /`[^`]*`/, // backtick substitution
  />\s*\/dev\//, // redirection to device files
  /\|\s*(?:sh|bash|zsh|curl|wget|nc|netcat)\b/i, // pipe to shell or net tool
];

/**
 * Heuristic detector for plaintext secrets the agent might be tricked into
 * embedding into commit messages, PR bodies, or file contents. Patterns are
 * intentionally narrow to keep false positives low — we'd rather miss an
 * obfuscated leak than block legitimate code changes.
 */
const SECRET_SHAPE_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub PAT/OAuth/server-to-server
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
];

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export class SafetyChecker {
  /** Check if a tool call is safe to execute. */
  async checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    _context: AgentContext
  ): Promise<SafetyCheckResult> {
    // Path-shaped arguments are validated by the tools themselves via
    // resolveSafePath() before they ever reach the filesystem. We re-check
    // here as a defense-in-depth seatbelt against a tool that forgets.
    const pathLikeKeys = ['filePath', 'path', 'dirPath', 'file'];
    for (const key of pathLikeKeys) {
      const v = args[key];
      if (typeof v === 'string' && isProtectedPath(v)) {
        return {
          safe: false,
          reason: `Tool ${toolName} attempted to touch a protected path: ${v}`,
          severity: 'critical',
        };
      }
    }
    // Path arrays (e.g. stageFiles).
    if (toolName === 'stageFiles' && Array.isArray(args.files)) {
      for (const f of args.files) {
        if (typeof f !== 'string' || isProtectedPath(f) || f === '.' || f === '-A' || f.startsWith('-')) {
          return {
            safe: false,
            reason: `stageFiles rejected entry: ${String(f)}`,
            severity: 'high',
          };
        }
      }
    }

    return { safe: true };
  }

  /** Check if a proposed change is safe to apply. */
  async checkChange(change: ProposedChange): Promise<SafetyCheckResult> {
    if (isProtectedPath(change.filePath)) {
      return {
        safe: false,
        reason: `Cannot modify protected file: ${change.filePath}`,
        severity: 'critical',
      };
    }

    if (change.content && this.containsHarmfulPattern(change.content)) {
      return {
        safe: false,
        reason: 'Content contains potentially harmful patterns',
        severity: 'high',
      };
    }

    if (change.content && this.containsSecretShape(change.content)) {
      return {
        safe: false,
        reason: 'Content matches a known secret shape (token / private key)',
        severity: 'critical',
      };
    }

    return { safe: true };
  }

  /**
   * Validate an issue for auto-fix eligibility. This is the first gate before
   * an agent processes an issue. The real trust gate is the maintainer-applied
   * `auto-fix-approved` label enforced in bug-fix-agent.ts; this is the
   * secondary content filter.
   */
  validateIssueForAutoFix(
    title: string,
    body: string
  ): { safe: boolean; reason?: string } {
    const combined = `${title}\n${body}`;

    if (this.containsHarmfulPattern(combined)) {
      return {
        safe: false,
        reason: 'Issue contains potentially harmful request patterns',
      };
    }

    if (this.containsSecretShape(combined)) {
      return {
        safe: false,
        reason: 'Issue body contains what looks like a credential',
      };
    }

    return { safe: true };
  }

  /**
   * Scan model-authored text that is about to be persisted to a public
   * surface (PR title, PR body, commit message). These strings hit shell
   * positions and end up in the commit log forever, so the bar is high:
   *   - no shell metacharacters (`$()`, backticks, pipes to sh)
   *   - no secret shapes
   *   - no harmful-instruction echoes
   */
  checkPRMetadata(parts: {
    title?: string;
    body?: string;
    commitMessage?: string;
    branchName?: string;
  }): SafetyCheckResult {
    const fields: Array<[string, string | undefined]> = [
      ['title', parts.title],
      ['body', parts.body],
      ['commitMessage', parts.commitMessage],
      ['branchName', parts.branchName],
    ];

    for (const [name, value] of fields) {
      if (!value) continue;

      if (name === 'branchName') {
        // Branch names go straight to `git checkout -b` and `git push`. Be
        // strict: only [A-Za-z0-9._/-], no leading dash.
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(value)) {
          return {
            safe: false,
            reason: `Branch name has disallowed characters: ${value}`,
            severity: 'high',
          };
        }
        continue;
      }

      if (this.containsShellInjection(value)) {
        return {
          safe: false,
          reason: `${name} contains shell metacharacters`,
          severity: 'high',
        };
      }

      if (this.containsSecretShape(value)) {
        return {
          safe: false,
          reason: `${name} contains what looks like a credential`,
          severity: 'critical',
        };
      }

      if (this.containsHarmfulPattern(value)) {
        return {
          safe: false,
          reason: `${name} contains a harmful pattern`,
          severity: 'high',
        };
      }
    }

    return { safe: true };
  }

  private containsHarmfulPattern(content: string): boolean {
    return HARMFUL_PATTERNS.some((p) => p.test(content));
  }

  private containsSecretShape(content: string): boolean {
    return SECRET_SHAPE_PATTERNS.some((p) => p.test(content));
  }

  private containsShellInjection(content: string): boolean {
    return SHELL_INJECTION_PATTERNS.some((p) => p.test(content));
  }
}
