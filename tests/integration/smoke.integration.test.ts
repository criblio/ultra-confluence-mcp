/**
 * API correctness smoke test.
 *
 * For every read-shaped tool the MCP server exposes, this test makes
 * one live call against the configured Confluence instance through
 * `handleTool` (so the trim layer runs too) and asserts the call
 * returns without throwing.
 *
 * Scope: catches "tool path is wrong / API returns 4xx" regressions.
 * Does NOT validate response *shape* — that's what the unit tests
 * around `applyTrim` do. The point here is "every tool the agent can
 * see actually works."
 *
 * Auto-discovers all IDs from the live instance so the test runs
 * against any tenant. Tools that would need fixtures we can't find
 * (e.g. an attachment ID, a content property ID) self-skip with a
 * console note rather than failing the suite.
 *
 * Self-skips entirely when CONFLUENCE_HOST/EMAIL/API_TOKEN are unset,
 * matching the pattern in markdown-tools.integration.test.ts.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getConfig } from "../../src/config.js";
import { ConfluenceClient } from "../../src/auth/confluence-client.js";
import { handleTool } from "../../src/tools/index.js";

function hasConfluenceEnv(): boolean {
  try {
    getConfig();
    return true;
  } catch {
    return false;
  }
}

interface DiscoveredFixtures {
  spaceId?: number;
  spaceKey?: string;
  pageId?: number;
  pageVersionNumber?: number;
  blogPostId?: number;
  blogPostVersionNumber?: number;
  attachmentId?: string;
  propertyId?: number;
  accountId?: string;
}

describe.runIf(hasConfluenceEnv())(
  "API smoke — every read tool returns without 4xx/5xx",
  { timeout: 60_000 },
  () => {
    let client: ConfluenceClient;
    const fx: DiscoveredFixtures = {};

    beforeAll(async () => {
      client = new ConfluenceClient(getConfig());

      // Discover a working space.
      const spaces = await client.get<{
        results: Array<{ id: string; key: string }>;
      }>("/spaces", { limit: 1 });
      const space = spaces.results?.[0];
      if (space) {
        fx.spaceId = Number(space.id);
        fx.spaceKey = space.key;
      }

      // Discover a working page + a real version number on it.
      // (Confluence prunes old versions on heavy editing, so v1 may
      // not exist any more — discover a current version instead.)
      const pages = await client.get<{
        results: Array<{ id: string; version?: { number?: number } }>;
      }>("/pages", { limit: 1 });
      const page = pages.results?.[0];
      if (page) {
        fx.pageId = Number(page.id);
        fx.pageVersionNumber = page.version?.number;
      }

      // Discover a working blog post (optional — many spaces have none).
      try {
        const blogs = await client.get<{
          results: Array<{ id: string; version?: { number?: number } }>;
        }>("/blogposts", { limit: 1 });
        const blog = blogs.results?.[0];
        if (blog) {
          fx.blogPostId = Number(blog.id);
          fx.blogPostVersionNumber = blog.version?.number;
        }
      } catch {
        // ignore
      }

      // Discover an attachment (optional).
      try {
        const atts = await client.get<{
          results: Array<{ id: string }>;
        }>("/attachments", { limit: 1 });
        fx.attachmentId = atts.results?.[0]?.id;
      } catch {
        // ignore
      }

      // Discover a content property on the working page (optional).
      if (fx.pageId !== undefined) {
        try {
          const props = await client.get<{
            results: Array<{ id: string }>;
          }>(`/pages/${fx.pageId}/properties`, { limit: 1 });
          fx.propertyId = props.results?.[0]
            ? Number(props.results[0].id)
            : undefined;
        } catch {
          // ignore
        }
      }

      // Current user account id (used by confluence_get_user).
      try {
        const me = (await handleTool(client, "confluence_get_current_user", {})) as {
          accountId?: string;
        };
        fx.accountId = me.accountId;
      } catch {
        // If get_current_user itself is broken the test for it below
        // will fail, which is the correct signal.
      }
    });

    /**
     * Helper: call `handleTool` and assert no throw. Returns the trimmed
     * response so individual tests can spot-check shape.
     */
    async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = await handleTool(client, name, args);
      expect(result).toBeDefined();
      return result;
    }

    function skipIfMissing(...keys: Array<keyof DiscoveredFixtures>): boolean {
      const missing = keys.filter((k) => fx[k] === undefined);
      if (missing.length > 0) {
        console.log(
          `  skip — fixture(s) not discoverable: ${missing.join(", ")}`
        );
        return true;
      }
      return false;
    }

    it("server", async () => {
      await call("confluence_get_server_info", {});
    });

    describe("user", () => {
      it("get_current_user", async () => {
        await call("confluence_get_current_user", {});
      });
      it("get_user", async () => {
        if (skipIfMissing("accountId")) return;
        await call("confluence_get_user", { accountId: fx.accountId });
      });
      it("get_users", async () => {
        await call("confluence_get_users", { limit: 2 });
      });
    });

    describe("space", () => {
      it("get_spaces", async () => {
        await call("confluence_get_spaces", { limit: 1 });
      });
      it("get_space", async () => {
        if (skipIfMissing("spaceId")) return;
        await call("confluence_get_space", { spaceId: fx.spaceId });
      });
      it("get_space_labels", async () => {
        if (skipIfMissing("spaceId")) return;
        await call("confluence_get_space_labels", {
          spaceId: fx.spaceId,
          limit: 1,
        });
      });
    });

    describe("page", () => {
      it("get_pages", async () => {
        await call("confluence_get_pages", { limit: 1 });
      });
      it("get_page", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page", { pageId: fx.pageId });
      });
      it("get_pages_in_space", async () => {
        if (skipIfMissing("spaceId")) return;
        await call("confluence_get_pages_in_space", {
          spaceId: fx.spaceId,
          limit: 1,
        });
      });
      it("get_page_ancestors", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_ancestors", { pageId: fx.pageId });
      });
      it("get_page_descendants", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_descendants", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_children", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_children", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_versions", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_versions", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_version", async () => {
        if (skipIfMissing("pageId", "pageVersionNumber")) return;
        await call("confluence_get_page_version", {
          pageId: fx.pageId,
          versionNumber: fx.pageVersionNumber,
        });
      });
      it("get_page_attachments", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_attachments", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_footer_comments", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_footer_comments", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_inline_comments", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_inline_comments", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_labels", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_labels", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_properties", async () => {
        if (skipIfMissing("pageId")) return;
        await call("confluence_get_page_properties", {
          pageId: fx.pageId,
          limit: 1,
        });
      });
      it("get_page_property", async () => {
        if (skipIfMissing("pageId", "propertyId")) return;
        await call("confluence_get_page_property", {
          pageId: fx.pageId,
          propertyId: fx.propertyId,
        });
      });
    });

    describe("blog post", () => {
      it("get_blog_posts", async () => {
        await call("confluence_get_blog_posts", { limit: 1 });
      });
      it("get_blog_post", async () => {
        if (skipIfMissing("blogPostId")) return;
        await call("confluence_get_blog_post", {
          blogPostId: fx.blogPostId,
        });
      });
      it("get_blog_posts_in_space", async () => {
        if (skipIfMissing("spaceId")) return;
        await call("confluence_get_blog_posts_in_space", {
          spaceId: fx.spaceId,
          limit: 1,
        });
      });
      it("get_blog_post_versions", async () => {
        if (skipIfMissing("blogPostId")) return;
        await call("confluence_get_blog_post_versions", {
          blogPostId: fx.blogPostId,
          limit: 1,
        });
      });
      it("get_blog_post_version", async () => {
        if (skipIfMissing("blogPostId", "blogPostVersionNumber")) return;
        await call("confluence_get_blog_post_version", {
          blogPostId: fx.blogPostId,
          versionNumber: fx.blogPostVersionNumber,
        });
      });
      it("get_blog_post_attachments", async () => {
        if (skipIfMissing("blogPostId")) return;
        await call("confluence_get_blog_post_attachments", {
          blogPostId: fx.blogPostId,
          limit: 1,
        });
      });
      it("get_blog_post_footer_comments", async () => {
        if (skipIfMissing("blogPostId")) return;
        await call("confluence_get_blog_post_footer_comments", {
          blogPostId: fx.blogPostId,
          limit: 1,
        });
      });
      it("get_blog_post_labels", async () => {
        if (skipIfMissing("blogPostId")) return;
        await call("confluence_get_blog_post_labels", {
          blogPostId: fx.blogPostId,
          limit: 1,
        });
      });
    });

    describe("attachment", () => {
      it("get_attachment", async () => {
        if (skipIfMissing("attachmentId")) return;
        await call("confluence_get_attachment", {
          attachmentId: fx.attachmentId,
        });
      });
    });

    describe("search", () => {
      it("cql_search", async () => {
        await call("confluence_cql_search", {
          cql: "type=page",
          limit: 1,
        });
      });
      it("search_content", async () => {
        await call("confluence_search_content", {
          query: "x",
          limit: 1,
        });
      });

      // The four generic-content types previously all returned HTTP 400
      // because the v2 search endpoint doesn't exist for them. Each
      // type is exercised independently so the suite catches a per-type
      // regression, not just "one of them works".
      for (const type of ["FOLDERS", "DATABASES", "WHITEBOARDS", "EMBEDS"] as const) {
        it(`search_generic_content (${type})`, async () => {
          await call("confluence_search_generic_content", {
            type,
            limit: 1,
          });
        });
      }
    });
  }
);
