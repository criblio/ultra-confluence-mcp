/**
 * Response projectors for the MCP tool layer. Strips bloated fields
 * (`_links`, `_expandable`, raw `body.*.value`, etc.) from Confluence
 * API responses, and converts ADF or storage XHTML bodies into compact
 * markdown.
 *
 * Single-page reads emit `bodyMarkdown` inline when the markdown fits
 * under BODY_INLINE_LIMIT. When it doesn't, the raw body is written to
 * the on-disk page cache and the response carries a `bodyPath` ref —
 * agents call `confluence_render_body` with that path to render the
 * full body on demand without re-hitting Confluence. List reads always
 * drop bodies entirely.
 */

import { adfToMarkdown } from "../utils/adf-to-markdown.js";
import { storageXhtmlToMarkdown } from "../utils/storage-to-markdown.js";
import {
  CacheKind,
  RawBody,
  writePageBody,
} from "./page-cache.js";
import { extractNextCursor } from "./pagination.js";
import { getTrimKind, TrimKind } from "./trim-registry.js";

const DEFAULT_BODY_INLINE_LIMIT = 4000;

function getBodyInlineLimit(): number {
  const raw = process.env.CONFLUENCE_BODY_INLINE_LIMIT;
  if (!raw) return DEFAULT_BODY_INLINE_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BODY_INLINE_LIMIT;
}

export interface ApplyTrimOptions {
  full?: boolean;
  disabled?: boolean;
}

export async function applyTrim(
  toolName: string,
  raw: unknown,
  opts: ApplyTrimOptions = {}
): Promise<unknown> {
  if (opts.full || opts.disabled) {
    return raw;
  }

  const kind = getTrimKind(toolName);
  const projected = project(kind, raw);
  await offloadOversizeBodies(projected);
  return projected;
}

/**
 * Walk the projected response and replace any pending body-offload
 * markers with `bodyPath` references after writing the raw body to the
 * on-disk page cache. Decoupled from the synchronous projector pass so
 * `applyTrim` can stay pure aside from this single async finalize step.
 */
async function offloadOversizeBodies(value: unknown): Promise<void> {
  if (!isObject(value)) return;

  const pending = value[OFFLOAD_MARKER];
  if (isOffloadRequest(pending)) {
    delete value[OFFLOAD_MARKER];
    try {
      const path = await writePageBody(
        pending.kind,
        pending.id,
        pending.version,
        pending.body
      );
      value.bodyPath = path;
    } catch (err) {
      // Cache write failure shouldn't block the read — fall back to
      // an excerpt so the agent at least gets something usable.
      value.bodyMarkdown = pending.excerpt;
      value.bodyCacheError =
        err instanceof Error ? err.message : String(err);
    }
  }

  // Sub-collections (labels/properties/etc.) and list `results` arrays
  // shouldn't contain bodies in our current projection, but recurse for
  // future-proofness.
  if (Array.isArray((value as Record<string, unknown>).results)) {
    for (const item of (value as { results: unknown[] }).results) {
      await offloadOversizeBodies(item);
    }
  }
}

interface OffloadRequest {
  kind: CacheKind;
  id: string | number;
  version: number;
  body: RawBody;
  excerpt: string;
}

const OFFLOAD_MARKER = "__pendingOffload" as const;

function isOffloadRequest(x: unknown): x is OffloadRequest {
  if (!isObject(x)) return false;
  return (
    typeof x.kind === "string" &&
    (typeof x.id === "string" || typeof x.id === "number") &&
    typeof x.version === "number" &&
    isObject(x.body) &&
    typeof x.body.value === "string"
  );
}

