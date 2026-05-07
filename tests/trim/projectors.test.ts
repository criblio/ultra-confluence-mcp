import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { applyTrim } from "../../src/core/trim.js";
import { extractNextCursor } from "../../src/core/pagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "../data/api-fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"));
}

function size(x: unknown): number {
  return JSON.stringify(x).length;
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
  it("returns raw response when full=true", () => {
    const raw = loadFixture("getPage.json");
    const result = applyTrim("confluence_get_page", raw, { full: true });
    expect(result).toBe(raw);
  });

  it("returns raw response when disabled=true", () => {
    const raw = loadFixture("getPage.json");
    const result = applyTrim("confluence_get_page", raw, { disabled: true });
    expect(result).toBe(raw);
  });

  it("returns raw response for unmapped tools (passthrough)", () => {
    const raw = { foo: "bar", _links: { webui: "x" } };
    const result = applyTrim("confluence_delete_page", raw);
    expect(result).toBe(raw);
  });
});

describe("projectPage (confluence_get_page)", () => {
  const raw = loadFixture("getPage.json");
  const trimmed = applyTrim("confluence_get_page", raw) as Record<string, unknown>;

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
  const raw = loadFixture("getPages.json");
  const trimmed = applyTrim("confluence_get_pages", raw) as Record<string, unknown>;

  it("returns a results array", () => {
    expect(Array.isArray(trimmed.results)).toBe(true);
    expect((trimmed.results as unknown[]).length).toBe(2);
  });

  it("drops body fields entirely from list items", () => {
    for (const item of trimmed.results as Record<string, unknown>[]) {
      expect(item.body).toBeUndefined();
      expect(item.bodyAvailable).toBeUndefined();
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
  const raw = loadFixture("cqlSearch.json");
  const trimmed = applyTrim("confluence_cql_search", raw) as Record<string, unknown>;

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
  const raw = loadFixture("getSpace.json");
  const trimmed = applyTrim("confluence_get_space", raw) as Record<string, unknown>;

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
  const raw = loadFixture("getSpaces.json");
  const trimmed = applyTrim("confluence_get_spaces", raw) as Record<string, unknown>;

  it("trims each space and exposes nextCursor", () => {
    expect((trimmed.results as unknown[]).length).toBe(2);
    expect(trimmed.nextCursor).toBe("Y3Vyc29yMg==");
    const first = (trimmed.results as Record<string, unknown>[])[0];
    expect(first.descriptionMarkdown).toBe("All engineering docs.");
    expect(first.description).toBeUndefined();
  });
});

describe("projectComment list (confluence_get_page_footer_comments)", () => {
  const raw = loadFixture("getPageFooterComments.json");
  const trimmed = applyTrim(
    "confluence_get_page_footer_comments",
    raw
  ) as Record<string, unknown>;

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
  const raw = loadFixture("getPageAttachments.json");
  const trimmed = applyTrim(
    "confluence_get_page_attachments",
    raw
  ) as Record<string, unknown>;

  it("keeps attachment essentials and drops mediaTypeDescription/_links", () => {
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
  it("prefers atlas_doc_format over storage when both are present", () => {
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
    const trimmed = applyTrim("confluence_get_page", raw) as Record<
      string,
      unknown
    >;
    expect(trimmed.bodyMarkdown).toBe("from-adf");
  });

  it("falls back to storage XHTML when ADF is missing", () => {
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
    const trimmed = applyTrim("confluence_get_page", raw) as Record<
      string,
      unknown
    >;
    expect(trimmed.bodyMarkdown).toContain("# Hello");
    expect(trimmed.bodyMarkdown).toContain("world");
  });

  it("falls back to view HTML when neither ADF nor storage are present", () => {
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
    const trimmed = applyTrim("confluence_get_page", raw) as Record<
      string,
      unknown
    >;
    expect(trimmed.bodyMarkdown).toContain("## From View");
  });

  it("emits bodyAvailable=true when body shape exists but is empty", () => {
    const raw = {
      id: "1",
      title: "T",
      body: { storage: { value: "", representation: "storage" } },
    };
    const trimmed = applyTrim("confluence_get_page", raw) as Record<
      string,
      unknown
    >;
    expect(trimmed.bodyMarkdown).toBeUndefined();
    expect(trimmed.bodyAvailable).toBe(true);
  });

  it("truncates long bodies past the inline limit and reports bodyFullSize", () => {
    process.env.CONFLUENCE_BODY_INLINE_LIMIT = "100";
    try {
      const longText = "x".repeat(500);
      const raw = {
        id: "1",
        title: "T",
        body: {
          storage: {
            value: `<p>${longText}</p>`,
            representation: "storage",
          },
        },
      };
      const trimmed = applyTrim("confluence_get_page", raw) as Record<
        string,
        unknown
      >;
      const md = trimmed.bodyMarkdown as string;
      expect(md.length).toBeLessThan(longText.length);
      expect(md).toContain("[truncated");
      expect(typeof trimmed.bodyFullSize).toBe("number");
      expect(trimmed.bodyFullSize as number).toBeGreaterThan(100);
    } finally {
      delete process.env.CONFLUENCE_BODY_INLINE_LIMIT;
    }
  });

  it("does not emit bodyMarkdown when body shape is absent", () => {
    const raw = { id: "1", title: "T" };
    const trimmed = applyTrim("confluence_get_page", raw) as Record<
      string,
      unknown
    >;
    expect(trimmed.bodyMarkdown).toBeUndefined();
    expect(trimmed.bodyAvailable).toBeUndefined();
  });
});

describe("nullish handling", () => {
  it("returns null/undefined unchanged", () => {
    expect(applyTrim("confluence_get_page", null)).toBeNull();
    expect(applyTrim("confluence_get_page", undefined)).toBeUndefined();
  });

  it("handles non-object responses (e.g. plain strings) without throwing", () => {
    expect(applyTrim("confluence_get_page", "weird")).toBe("weird");
  });
});
