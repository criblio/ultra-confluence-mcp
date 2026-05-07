import { randomUUID } from "node:crypto";
import { Marked, type Token, type Tokens } from "marked";
import type { AdfDocument, AdfMark, AdfNode } from "../types/adf.js";

export type { AdfDocument, AdfMark, AdfNode };

// ─── Mermaid Extension ───────────────────────────────────────────────────────

// Extension key for the "Mermaid Diagrams for Confluence" ecosystem app.
const MERMAID_EXTENSION_KEY =
  "23392b90-4271-4239-98ca-a3e96c663cbb/63d4d207-ac2f-4273-865c-0240d37f044a/static/mermaid-diagram";

function buildMermaidExtensionNode(): AdfNode {
  const localId = randomUUID();
  return {
    type: "extension",
    attrs: {
      extensionType: "com.atlassian.ecosystem",
      extensionKey: MERMAID_EXTENSION_KEY,
      parameters: { localId },
      localId,
    },
  };
}

// ─── Markdown File Link Helpers ──────────────────────────────────────────────

/**
 * Check if a link href points to a Markdown file (relative .md link).
 */
function isMarkdownFileLink(href: string): boolean {
  try {
    const url = new URL(href, "http://dummy");
    if (url.host !== "dummy") return false;
  } catch {
    // Not a valid URL — treat as relative
  }
  return /\.md(?:#.*)?$/.test(href);
}

/**
 * Extract the page title from a .md link href.
 * Strips path, fragment, and .md extension.
 * E.g. "docs/sample-short.md#section" → "sample-short"
 */
function mdHrefToPageTitle(href: string): string {
  const withoutFragment = href.split("#")[0];
  return withoutFragment.split("/").pop()!.replace(/\.md$/, "");
}

/**
 * Collect all unique page titles referenced by .md links in an ADF document.
 */
export function collectMdLinkTitles(doc: AdfDocument): string[] {
  const titles = new Set<string>();
  function walk(nodes: AdfNode[]) {
    for (const node of nodes) {
      if (node.marks) {
        for (const mark of node.marks) {
          if (
            mark.type === "link" &&
            typeof mark.attrs?.href === "string" &&
            isMarkdownFileLink(mark.attrs.href as string)
          ) {
            titles.add(mdHrefToPageTitle(mark.attrs.href as string));
          }
        }
      }
      if (node.content) walk(node.content);
    }
  }
  walk(doc.content);
  return [...titles];
}

/**
 * Rewrite .md link hrefs in an ADF document using a title → URL map.
 * Links whose title is not found in the map are left unchanged.
 */
export function rewriteMdLinks(
  doc: AdfDocument,
  titleToUrl: Record<string, string>
): void {
  function walk(nodes: AdfNode[]) {
    for (const node of nodes) {
      if (node.marks) {
        for (const mark of node.marks) {
          if (
            mark.type === "link" &&
            typeof mark.attrs?.href === "string" &&
            isMarkdownFileLink(mark.attrs.href as string)
          ) {
            const title = mdHrefToPageTitle(mark.attrs.href as string);
            if (titleToUrl[title]) {
              mark.attrs!.href = titleToUrl[title];
            }
          }
        }
      }
      if (node.content) walk(node.content);
    }
  }
  walk(doc.content);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert Markdown content to Atlassian Document Format (ADF).
 *
 * Supports all standard Markdown features:
 * - Headings (h1-h6)
 * - Bold, italic, strikethrough inline formatting
 * - Links and images (images use mediaSingle with external media)
 * - Ordered and unordered lists (including nested)
 * - Code blocks with syntax highlighting (uses ADF codeBlock)
 * - Mermaid diagrams via ```mermaid code blocks (rendered natively by Confluence)
 * - Inline code
 * - Blockquotes
 * - Tables (with header row)
 * - Horizontal rules
 *
 * @param markdown - The Markdown content to convert
 * @returns ADF document object
 */
export function markdownToAdf(markdown: string): AdfDocument {
  const instance = new Marked();
  const tokens = instance.lexer(markdown);
  const content = convertBlockTokens(tokens);

  return {
    type: "doc",
    content:
      content.length > 0
        ? content
        : [{ type: "paragraph", content: [] }],
    version: 1,
  };
}

// ─── Block Token Conversion ──────────────────────────────────────────────────

function convertBlockTokens(tokens: Token[]): AdfNode[] {
  const nodes: AdfNode[] = [];

  for (const token of tokens) {
    const converted = convertBlockToken(token);
    if (converted) {
      nodes.push(...converted);
    }
  }

  return nodes;
}

/**
 * Convert a single block-level token into one or more ADF nodes.
 * Returns null for tokens that produce no output (whitespace, defs).
 */
function convertBlockToken(token: Token): AdfNode[] | null {
  switch (token.type) {
    case "heading":
      return [convertHeading(token as Tokens.Heading)];

    case "paragraph":
      return convertParagraphNodes(token as Tokens.Paragraph);

    case "code":
      return convertCodeBlock(token as Tokens.Code);

    case "list":
      return [convertList(token as Tokens.List)];

    case "blockquote":
      return [convertBlockquote(token as Tokens.Blockquote)];

    case "table":
      return [convertTable(token as Tokens.Table)];

    case "hr":
      return [{ type: "rule" }];

    case "html": {
      const htmlToken = token as Tokens.HTML;
      if (htmlToken.text.trim()) {
        return [
          {
            type: "paragraph",
            content: [{ type: "text", text: htmlToken.text }],
          },
        ];
      }
      return null;
    }

    case "space":
    case "def":
      return null;

    default:
      return null;
  }
}

// ─── Heading ─────────────────────────────────────────────────────────────────

function convertHeading(token: Tokens.Heading): AdfNode {
  return {
    type: "heading",
    attrs: { level: token.depth },
    content: convertInlineTokens(token.tokens || []),
  };
}

// ─── Paragraph ───────────────────────────────────────────────────────────────

/**
 * Convert a paragraph token to ADF nodes.
 * If the paragraph contains only images, they become mediaSingle blocks.
 * Otherwise it becomes a standard paragraph node.
 */
function convertParagraphNodes(token: Tokens.Paragraph): AdfNode[] {
  const inlineTokens = token.tokens || [];

  // Check if this paragraph contains only image(s)
  if (isImageOnlyParagraph(inlineTokens)) {
    return inlineTokens
      .filter((t: Token): t is Tokens.Image => t.type === "image")
      .map(convertImageToMediaSingle);
  }

  const content = convertInlineTokens(inlineTokens);
  return [
    {
      type: "paragraph",
      content: content.length > 0 ? content : [],
    },
  ];
}

function isImageOnlyParagraph(tokens: Token[]): boolean {
  const nonSpaceTokens = tokens.filter(
    (t) =>
      !(t.type === "text" && !(t as Tokens.Text).text.trim())
  );
  return (
    nonSpaceTokens.length > 0 &&
    nonSpaceTokens.every((t) => t.type === "image")
  );
}

function convertImageToMediaSingle(token: Tokens.Image): AdfNode {
  const mediaAttrs: Record<string, unknown> = {
    type: "external",
    url: token.href,
  };
  if (token.text) {
    mediaAttrs.alt = token.text;
  }

  return {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [
      {
        type: "media",
        attrs: mediaAttrs,
      },
    ],
  };
}

// ─── Code Block ──────────────────────────────────────────────────────────────

function convertCodeBlock(token: Tokens.Code): AdfNode[] {
  const node: AdfNode = {
    type: "codeBlock",
    attrs: {},
    content: [{ type: "text", text: token.text }],
  };

  if (token.lang) {
    node.attrs!.language = token.lang;
  }

  // Mermaid blocks need an extension node for the Mermaid app to render them
  if (token.lang === "mermaid") {
    return [node, buildMermaidExtensionNode()];
  }

  return [node];
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function convertList(token: Tokens.List): AdfNode {
  const listType = token.ordered ? "orderedList" : "bulletList";
  const node: AdfNode = {
    type: listType,
    content: token.items.map(convertListItem),
  };

  if (token.ordered && token.start !== "" && token.start !== 1) {
    node.attrs = { order: token.start };
  }

  return node;
}

function convertListItem(item: Tokens.ListItem): AdfNode {
  const content: AdfNode[] = [];

  for (const token of item.tokens) {
    if (token.type === "text" && (token as Tokens.Text).tokens) {
      // Tight list item — inline content wrapped in a "text" token;
      // wrap in a paragraph for ADF
      const inlineNodes = convertInlineTokens(
        (token as Tokens.Text).tokens || []
      );
      if (inlineNodes.length > 0) {
        content.push({ type: "paragraph", content: inlineNodes });
      }
    } else if (token.type === "list") {
      // Nested list
      content.push(convertList(token as Tokens.List));
    } else if (token.type === "paragraph") {
      // Loose list item — already block-level
      content.push(...convertParagraphNodes(token as Tokens.Paragraph));
    } else if (token.type === "space") {
      // Skip whitespace tokens
    } else {
      // Other block tokens (code, blockquote, etc.) inside list items
      const converted = convertBlockToken(token);
      if (converted) {
        content.push(...converted);
      }
    }
  }

  // ADF requires at least one block-level child in listItem
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }

  return {
    type: "listItem",
    content,
  };
}

// ─── Blockquote ──────────────────────────────────────────────────────────────

function convertBlockquote(token: Tokens.Blockquote): AdfNode {
  return {
    type: "blockquote",
    content: convertBlockTokens(token.tokens),
  };
}

// ─── Table ───────────────────────────────────────────────────────────────────

function convertTable(token: Tokens.Table): AdfNode {
  const rows: AdfNode[] = [];

  // Header row
  if (token.header && token.header.length > 0) {
    rows.push({
      type: "tableRow",
      content: token.header.map((cell: Tokens.TableCell) => ({
        type: "tableHeader",
        attrs: {},
        content: [
          {
            type: "paragraph",
            content: convertInlineTokens(cell.tokens),
          },
        ],
      })),
    });
  }

  // Body rows
  for (const row of token.rows) {
    rows.push({
      type: "tableRow",
      content: row.map((cell: Tokens.TableCell) => ({
        type: "tableCell",
        attrs: {},
        content: [
          {
            type: "paragraph",
            content: convertInlineTokens(cell.tokens),
          },
        ],
      })),
    });
  }

  return {
    type: "table",
    attrs: {
      isNumberColumnEnabled: false,
      layout: "default",
    },
    content: rows,
  };
}

// ─── Inline Token Conversion ─────────────────────────────────────────────────

/**
 * Convert inline tokens to ADF inline nodes, threading marks through
 * nested formatting tokens (bold, italic, etc.).
 */
function convertInlineTokens(
  tokens: Token[],
  marks: AdfMark[] = []
): AdfNode[] {
  const nodes: AdfNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        const textNode: AdfNode = { type: "text", text: t.text };
        if (marks.length > 0) textNode.marks = [...marks];
        nodes.push(textNode);
        break;
      }

      case "escape": {
        const e = token as Tokens.Escape;
        const escNode: AdfNode = { type: "text", text: e.text };
        if (marks.length > 0) escNode.marks = [...marks];
        nodes.push(escNode);
        break;
      }

      case "strong": {
        const s = token as Tokens.Strong;
        nodes.push(
          ...convertInlineTokens(s.tokens, [
            ...marks,
            { type: "strong" },
          ])
        );
        break;
      }

      case "em": {
        const e = token as Tokens.Em;
        nodes.push(
          ...convertInlineTokens(e.tokens, [...marks, { type: "em" }])
        );
        break;
      }

      case "del": {
        const d = token as Tokens.Del;
        nodes.push(
          ...convertInlineTokens(d.tokens, [
            ...marks,
            { type: "strike" },
          ])
        );
        break;
      }

      case "codespan": {
        const c = token as Tokens.Codespan;
        const codeNode: AdfNode = { type: "text", text: c.text };
        codeNode.marks = [...marks, { type: "code" }];
        nodes.push(codeNode);
        break;
      }

      case "link": {
        const l = token as Tokens.Link;
        const linkMark: AdfMark = {
          type: "link",
          attrs: { href: l.href },
        };
        if (l.title) linkMark.attrs!.title = l.title;
        nodes.push(
          ...convertInlineTokens(l.tokens, [...marks, linkMark])
        );
        break;
      }

      case "image": {
        // Images appearing inline with other text are rendered as linked text
        const img = token as Tokens.Image;
        const imgNode: AdfNode = {
          type: "text",
          text: img.text || img.href,
          marks: [
            ...marks,
            { type: "link", attrs: { href: img.href } },
          ],
        };
        nodes.push(imgNode);
        break;
      }

      case "br": {
        nodes.push({ type: "hardBreak" });
        break;
      }

      default: {
        // Fallback: extract text if available
        if (
          "text" in token &&
          typeof (token as Record<string, unknown>).text === "string"
        ) {
          const fallbackNode: AdfNode = {
            type: "text",
            text: (token as Record<string, unknown>).text as string,
          };
          if (marks.length > 0) fallbackNode.marks = [...marks];
          nodes.push(fallbackNode);
        }
        break;
      }
    }
  }

  return nodes;
}