function project(kind: TrimKind, raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;

  switch (kind) {
    case "page":
      return projectPage(raw, "pages");
    case "blogPost":
      return projectPage(raw, "blogposts");
    case "pageList":
    case "blogPostList":
      return projectList(raw, projectPageNoBody);
    case "comment":
      return projectComment(raw);
    case "commentList":
      return projectList(raw, (item) => projectComment(item));
    case "search":
      return projectSearch(raw);
    case "attachment":
      return projectAttachment(raw);
    case "attachmentList":
      return projectList(raw, projectAttachment);
    case "space":
      return projectSpace(raw);
    case "spaceList":
      return projectList(raw, projectSpace);
    case "label":
      return projectLabel(raw);
    case "labelList":
      return projectList(raw, projectLabel);
    case "version":
      return projectVersion(raw);
    case "versionList":
      return projectList(raw, projectVersion);
    case "user":
      return projectUser(raw);
    case "userList":
      return projectList(raw, projectUser);
    case "ancestorList":
      return projectList(raw, projectAncestor);
    case "passthrough":
    default:
      return raw;
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function pick<T extends Record<string, unknown>>(
  obj: Record<string, unknown>,
  keys: readonly string[]
): T {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Project the standard `{ results, _links: { next } }` paginated shape
 * to `{ results, nextCursor? }` and apply `itemFn` to each result.
 */
function projectList(
  raw: unknown,
  itemFn: (item: Record<string, unknown>) => unknown
): unknown {
  if (!isObject(raw)) return raw;

  const results = Array.isArray(raw.results) ? raw.results : [];
  const projected = results.map((item) =>
    isObject(item) ? itemFn(item) : item
  );

  const out: Record<string, unknown> = { results: projected };

  const links = isObject(raw._links) ? raw._links : undefined;
  const nextCursor = extractNextCursor(links?.next);
  if (nextCursor) {
    out.nextCursor = nextCursor;
  }

  return out;
}

function trimWebuiLink(links: unknown): string | undefined {
  if (!isObject(links)) return undefined;
  const webui = links.webui;
  return typeof webui === "string" && webui.length > 0 ? webui : undefined;
}

function trimVersion(version: unknown): unknown {
  if (!isObject(version)) return undefined;
  return pick(version, ["number", "createdAt", "message"]);
}

// ---- Pages and blog posts (same shape) ----

function projectPageBase(p: Record<string, unknown>): Record<string, unknown> {
  const out = pick(p, [
    "id",
    "title",
    "spaceId",
    "parentId",
    "parentType",
    "status",
    "authorId",
    "createdAt",
  ]);
  const version = trimVersion(p.version);
  if (version) out.version = version;
  const webui = trimWebuiLink(p._links);
  if (webui) out._links = { webui };
  return out;
}

/** Single page/blog-post: converts body to markdown with on-disk offload. */
function projectPage(raw: unknown, kind: CacheKind): unknown {
  if (!isObject(raw)) return raw;
  const out = projectPageBase(raw);
  attachBodyMarkdown(raw, out, kind);
  // Optional sub-collections requested via includeLabels/etc — keep their
  // results array but drop the meta/_links wrapper.
  for (const key of ["labels", "properties", "operations", "likes", "versions"] as const) {
    const sub = raw[key];
    if (isObject(sub) && Array.isArray(sub.results)) {
      out[key] = sub.results;
    }
  }
  return out;
}

/**
 * Convert `raw.body` to markdown and either inline it or queue an
 * on-disk offload (resolved later by `offloadOversizeBodies`) when it
 * exceeds `BODY_INLINE_LIMIT`. Drops the original body shape regardless.
 */
function attachBodyMarkdown(
  raw: Record<string, unknown>,
  out: Record<string, unknown>,
  kind: CacheKind
): void {
  const body = raw.body;
  if (!isObject(body)) return;

  const rawBody = pickBestRepresentation(body);
  if (!rawBody) {
    out.bodyAvailable = true;
    return;
  }

  const markdown = renderRawBody(rawBody);
  out.bodyFullSize = markdown.length;

  const limit = getBodyInlineLimit();
  if (markdown.length <= limit) {
    out.bodyMarkdown = markdown;
    return;
  }

  // Markdown is too big to inline — queue the raw body for offload.
  // The async pass in applyTrim() turns this into a `bodyPath` ref.
  const id = typeof raw.id === "string" || typeof raw.id === "number" ? raw.id : "unknown";
  const version = readVersionNumber(raw.version);
  const offload: OffloadRequest = {
    kind,
    id,
    version,
    body: rawBody,
    excerpt: `${markdown.slice(0, limit)}\n\n[truncated — call confluence_render_body with bodyPath]`,
  };
  out[OFFLOAD_MARKER] = offload;
}

function readVersionNumber(version: unknown): number {
  if (isObject(version) && typeof version.number === "number") {
    return version.number;
  }
  return 0;
}

/**
 * Pick the best body representation as a `{value, representation}`
 * pair. Preference: atlas_doc_format → storage → view. The raw shape
 * (rather than rendered markdown) is what gets persisted to the cache,
 * so the converter can run lazily when the agent calls
 * `confluence_render_body`.
 */
function pickBestRepresentation(
  body: Record<string, unknown>
): RawBody | undefined {
  for (const rep of ["atlas_doc_format", "storage", "view"] as const) {
    const part = body[rep];
    if (isObject(part) && typeof part.value === "string" && part.value.length > 0) {
      return { value: part.value, representation: rep };
    }
  }
  return undefined;
}

/** Render a `{value, representation}` pair to markdown. */
function renderRawBody(body: RawBody): string {
  switch (body.representation) {
    case "atlas_doc_format":
      return adfToMarkdown(body.value).trim();
    case "storage":
    case "view":
      return storageXhtmlToMarkdown(body.value).trim();
    default:
      return storageXhtmlToMarkdown(body.value).trim();
  }
}

function projectPageNoBody(p: Record<string, unknown>): unknown {
  return projectPageBase(p);
}

// ---- Comments ----

function projectComment(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = pick(raw, [
    "id",
    "status",
    "title",
    "pageId",
    "blogPostId",
    "parentCommentId",
    "resolutionStatus",
  ]);
  const version = trimVersion(raw.version);
  if (version) out.version = version;
  const webui = trimWebuiLink(raw._links);
  if (webui) out._links = { webui };
  attachBodyMarkdown(raw, out, "comments");
  return out;
}

// ---- Search ----

function projectSearch(raw: unknown): unknown {
  if (!isObject(raw)) return raw;

  const results = Array.isArray(raw.results) ? raw.results : [];
  const projected = results.map((r) => projectSearchResult(r));

  const out: Record<string, unknown> = {
    results: projected,
  };

  // V1 search uses start/limit/size offsets, v2 uses cursor — keep both signals.
  for (const k of ["start", "limit", "size", "totalSize", "cqlQuery"] as const) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }

  const links = isObject(raw._links) ? raw._links : undefined;
  const nextCursor = extractNextCursor(links?.next);
  if (nextCursor) out.nextCursor = nextCursor;

  return out;
}

function projectSearchResult(r: unknown): unknown {
  if (!isObject(r)) return r;

  const content = isObject(r.content) ? r.content : undefined;
  const out: Record<string, unknown> = {};

  if (content?.id) out.id = content.id;
  if (r.entityType) out.type = r.entityType;
  if (r.title ?? content?.title) out.title = r.title ?? content?.title;
  if (typeof r.excerpt === "string") {
    // Confluence excerpts come with @@@hl@@@ markers around matched terms;
    // strip them — agents don't need the highlighting hints.
    out.excerpt = (r.excerpt as string)
      .replace(/@@@hl@@@/g, "")
      .replace(/@@@endhl@@@/g, "");
  }
  if (r.url) out.url = r.url;
  if (r.lastModified) out.lastModified = r.lastModified;
  if (typeof r.score === "number") out.score = r.score;

  if (Array.isArray(r.breadcrumbs)) {
    const trail = r.breadcrumbs
      .map((b) => (isObject(b) && typeof b.label === "string" ? b.label : null))
      .filter((s): s is string => s !== null && s.length > 0);
    if (trail.length > 0) out.breadcrumbs = trail;
  }

  return out;
}

// ---- Attachments ----

function projectAttachment(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = pick(raw, [
    "id",
    "status",
    "title",
    "pageId",
    "blogPostId",
    "mediaType",
    "fileSize",
    "webuiLink",
    "downloadLink",
  ]);
  const version = trimVersion(raw.version);
  if (version) out.version = version;
  return out;
}

// ---- Spaces ----

function projectSpace(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = pick(raw, [
    "id",
    "key",
    "name",
    "type",
    "status",
    "homepageId",
    "authorId",
    "createdAt",
  ]);

  // description.{plain,view} → descriptionMarkdown (plain only — view is
  // pre-rendered HTML, drop it).
  if (isObject(raw.description)) {
    const plain = isObject(raw.description.plain) ? raw.description.plain : undefined;
    if (plain && typeof plain.value === "string" && plain.value.length > 0) {
      out.descriptionMarkdown = plain.value;
    }
  }

  const webui = trimWebuiLink(raw._links);
  if (webui) out._links = { webui };

  // Pass through optional sub-collections from includeLabels/etc.
  for (const key of ["labels", "properties", "operations"] as const) {
    const sub = raw[key];
    if (isObject(sub) && Array.isArray(sub.results)) {
      out[key] = sub.results;
    }
  }

  return out;
}

// ---- Labels ----

function projectLabel(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  return pick(raw, ["id", "name", "prefix"]);
}

// ---- Versions ----

function projectVersion(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  return pick(raw, [
    "number",
    "createdAt",
    "message",
    "minorEdit",
    "authorId",
    "pageId",
    "blogPostId",
  ]);
}

// ---- Users ----

function projectUser(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  return pick(raw, [
    "accountId",
    "accountType",
    "displayName",
    "publicName",
    "email",
  ]);
}

// ---- Ancestors ----

function projectAncestor(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  return pick(raw, [
    "id",
    "type",
    "status",
    "title",
    "spaceId",
    "parentId",
    "authorId",
    "createdAt",
  ]);
}
