/**
 * Response projectors for the MCP tool layer. Strips bloated fields
 * (`_links`, `_expandable`, raw `body.*.value`, etc.) from Confluence
 * API responses, and converts ADF or storage XHTML bodies into compact
 * markdown.
 *
 * Single-page reads get `bodyMarkdown` (truncated past BODY_INLINE_LIMIT
 * with a hint to retry with `full=true`). List reads always drop bodies.
 */

import { adfToMarkdown } from "../utils/adf-to-markdown.js";
import { storageXhtmlToMarkdown } from "../utils/storage-to-markdown.js";
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

export function applyTrim(
  toolName: string,
  raw: unknown,
  opts: ApplyTrimOptions = {}
): unknown {
  if (opts.full || opts.disabled) {
    return raw;
  }

  const kind = getTrimKind(toolName);
  return project(kind, raw);
}

function project(kind: TrimKind, raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;

  switch (kind) {
    case "page":
    case "blogPost":
      return projectPage(raw);
    case "pageList":
    case "blogPostList":
      return projectList(raw, projectPageNoBody);
    case "comment":
      return projectComment(raw);
    case "commentList":
      return projectList(raw, projectComment);
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

/** Single page/blog-post: converts body to markdown with truncation. */
function projectPage(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = projectPageBase(raw);
  attachBodyMarkdown(raw, out);
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
 * Convert `raw.body` (ADF JSON, storage XHTML, or rendered view HTML) into a
 * compact `bodyMarkdown` field on `out`. Truncates past the inline limit.
 * Drops the original body shape entirely.
 */
function attachBodyMarkdown(
  raw: Record<string, unknown>,
  out: Record<string, unknown>
): void {
  const body = raw.body;
  if (!isObject(body)) return;

  const markdown = bodyToMarkdown(body);
  if (markdown === undefined) {
    out.bodyAvailable = true;
    return;
  }

  const limit = getBodyInlineLimit();
  if (markdown.length <= limit) {
    out.bodyMarkdown = markdown;
    return;
  }

  const omitted = markdown.length - limit;
  out.bodyMarkdown = `${markdown.slice(0, limit)}\n\n[truncated — ${omitted} chars omitted; call again with full=true]`;
  out.bodyFullSize = markdown.length;
}

/**
 * Pick the best body representation and convert to markdown. Preference
 * order: atlas_doc_format → storage → view (HTML stripped as a last
 * resort). Returns undefined if no body can be extracted.
 */
function bodyToMarkdown(body: Record<string, unknown>): string | undefined {
  const adfValue = readBodyValue(body.atlas_doc_format);
  if (adfValue) {
    const md = adfToMarkdown(adfValue).trim();
    if (md) return md;
  }

  const storageValue = readBodyValue(body.storage);
  if (storageValue) {
    const md = storageXhtmlToMarkdown(storageValue).trim();
    if (md) return md;
  }

  const viewValue = readBodyValue(body.view);
  if (viewValue) {
    // `view` is pre-rendered HTML — the storage converter handles enough of
    // it to produce a usable approximation.
    const md = storageXhtmlToMarkdown(viewValue).trim();
    if (md) return md;
  }

  return undefined;
}

function readBodyValue(part: unknown): string | undefined {
  if (!isObject(part)) return undefined;
  return typeof part.value === "string" && part.value.length > 0
    ? part.value
    : undefined;
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
  attachBodyMarkdown(raw, out);
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
