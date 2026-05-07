/**
 * Convert Atlassian Document Format (ADF) to Markdown.
 *
 * Inverse of `markdown-to-adf.ts`. Lossy by design — the goal is a
 * compact, agent-readable representation, not perfect round-trip.
 *
 * Coverage:
 * - doc, paragraph, heading, text + marks (strong/em/code/link/strike/underline)
 * - bulletList / orderedList / listItem (nested)
 * - codeBlock (with language)
 * - blockquote, hardBreak, rule
 * - table / tableRow / tableHeader / tableCell
 * - mediaSingle / media → ![alt](url)
 * - extension → fenced block (special-cases Mermaid)
 * - mention (@displayName), inlineCard, panel, expand, status, date, emoji
 *
 * Unknown nodes degrade to their text content if any, otherwise are dropped.
 */

import type { AdfDocument, AdfMark, AdfNode } from "../types/adf.js";

export function adfToMarkdown(input: AdfDocument | string): string {
  const doc = typeof input === "string" ? parseAdf(input) : input;
  if (!doc || !Array.isArray(doc.content)) return "";

  const blocks = doc.content
    .map((node) => renderBlock(node, 0))
    .filter((s) => s !== "");

  return blocks.join("\n\n").trim();
}

function parseAdf(input: string): AdfDocument | null {
  try {
    const parsed = JSON.parse(input);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.type === "doc" &&
      Array.isArray(parsed.content)
    ) {
      return parsed as AdfDocument;
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ─── Block-level rendering ───────────────────────────────────────────────────

function renderBlock(node: AdfNode, listDepth: number): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content ?? []);

    case "heading": {
      const level = clampHeadingLevel(node.attrs?.level);
      return `${"#".repeat(level)} ${renderInline(node.content ?? [])}`;
    }

    case "codeBlock":
      return renderCodeBlock(node);

    case "blockquote":
      return renderBlockquote(node);

    case "bulletList":
      return renderList(node, false, listDepth);

    case "orderedList":
      return renderList(node, true, listDepth);

    case "rule":
      return "---";

    case "table":
      return renderTable(node);

    case "mediaSingle":
    case "mediaGroup":
      return renderMediaContainer(node);

    case "extension":
    case "bodiedExtension":
    case "inlineExtension":
      return renderExtension(node);

    case "panel":
      return renderPanel(node);

    case "expand":
    case "nestedExpand":
      return renderExpand(node);

    case "decisionList":
    case "taskList":
      return renderTaskOrDecisionList(node);

    default:
      return renderInline(node.content ?? []);
  }
}

function clampHeadingLevel(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(6, Math.max(1, Math.floor(n)));
}

