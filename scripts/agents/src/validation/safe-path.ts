import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Single source of truth for "is this path safe for the agent to touch."
 *
 * Used by file-tools, git-tools, and the safety-checker so every layer agrees
 * on the path policy. If you find yourself adding a new write surface and
 * bypassing this module, stop and route through it instead.
 */

/**
 * Path patterns the agent must never read, write, stage, or commit.
 *
 * Match semantics: each entry is tested against (1) the basename and
 * (2) any path segment of the relative POSIX path. So ".env.local" matches
 * the .env.* pattern, and ".github/workflows/foo.yml" matches /^\.github$/i
 * via its second segment.
 */
export const PROTECTED_PATH_PATTERNS: RegExp[] = [
  // Secrets / credentials
  /^\.env$/i,
  /^\.env\..*/i,
  /credentials/i,
  /secrets?/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /^\.ssh$/i,
  /^\.aws$/i,
  /^\.npmrc$/i,
  /^\.gitconfig$/i,

  // CI/CD — the agent must not be able to grant itself more permissions or
  // disable safety checks by editing the workflows that govern it.
  /^\.github$/i,

  // Dependency manifests / lockfiles — package upgrades go through Dependabot,
  // not this agent.
  /^package-lock\.json$/i,
  /^npm-shrinkwrap\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /^bun\.lockb$/i,

  // The agent's own code. Letting the agent rewrite its safety layer or
  // tools would defeat every other control here.
  /^scripts$/i,

  // VCS internals
  /^\.git$/i,
];

/** Glob-style overrides allowed inside otherwise-protected directories. */
const PROTECTED_PATH_ALLOWLIST: RegExp[] = [
  // (Empty by default. If we ever need the agent to legitimately touch a file
  // under a protected dir, add a specific relative-path regex here — never
  // widen the denylist.)
];

export interface PathDecision {
  safe: boolean;
  /** The absolute resolved path, only set when safe. */
  resolved?: string;
  /** Human-readable reason; populated on rejection. */
  reason?: string;
}

/**
 * Resolve a user-supplied path inside `workingDir` and validate it. Rejects:
 *   - absolute paths
 *   - paths containing `..` segments
 *   - paths that, after resolution, escape `workingDir`
 *   - paths matching `PROTECTED_PATH_PATTERNS` (unless on the allowlist)
 *
 * Symlinks are checked separately via `verifyResolvedRealpath` once the file
 * exists — call that from `readFile`/`writeFile` after this returns.
 */
export function resolveSafePath(
  workingDir: string,
  requested: string
): PathDecision {
  if (typeof requested !== 'string' || requested.length === 0) {
    return { safe: false, reason: 'Path must be a non-empty string' };
  }

  if (path.isAbsolute(requested)) {
    return { safe: false, reason: `Absolute paths are not permitted: ${requested}` };
  }

  // Normalize once and look for `..` segments. `path.normalize` collapses
  // multiple separators, so we check the resulting segments rather than the
  // raw input — `foo/../../bar` collapses to `../bar`, which we reject.
  const normalized = path.normalize(requested);
  const segments = normalized.split(path.sep);
  if (segments.some((s) => s === '..')) {
    return { safe: false, reason: `Path escapes working directory: ${requested}` };
  }

  const resolved = path.resolve(workingDir, normalized);
  const resolvedRel = path.relative(workingDir, resolved);
  if (resolvedRel === '' || resolvedRel.startsWith('..') || path.isAbsolute(resolvedRel)) {
    // Empty rel string is the workingDir itself; we don't let the agent
    // operate on the root path as a single unit, only on entries inside.
    if (resolvedRel === '') {
      return { safe: false, reason: 'Path resolves to the working directory itself' };
    }
    return {
      safe: false,
      reason: `Path escapes working directory: ${requested}`,
    };
  }

  if (isProtectedPath(resolvedRel)) {
    return {
      safe: false,
      reason: `Path is protected from agent modification: ${resolvedRel}`,
    };
  }

  return { safe: true, resolved };
}

/**
 * After a file is resolved, verify its realpath stays inside `workingDir`.
 * Catches symlinks the agent or attacker might have planted that point at
 * `/etc/passwd`, `~/.ssh/id_rsa`, etc.
 *
 * Call AFTER `resolveSafePath`, only on paths that exist on disk. Missing
 * files (e.g. on first-write) are considered safe — there's nothing to
 * symlink-attack yet.
 */
export async function verifyResolvedRealpath(
  workingDir: string,
  resolvedAbs: string
): Promise<PathDecision> {
  let real: string;
  try {
    real = await fs.realpath(resolvedAbs);
  } catch {
    // Doesn't exist; nothing to check.
    return { safe: true, resolved: resolvedAbs };
  }
  const realRoot = await fs.realpath(workingDir).catch(() => workingDir);
  const rel = path.relative(realRoot, real);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      safe: false,
      reason: `Path resolves outside working directory via symlink: ${resolvedAbs} -> ${real}`,
    };
  }
  if (isProtectedPath(rel)) {
    return {
      safe: false,
      reason: `Symlink target is protected: ${resolvedAbs} -> ${real}`,
    };
  }
  return { safe: true, resolved: real };
}

/**
 * Pure pattern check — does a relative POSIX-style path match any protected
 * pattern? Exposed for the safety-checker to use directly on PR file lists.
 */
export function isProtectedPath(relPath: string): boolean {
  const posix = relPath.split(path.sep).join('/');

  // Allowlist first — if explicitly permitted, skip denylist.
  if (PROTECTED_PATH_ALLOWLIST.some((p) => p.test(posix))) {
    return false;
  }

  const segments = posix.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';

  for (const pattern of PROTECTED_PATH_PATTERNS) {
    if (pattern.test(basename)) return true;
    for (const seg of segments) {
      if (pattern.test(seg)) return true;
    }
  }
  return false;
}
