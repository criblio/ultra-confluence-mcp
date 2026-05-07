import { describe, it, expect, vi } from "vitest";
import { handleSearchTool } from "../src/tools/search.js";
import { handlePageTool } from "../src/tools/pages.js";
import type { ConfluenceClient } from "../src/auth/confluence-client.js";

// Regression: MCP clients sometimes serialize numeric args as strings
// ("5" vs 5). The schemas must coerce so callers don't get
// "expected number, received string" rejections.

function makeStubClient() {
  const calls: Array<{ method: string; path: string; params?: unknown }> = [];
  const stub = {
    getV1: vi.fn(async (path: string, params?: unknown) => {
      calls.push({ method: "getV1", path, params });
      return { results: [], start: 0, limit: 25, size: 0 };
    }),
    get: vi.fn(async (path: string, params?: unknown) => {
      calls.push({ method: "get", path, params });
      return { id: 1, title: "stub", body: { view: { value: "" } } };
    }),
    request: vi.fn(async () => ({})),
  };
  return { client: stub as unknown as ConfluenceClient, calls };
}

describe("numeric arg coercion", () => {
  it("confluence_cql_search accepts limit as a string", async () => {
    const { client, calls } = makeStubClient();
    await handleSearchTool(client, "confluence_cql_search", {
      cql: "type=page",
      limit: "5",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({ cql: "type=page", limit: 5 });
  });

  it("confluence_search_content accepts limit as a string", async () => {
    const { client, calls } = makeStubClient();
    await handleSearchTool(client, "confluence_search_content", {
      query: "hello",
      limit: "10",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({ limit: 10 });
  });

  it("confluence_get_page accepts pageId as a string", async () => {
    const { client, calls } = makeStubClient();
    await handlePageTool(
      client,
      "confluence_get_page",
      { pageId: "12345" },
      false
    );
    expect(calls.length).toBeGreaterThan(0);
    // Path should contain the numeric id, not the string.
    const pathHit = calls.find((c) => c.path.includes("/pages/"));
    expect(pathHit?.path).toContain("/pages/12345");
  });
});
