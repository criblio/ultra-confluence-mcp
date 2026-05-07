/**
 * Response projectors for the MCP tool layer. Strips bloated fields
 * (`_links`, `_expandable`, raw `body.*.value`, etc.) from Confluence
 * API responses to keep the MCP context window manageable.
 *
 * PR1 scope: drop bodies entirely (lists get nothing; single reads get
 * `bodyAvailable: true`). PR2 will add markdown body conversion.
 */

import { extractNextCursor } from "./pagination.js";
import { getTrimKind, TrimKind } from "./trim-registry.js";

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
      return projectPage(raw);
    case "pageList":
      return projectList(raw, projectPageNoBody);
    case "blogPost":
      return projectBlogPost(raw);
    case "blogPostList":
      return projectList(raw, projectBlogPostNoBody);
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

// ---- Pages ----

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

/** Single-page projection: includes a placeholder for body presence. */
function projectPage(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = projectPageBase(raw);
  if (isObject(raw.body)) {
    out.bodyAvailable = true;
  }
  // Optional sub-collections requested via includeLabels/etc — keep their
  // results array but drop the meta/_links wrapper.
  passthroughIncludes(raw, out);
  return out;
}

function projectPageNoBody(p: Record<string, unknown>): unknown {
  return projectPageBase(p);
}

function passthroughIncludes(
  raw: Record<string, unknown>,
  out: Record<string, unknown>
): void {
  for (const key of ["labels", "properties", "operations", "likes", "versions"] as const) {
    const sub = raw[key];
    if (isObject(sub) && Array.isArray(sub.results)) {
      out[key] = sub.results;
    }
  }
}

// ---- Blog posts (same shape as pages) ----

function projectBlogPost(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const out = projectPageBase(raw);
  if (isObject(raw.body)) {
    out.bodyAvailable = true;
  }
  passthroughIncludes(raw, out);
  return out;
}

function projectBlogPostNoBody(p: Record<string, unknown>): unknown {
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
  if (isObject(raw.body)) {
    out.bodyAvailable = true;
  }
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
