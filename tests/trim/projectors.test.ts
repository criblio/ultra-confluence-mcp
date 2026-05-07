import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTrim } from "../../src/core/trim.js";
import { extractNextCursor } from "../../src/core/pagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../data/api-fixtures");

let cacheRoot: string;

beforeAll(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), "confluence-mcp-trim-"));
  process.env.CONFLUENCE_BODY_CACHE_DIR = cacheRoot;
});

afterAll(async () => {
  delete process.env.CONFLUENCE_BODY_CACHE_DIR;
  if (cacheRoot) {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function size(x: unknown): number {
  return JSON.stringify(x).length;
}

async function trim(
  toolName: string,
  raw: unknown,
  opts?: { full?: boolean; disabled?: boolean }
): Promise<Record<string, unknown>> {
  return (await applyTrim(toolName, raw, opts)) as Record<string, unknown>;
}

describe("extractNextCursor", () => {
  it("extracts cursor from a relative pagination link", () => {
    expect(
      extractNextCursor("/wiki/api/v2/pages?cursor=eyJpZCI6MTAwMn0%3D&limit=25")
    ).toBe("eyJpZCI6MTAwMn0=");
  });

  it("returns undefined for null/empty/undefined input", () => {
    expect(extractNextCursor(null)).toBeUndefined();
    expect(extractNextCursor(undefined)).toBeUndefined();
    expect(extractNextCursor("")).toBeUndefined();
  });

  it("returns undefined when no cursor param is present", () => {
    expect(extractNextCursor("/wiki/api/v2/pages?limit=25")).toBeUndefined();
  });
});

describe("applyTrim - escape hatches", () => {
  it("returns raw response when full=true", async () => {
    const raw = loadFixture("getPage.json");
    const result = await applyTrim("confluence_get_page", raw, { full: true });
    expect(result).toBe(raw);
  });

  it("returns raw response when disabled=true", async () => {
    const raw = loadFixture("getPage.json");
    const result = await applyTrim("confluence_get_page", raw, {
      disabled: true,
    });
    expect(result).toBe(raw);
  });

  it("returns raw response for unmapped tools (passthrough)", async () => {
    const raw = { foo: "bar", _links: { webui: "x" } };
    const result = await applyTrim("confluence_delete_page", raw);
    expect(result).toBe(raw);
  });
});

describe("projectPage (confluence_get_page)", () => {
  let raw: unknown;
  let trimmed: Record<string, unknown>;

  beforeAll(async () => {
    raw = loadFixture("getPage.json");
    trimmed = await trim("confluence_get_page", raw);
  });

  it("keeps essential fields", () => {
    expect(trimmed.id).toBe("1234567890");
    expect(trimmed.title).toBe("Engineering Onboarding");
    expect(trimmed.spaceId).toBe("98765");
    expect(trimmed.parentId).toBe("11111");
    expect(trimmed.status).toBe("current");
  });

  it("trims version to {number, createdAt, message} only", () => {
    expect(trimmed.version).toEqual({
      number: 17,
      createdAt: "2025-01-04T14:22:01.000Z",
      message: "Updated quickstart link",
    });
  });

  it("keeps only _links.webui (drops editui/tinyui/self/base)", () => {
    expect(trimmed._links).toEqual({
      webui: "/spaces/ENG/pages/1234567890/Engineering+Onboarding",
    });
  });

  it("drops the raw body shape and emits bodyMarkdown", () => {
    expect(trimmed.body).toBeUndefined();
    expect(typeof trimmed.bodyMarkdown).toBe("string");
    expect((trimmed.bodyMarkdown as string).startsWith("# Welcome")).toBe(
      true
    );
  });

  it("drops _expandable", () => {
    expect(trimmed._expandable).toBeUndefined();
  });

  it("achieves significant size reduction", () => {
    const ratio = size(raw) / size(trimmed);
    expect(ratio).toBeGreaterThan(2);
  });

  it("stays within size budget", () => {
    expect(size(trimmed)).toBeLessThan(512);
  });
});

describe("projectList (confluence_get_pages)", () => {
  let raw: unknown;
  let trimmed: Record<string, unknown>;

  beforeAll(async () => {
    raw = loadFixture("getPages.json");
    trimmed = await trim("confluence_get_pages", raw);
  });

  it("returns a results array", () => {
    expect(Array.isArray(trimmed.results)).toBe(true);
    expect((trimmed.results as unknown[]).length).toBe(2);
  });

  it("drops body fields entirely from list items", () => {
    for (const item of trimmed.results as Record<string, unknown>[]) {
      expect(item.body).toBeUndefined();
      expect(item.bodyAvailable).toBeUndefined();
      expect(item.bodyMarkdown).toBeUndefined();
      expect(item.bodyPath).toBeUndefined();
    }
  });

  it("extracts nextCursor from _links.next", () => {
    expect(trimmed.nextCursor).toBe("eyJpZCI6MTAwMn0=");
  });

  it("drops the original _links wrapper", () => {
    expect(trimmed._links).toBeUndefined();
  });

  it("keeps webui on each item", () => {
    const items = trimmed.results as Record<string, unknown>[];
    expect((items[0]._links as Record<string, unknown>).webui).toBe(
      "/spaces/ENG/pages/1001/Onboarding"
    );
  });

  it("achieves significant size reduction", () => {
    const ratio = size(raw) / size(trimmed);
    expect(ratio).toBeGreaterThan(1.5);
  });
});

describe("projectSearch (confluence_cql_search)", () => {
  let trimmed: Record<string, unknown>;

  beforeAll(async () => {
    trimmed = await trim("confluence_cql_search", loadFixture("cqlSearch.json"));
  });

  it("flattens content.id to top-level id", () => {
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.id).toBe("1001");
    expect(first.type).toBe("content");
  });

  it("strips Confluence highlight markers from excerpt", () => {
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.excerpt).toBe(
      "Welcome to the engineering onboarding doc..."
    );
    expect((first.excerpt as string).includes("@@@hl@@@")).toBe(false);
  });

  it("flattens breadcrumbs to a label array", () => {
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.breadcrumbs).toEqual(["Engineering", "Docs"]);
  });

  it("drops noisy v1 search fields (iconCssClass, friendlyLastModified, searchDuration)", () => {
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.iconCssClass).toBeUndefined();
    expect(first.friendlyLastModified).toBeUndefined();
    expect(trimmed.searchDuration).toBeUndefined();
  });

  it("preserves v1 pagination fields (start, limit, size, totalSize, cqlQuery)", () => {
    expect(trimmed.start).toBe(0);
    expect(trimmed.limit).toBe(25);
    expect(trimmed.size).toBe(2);
    expect(trimmed.totalSize).toBe(2);
    expect(trimmed.cqlQuery).toBe('text~"engineering"');
  });
});

