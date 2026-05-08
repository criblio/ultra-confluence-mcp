import { describe, it, expect } from "vitest";
import {
  markdownToAdf,
  type AdfDocument,
} from "../src/utils/markdown-to-adf.js";

/** Helper to get the ADF document content array */
function adf(markdown: string): AdfDocument {
  return markdownToAdf(markdown);
}

describe("markdownToAdf", () => {
  describe("document structure", () => {
    it("should return a valid ADF document", () => {
      const doc = adf("Hello");
      expect(doc.type).toBe("doc");
      expect(doc.version).toBe(1);
      expect(doc.content).toBeInstanceOf(Array);
    });

    it("should return an empty paragraph for empty input", () => {
      const doc = adf("");
      expect(doc.content).toHaveLength(1);
      expect(doc.content[0].type).toBe("paragraph");
    });
  });

  describe("headings", () => {
    it("should convert h1-h6 headings", () => {
      for (let level = 1; level <= 6; level++) {
        const doc = adf(`${"#".repeat(level)} Heading ${level}`);
        const heading = doc.content[0];
        expect(heading.type).toBe("heading");
        expect(heading.attrs?.level).toBe(level);
        expect(heading.content?.[0]?.text).toBe(`Heading ${level}`);
      }
    });

    it("should preserve inline formatting in headings", () => {
      const doc = adf("# Hello **bold** world");
      const heading = doc.content[0];
      expect(heading.type).toBe("heading");
      expect(heading.content).toHaveLength(3);
      expect(heading.content?.[0]?.text).toBe("Hello ");
      expect(heading.content?.[1]?.text).toBe("bold");
      expect(heading.content?.[1]?.marks).toEqual([{ type: "strong" }]);
      expect(heading.content?.[2]?.text).toBe(" world");
    });
  });

  describe("paragraphs", () => {
    it("should wrap text in paragraph nodes", () => {
      const doc = adf("Hello world");
      expect(doc.content[0].type).toBe("paragraph");
      expect(doc.content[0].content?.[0]?.text).toBe("Hello world");
    });

    it("should separate paragraphs", () => {
      const doc = adf("First paragraph\n\nSecond paragraph");
      expect(doc.content).toHaveLength(2);
      expect(doc.content[0].content?.[0]?.text).toBe("First paragraph");
      expect(doc.content[1].content?.[0]?.text).toBe("Second paragraph");
    });
  });

  describe("inline formatting", () => {
    it("should convert bold text with strong mark", () => {
      const doc = adf("This is **bold** text");
      const para = doc.content[0];
      const boldNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "strong")
      );
      expect(boldNode).toBeDefined();
      expect(boldNode?.text).toBe("bold");
      expect(boldNode?.marks).toEqual([{ type: "strong" }]);
    });

    it("should convert italic text with em mark", () => {
      const doc = adf("This is *italic* text");
      const para = doc.content[0];
      const italicNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "em")
      );
      expect(italicNode).toBeDefined();
      expect(italicNode?.text).toBe("italic");
      expect(italicNode?.marks).toEqual([{ type: "em" }]);
    });

    it("should convert strikethrough text with strike mark", () => {
      const doc = adf("This is ~~deleted~~ text");
      const para = doc.content[0];
      const strikeNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "strike")
      );
      expect(strikeNode).toBeDefined();
      expect(strikeNode?.text).toBe("deleted");
      expect(strikeNode?.marks).toEqual([{ type: "strike" }]);
    });

    it("should convert inline code with code mark", () => {
      const doc = adf("Use `console.log()` here");
      const para = doc.content[0];
      const codeNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "code")
      );
      expect(codeNode).toBeDefined();
      expect(codeNode?.text).toBe("console.log()");
    });

    it("should handle nested marks (bold + italic)", () => {
      const doc = adf("***bold and italic***");
      const para = doc.content[0];
      const node = para.content?.[0];
      expect(node?.text).toBe("bold and italic");
      const markTypes = node?.marks?.map((m) => m.type).sort();
      expect(markTypes).toEqual(["em", "strong"]);
    });
  });

  describe("links", () => {
    it("should convert links with link mark", () => {
      const doc = adf("[Click here](https://example.com)");
      const para = doc.content[0];
      const linkNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "link")
      );
      expect(linkNode).toBeDefined();
      expect(linkNode?.text).toBe("Click here");
      const linkMark = linkNode?.marks?.find((m) => m.type === "link");
      expect(linkMark?.attrs?.href).toBe("https://example.com");
    });

    it("should handle links with titles", () => {
      const doc = adf('[Link](https://example.com "My Title")');
      const para = doc.content[0];
      const linkNode = para.content?.find((n) =>
        n.marks?.some((m) => m.type === "link")
      );
      const linkMark = linkNode?.marks?.find((m) => m.type === "link");
      expect(linkMark?.attrs?.href).toBe("https://example.com");
      expect(linkMark?.attrs?.title).toBe("My Title");
    });
  });

  describe("images", () => {
    it("should convert standalone images to mediaSingle", () => {
      const doc = adf("![Alt text](https://example.com/image.png)");
      const node = doc.content[0];
      expect(node.type).toBe("mediaSingle");
      expect(node.attrs?.layout).toBe("center");
      expect(node.content?.[0]?.type).toBe("media");
      expect(node.content?.[0]?.attrs?.type).toBe("external");
      expect(node.content?.[0]?.attrs?.url).toBe(
        "https://example.com/image.png"
      );
      expect(node.content?.[0]?.attrs?.alt).toBe("Alt text");
    });

    it("should not produce paragraph wrapper for standalone images", () => {
      const doc = adf("![Alt](https://example.com/img.png)");
      expect(doc.content[0].type).toBe("mediaSingle");
    });
  });

  describe("lists", () => {
    it("should convert unordered lists", () => {
      const doc = adf("- Item 1\n- Item 2\n- Item 3");
      const list = doc.content[0];
      expect(list.type).toBe("bulletList");
      expect(list.content).toHaveLength(3);
      expect(list.content?.[0]?.type).toBe("listItem");
      // Each listItem should contain a paragraph
      const firstItemPara = list.content?.[0]?.content?.[0];
      expect(firstItemPara?.type).toBe("paragraph");
      expect(firstItemPara?.content?.[0]?.text).toBe("Item 1");
    });

    it("should convert ordered lists", () => {
      const doc = adf("1. First\n2. Second\n3. Third");
      const list = doc.content[0];
      expect(list.type).toBe("orderedList");
      expect(list.content).toHaveLength(3);
      expect(list.content?.[0]?.type).toBe("listItem");
    });

    it("should handle nested lists", () => {
      const doc = adf("- Parent\n  - Child\n  - Child 2\n- Parent 2");
      const list = doc.content[0];
      expect(list.type).toBe("bulletList");
      // First item should have paragraph + nested bulletList
      const firstItem = list.content?.[0];
      expect(firstItem?.content).toHaveLength(2); // paragraph + nested list
      expect(firstItem?.content?.[0]?.type).toBe("paragraph");
      expect(firstItem?.content?.[1]?.type).toBe("bulletList");
      // Nested list should have 2 items
      expect(firstItem?.content?.[1]?.content).toHaveLength(2);
    });
  });

  describe("task lists", () => {
    it("should convert GFM task lists to ADF taskList", () => {
      const doc = adf(
        "- [ ] todo one\n- [x] done one\n- [ ] todo two\n- [x] done two"
      );
      const list = doc.content[0];
      expect(list.type).toBe("taskList");
      expect(typeof list.attrs?.localId).toBe("string");
      expect(list.content).toHaveLength(4);

      const states = list.content?.map((i) => i.attrs?.state);
      expect(states).toEqual(["TODO", "DONE", "TODO", "DONE"]);

      // Each taskItem has its own localId and inline text content
      for (const item of list.content ?? []) {
        expect(item.type).toBe("taskItem");
        expect(typeof item.attrs?.localId).toBe("string");
      }
      expect(list.content?.[0].content?.[0].text).toBe("todo one");
      expect(list.content?.[1].content?.[0].text).toBe("done one");
    });

    it("should preserve inline marks inside task items", () => {
      const doc = adf("- [x] **bold** task with `code`");
      const list = doc.content[0];
      expect(list.type).toBe("taskList");
      const item = list.content?.[0];
      expect(item?.attrs?.state).toBe("DONE");
      const inline = item?.content ?? [];
      expect(inline[0]?.text).toBe("bold");
      expect(inline[0]?.marks).toEqual([{ type: "strong" }]);
      expect(inline[2]?.text).toBe("code");
      expect(inline[2]?.marks).toEqual([{ type: "code" }]);
    });

    it("should fall back to bulletList when items mix task and non-task", () => {
      const doc = adf("- [ ] checkbox item\n- plain item");
      const list = doc.content[0];
      expect(list.type).toBe("bulletList");
      // Stray checkbox tokens should not produce empty children
      expect(list.content).toHaveLength(2);
      const firstText = list.content?.[0].content?.[0].content?.[0].text;
      expect(firstText).toBe("checkbox item");
    });
  });

  describe("code blocks", () => {
    it("should convert code blocks to codeBlock nodes", () => {
      const doc = adf('```javascript\nconsole.log("hello");\n```');
      const codeBlock = doc.content[0];
      expect(codeBlock.type).toBe("codeBlock");
      expect(codeBlock.attrs?.language).toBe("javascript");
      expect(codeBlock.content?.[0]?.text).toBe('console.log("hello");');
    });

    it("should convert code blocks without language", () => {
      const doc = adf("```\nsome code\n```");
      const codeBlock = doc.content[0];
      expect(codeBlock.type).toBe("codeBlock");
      expect(codeBlock.attrs?.language).toBeUndefined();
      expect(codeBlock.content?.[0]?.text).toBe("some code");
    });

    it("should not escape special characters in code blocks", () => {
      const doc = adf('```html\n<div class="test">Hello</div>\n```');
      const codeBlock = doc.content[0];
      expect(codeBlock.content?.[0]?.text).toBe(
        '<div class="test">Hello</div>'
      );
    });
  });

  describe("mermaid diagrams", () => {
    it("should emit codeBlock + extension for mermaid blocks", () => {
      const doc = adf("```mermaid\ngraph TD\n    A --> B\n```");

      expect(doc.content).toHaveLength(2);
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs?.language).toBe("mermaid");
      expect(doc.content[0].content?.[0]?.text).toContain("graph TD");
      expect(doc.content[1].type).toBe("extension");
      expect(doc.content[1].attrs?.extensionKey).toContain("mermaid-diagram");
    });

    it("should handle sequence diagram mermaid", () => {
      const mermaid = [
        "```mermaid",
        "sequenceDiagram",
        "    Alice->>John: Hello John",
        "    John-->>Alice: Great!",
        "```",
      ].join("\n");
      const doc = adf(mermaid);
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[0].attrs?.language).toBe("mermaid");
      expect(doc.content[0].content?.[0]?.text).toContain("sequenceDiagram");
      expect(doc.content[1].type).toBe("extension");
    });

    it("should generate unique localIds for multiple mermaid blocks", () => {
      const doc = adf(
        "```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\ngraph LR\nC-->D\n```"
      );

      // 2 codeBlocks + 2 extensions
      expect(doc.content).toHaveLength(4);
      expect(doc.content[0].type).toBe("codeBlock");
      expect(doc.content[1].type).toBe("extension");
      expect(doc.content[2].type).toBe("codeBlock");
      expect(doc.content[3].type).toBe("extension");
      expect(doc.content[1].attrs?.localId).not.toBe(
        doc.content[3].attrs?.localId
      );
    });

    it("should not emit extension for non-mermaid code blocks", () => {
      const doc = adf("```javascript\nconsole.log('hi');\n```");
      expect(doc.content).toHaveLength(1);
      expect(doc.content[0].type).toBe("codeBlock");
    });
  });

  describe("blockquotes", () => {
    it("should convert blockquotes", () => {
      const doc = adf("> This is a quote");
      const bq = doc.content[0];
      expect(bq.type).toBe("blockquote");
      expect(bq.content?.[0]?.type).toBe("paragraph");
      expect(bq.content?.[0]?.content?.[0]?.text).toBe("This is a quote");
    });

    it("should handle multi-line blockquotes", () => {
      const doc = adf("> Line 1\n> Line 2");
      const bq = doc.content[0];
      expect(bq.type).toBe("blockquote");
      expect(bq.content?.[0]?.type).toBe("paragraph");
    });
  });

  describe("horizontal rules", () => {
    it("should convert horizontal rules to rule nodes", () => {
      const doc = adf("---");
      expect(doc.content[0].type).toBe("rule");
    });
  });

  describe("tables", () => {
    it("should convert markdown tables to ADF table nodes", () => {
      const table =
        "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |";
      const doc = adf(table);
      const tableNode = doc.content[0];
      expect(tableNode.type).toBe("table");
      expect(tableNode.attrs?.isNumberColumnEnabled).toBe(false);
      expect(tableNode.attrs?.layout).toBe("default");
    });

    it("should have tableHeader cells in the header row", () => {
      const table =
        "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |";
      const doc = adf(table);
      const tableNode = doc.content[0];
      const headerRow = tableNode.content?.[0];
      expect(headerRow?.type).toBe("tableRow");
      expect(headerRow?.content?.[0]?.type).toBe("tableHeader");
      expect(
        headerRow?.content?.[0]?.content?.[0]?.content?.[0]?.text
      ).toBe("Header 1");
    });

    it("should have tableCell nodes in body rows", () => {
      const table =
        "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |";
      const doc = adf(table);
      const tableNode = doc.content[0];
      const bodyRow = tableNode.content?.[1];
      expect(bodyRow?.type).toBe("tableRow");
      expect(bodyRow?.content?.[0]?.type).toBe("tableCell");
      expect(
        bodyRow?.content?.[0]?.content?.[0]?.content?.[0]?.text
      ).toBe("Cell 1");
    });
  });

  describe("complex documents", () => {
    it("should convert a full markdown document to valid ADF", () => {
      const markdown = [
        "# Project Overview",
        "",
        "This is a **bold** statement with *italic* text.",
        "",
        "## Features",
        "",
        "- Feature 1",
        "- Feature 2",
        "- Feature 3",
        "",
        "### Code Example",
        "",
        "```typescript",
        'const greeting = "hello";',
        "console.log(greeting);",
        "```",
        "",
        "### Architecture Diagram",
        "",
        "```mermaid",
        "graph LR",
        "    A[Client] --> B[Server]",
        "    B --> C[Database]",
        "```",
        "",
        "| Column A | Column B |",
        "| -------- | -------- |",
        "| Value 1  | Value 2  |",
        "",
        "---",
        "",
        "Visit [our site](https://example.com) for more info.",
      ].join("\n");

      const doc = adf(markdown);

      expect(doc.type).toBe("doc");
      expect(doc.version).toBe(1);

      // Find specific node types
      const nodeTypes = doc.content.map((n) => n.type);

      // Should have headings
      expect(nodeTypes).toContain("heading");

      // Should have paragraphs
      expect(nodeTypes).toContain("paragraph");

      // Should have bullet list
      expect(nodeTypes).toContain("bulletList");

      // Should have code blocks
      expect(nodeTypes).toContain("codeBlock");

      // Should have table
      expect(nodeTypes).toContain("table");

      // Should have rule
      expect(nodeTypes).toContain("rule");

      // Check heading levels
      const headings = doc.content.filter((n) => n.type === "heading");
      expect(headings[0].attrs?.level).toBe(1);
      expect(headings[1].attrs?.level).toBe(2);
      expect(headings[2].attrs?.level).toBe(3);

      // Check mermaid code block
      const codeBlocks = doc.content.filter((n) => n.type === "codeBlock");
      const mermaidBlock = codeBlocks.find(
        (n) => n.attrs?.language === "mermaid"
      );
      expect(mermaidBlock).toBeDefined();
      expect(mermaidBlock?.content?.[0]?.text).toContain("graph LR");

      // Check typescript code block
      const tsBlock = codeBlocks.find(
        (n) => n.attrs?.language === "typescript"
      );
      expect(tsBlock).toBeDefined();
      expect(tsBlock?.content?.[0]?.text).toContain('const greeting');

      // Check link in last paragraph
      const lastPara = doc.content.filter((n) => n.type === "paragraph").pop();
      const linkNode = lastPara?.content?.find((n) =>
        n.marks?.some((m) => m.type === "link")
      );
      expect(linkNode?.text).toBe("our site");
      expect(
        linkNode?.marks?.find((m) => m.type === "link")?.attrs?.href
      ).toBe("https://example.com");
    });

    it("should produce valid JSON when stringified (as sent to API)", () => {
      const doc = adf("# Hello\n\nWorld\n\n```mermaid\ngraph TD\nA-->B\n```");
      const json = JSON.stringify(doc);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe("doc");
      expect(parsed.version).toBe(1);
      expect(parsed.content.length).toBeGreaterThan(0);
    });
  });
});
