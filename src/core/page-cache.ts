/**
 * On-disk cache for raw Confluence page/blog-post/comment bodies.
 *
 * When a body's markdown rendering would exceed the inline limit, the
 * trim layer writes the raw API response (`{ value, representation }`)
 * to disk and surfaces a stable, agent-readable file path. The
 * `confluence_render_body` tool reads from that path on demand and runs
 * the same converters used inline.
 *
 * Path scheme: `{cacheRoot}/{kind}/{id}-v{version}.json`
 *   - `kind` is `pages`, `blogposts`, or `comments`.
 *   - `version` is Confluence's version number — the file is content-
 *     addressed by id+version, so updates create a new file rather than
 *     overwriting and stale entries are easy to identify.
 *
 * Cache root defaults to `${os.tmpdir()}/confluence-mcp` and can be
 * overridden via `CONFLUENCE_BODY_CACHE_DIR`. Pruning runs on startup
 * and removes files older than `CONFLUENCE_BODY_CACHE_TTL_DAYS` (default
 * 7 days).
 *
 * Per-file size cap: writes above `CONFLUENCE_BODY_CACHE_MAX_BYTES`
 * (default 5MB) throw `BodyCacheTooLargeError` so the trim layer can
 * fall through to an inline excerpt rather than fill the disk.
 */

import { writeFile, mkdir, readdir, stat, rm, rename, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, isAbsolute, relative } from "node:path";
import { randomBytes } from "node:crypto";

export type CacheKind = "pages" | "blogposts" | "comments";

export interface RawBody {
  value: string;
  representation: string;
}

const DEFAULT_TTL_DAYS = 7;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB per file

export class BodyCacheTooLargeError extends Error {
  constructor(public readonly bytes: number, public readonly max: number) {
    super(
      `body would exceed cache size cap (${bytes} > ${max}); pass through to inline excerpt`
    );
    this.name = "BodyCacheTooLargeError";
  }
}

export function getCacheRoot(): string {
  const override = process.env.CONFLUENCE_BODY_CACHE_DIR;
  if (override && override.length > 0) {
    return resolve(override);
  }
  return resolve(join(tmpdir(), "confluence-mcp"));
}

function getTtlMs(): number {
  const raw = process.env.CONFLUENCE_BODY_CACHE_TTL_DAYS;
  const days =
    raw !== undefined && raw !== "" && Number.isFinite(Number(raw))
      ? Number(raw)
      : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function getMaxBytes(): number {
  const raw = process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES;
  if (raw === undefined || raw === "") return DEFAULT_MAX_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES;
}

/**
 * Sanitize a path component derived from possibly-untrusted input
 * (Confluence ids can contain unusual characters depending on token
 * scope/server config). Replaces anything outside `[A-Za-z0-9_-]` with
 * `_` so the resulting filename can't escape the cache directory.
 */
function sanitizeIdComponent(s: string | number): string {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildBodyPath(
  kind: CacheKind,
  id: string | number,
  version: number
): string {
  // `version: number` always serializes to `[0-9]+`, so no sanitization
  // needed there — only `id` is potentially user-controlled.
  return join(
    getCacheRoot(),
    kind,
    `${sanitizeIdComponent(id)}-v${String(version)}.json`
  );
}

/**
 * Write the raw body wrapper to disk and return the absolute path.
 *
 * Atomic via tmp + rename: the JSON is written to
 * `${path}.${pid}-${rand}.tmp` and renamed into place once flushed, so
 * a concurrent reader never observes a partial file. Two writers for
 * the same id+version may race the rename; the loser's tmp file is
 * cleaned up by `rename`'s overwrite semantics.
 *
 * Throws `BodyCacheTooLargeError` when the serialized body exceeds
 * `CONFLUENCE_BODY_CACHE_MAX_BYTES`. Callers should treat this as a
 * signal to fall back to an inline excerpt rather than abort.
 */
export async function writePageBody(
  kind: CacheKind,
  id: string | number,
  version: number,
  body: RawBody
): Promise<string> {
  const json = JSON.stringify(body);
  // Use byte length, not String#length — String#length is UTF-16 code
  // units, which under-counts emoji and many CJK code points by ~2×.
  // The on-disk file is UTF-8, so the cap should match.
  const bytes = Buffer.byteLength(json, "utf-8");
  const max = getMaxBytes();
  if (bytes > max) {
    throw new BodyCacheTooLargeError(bytes, max);
  }

  const path = buildBodyPath(kind, id, version);
  await mkdir(join(getCacheRoot(), kind), { recursive: true });

  const tmpPath = `${path}.${process.pid}-${randomBytes(4).toString(
    "hex"
  )}.tmp`;
  await writeFile(tmpPath, json, "utf-8");
  try {
    await rename(tmpPath, path);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
  return path;
}

/**
 * Read a previously written raw body from disk. Throws if the path is
 * outside the cache root (defense against arbitrary file reads via
 * crafted refs) or if the file is missing/malformed.
 */
export async function readPageBody(path: string): Promise<RawBody> {
  if (!isAbsolute(path)) {
    throw new Error(`bodyPath must be absolute: ${path}`);
  }
  const root = getCacheRoot();
  const rel = relative(root, path);
  // `path.relative` produces an empty string when `path === root`, a
  // path starting with `..` when `path` is outside `root`, and an
  // absolute path on Windows when the two are on different drives.
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `bodyPath is outside the cache root (${root}): ${path}`
    );
  }
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`bodyPath does not contain valid JSON: ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as RawBody).value !== "string" ||
    typeof (parsed as RawBody).representation !== "string"
  ) {
    throw new Error(
      `bodyPath does not contain a {value, representation} object: ${path}`
    );
  }
  return parsed as RawBody;
}

/**
 * Remove cache entries older than the configured TTL. Best-effort: a
 * broken cache directory can't crash server startup, but failures are
 * logged to stderr so they're not silently lost. Set
 * `CONFLUENCE_BODY_CACHE_DEBUG=1` to log the cutoff timestamp too.
 */
export async function prunePageCache(): Promise<void> {
  const root = getCacheRoot();
  const ttl = getTtlMs();
  const cutoff = Date.now() - ttl;

  if (process.env.CONFLUENCE_BODY_CACHE_DEBUG) {
    console.error(
      `[confluence-mcp] pruning ${root}, cutoff ${new Date(
        cutoff
      ).toISOString()}`
    );
  }

  let kinds: string[];
  try {
    kinds = await readdir(root);
  } catch (err) {
    // ENOENT on the root is normal (first run); log everything else.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[confluence-mcp] prune readdir(${root}) failed:`, err);
    }
    return;
  }

  await Promise.all(
    kinds.map(async (kind) => {
      const dir = join(root, kind);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        console.error(
          `[confluence-mcp] prune readdir(${dir}) failed:`,
          err
        );
        return;
      }
      await Promise.all(
        entries.map(async (entry) => {
          const path = join(dir, entry);
          try {
            const st = await stat(path);
            if (st.mtimeMs < cutoff) {
              await rm(path, { force: true });
            }
          } catch (err) {
            console.error(
              `[confluence-mcp] prune stat/rm(${path}) failed:`,
              err
            );
          }
        })
      );
    })
  );
}
