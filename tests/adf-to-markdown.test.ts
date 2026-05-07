import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { adfToMarkdown } from "../src/utils/adf-to-markdown.js";
import { markdownToAdf } from "../src/utils/markdown-to-adf.js";
import type { AdfDocument } from "../src/types/adf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "data");

function load(name: string): string {
  return readFileSync(resolve(dataDir, name), "utf-8");
}

function normalizeWs(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

describe("adfToMarkdown — basic blocks", () => {
  it("converts headings 1–6", () => {
    for (let level = 1; level <= 6; level++) {
      const adf: AdfDocument = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level },
            content: [{ type: "text", text: `H${level}` }],
          },
        ],
      };
      expect(adfToMarkdown(adf)).toBe(`${"#".repeat(level)} H${level}`);
    }
  });

  it("converts paragraphs with inline marks", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            {
              type: "text",
              text: "bold",
              marks: [{ type: "strong" }],
            },
            { type: "text", text: " " },
            { type: "text", text: "italic", marks: [{ type: "em" }] },
            { type: "text", text: " " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: " " },
            {
              type: "text",
              text: "del",
              marks: [{ type: "strike" }],
            },
          ],
        },
      ],
    });
    expect(md).toBe("plain **bold** *italic* `code` ~~del~~");
  });

  it("converts code blocks with language", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    });
    expect(md).toBe("```ts\nconst x = 1;\n```");
  });

  it("converts links via the link mark", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    });
    expect(md).toBe("[click](https://example.com)");
  });

  it("falls back to bare label when link href is missing or empty", () => {
    const missing = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "click", marks: [{ type: "link", attrs: {} }] },
          ],
        },
      ],
    });
    expect(missing).toBe("click");

    const empty = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click",
              marks: [{ type: "link", attrs: { href: "" } }],
            },
          ],
        },
      ],
    });
    expect(empty).toBe("click");
  });

  it("converts a horizontal rule", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [{ type: "rule" }],
    });
    expect(md).toBe("---");
  });

  it("converts a blockquote", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "wisdom" }],
            },
          ],
        },
      ],
    });
    expect(md).toBe("> wisdom");
  });
});

describe("adfToMarkdown — lists", () => {
  it("converts a flat bullet list", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "b" }] },
              ],
            },
          ],
        },
      ],
    });
    expect(md).toBe("- a\n- b");
  });

  it("converts an ordered list with custom start", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "orderedList",
          attrs: { order: 5 },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "x" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "y" }] },
              ],
            },
          ],
        },
      ],
    });
    expect(md).toBe("5. x\n6. y");
  });

  it("converts nested lists with indentation", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "outer" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "inner" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(md).toBe("- outer\n  - inner");
  });
});

describe("adfToMarkdown — tables", () => {
  it("renders a simple 2-column table", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "1" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "2" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("escapes pipes inside cell text", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A | B" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(md.includes("A \\| B")).toBe(true);
  });
});