describe("projectSpace (confluence_get_space)", () => {
  let trimmed: Record<string, unknown>;

  beforeAll(async () => {
    trimmed = await trim("confluence_get_space", loadFixture("getSpace.json"));
  });

  it("keeps essential fields", () => {
    expect(trimmed.id).toBe("98765");
    expect(trimmed.key).toBe("ENG");
    expect(trimmed.name).toBe("Engineering");
    expect(trimmed.type).toBe("global");
  });

  it("flattens description.plain.value to descriptionMarkdown", () => {
    expect(trimmed.descriptionMarkdown).toBe(
      "All engineering documentation lives here."
    );
  });

  it("drops description.view (rendered HTML)", () => {
    expect(trimmed.description).toBeUndefined();
  });

  it("keeps only _links.webui", () => {
    expect(trimmed._links).toEqual({ webui: "/spaces/ENG" });
  });

  it("drops _expandable and icon", () => {
    expect(trimmed._expandable).toBeUndefined();
    expect(trimmed.icon).toBeUndefined();
  });
});

describe("projectList for spaces (confluence_get_spaces)", () => {
  it("trims each space and exposes nextCursor", async () => {
    const trimmed = await trim(
      "confluence_get_spaces",
      loadFixture("getSpaces.json")
    );
    expect((trimmed.results as unknown[]).length).toBe(2);
    expect(trimmed.nextCursor).toBe("Y3Vyc29yMg==");
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.descriptionMarkdown).toBe("All engineering docs.");
    expect(first.description).toBeUndefined();
  });
});