function renderCodeBlock(node: AdfNode): string {
  const language =
    typeof node.attrs?.language === "string" ? node.attrs.language : "";
  const text = (node.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("");
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function renderBlockquote(node: AdfNode): string {
  const inner = (node.content ?? [])
    .map((c) => renderBlock(c, 0))
    .filter((s) => s !== "")
    .join("\n\n");
  return inner
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderList(
  node: AdfNode,
  ordered: boolean,
  depth: number
): string {
  const items = node.content ?? [];
  const startRaw = node.attrs?.order;
  const start =
    ordered && typeof startRaw === "number" && startRaw > 0 ? startRaw : 1;

  const lines: string[] = [];
  items.forEach((item, idx) => {
    if (item.type !== "listItem") return;
    const marker = ordered ? `${start + idx}.` : "-";
    const rendered = renderListItem(item, marker, depth);
    if (rendered) lines.push(rendered);
  });
  return lines.join("\n");
}

function renderListItem(
  item: AdfNode,
  marker: string,
  depth: number
): string {
  const indent = "  ".repeat(depth);
  const blocks = item.content ?? [];

  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (block.type === "bulletList") {
      const nested = renderList(block, false, depth + 1);
      if (nested) out.push(nested);
      return;
    }
    if (block.type === "orderedList") {
      const nested = renderList(block, true, depth + 1);
      if (nested) out.push(nested);
      return;
    }

    const rendered = renderBlock(block, depth + 1);
    if (rendered === "") return;

    if (i === 0) {
      // First block carries the bullet marker.
      out.push(`${indent}${marker} ${rendered.split("\n").join(`\n${indent}  `)}`);
    } else {
      // Continuation paragraph — indented under the bullet.
      out.push(
        rendered
          .split("\n")
          .map((line) => `${indent}  ${line}`)
          .join("\n")
      );
    }
  });

  return out.join("\n");
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";

  const cellsByRow = rows.map((row) =>
    (row.content ?? []).map((cell) =>
      renderInline(extractCellInlineContent(cell)).replace(/\|/g, "\\|").replace(/\n+/g, " ")
    )
  );

  const colCount = Math.max(...cellsByRow.map((r) => r.length));
  if (colCount === 0) return "";

  const padRow = (cells: string[]): string[] => {
    if (cells.length >= colCount) return cells.slice(0, colCount);
    return [...cells, ...Array(colCount - cells.length).fill("")];
  };

  const headerCells = padRow(cellsByRow[0]);
  const bodyRows = cellsByRow.slice(1).map(padRow);

  const headerLine = `| ${headerCells.join(" | ")} |`;
  const sepLine = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const bodyLines = bodyRows.map((r) => `| ${r.join(" | ")} |`);

  return [headerLine, sepLine, ...bodyLines].join("\n");
}

function extractCellInlineContent(cell: AdfNode): AdfNode[] {
  // tableHeader/tableCell wrap their inline content in a paragraph node.
  // Flatten one level of paragraph nesting for the markdown table cell.
  const content = cell.content ?? [];
  if (
    content.length === 1 &&
    content[0].type === "paragraph" &&
    Array.isArray(content[0].content)
  ) {
    return content[0].content;
  }
  return content;
}

function renderMediaContainer(node: AdfNode): string {
  const inner = (node.content ?? [])
    .map((c) => {
      if (c.type !== "media") return "";
      return renderMedia(c);
    })
    .filter((s) => s !== "");
  return inner.join("\n");
}

function renderMedia(node: AdfNode): string {
  const attrs = node.attrs ?? {};
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const url =
    typeof attrs.url === "string"
      ? attrs.url
      : typeof attrs.id === "string"
      ? `attachment:${attrs.id}`
      : "";
  if (!url) return "";
  return `![${alt}](${url})`;
}

function renderExtension(node: AdfNode): string {
  const key =
    typeof node.attrs?.extensionKey === "string"
      ? node.attrs.extensionKey
      : "";
  // The Mermaid app emits a separate extension node alongside the codeBlock —
  // the codeBlock already renders the source; render the extension as empty.
  if (key.includes("mermaid-diagram")) return "";

  const summary =
    typeof node.attrs?.text === "string"
      ? node.attrs.text
      : key || "extension";
  return `[${summary}]`;
}

function renderPanel(node: AdfNode): string {
  // Panel types: info, note, warning, error, success, custom — render as
  // a blockquote prefixed with the type so the agent sees the intent.
  const panelType =
    typeof node.attrs?.panelType === "string" ? node.attrs.panelType : "info";
  const inner = (node.content ?? [])
    .map((c) => renderBlock(c, 0))
    .filter((s) => s !== "")
    .join("\n\n");
  const lines = inner.split("\n").map((line) => `> ${line}`);
  return [`> [!${panelType.toUpperCase()}]`, ...lines].join("\n");
}

function renderExpand(node: AdfNode): string {
  const title =
    typeof node.attrs?.title === "string" && node.attrs.title.length > 0
      ? node.attrs.title
      : "Details";
  const inner = (node.content ?? [])
    .map((c) => renderBlock(c, 0))
    .filter((s) => s !== "")
    .join("\n\n");
  return `<details><summary>${title}</summary>\n\n${inner}\n\n</details>`;
}

function renderTaskOrDecisionList(node: AdfNode): string {
  const items = node.content ?? [];
  const lines = items
    .map((item) => {
      const checked = item.attrs?.state === "DONE";
      const text = renderInline(item.content ?? []);
      return `- [${checked ? "x" : " "}] ${text}`;
    })
    .filter((line) => line !== "- [ ] " && line !== "- [x] ");
  return lines.join("\n");
}

// ─── Inline rendering ────────────────────────────────────────────────────────

function renderInline(nodes: AdfNode[]): string {
  return nodes.map((n) => renderInlineNode(n)).join("");
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks ?? []);

    case "hardBreak":
      return "  \n";

    case "mention": {
      const name =
        typeof node.attrs?.text === "string"
          ? node.attrs.text
          : typeof node.attrs?.displayName === "string"
          ? node.attrs.displayName
          : typeof node.attrs?.id === "string"
          ? node.attrs.id
          : "user";
      return `@${name}`;
    }

    case "emoji": {
      const shortName =
        typeof node.attrs?.shortName === "string" ? node.attrs.shortName : "";
      const text = typeof node.attrs?.text === "string" ? node.attrs.text : "";
      return text || shortName || "";
    }

    case "date": {
      const ts =
        typeof node.attrs?.timestamp === "string" ||
        typeof node.attrs?.timestamp === "number"
          ? String(node.attrs.timestamp)
          : "";
      if (!ts) return "";
      const ms = /^\d+$/.test(ts) ? Number(ts) : NaN;
      if (Number.isFinite(ms)) {
        return new Date(ms).toISOString().slice(0, 10);
      }
      return ts;
    }

    case "status": {
      const text = typeof node.attrs?.text === "string" ? node.attrs.text : "";
      return text ? `[${text}]` : "";
    }

    case "inlineCard": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      return url ? `<${url}>` : "";
    }

    case "media":
      // Inline media (rare) — render same as block media but inline.
      return renderMedia(node);

    default:
      // Containers (e.g. when an inline node has nested content like a link
      // mark applied via wrapping), or unknown — render children.
      if (Array.isArray(node.content)) {
        return renderInline(node.content);
      }
      return typeof node.text === "string" ? node.text : "";
  }
}

// Mark application order matters when marks combine. We apply: code → strike →
// em → strong → underline → link, which produces the conventional nesting
// `[**_text_**](href)`.
function applyMarks(text: string, marks: AdfMark[]): string {
  if (text === "") return "";

  // Find marks by type for predictable layering.
  const has = (type: string) => marks.find((m) => m.type === type);

  let out = text;

  if (has("code")) {
    // Inline code can't carry other marks meaningfully.
    return `\`${out}\``;
  }

  if (has("strike")) out = `~~${out}~~`;
  if (has("em")) out = `*${out}*`;
  if (has("strong")) out = `**${out}**`;
  if (has("underline")) out = `<u>${out}</u>`;

  const link = has("link");
  if (link) {
    const href =
      typeof link.attrs?.href === "string" ? link.attrs.href : "";
    out = `[${out}](${href})`;
  }

  return out;
}
