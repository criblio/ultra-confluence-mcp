import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePageBody } from "../src/core/page-cache.js";
import { handleTool } from "../src/tools/index.js";
import type { ConfluenceClient } from "../src/auth/confluence-client.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "confluence-mcp-render-"));
  process.env.CONFLUENCE_BODY_CACHE_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.CONFLUENCE_BODY_CACHE_DIR;
  await rm(tmpRoot, { recursive: true, force: true });
});

// confluence_render_body doesn't touch the network, so a stub client is fine.
const stubClient = {} as unknown as ConfluenceClient;

describe("confluence_render_body", () => {
  it("renders an ADF body to markdown", async () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Hello" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "world" }],
        },
      ],
    };
    const path = await writePageBody("pages", 100, 1, {
      value: JSON.stringify(adf),
      representation: "atlas_doc_format",
    });
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
    })) as Record<string, unknown>;

    expect(result.bodyMarkdown).toBe("# Hello\n\nworld");
    expect(result.representation).toBe("atlas_doc_format");
    expect(typeof result.sourceLength).toBe("number");
  });

  it("renders a storage XHTML body to markdown", async () => {
    const path = await writePageBody("pages", 101, 1, {
      value: "<h2>Sub</h2><p>body text</p>",
      representation: "storage",
    });
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
    })) as Record<string, unknown>;

    expect(result.bodyMarkdown).toContain("## Sub");
    expect(result.bodyMarkdown).toContain("body text");
  });

  it("returns the raw {value, representation} when format=raw", async () => {
    const path = await writePageBody("pages", 102, 1, {
      value: "<p>abc</p>",
      representation: "storage",
    });
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
      format: "raw",
    })) as Record<string, unknown>;

    expect(result).toEqual({
      value: "<p>abc</p>",
      representation: "storage",
    });
  });

  it("rejects bodyPath outside the cache root", async () => {
    await expect(
      handleTool(stubClient, "confluence_render_body", {
        bodyPath: "/etc/passwd",
      })
    ).rejects.toThrow(/outside the cache root/);
  });

  it("rejects relative bodyPath", async () => {
    await expect(
      handleTool(stubClient, "confluence_render_body", {
        bodyPath: "relative/path.json",
      })
    ).rejects.toThrow(/must be absolute/);
  });

  it("renders an empty body without throwing", async () => {
    const path = await writePageBody("pages", 103, 1, {
      value: "",
      representation: "storage",
    });
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
    })) as Record<string, unknown>;
    expect(result.bodyMarkdown).toBe("");
    expect(result.sourceLength).toBe(0);
  });
});