describe("projectComment list (confluence_get_page_footer_comments)", () => {
  let trimmed: Record<string, unknown>;

  beforeAll(async () => {
    trimmed = await trim(
      "confluence_get_page_footer_comments",
      loadFixture("getPageFooterComments.json")
    );
  });

  it("trims comments and converts the body to markdown", () => {
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.id).toBe("5001");
    expect(first.body).toBeUndefined();
    expect(typeof first.bodyMarkdown).toBe("string");
    expect((first.bodyMarkdown as string).includes("Looks good")).toBe(true);
  });

  it("does not include nextCursor when next is null", () => {
    expect(trimmed.nextCursor).toBeUndefined();
  });
});

describe("projectAttachment list (confluence_get_page_attachments)", () => {
  it("keeps attachment essentials and drops mediaTypeDescription/_links", async () => {
    const trimmed = await trim(
      "confluence_get_page_attachments",
      loadFixture("getPageAttachments.json")
    );
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.id).toBe("att-7001");
    expect(first.mediaType).toBe("image/png");
    expect(first.fileSize).toBe(248192);
    expect(first.webuiLink).toBe(
      "/wiki/download/attachments/1234567890/diagram.png"
    );
    expect(first.mediaTypeDescription).toBeUndefined();
    expect(first._links).toBeUndefined();
  });
});