describe("adfToMarkdown — Confluence specifics", () => {
  it("renders mediaSingle as a markdown image", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { type: "external", url: "https://x.com/y.png", alt: "y" },
            },
          ],
        },
      ],
    });
    expect(md).toBe("![y](https://x.com/y.png)");
  });

  it("renders a panel as a quoted callout", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "panel",
          attrs: { panelType: "warning" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "danger" }],
            },
          ],
        },
      ],
    });
    expect(md).toBe("> [!WARNING]\n> danger");
  });

  it("renders an expand block as <details>", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "expand",
          attrs: { title: "More" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hidden" }],
            },
          ],
        },
      ],
    });
    expect(md).toBe(
      "<details><summary>More</summary>\n\nhidden\n\n</details>"
    );
  });

  it("renders mentions, status, inlineCard", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { displayName: "Alice", text: "Alice" } },
            { type: "text", text: " said " },
            { type: "status", attrs: { text: "DONE" } },
            { type: "text", text: " ; " },
            { type: "inlineCard", attrs: { url: "https://example.com" } },
          ],
        },
      ],
    });
    expect(md).toBe("@Alice said [DONE] ; <https://example.com>");
  });

  it("drops the Mermaid extension companion node (codeBlock carries the source)", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "graph TD; A-->B" }],
        },
        {
          type: "extension",
          attrs: {
            extensionType: "com.atlassian.ecosystem",
            extensionKey:
              "23392b90/63d4d207/static/mermaid-diagram",
          },
        },
      ],
    });
    expect(md.trim()).toBe("```mermaid\ngraph TD; A-->B\n```");
  });

  it("infers `language: mermaid` on a preceding language-less codeBlock when paired with the Mermaid extension", () => {
    // This is what Confluence's ADF actually emits for a Mermaid
    // diagram: the codeBlock carries the source with NO language attr,
    // and a sibling extension node tells the Mermaid plugin to render.
    // Without the lift, the agent would receive a plain ` ``` ` block
    // and lose the language tag on round-trip.
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          // no attrs.language — this is the bug condition
          content: [
            { type: "text", text: "sequenceDiagram\nA->>B: ping" },
          ],
        },
        {
          type: "extension",
          attrs: {
            extensionType: "com.atlassian.ecosystem",
            extensionKey:
              "23392b90-4271-4239-98ca-a3e96c663cbb/63d4d207-ac2f-4273-865c-0240d37f044a/static/mermaid-diagram",
            parameters: { localId: "test-mermaid-1" },
            text: "Mermaid diagram",
          },
        },
      ],
    });
    expect(md.trim()).toBe(
      "```mermaid\nsequenceDiagram\nA->>B: ping\n```"
    );
  });

  it("does NOT lift to mermaid when the codeBlock already has a language", () => {
    // If the agent put an explicit language on the codeBlock, respect
    // it — don't override with mermaid just because an unrelated
    // extension happens to follow.
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
        {
          type: "extension",
          attrs: {
            extensionType: "com.atlassian.ecosystem",
            extensionKey:
              "23392b90/63d4d207/static/mermaid-diagram",
          },
        },
      ],
    });
    expect(md.trim()).toBe("```ts\nconst x = 1;\n```");
  });

  it("does NOT lift when the following extension is not a Mermaid one", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "x" }],
        },
        {
          type: "extension",
          attrs: {
            extensionType: "com.atlassian.ecosystem",
            extensionKey: "some-other-extension/v1/widget",
            text: "Other widget",
          },
        },
      ],
    });
    // codeBlock renders plain (no language inferred), and the extension
    // renders its placeholder.
    expect(md).toContain("```\nx\n```");
    expect(md).toContain("Other widget");
  });

  it("lifts a Mermaid pair nested inside a panel (not just at the doc root)", () => {
    // Regression: previously the lift only walked doc.content, so a
    // pair inside panel/expand/tableCell silently dropped the language.
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "panel",
          attrs: { panelType: "info" },
          content: [
            {
              type: "codeBlock",
              content: [{ type: "text", text: "graph TD; A-->B" }],
            },
            {
              type: "extension",
              attrs: {
                extensionKey:
                  "23392b90/63d4d207/static/mermaid-diagram",
              },
            },
          ],
        },
      ],
    });
    expect(md).toContain("```mermaid");
    expect(md).toContain("> ```mermaid");
    expect(md).toContain("> graph TD; A-->B");
    expect(md).toContain("> ```");
    // Critical: the language must NOT be missing (regression marker).
    expect(md).not.toMatch(/^> ```\n/m);
  });

  it("lifts a Mermaid pair nested inside an expand block", () => {
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "expand",
          attrs: { title: "Diagram" },
          content: [
            {
              type: "codeBlock",
              content: [{ type: "text", text: "flowchart LR; X-->Y" }],
            },
            {
              type: "extension",
              attrs: {
                extensionKey: "ext/static/mermaid-diagram",
              },
            },
          ],
        },
      ],
    });
    expect(md).toContain("<details><summary>Diagram</summary>");
    expect(md).toContain("```mermaid\nflowchart LR; X-->Y\n```");
  });

  it("does not leak the Mermaid extension's text payload when nested in a table cell", () => {
    // Table cells render inline content only. The lift should consume
    // the extension regardless — leaving the cell with just the source
    // text rather than appending a placeholder for the dropped node.
    const md = adfToMarkdown({
      type: "doc",
      version: 1,
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "codeBlock",
                      content: [{ type: "text", text: "A-->B" }],
                    },
                    {
                      type: "extension",
                      attrs: {
                        extensionKey: "x/mermaid-diagram",
                        text: "Mermaid diagram",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // Critically: the extension's `text` attr ("Mermaid diagram") must
    // NOT leak into the cell. Before the recursive lift, it would
    // render as a separate `[Mermaid diagram]` placeholder.
    expect(md).not.toContain("[Mermaid diagram]");
    expect(md).toContain("A-->B");
  });
});

describe("adfToMarkdown — input handling", () => {
  it("accepts a JSON string", () => {
    const json = JSON.stringify({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(adfToMarkdown(json)).toBe("hi");
  });

  it("returns empty string for malformed JSON", () => {
    expect(adfToMarkdown("not json")).toBe("");
  });

  it("returns empty string for non-doc input", () => {
    // @ts-expect-error — exercising defensive runtime path
    expect(adfToMarkdown({ type: "paragraph", content: [] })).toBe("");
  });
});

describe("adfToMarkdown — round-trip with markdownToAdf", () => {
  it("preserves headings, paragraphs, and inline marks", () => {
    const original =
      "# Title\n\n" +
      "A paragraph with **bold** and *em* and `code`.\n\n" +
      "Another paragraph with [a link](https://example.com).";
    const adf = markdownToAdf(original);
    const md = adfToMarkdown(adf);
    expect(normalizeWs(md)).toBe(normalizeWs(original));
  });

  it("preserves bullet and ordered lists (flat)", () => {
    const original = "- one\n- two\n- three";
    const adf = markdownToAdf(original);
    expect(normalizeWs(adfToMarkdown(adf))).toBe(normalizeWs(original));

    const ordered = "1. a\n2. b\n3. c";
    const adfOrdered = markdownToAdf(ordered);
    expect(normalizeWs(adfToMarkdown(adfOrdered))).toBe(normalizeWs(ordered));
  });

  it("preserves a fenced code block with language", () => {
    const original = "```js\nconsole.log(1);\n```";
    const adf = markdownToAdf(original);
    expect(normalizeWs(adfToMarkdown(adf))).toBe(normalizeWs(original));
  });

  it("preserves a blockquote", () => {
    const original = "> something quotable";
    const adf = markdownToAdf(original);
    expect(normalizeWs(adfToMarkdown(adf))).toBe(normalizeWs(original));
  });

  it("renders the sample-short.md fixture without throwing and keeps key strings", () => {
    const original = load("sample-short.md");
    const adf = markdownToAdf(original);
    const md = adfToMarkdown(adf);

    expect(md).toContain("# The Simpsons — Season Highlights");
    expect(md).toContain("**Season**");
    expect(md).toContain("```");
    expect(md).toContain("Homer's Patented Moon Waffles");
  });
});
