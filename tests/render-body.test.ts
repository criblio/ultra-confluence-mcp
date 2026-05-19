import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePageBody } from "../src/core/page-cache.js";
import { handleTool } from "../src/tools/index.js";
import type { ConfluenceClient } from "../src/auth/confluence-client.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "ultra-confluence-mcp-render-"));
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

  it("returns the raw source under bodyRaw when format=raw (same envelope as markdown)", async () => {
    const path = await writePageBody("pages", 102, 1, {
      value: "<p>abc</p>",
      representation: "storage",
    });
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
      format: "raw",
    })) as Record<string, unknown>;

    expect(result).toEqual({
      bodyRaw: "<p>abc</p>",
      representation: "storage",
      sourceLength: 10,
    });
    // Markdown branch wraps in `bodyMarkdown`; raw branch wraps in
    // `bodyRaw`. Either way, `representation` and `sourceLength` are
    // always present, so callers don't have to branch on the shape.
    expect(result.bodyMarkdown).toBeUndefined();
  });

  it("declares format=markdown as the default in inputSchema", async () => {
    const { bodyTools } = await import("../src/tools/body.js");
    const tool = bodyTools.find((t) => t.name === "confluence_render_body");
    const props = (tool?.inputSchema as { properties?: Record<string, unknown> })
      .properties;
    expect((props?.format as { default?: string }).default).toBe("markdown");
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

  it("writes rendered markdown to outputPath and omits the body from the response", async () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "world" }] },
      ],
    };
    const path = await writePageBody("pages", 200, 1, {
      value: JSON.stringify(adf),
      representation: "atlas_doc_format",
    });
    const outputPath = join(tmpRoot, "out", "page.md");
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
      outputPath,
    })) as Record<string, unknown>;

    // Response carries path + size, not the rendered content.
    expect(result.outputPath).toBe(outputPath);
    expect(result.bytesWritten).toBe(Buffer.byteLength("# Hello\n\nworld", "utf-8"));
    expect(result.bodyMarkdown).toBeUndefined();
    expect(result.bodyRaw).toBeUndefined();
    expect(result.representation).toBe("atlas_doc_format");
    expect(typeof result.sourceLength).toBe("number");

    // File on disk has the rendered markdown verbatim.
    const written = await readFile(outputPath, "utf-8");
    expect(written).toBe("# Hello\n\nworld");
  });

  it("writes raw source to outputPath when format=raw", async () => {
    const path = await writePageBody("pages", 201, 1, {
      value: "<p>raw bytes</p>",
      representation: "storage",
    });
    const outputPath = join(tmpRoot, "raw.html");
    const result = (await handleTool(stubClient, "confluence_render_body", {
      bodyPath: path,
      format: "raw",
      outputPath,
    })) as Record<string, unknown>;

    expect(result.outputPath).toBe(outputPath);
    expect(result.bodyMarkdown).toBeUndefined();
    expect(result.bodyRaw).toBeUndefined();
    expect(await readFile(outputPath, "utf-8")).toBe("<p>raw bytes</p>");
  });

  it("creates parent directories on demand and overwrites existing files", async () => {
    const path = await writePageBody("pages", 202, 1, {
      value: "<p>v1</p>",
      representation: "storage",
    });
    const outputPath = join(tmpRoot, "deep", "nested", "dir", "out.md");

    await handleTool(stubClient, "confluence_render_body", { bodyPath: path, outputPath });
    const first = await readFile(outputPath, "utf-8");
    expect(first).toContain("v1");

    // Overwrite with a new render.
    const path2 = await writePageBody("pages", 202, 2, {
      value: "<p>v2</p>",
      representation: "storage",
    });
    await handleTool(stubClient, "confluence_render_body", { bodyPath: path2, outputPath });
    const second = await readFile(outputPath, "utf-8");
    expect(second).toContain("v2");
    expect(second).not.toContain("v1");

    // Still exactly one file.
    expect((await stat(outputPath)).isFile()).toBe(true);
  });

  it("rejects relative outputPath", async () => {
    const path = await writePageBody("pages", 203, 1, {
      value: "<p>x</p>",
      representation: "storage",
    });
    await expect(
      handleTool(stubClient, "confluence_render_body", {
        bodyPath: path,
        outputPath: "relative/out.md",
      })
    ).rejects.toThrow(/outputPath must be absolute/);
  });
});
