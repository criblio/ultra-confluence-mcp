/**
 * Confluence v2 paginated responses use `{ results, _links: { next } }`
 * where `_links.next` is a partial URL like `/wiki/api/v2/pages?cursor=ABC`.
 * Agents care about the cursor, not the full URL — extract it.
 */
export function extractNextCursor(linksNext: unknown): string | undefined {
  if (typeof linksNext !== "string" || linksNext.length === 0) {
    return undefined;
  }

  // The link can be relative (`/wiki/api/v2/pages?cursor=...`) or absolute.
  // URL needs a base to parse a relative path.
  let url: URL;
  try {
    url = new URL(linksNext, "https://placeholder.invalid");
  } catch {
    return undefined;
  }

  const cursor = url.searchParams.get("cursor");
  return cursor ?? undefined;
}
