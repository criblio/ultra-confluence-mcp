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

  it("converts nested lists with indentation (one level)", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<ul><li>outer<ul><li>inner</li></ul></li></ul>"
      )
    );
    expect(out).toBe("- outer\n  - inner");
  });

  it("preserves bullets across siblings inside a nested list", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<ul><li>outer<ul><li>inner1</li><li>inner2</li></ul></li></ul>"
      )
    );
    expect(out).toBe("- outer\n  - inner1\n  - inner2");
  });

  it("handles 3 levels of nesting without collapsing", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>"
      )
    );
    expect(out).toBe("- A\n  - B\n    - C");
  });

  it("handles mixed ordered/unordered nesting", () => {
    const out = trim(
      storageXhtmlToMarkdown(
        "<ol><li>step<ul><li>note</li></ul></li><li>next</li></ol>"
      )
    );
    expect(out).toBe("1. step\n  - note\n2. next");
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

  it("preserves HTML inside a code macro (no list extraction or tag stripping)", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">html</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[<ul><li>list item</li></ul>]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```html\n<ul><li>list item</li></ul>\n```");
  });

  it("preserves TypeScript generics inside a code macro", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">ts</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[const xs: Array<number> = [];]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```ts\nconst xs: Array<number> = [];\n```");
  });

  it("preserves markdown-looking source inside a code macro (no inline-mark resolution)", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">md</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[**not bold** and <em>not em</em>]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```md\n**not bold** and <em>not em</em>\n```");
  });

  it("preserves multiple code blocks separated by other content", () => {
    const xml =
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[a<b]]></ac:plain-text-body></ac:structured-macro>" +
      "<p>between</p>" +
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[c>d]]></ac:plain-text-body></ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toContain("```js\na<b\n```");
    expect(out).toContain("between");
    expect(out).toContain("```js\nc>d\n```");
  });

  it("preserves a code block nested inside an info panel", () => {
    const xml =
      '<ac:structured-macro ac:name="info"><ac:rich-text-body>' +
      "<p>see this:</p>" +
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[Array<number>]]></ac:plain-text-body></ac:structured-macro>" +
      "</ac:rich-text-body></ac:structured-macro>";
    const out = storageXhtmlToMarkdown(xml);
    expect(out).toContain("> [!INFO]");
    expect(out).toContain("> see this:");
    expect(out).toContain("Array<number>");
    // Critical: the generic must NOT have been stripped to `Array`.
    expect(out).not.toMatch(/Array\s*=/);
  });

  it("preserves a noformat block's content verbatim", () => {
    const xml =
      '<ac:structured-macro ac:name="noformat">' +
      "<ac:plain-text-body><![CDATA[<bold> & </bold>]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```\n<bold> & </bold>\n```");
  });

  it("preserves Mermaid source even when it contains arrow syntax", () => {
    const xml =
      '<ac:structured-macro ac:name="mermaid-cloud">' +
      "<ac:plain-text-body><![CDATA[sequenceDiagram\nA->>B: ping]]></ac:plain-text-body>" +
      "</ac:structured-macro>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```mermaid\nsequenceDiagram\nA->>B: ping\n```");
  });

  it("infers `language: mermaid` on a `code` macro when followed by an <ac:adf-extension> with the Mermaid extension key", () => {
    // This is the actual storage shape Confluence emits when an agent
    // creates a Mermaid diagram via the editor: a `code` macro with no
    // language parameter, followed by an `ac:adf-extension` whose
    // `extension-key` ends in `/static/mermaid-diagram`. Without the
    // lift, the code macro renders as a plain block and round-tripping
    // breaks the Mermaid plugin's render.
    const xml =
      '<ac:structured-macro ac:name="code" ac:schema-version="1">' +
      "<ac:plain-text-body><![CDATA[sequenceDiagram\nA->>B: ping]]></ac:plain-text-body>" +
      "</ac:structured-macro>" +
      '<ac:adf-extension><ac:adf-node type="extension">' +
      '<ac:adf-attribute key="extension-key">23392b90-4271-4239-98ca-a3e96c663cbb/63d4d207-ac2f-4273-865c-0240d37f044a/static/mermaid-diagram</ac:adf-attribute>' +
      '<ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute>' +
      '<ac:adf-attribute key="text">Mermaid diagram</ac:adf-attribute>' +
      "</ac:adf-node></ac:adf-extension>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe(
      "```mermaid\nsequenceDiagram\nA->>B: ping\n```"
    );
  });

  it("does NOT clobber an explicit language on the code macro just because a Mermaid extension follows", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">ts</ac:parameter>' +
      "<ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body>" +
      "</ac:structured-macro>" +
      '<ac:adf-extension><ac:adf-node type="extension">' +
      '<ac:adf-attribute key="extension-key">.../mermaid-diagram</ac:adf-attribute>' +
      "</ac:adf-node></ac:adf-extension>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```ts\nconst x = 1;\n```");
  });

  it("infers `language: mermaid` even when the macro and extension are wrapped in <p>", () => {
    // Regression: the previous pair-match required only `\s*` between
    // the closing `</ac:structured-macro>` and the opening
    // `<ac:adf-extension>`, so any `<p>` wrapper Confluence emitted
    // around either node broke the lift entirely.
    const xml =
      '<p><ac:structured-macro ac:name="code">' +
      "<ac:plain-text-body><![CDATA[graph TD; A-->B]]></ac:plain-text-body>" +
      "</ac:structured-macro></p>" +
      '<p><ac:adf-extension><ac:adf-node type="extension">' +
      '<ac:adf-attribute key="extension-key">.../mermaid-diagram</ac:adf-attribute>' +
      "</ac:adf-node></ac:adf-extension></p>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe(
      "```mermaid\ngraph TD; A-->B\n```"
    );
  });

  it("infers `language: mermaid` when only the extension is wrapped in <p>", () => {
    const xml =
      '<ac:structured-macro ac:name="code">' +
      "<ac:plain-text-body><![CDATA[A-->B]]></ac:plain-text-body>" +
      "</ac:structured-macro>" +
      '<p><ac:adf-extension>' +
      '<ac:adf-attribute key="extension-key">.../mermaid-diagram</ac:adf-attribute>' +
      "</ac:adf-extension></p>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("```mermaid\nA-->B\n```");
  });

  it("does NOT lift when an unrelated block separates the code macro and Mermaid extension", () => {
    // A list (or any non-paragraph block) between them breaks the
    // pairing — the bench/agent shouldn't see misattributed languages.
    const xml =
      '<ac:structured-macro ac:name="code">' +
      "<ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body>" +
      "</ac:structured-macro>" +
      "<ul><li>not part of the pair</li></ul>" +
      '<ac:adf-extension>' +
      '<ac:adf-attribute key="extension-key">.../mermaid-diagram</ac:adf-attribute>' +
      "</ac:adf-extension>";
    const out = trim(storageXhtmlToMarkdown(xml));
    // The code macro stays plain (no `mermaid` injected).
    expect(out).toContain("```\nconst x = 1;\n```");
    expect(out).toContain("- not part of the pair");
    expect(out).not.toContain("```mermaid");
  });

  it("strips self-closing <ac:adf-extension/> blocks", () => {
    const xml = "<p>before</p><ac:adf-extension key=\"x\"/><p>after</p>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("before\n\nafter");
  });

  it("strips standalone <ac:adf-extension> blocks (no leaked attribute text)", () => {
    const xml =
      "<p>before</p>" +
      '<ac:adf-extension><ac:adf-node type="extension">' +
      '<ac:adf-attribute key="extension-key">some-key/v1/widget</ac:adf-attribute>' +
      '<ac:adf-attribute key="text">A widget</ac:adf-attribute>' +
      '<ac:adf-attribute key="local-id">abc-123</ac:adf-attribute>' +
      "</ac:adf-node></ac:adf-extension>" +
      "<p>after</p>";
    const out = trim(storageXhtmlToMarkdown(xml));
    expect(out).toBe("before\n\nafter");
    // Critically, none of the extension metadata should leak into the
    // output — these are all internal plugin orchestration values.
    expect(out).not.toContain("some-key");
    expect(out).not.toContain("A widget");
    expect(out).not.toContain("abc-123");
  });

  it("does NOT lift when the extension key only contains 'mermaid-diagram' as a substring (anchored match)", () => {
    // Regression: previously a substring `includes("mermaid-diagram")`
    // check would also fire on keys like `static-mermaid-diagrams-v2`,
    // misattributing language=mermaid to an unrelated code macro. The
    // lift must only match the canonical `/mermaid-diagram` suffix.
    const xml =
      '<ac:structured-macro ac:name="code">' +
      "<ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body>" +
      "</ac:structured-macro>" +
      '<ac:adf-extension><ac:adf-node type="extension">' +
      '<ac:adf-attribute key="extension-key">static/mermaid-diagrams-v2</ac:adf-attribute>' +
      "</ac:adf-node></ac:adf-extension>";
    const out = trim(storageXhtmlToMarkdown(xml));
    // The code macro stays plain; the extension is stripped by the
    // catch-all stripAdfExtensions pass either way.
    expect(out).toBe("```\nconst x = 1;\n```");
    expect(out).not.toContain("```mermaid");
  });

  it("renders self-closing macros (e.g. toc) as a placeholder rather than dropping them", () => {
    expect(trim(storageXhtmlToMarkdown('<ac:structured-macro ac:name="toc"/>'))).toBe(
      "[macro: toc]"
    );
    expect(
      trim(
        storageXhtmlToMarkdown(
          '<p>before</p><ac:structured-macro ac:name="page-properties-report"/><p>after</p>'
        )
      )
    ).toContain("[macro: page-properties-report]");
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

  it("does not corrupt surrounding text when an attribute value contains < or >", () => {
    expect(trim(storageXhtmlToMarkdown('<p title="<bad>">hello</p>'))).toBe(
      "hello"
    );
    expect(
      trim(storageXhtmlToMarkdown('<p data-x="a > b">x</p><p>y</p>'))
    ).toBe("x\n\ny");
  });

  it("preserves apostrophes in attribute values", () => {
    expect(trim(storageXhtmlToMarkdown(`<p title="it's fine">hi</p>`))).toBe(
      "hi"
    );
  });
});