describe("projectPage — body conversion", () => {
  it("prefers atlas_doc_format over storage when both are present", async () => {
    const raw = {
      id: "1",
      title: "T",
      body: {
        atlas_doc_format: {
          value: JSON.stringify({
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "from-adf" }],
              },
            ],
          }),
          representation: "atlas_doc_format",
        },
        storage: {
          value: "<p>from-storage</p>",
          representation: "storage",
        },
      },
    };
    const trimmed = await trim("confluence_get_page", raw);
    expect(trimmed.bodyMarkdown).toBe("from-adf");
  });

  it("falls back to storage XHTML when ADF is missing", async () => {
    const raw = {
      id: "1",
      title: "T",
      body: {
        storage: {
          value: "<h1>Hello</h1><p>world</p>",
          representation: "storage",
        },
      },
    };
    const trimmed = await trim("confluence_get_page", raw);
    expect(trimmed.bodyMarkdown).toContain("# Hello");
    expect(trimmed.bodyMarkdown).toContain("world");
  });

  it("falls back to view HTML when neither ADF nor storage are present", async () => {
    const raw = {
      id: "1",
      title: "T",
      body: {
        view: {
          value: "<h2>From View</h2>",
          representation: "view",
        },
      },
    };
    const trimmed = await trim("confluence_get_page", raw);
    expect(trimmed.bodyMarkdown).toContain("## From View");
  });

  it("emits bodyAvailable=true when body shape exists but is empty", async () => {
    const raw = {
      id: "1",
      title: "T",
      body: { storage: { value: "", representation: "storage" } },
    };
    const trimmed = await trim("confluence_get_page", raw);
    expect(trimmed.bodyMarkdown).toBeUndefined();
    expect(trimmed.bodyAvailable).toBe(true);
  });

  it("offloads long bodies to disk and returns a bodyPath instead of bodyMarkdown", async () => {
    process.env.CONFLUENCE_BODY_INLINE_LIMIT = "100";
    try {
      const longText = "x".repeat(500);
      const raw = {
        id: "42",
        title: "T",
        version: { number: 7 },
        body: {
          storage: {
            value: `<p>${longText}</p>`,
            representation: "storage",
          },
        },
      };
      const trimmed = await trim("confluence_get_page", raw);
      expect(trimmed.bodyMarkdown).toBeUndefined();
      expect(typeof trimmed.bodyPath).toBe("string");
      expect((trimmed.bodyPath as string).startsWith(cacheRoot)).toBe(true);
      expect((trimmed.bodyPath as string).endsWith("42-v7.json")).toBe(true);
      expect(typeof trimmed.bodyFullSize).toBe("number");
      expect(trimmed.bodyFullSize as number).toBeGreaterThan(100);

      // The on-disk file should round-trip through readFile to the raw body.
      const disk = JSON.parse(
        await readFile(trimmed.bodyPath as string, "utf-8")
      );
      expect(disk.representation).toBe("storage");
      expect((disk.value as string).includes(longText)).toBe(true);
    } finally {
      delete process.env.CONFLUENCE_BODY_INLINE_LIMIT;
    }
  });

  it("does not emit bodyMarkdown when body shape is absent", async () => {
    const raw = { id: "1", title: "T" };
    const trimmed = await trim("confluence_get_page", raw);
    expect(trimmed.bodyMarkdown).toBeUndefined();
    expect(trimmed.bodyAvailable).toBeUndefined();
    expect(trimmed.bodyPath).toBeUndefined();
  });

  it("does NOT emit bodyFullSize for small inline bodies (preserves the 'is this trimmed?' signal)", async () => {
    const raw = {
      id: "1",
      title: "T",
      version: { number: 1 },
      body: {
        storage: { value: "<p>tiny</p>", representation: "storage" },
      },
    };
    const trimmed = await trim("confluence_get_page", raw);
    expect(typeof trimmed.bodyMarkdown).toBe("string");
    expect(trimmed.bodyFullSize).toBeUndefined();
  });

  it("falls back to bodyMarkdownPartial when version is missing (cache would collide on disk)", async () => {
    process.env.CONFLUENCE_BODY_INLINE_LIMIT = "100";
    try {
      const longText = "x".repeat(500);
      const raw = {
        id: "42",
        title: "T",
        // version intentionally absent.
        body: {
          storage: {
            value: `<p>${longText}</p>`,
            representation: "storage",
          },
        },
      };
      const trimmed = await trim("confluence_get_page", raw);
      expect(trimmed.bodyPath).toBeUndefined();
      expect(trimmed.bodyMarkdown).toBeUndefined();
      expect(typeof trimmed.bodyMarkdownPartial).toBe("string");
      expect(typeof trimmed.bodyCacheSkippedReason).toBe("string");
      expect((trimmed.bodyCacheSkippedReason as string).toLowerCase()).toContain(
        "version"
      );
      // Not an error — skip is intentional, not a failure.
      expect(trimmed.bodyCacheError).toBeUndefined();
      expect(typeof trimmed.bodyFullSize).toBe("number");
    } finally {
      delete process.env.CONFLUENCE_BODY_INLINE_LIMIT;
    }
  });

  it("falls back to bodyMarkdownPartial when the body is too large for the cache size cap", async () => {
    process.env.CONFLUENCE_BODY_INLINE_LIMIT = "100";
    process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES = "200";
    try {
      const longText = "x".repeat(2000);
      const raw = {
        id: "42",
        title: "T",
        version: { number: 1 },
        body: {
          storage: {
            value: `<p>${longText}</p>`,
            representation: "storage",
          },
        },
      };
      const trimmed = await trim("confluence_get_page", raw);
      expect(trimmed.bodyPath).toBeUndefined();
      expect(typeof trimmed.bodyMarkdownPartial).toBe("string");
      expect((trimmed.bodyCacheSkippedReason as string).toLowerCase()).toContain(
        "size cap"
      );
      // BodyCacheTooLargeError is an expected fallback, not an error.
      expect(trimmed.bodyCacheError).toBeUndefined();
    } finally {
      delete process.env.CONFLUENCE_BODY_INLINE_LIMIT;
      delete process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES;
    }
  });
});

describe("nullish handling", () => {
  it("returns null/undefined unchanged", async () => {
    expect(await applyTrim("confluence_get_page", null)).toBeNull();
    expect(await applyTrim("confluence_get_page", undefined)).toBeUndefined();
  });

  it("handles non-object responses (e.g. plain strings) without throwing", async () => {
    expect(await applyTrim("confluence_get_page", "weird")).toBe("weird");
  });
});
