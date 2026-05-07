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
 */

import { readFile, writeFile, mkdir, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";

export type CacheKind = "pages" | "blogposts" | "comments";

export interface RawBody {
  value: string;
  representation: string;
}

const DEFAULT_TTL_DAYS = 7;

export function getCacheRoot(): string {
  const override = process.env.CONFLUENCE_BODY_CACHE_DIR;
  if (override && override.length > 0) {
    return resolve(override);
  }
  return join(tmpdir(), "confluence-mcp");
}

function getTtlMs(): number {
  const raw = process.env.CONFLUENCE_BODY_CACHE_TTL_DAYS;
  const days =
    raw !== undefined && raw !== "" && Number.isFinite(Number(raw))
      ? Number(raw)
      : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function sanitizeIdComponent(s: string | number): string {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildBodyPath(
  kind: CacheKind,
  id: string | number,
  version: number
): string {
  return join(
    getCacheRoot(),
    kind,
    `${sanitizeIdComponent(id)}-v${sanitizeIdComponent(version)}.json`
  );
}

/**
 * Write the raw body wrapper to disk and return the absolute path.
 * Re-uses an existing file when one is already present (write is
 * idempotent — same id+version always lands at the same path).
 */
export async function writePageBody(
  kind: CacheKind,
  id: string | number,
  version: number,
  body: RawBody
): Promise<string> {
  const path = buildBodyPath(kind, id, version);
  await mkdir(join(getCacheRoot(), kind), { recursive: true });
  await writeFile(path, JSON.stringify(body), "utf-8");
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
  if (!path.startsWith(root + "/") && path !== root) {
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
 * Remove cache entries older than the configured TTL. Best-effort:
 * silently swallows errors so a broken cache directory can't crash
 * server startup.
 */
export async function prunePageCache(): Promise<void> {
  const root = getCacheRoot();
  const ttl = getTtlMs();
  const cutoff = Date.now() - ttl;

  let kinds: string[];
  try {
    kinds = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(
    kinds.map(async (kind) => {
      const dir = join(root, kind);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
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
          } catch {
            /* ignore */
          }
        })
      );
    })
  );
}
