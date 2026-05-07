/**
 * Convert Confluence "storage format" (XHTML + ac/ri macro tags) to Markdown.
 *
 * Regex-based by design: the trim layer forces `body-format=atlas_doc_format`
 * for pages and blog posts when callers don't specify, so storage is the rare
 * fallback path (legacy data, version history, comments without ADF).
 *
 * Coverage:
 * - Headings (h1-h6), paragraphs, line breaks
 * - Bold/italic/strike/code inline
 * - Links (a, ac:link with ri:page/ri:attachment/ri:user)
 * - Lists (ul/ol/li, including nested)
 * - Tables (thead/tbody/tr/th/td)
 * - Blockquotes
 * - <ac:structured-macro ac:name="code"> with optional language
 * - <ac:structured-macro ac:name="info|note|warning|tip|panel|expand">
 * - Images (img, ac:image with ri:attachment/ri:url)
 * - Mermaid macro
 *
 * Unknown macros degrade to a `[macro: name]` placeholder.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function storageXhtmlToMarkdown(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";

  let text = input;

  // 1. Resolve macros first (they can contain XHTML inside).
  text = resolveMacros(text);

  // 2. Block-level structural tags.
  text = resolveTables(text);
  text = resolveLists(text);
  text = resolveBlockquotes(text);
  text = resolveHeadings(text);
  text = resolveParagraphs(text);
  text = resolveBreaks(text);
  text = resolveHorizontalRules(text);

  // 3. Inline formatting and links.
  text = resolveLinks(text);
  text = resolveInlineMarks(text);
  text = resolveImages(text);

  // 4. Strip any remaining XML/HTML tags except the markdown-friendly ones
  //    we emit ourselves (details/summary, u for underlines if any).
  text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, tag) => {
    const lower = (tag as string).toLowerCase();
    if (lower === "details" || lower === "summary" || lower === "u") return m;
    return "";
  });

  // 5. Decode entities and normalize whitespace.
  text = decodeEntities(text);
  text = collapseBlankLines(text);

  return text.trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : m
    );
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

// ─── Macros ──────────────────────────────────────────────────────────────────

function resolveMacros(text: string): string {
  const macroRegex =
    /<ac:structured-macro\s+([^>]*?)>([\s\S]*?)<\/ac:structured-macro>/g;

  return text.replace(macroRegex, (_full, attrsStr, body) => {
    const name = extractAcAttr(attrsStr, "ac:name");
    if (!name) return "";
    return renderMacro(name, body);
  });
}

function extractAcAttr(attrs: string, key: string): string | undefined {
  const re = new RegExp(`${escapeRegex(key)}="([^"]*)"`);
  const m = attrs.match(re);
  return m ? m[1] : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMacro(name: string, body: string): string {
  const lower = name.toLowerCase();

  switch (lower) {
    case "code": {
      const lang =
        extractParam(body, "language") ?? extractParam(body, "title") ?? "";
      const text = extractPlainTextBody(body);
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }

    case "noformat": {
      const text = extractPlainTextBody(body);
      return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }

    case "mermaid":
    case "mermaid-cloud":
    case "mermaid-diagram": {
      const text = extractParam(body, "code") ?? extractPlainTextBody(body);
      return `\n\n\`\`\`mermaid\n${text}\n\`\`\`\n\n`;
    }

    case "info":
    case "note":
    case "warning":
    case "tip":
    case "success":
    case "panel": {
      const inner = extractRichTextBody(body);
      const label = lower.toUpperCase();
      return `\n\n> [!${label}]\n${prefixLines(inner, "> ")}\n\n`;
    }

    case "expand": {
      const title = extractParam(body, "title") ?? "Details";
      const inner = extractRichTextBody(body);
      return `\n\n<details><summary>${title}</summary>\n\n${inner}\n\n</details>\n\n`;
    }

    case "status": {
      const title = extractParam(body, "title") ?? "";
      return title ? `[${title}]` : "";
    }

    default: {
      // Unknown macro — render a compact placeholder.
      return `[macro: ${name}]`;
    }
  }
}

function extractParam(body: string, name: string): string | undefined {
  const re = new RegExp(
    `<ac:parameter\\s+ac:name="${escapeRegex(name)}"[^>]*>([\\s\\S]*?)</ac:parameter>`
  );
  const m = body.match(re);
  return m ? stripCdata(m[1]).trim() : undefined;
}

function extractPlainTextBody(body: string): string {
  const m = body.match(
    /<ac:plain-text-body[^>]*>([\s\S]*?)<\/ac:plain-text-body>/
  );
  if (!m) return "";
  return stripCdata(m[1]);
}

function extractRichTextBody(body: string): string {
  const m = body.match(/<ac:rich-text-body[^>]*>([\s\S]*?)<\/ac:rich-text-body>/);
  if (!m) return "";
  // Recursively run the storage converter on the rich-text body so nested
  // markup and macros render correctly.
  return storageXhtmlToMarkdown(m[1]);
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

// ─── Tables ──────────────────────────────────────────────────────────────────

function resolveTables(text: string): string {
  return text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, body) => {
    const rows = extractRows(body);
    if (rows.length === 0) return "";

    const cellRows = rows.map((row) => extractCells(row));
    const colCount = Math.max(...cellRows.map((r) => r.length));
    if (colCount === 0) return "";

    // First row with <th> wins as header; otherwise synthesize empty header.
    const headerIndex = cellRows.findIndex((r) => r.some((c) => c.isHeader));
    let header: string[];
    let bodyRows: string[][];

    if (headerIndex >= 0) {
      header = pad(cellRows[headerIndex].map((c) => c.text), colCount);
      bodyRows = cellRows
        .filter((_, i) => i !== headerIndex)
        .map((r) => pad(r.map((c) => c.text), colCount));
    } else {
      header = pad([], colCount);
      bodyRows = cellRows.map((r) => pad(r.map((c) => c.text), colCount));
    }

    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${Array(colCount).fill("---").join(" | ")} |`,
      ...bodyRows.map((r) => `| ${r.join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });
}

function extractRows(tableBody: string): string[] {
  const rows: string[] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableBody)) !== null) {
    rows.push(m[1]);
  }
  return rows;
}

function extractCells(rowBody: string): { text: string; isHeader: boolean }[] {
  const cells: { text: string; isHeader: boolean }[] = [];
  const re = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowBody)) !== null) {
    cells.push({
      text: cellTextToInline(m[2]),
      isHeader: m[1].toLowerCase() === "th",
    });
  }
  return cells;
}

function cellTextToInline(html: string): string {
  // Strip block-level wrappers, keep inline marks, then run inline resolution.
  let text = html.replace(/<\/?p[^>]*>/gi, " ");
  text = resolveLinks(text);
  text = resolveInlineMarks(text);
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  text = decodeEntities(text);
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function pad(arr: string[], n: number): string[] {
  if (arr.length >= n) return arr.slice(0, n);
  return [...arr, ...Array(n - arr.length).fill("")];
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function resolveLists(text: string): string {
  // Iteratively resolve from the deepest list outward.
  let prev = "";
  let out = text;
  while (prev !== out) {
    prev = out;
    out = out.replace(
      /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/i,
      (_m, tag, body) => renderList(body, tag.toLowerCase() === "ol", 0)
    );
  }
  return out;
}

function renderList(listBody: string, ordered: boolean, depth: number): string {
  const items: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  let idx = 1;

  while ((m = re.exec(listBody)) !== null) {
    const itemHtml = m[1];
    const marker = ordered ? `${idx}.` : "-";
    idx++;

    const inline = stripBlockTagsForListItem(itemHtml);
    const indent = "  ".repeat(depth);
    items.push(`${indent}${marker} ${inline}`.replace(/\s+$/, ""));
  }

  return `\n${items.join("\n")}\n`;
}

function stripBlockTagsForListItem(html: string): string {
  // First-level paragraphs collapse to plain text; nested ul/ol pass through
  // (already resolved by the outer iteration).
  let text = html.replace(/<\/?p[^>]*>/gi, "");
  text = resolveLinks(text);
  text = resolveInlineMarks(text);
  text = decodeEntities(text);
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  return text.trim();
}

// ─── Blockquotes ─────────────────────────────────────────────────────────────

function resolveBlockquotes(text: string): string {
  return text.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_m, body) => {
      const inner = body
        .replace(/<\/?p[^>]*>/gi, "\n")
        .replace(/<\/?[a-zA-Z][^>]*>/g, "")
        .trim();
      return `\n\n${prefixLines(decodeEntities(inner), "> ")}\n\n`;
    }
  );
}

// ─── Headings, paragraphs, breaks ────────────────────────────────────────────

function resolveHeadings(text: string): string {
  return text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level, body) => {
      const cleaned = body.replace(/<\/?[a-zA-Z][^>]*>/g, "").trim();
      return `\n\n${"#".repeat(Number(level))} ${cleaned}\n\n`;
    }
  );
}

function resolveParagraphs(text: string): string {
  return text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
}

function resolveBreaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "  \n");
}

function resolveHorizontalRules(text: string): string {
  return text.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
}

// ─── Inline marks and links ──────────────────────────────────────────────────

function resolveInlineMarks(text: string): string {
  return text
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<(?:s|strike|del)[^>]*>([\s\S]*?)<\/(?:s|strike|del)>/gi, "~~$1~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
}

function resolveLinks(text: string): string {
  // Standard <a href>
  let out = text.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (_m, attrs, body) => {
      const hrefMatch = (attrs as string).match(/href="([^"]*)"/);
      const href = hrefMatch ? hrefMatch[1] : "";
      const label = body.replace(/<[^>]+>/g, "").trim();
      return href ? `[${label}](${href})` : label;
    }
  );

  // Confluence ac:link with ri:page
  out = out.replace(
    /<ac:link[^>]*>([\s\S]*?)<\/ac:link>/gi,
    (_m, body) => renderAcLink(body)
  );

  return out;
}

function renderAcLink(body: string): string {
  const pageMatch = body.match(/<ri:page[^>]*ri:content-title="([^"]*)"/);
  const attMatch = body.match(/<ri:attachment[^>]*ri:filename="([^"]*)"/);
  const userMatch = body.match(/<ri:user[^>]*ri:account-id="([^"]*)"/);
  const bodyMatch = body.match(
    /<ac:plain-text-link-body[^>]*>([\s\S]*?)<\/ac:plain-text-link-body>/
  );
  const linkBodyMatch = body.match(
    /<ac:link-body[^>]*>([\s\S]*?)<\/ac:link-body>/
  );

  const label = bodyMatch
    ? stripCdata(bodyMatch[1]).trim()
    : linkBodyMatch
    ? linkBodyMatch[1].replace(/<[^>]+>/g, "").trim()
    : "";

  if (pageMatch) {
    const title = pageMatch[1];
    return `[${label || title}](confluence://page/${encodeURIComponent(title)})`;
  }
  if (attMatch) {
    const file = attMatch[1];
    return `[${label || file}](confluence://attachment/${encodeURIComponent(file)})`;
  }
  if (userMatch) {
    return `@${userMatch[1]}`;
  }
  return label;
}

function resolveImages(text: string): string {
  // Standard <img>
  let out = text.replace(/<img\b([^>]*)\/?>/gi, (_m, attrs) => {
    const src = (attrs as string).match(/src="([^"]*)"/);
    const alt = (attrs as string).match(/alt="([^"]*)"/);
    if (!src) return "";
    return `![${alt ? alt[1] : ""}](${src[1]})`;
  });

  // Confluence <ac:image><ri:attachment ri:filename="..."/>
  out = out.replace(
    /<ac:image[^>]*>([\s\S]*?)<\/ac:image>/gi,
    (_m, body) => {
      const att = body.match(/<ri:attachment[^>]*ri:filename="([^"]*)"/);
      const url = body.match(/<ri:url[^>]*ri:value="([^"]*)"/);
      if (att) return `![](confluence://attachment/${encodeURIComponent(att[1])})`;
      if (url) return `![](${url[1]})`;
      return "";
    }
  );

  return out;
}
