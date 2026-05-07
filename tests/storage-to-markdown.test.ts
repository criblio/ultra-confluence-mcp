import { describe, it, expect } from "vitest";
import { storageXhtmlToMarkdown } from "../src/utils/storage-to-markdown.js";

function trim(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").trim();
}

describe("storageXhtmlToMarkdown — basics", () => {
  it("returns empty string on empty input", () => {
    expect(storageXhtmlToMarkdown("")).toBe("");
  });

  it("converts headings", () => {
    expect(trim(storageXhtmlToMarkdown("<h1>Title</h1>"))).toBe("# Title");
    expect(trim(storageXhtmlToMarkdown("<h3>Sub</h3>"))).toBe("### Sub");
  });

  it("converts paragraphs and inline marks", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<p>Hello <strong>bold</strong> and <em>italic</em> and <code>tt</code>.</p>"
      )
    );
    expect(out).toBe("Hello **bold** and *italic* and `tt`.");
  });

  it("converts <s>, <strike>, <del> as ~~text~~", () => {
    expect(trim(storageXhtmlToMarkdown("<p><s>x</s></p>"))).toBe("~~x~~");
    expect(trim(storageXhtmlToMarkdown("<p><del>y</del></p>"))).toBe("~~y~~");
  });

  it("converts a horizontal rule", () => {
    expect(trim(storageXhtmlToMarkdown("<hr/>"))).toBe("---");
  });

  it("converts <br> to a hard break", () => {
    const out = storageXhtmlToMarkdown("<p>line1<br/>line2</p>");
    expect(out.includes("line1")).toBe(true);
    expect(out.includes("line2")).toBe(true);
  });

  it("decodes entities", () => {
    expect(trim(storageXhtmlToMarkdown("<p>&amp; &lt; &gt; &quot;</p>"))).toBe(
      '& < > "'
    );
  });
});

describe("storageXhtmlToMarkdown — links and images", () => {
  it("converts <a href> to markdown link", () => {
    const out = trim(
      storageXhtmlToMarkdown('<p>see <a href="https://x.com">here</a></p>')
    );
    expect(out).toBe("see [here](https://x.com)");
  });

  it("converts <ac:link><ri:page/> to a confluence:// page link", () => {
    const xml =
      '<p>see <ac:link><ri:page ri:content-title="Onboarding"/><ac:plain-text-link-body><![CDATA[Onboarding]]></ac:plain-text-link-body></ac:link></p>';
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("see [Onboarding](confluence://page/Onboarding)");
  });

  it("converts <ac:link><ri:attachment/> to a confluence:// attachment link", () => {
    const xml =
      '<p>see <ac:link><ri:attachment ri:filename="doc.pdf"/><ac:plain-text-link-body><![CDATA[PDF]]></ac:plain-text-link-body></ac:link></p>';
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("see [PDF](confluence://attachment/doc.pdf)");
  });

  it("converts <ac:link><ri:user/> to @account-id", () => {
    const xml = '<p>cc <ac:link><ri:user ri:account-id="abc-123"/></ac:link></p>';
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("cc @abc-123");
  });

  it("converts <img> to markdown image", () => {
    const out = trim(
      storageXhtmlToMarkdown('<p><img src="https://x.com/y.png" alt="y"/></p>')
    );
    expect(out).toBe("![y](https://x.com/y.png)");
  });

  it("converts <ac:image><ri:attachment/> to confluence:// attachment image", () => {
    const xml = '<ac:image><ri:attachment ri:filename="diagram.png"/></ac:image>';
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("![](confluence://attachment/diagram.png)");
  });
});

describe("storageXhtmlToMarkdown — lists", () => {
  it("converts a flat <ul>", () => {
    const out = trim(
      storageXhtmlToMarkdown("<ul><li>a</li><li>b</li><li>c</li></ul>")
    );
    expect(out).toBe("- a\n- b\n- c");
  });

  it("converts a flat <ol>", () => {
    const out = trim(
      storageXhtmlToMarkdown("<ol><li>x</li><li>y</li></ol>")
    );
    expect(out).toBe("1. x\n2. y");
  });

  it("converts nested lists with indentation", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<ul><li>outer<ul><li>inner</li></ul></li></ul>"
      )
    );
    expect(out).toContain("- outer");
    expect(out).toContain("inner");
  });
});

describe("storageXhtmlToMarkdown — tables", () => {
  it("renders a simple table", () => {
    const xml =
      "<table><tbody>" +
      "<tr><th>Name</th><th>Role</th></tr>" +
      "<tr><td>Homer</td><td>Safety Inspector</td></tr>" +
      "</tbody></table>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe(
      "| Name | Role |\n| --- | --- |\n| Homer | Safety Inspector |"
    );
  });

  it("falls back to empty header when no <th> is present", () => {
    const xml =
      "<table><tbody>" +
      "<tr><td>a</td><td>b</td></tr>" +
      "<tr><td>c</td><td>d</td></tr>" +
      "</tbody></table>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out.split("\n")).toEqual([
      "|  |  |",
      "| --- | --- |",
      "| a | b |",
      "| c | d |",
    ]);
  });
});

describe("storageXhtmlToMarkdown — Confluence macros", () => {
  it("converts a code macro with language", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">ts</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```ts\nconst x = 1;\n```");
  });

  it("converts an info panel into a quoted callout", () => {
    const xml =
      '<ac:structured-macro ac:name="info">' +
      "<ac:rich-text-body><p>Heads up.</p></ac:rich-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("> [!INFO]\n> Heads up.");
  });

  it("converts a warning panel", () => {
    const xml =
      '<ac:structured-macro ac:name="warning">' +
      "<ac:rich-text-body><p>Careful.</p></ac:rich-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toContain("> [!WARNING]");
    expect(out).toContain("> Careful.");
  });

  it("converts an expand macro to <details>", () => {
    const xml =
      '<ac:structured-macro ac:name="expand">' +
      '<ac:parameter ac:name="title">More</ac:parameter>' +
      "<ac:rich-text-body><p>Hidden text</p></ac:rich-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out.startsWith("<details><summary>More</summary>")).toBe(true);
    expect(out.endsWith("</details>")).toBe(true);
    expect(out.includes("Hidden text")).toBe(true);
  });

  it("converts a Mermaid macro", () => {
    const xml =
      '<ac:structured-macro ac:name="mermaid-cloud">' +
      "<ac:plain-text-body><![CDATA[graph TD; A-->B]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```mermaid\ngraph TD; A-->B\n```");
  });

  it("renders unknown macros as a placeholder", () => {
    const xml =
      '<ac:structured-macro ac:name="unsupported-thing"></ac:structured-macro>';
    expect(trim(storageXhtmlToMarkdown(xml))).toBe("[macro: unsupported-thing]");
  });
});

describe("storageXhtmlToMarkdown — cleanup", () => {
  it("strips unknown XHTML tags but keeps their text", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        '<p>Hello <span class="foo">world</span></p>'
      )
    );
    expect(out).toBe("Hello world");
  });

  it("collapses multiple blank lines", () => {
    const out = storageXhtmlToMarkdown(
      "<h1>One</h1>\n\n\n\n<p>Two</p>\n\n\n\n<p>Three</p>"
    );
    expect(out).not.toContain("\n\n\n");
  });
});