/**
 * The trim layer also routes Confluence's `view` representation (rendered
 * HTML, not storage XHTML) through this converter as a last-resort fallback.
 * Rendered HTML has no `<ac:*>` macro tags but has Confluence-specific div
 * wrappers, anchor spans, and richer attribute usage. These tests pin down
 * the current behavior so future readers know the lossy areas.
 */
describe("storageXhtmlToMarkdown — view HTML characterization", () => {
  it("strips heading anchor wrappers and keeps the heading text", () => {
    const view =
      '<h2 id="heading-Foo">' +
      '<span class="aui-icon icon-permalink"></span>Foo</h2>' +
      "<p>body</p>";
    const out = trim(storageXhtmlToMarkdown(view));
    expect(out).toBe("## Foo\n\nbody");
  });

  it("flattens div wrappers into their inner content", () => {
    const view =
      '<div class="confluence-information-macro confluence-information-macro-information">' +
      '<p>info text</p>' +
      "</div>";
    const out = trim(storageXhtmlToMarkdown(view));
    expect(out).toBe("info text");
  });

  it("renders rendered images via <img>", () => {
    const view =
      '<p><img src="/wiki/download/attachments/1/x.png" data-image-src="/wiki/download/attachments/1/x.png" alt="diagram"/></p>';
    const out = trim(storageXhtmlToMarkdown(view));
    expect(out).toBe("![diagram](/wiki/download/attachments/1/x.png)");
  });

  it("renders <a class='external-link' href> as a markdown link", () => {
    const view =
      '<p>see <a class="external-link" href="https://example.com" rel="nofollow">here</a></p>';
    const out = trim(storageXhtmlToMarkdown(view));
    expect(out).toBe("see [here](https://example.com)");
  });
});
