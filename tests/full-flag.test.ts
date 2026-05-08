import { describe, it, expect } from "vitest";
import { handleTool } from "../src/tools/index.js";
import type { ConfluenceClient } from "../src/auth/confluence-client.js";

interface RecordedCall {
  path: string;
  queryParams?: Record<string, unknown>;
}

function makeStubClient(response: unknown): {
  client: ConfluenceClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client = {
    async get(
      path: string,
      queryParams?: Record<string, unknown>
    ): Promise<unknown> {
      calls.push({ path, queryParams });
      return response;
    },
    async getV1(
      path: string,
      queryParams?: Record<string, unknown>
    ): Promise<unknown> {
      calls.push({ path, queryParams });
      return response;
    },
    async post() {
      return response;
    },
    async put() {
      return response;
    },
    async delete() {
      return response;
    },
  } as unknown as ConfluenceClient;
  return { client, calls };
}

const SAMPLE_PAGE = {
  id: "1",
  title: "T",
  spaceId: "100",
  status: "current",
  body: {
    atlas_doc_format: {
      value: JSON.stringify({
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        ],
      }),
      representation: "atlas_doc_format",
    },
  },
};

describe("body-format defaulting respects full=true", () => {
  it("forces atlas_doc_format on confluence_get_page when full is unset", async () => {
    const { client, calls } = makeStubClient(SAMPLE_PAGE);
    await handleTool(client, "confluence_get_page", { pageId: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].queryParams?.["body-format"]).toBe("atlas_doc_format");
  });

  it("does NOT force a default when full=true", async () => {
    const { client, calls } = makeStubClient(SAMPLE_PAGE);
    await handleTool(client, "confluence_get_page", { pageId: 1, full: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].queryParams?.["body-format"]).toBeUndefined();
  });

  it("honors an explicit bodyFormat regardless of full", async () => {
    const { client, calls } = makeStubClient(SAMPLE_PAGE);
    await handleTool(client, "confluence_get_page", {
      pageId: 1,
      bodyFormat: "storage",
      full: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].queryParams?.["body-format"]).toBe("storage");
  });

  it("forces atlas_doc_format on confluence_get_blog_post when full is unset", async () => {
    const { client, calls } = makeStubClient(SAMPLE_PAGE);
    await handleTool(client, "confluence_get_blog_post", { blogPostId: 1 });
    expect(calls[0].queryParams?.["body-format"]).toBe("atlas_doc_format");
  });

  it("does NOT force a default on confluence_get_blog_post when full=true", async () => {
    const { client, calls } = makeStubClient(SAMPLE_PAGE);
    await handleTool(client, "confluence_get_blog_post", {
      blogPostId: 1,
      full: true,
    });
    expect(calls[0].queryParams?.["body-format"]).toBeUndefined();
  });

  it("forces atlas_doc_format on comment list reads when full is unset", async () => {
    const { client, calls } = makeStubClient({ results: [], _links: {} });
    await handleTool(client, "confluence_get_page_footer_comments", {
      pageId: 1,
    });
    expect(calls[0].queryParams?.["body-format"]).toBe("atlas_doc_format");
  });

  it("does NOT force a default on comment reads when full=true", async () => {
    const { client, calls } = makeStubClient({ results: [], _links: {} });
    await handleTool(
      client,
      "confluence_get_page_footer_comments",
      { pageId: 1, full: true }
    );
    expect(calls[0].queryParams?.["body-format"]).toBeUndefined();
  });
});
