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

/**
 * Per-call sentinel sequence — kept long and distinctive so it cannot
 * appear naturally in either Confluence storage XHTML or markdown output.
 */
const PLACEHOLDER_PREFIX = " __PROTECTED_BLOCK_";
const PLACEHOLDER_SUFFIX = "__ ";

export function storageXhtmlToMarkdown(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";

  // 0. Encode angle brackets inside quoted attribute values so downstream
  //    regexes (which use [^>]* to scan attributes) don't terminate early
  //    on a literal '>' that's actually part of an attribute value.
  let text = encodeAngleBracketsInAttrs(input);

  // 0b. Confluence stores Mermaid diagrams as a code macro followed by
  //    a sibling <ac:adf-extension> with extensionKey ending in
  //    `mermaid-diagram`. The code macro itself has no language
  //    parameter — the extension is what tells the Mermaid plugin to
  //    render. Rewrite the pair so the code macro carries
  //    language=mermaid, then drop the extension. Order matters:
  //    must run before resolveMacros so the macro renderer sees the
  //    injected language parameter.
  text = liftAdfExtensionLanguage(text);

  // 0c. Strip any remaining <ac:adf-extension> blocks. They're
  //    plugin-orchestration metadata with no agent-useful payload, but
  //    the catch-all tag stripper would otherwise leave their nested
  //    <ac:adf-attribute> text content intact (extension keys, local
  //    ids, etc. leaking into the markdown output).
  text = stripAdfExtensions(text);

  // 1. Resolve macros first. Code/noformat/mermaid macros stash their
  //    fenced-block output behind sentinel placeholders so subsequent
  //    passes (lists, inline marks, tag stripper, entity decoder) don't
  //    treat the source code as XHTML. Re-inserted verbatim at step 6.
  const protectedBlocks: string[] = [];
  text = resolveMacros(text, protectedBlocks);

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
  text = stripRemainingTags(text);

  // 5. Decode entities and normalize whitespace.
  text = decodeEntities(text);
  text = collapseBlankLines(text);

  // 6. Re-insert code/noformat/mermaid blocks. Done last so their content
  //    is never re-processed by the passes above.
  text = restoreProtectedBlocks(text, protectedBlocks);

  return text.trim();
}

function protectBlock(content: string, table: string[]): string {
  const id = table.length;
  table.push(content);
  return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
}

function restoreProtectedBlocks(text: string, table: string[]): string {
  if (table.length === 0) return text;
  const re = new RegExp(
    `${PLACEHOLDER_PREFIX.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}` +
      "(\\d+)" +
      `${PLACEHOLDER_SUFFIX.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`,
    "g"
  );
  return text.replace(re, (_, id) => table[Number(id)] ?? "");
}

/**
 * Find each Mermaid `<ac:adf-extension>` and look back for the
 * closest preceding `<ac:structured-macro ac:name="code|noformat">`.
 * If the only thing between them is whitespace, paragraph wrappers
 * (`<p>` / `</p>`), or `<br/>`, treat them as a Mermaid pair: inject
 * `<ac:parameter ac:name="language">mermaid</ac:parameter>` into the
 * code macro and drop the extension.
 *
 * Anchored on the extension (rather than pair-matched as a single
 * regex) because Confluence frequently wraps each node in `<p>` —
 * the previous "macro followed by extension separated only by `\s*`"
 * approach missed every wrapped pair.
 */
function liftAdfExtensionLanguage(text: string): string {
  const extRe =
    /<ac:adf-extension(?:\s[^>]*)?>([\s\S]*?)<\/ac:adf-extension>/g;
  const macroOpenRe =
    /<ac:structured-macro\s+[^>]*ac:name="(?:code|noformat)"[^>]*>/gi;
  const macroCloseLiteral = "</ac:structured-macro>";

  let result = "";
  let cursor = 0;
  let m;
  while ((m = extRe.exec(text)) !== null) {
    const extStart = m.index;
    const extEnd = extStart + m[0].length;
    const extInner = m[1];

    if (!extensionInnerIsMermaid(extInner)) continue;

    // Find the closest preceding `</ac:structured-macro>` and verify
    // the gap between it and the extension is only block wrappers.
    const beforeExt = text.slice(cursor, extStart);
    const macroCloseIdx = beforeExt.lastIndexOf(macroCloseLiteral);
    if (macroCloseIdx < 0) continue;
    const macroCloseEnd = macroCloseIdx + macroCloseLiteral.length;
    const gap = beforeExt.slice(macroCloseEnd);
    if (!isBlockWrapperGap(gap)) continue;

    // Find the matching open tag for this close. Walk backward to the
    // last code|noformat open in `beforeExt[0..macroCloseIdx]`.
    macroOpenRe.lastIndex = 0;
    let lastOpenStart = -1;
    let lastOpenEnd = -1;
    let om;
    while ((om = macroOpenRe.exec(beforeExt)) !== null) {
      if (om.index >= macroCloseIdx) break;
      lastOpenStart = om.index;
      lastOpenEnd = om.index + om[0].length;
    }
    if (lastOpenStart < 0) continue;

    const macroOpen = beforeExt.slice(lastOpenStart, lastOpenEnd);
    const macroBody = beforeExt.slice(lastOpenEnd, macroCloseIdx);
    const macroFull = beforeExt.slice(lastOpenStart, macroCloseEnd);

    const alreadyHasLanguage =
      /<ac:parameter\s+ac:name="language"/i.test(macroFull);
    const newMacro = alreadyHasLanguage
      ? macroFull
      : macroOpen +
        '<ac:parameter ac:name="language">mermaid</ac:parameter>' +
        macroBody +
        macroCloseLiteral;

    // Emit: text up to the macro, the rewritten macro, the gap
    // (possibly `<p></p>` etc., harmless), and skip past the
    // extension.
    result += text.slice(cursor, cursor + lastOpenStart);
    result += newMacro;
    result += gap;
    cursor = extEnd;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * The only content allowed between a code macro and the Mermaid
 * extension that should still be considered a "pair": whitespace,
 * paragraph wrappers, line breaks. Anything else (other macros,
 * lists, tables, etc.) means they're not actually adjacent.
 */
function isBlockWrapperGap(gap: string): boolean {
  return /^(?:\s|<\/?p[^>]*>|<br\s*\/?>)*$/i.test(gap);
}

function extensionInnerIsMermaid(inner: string): boolean {
  // Matches both attribute styles Confluence emits:
  //   <ac:adf-attribute key="extension-key">.../mermaid-diagram</ac:adf-attribute>
  //   key="extensionKey" (camelCase)
  const m = inner.match(
    /<ac:adf-attribute\s+key="extension[-_]?[Kk]ey"[^>]*>([\s\S]*?)<\/ac:adf-attribute>/
  );
  if (!m) return false;
  return m[1].includes("mermaid-diagram");
}

/**
 * Drop any remaining `<ac:adf-extension>` blocks. After the Mermaid
 * lift in `liftAdfExtensionLanguage` the only ones left are
 * standalone extensions (no preceding code macro to attach to) or
 * non-Mermaid extension types. Either way, their payload is plugin
 * orchestration metadata, not content for the agent.
 */
function stripAdfExtensions(text: string): string {
  // Both forms: paired `<ac:adf-extension>...</ac:adf-extension>` and
  // self-closing `<ac:adf-extension ... />`. The catch-all tag stripper
  // would otherwise drop the wrapper but keep nested
  // <ac:adf-attribute> text content (extension keys, local ids, etc.).
  return text.replace(
    /<ac:adf-extension(?:\s[^>]*)?\/>|<ac:adf-extension[^>]*>[\s\S]*?<\/ac:adf-extension>/g,
    ""
  );
}

/**
 * Walk the input and entity-encode `<` and `>` that appear inside quoted
 * attribute values (`...="..."` or `...='...'`). Without this, a regex
 * like `<p[^>]*>` truncates at the first `>` inside an attribute value,
 * which leaves the rest of the value as stray text once the (mis-matched)
 * tag is stripped.
 */
function encodeAngleBracketsInAttrs(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch !== "<") {
      out += ch;
      i++;
      continue;
    }
    const next = input[i + 1];
    const isTagStart =
      next === "/" || next === "!" || next === "?" || /[a-zA-Z]/.test(next ?? "");
    if (!isTagStart) {
      out += ch;
      i++;
      continue;
    }
    // Inside a tag — copy chars, encoding angle brackets that appear
    // inside a quoted attribute value, until the (real) closing '>'.
    let j = i;
    let quote: '"' | "'" | null = null;
    let segment = "";
    while (j < input.length) {
      const c = input[j];
      if (quote) {
        if (c === quote) {
          quote = null;
          segment += c;
        } else if (c === "<") {
          segment += "&lt;";
        } else if (c === ">") {
          segment += "&gt;";
        } else {
          segment += c;
        }
      } else if (c === '"' || c === "'") {
        quote = c;
        segment += c;
      } else if (c === ">") {
        segment += c;
        j++;
        break;
      } else {
        segment += c;
      }
      j++;
    }
    out += segment;
    i = j;
  }
  return out;
}

const KEEP_TAGS = new Set(["details", "summary", "u"]);

/**
 * Strip XHTML/XML tags from `text`, preserving the small allowlist used
 * by markdown output (`<details>`, `<summary>`, `<u>`).
 *
 * Quote-aware: angle brackets inside `"..."` or `'...'` attribute values
 * are not treated as tag delimiters. This matters because some real
 * Confluence storage emits `title="<...>"` and similar; the previous
 * regex-only stripper would mis-tokenize and corrupt surrounding text.
 */
function stripRemainingTags(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "<") {
      out += ch;
      i++;
      continue;
    }
    // Look at what follows '<'. If not a plausible tag start, emit literally.
    const next = text[i + 1];
    const isTagStart =
      next === "/" || next === "!" || next === "?" || /[a-zA-Z]/.test(next ?? "");
    if (!isTagStart) {
      out += ch;
      i++;
      continue;
    }

    // Walk until the matching '>', skipping over quoted regions.
    let j = i + 1;
    let quote: '"' | "'" | null = null;
    while (j < text.length) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    if (j >= text.length) {
      // Unterminated — emit the rest literally rather than swallow it.
      out += text.slice(i);
      break;
    }

    const tagSrc = text.slice(i, j + 1);
    const m = tagSrc.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
    const name = m ? m[1].toLowerCase() : "";
    if (name && KEEP_TAGS.has(name)) {
      out += tagSrc;
    }
    i = j + 1;
  }
  return out;
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

/**
 * Walk `text` and replace each top-level `<ac:structured-macro>` (closed
 * or self-closing) with its rendered output. Depth-aware: macros nested
 * inside a panel/expand body do NOT terminate the outer macro early.
 * (A non-greedy regex has the opposite behavior and corrupts nested
 * cases like a `code` macro inside an `info` panel.)
 */
function resolveMacros(text: string, protectedBlocks: string[]): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = findNextMacroOpen(text, i);
    if (!open) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open.start);

    if (open.selfClosing) {
      const name = extractAcAttr(open.attrs, "ac:name");
      if (name) out += renderMacro(name, "", protectedBlocks);
      i = open.openEnd;
      continue;
    }

    const closeIdx = findMatchingMacroClose(text, open.openEnd);
    if (closeIdx < 0) {
      // Unbalanced — leave the rest as-is.
      out += text.slice(open.start);
      break;
    }
    const body = text.slice(open.openEnd, closeIdx);
    const name = extractAcAttr(open.attrs, "ac:name");
    if (name) out += renderMacro(name, body, protectedBlocks);
    i = closeIdx + "</ac:structured-macro>".length;
  }
  return out;
}

interface MacroOpen {
  start: number;
  openEnd: number;
  attrs: string;
  selfClosing: boolean;
}

function findNextMacroOpen(text: string, from: number): MacroOpen | null {
  const re = /<ac:structured-macro\s+([^>]*?)(\/?)>/g;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return null;
  return {
    start: m.index,
    openEnd: m.index + m[0].length,
    attrs: m[1],
    selfClosing: m[2] === "/",
  };
}

function findMatchingMacroClose(text: string, from: number): number {
  const open = /<ac:structured-macro\s+([^>]*?)(\/?)>/g;
  const close = /<\/ac:structured-macro\s*>/g;
  let depth = 1;
  let cursor = from;
  while (cursor < text.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(text);
    const c = close.exec(text);
    if (!c) return -1;
    // A self-closing match doesn't open a new depth level.
    const oIsRealOpen = o && o[2] !== "/";
    if (oIsRealOpen && o.index < c.index) {
      depth++;
      cursor = o.index + o[0].length;
    } else if (o && o[2] === "/" && o.index < c.index) {
      // Self-closing macro between us and the next close — skip past it.
      cursor = o.index + o[0].length;
    } else {
      depth--;
      if (depth === 0) return c.index;
      cursor = c.index + c[0].length;
    }
  }
  return -1;
}

function extractAcAttr(attrs: string, key: string): string | undefined {
  const re = new RegExp(`${escapeRegex(key)}="([^"]*)"`);
  const m = attrs.match(re);
  return m ? m[1] : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMacro(name: string, body: string, protectedBlocks: string[]): string {
  const lower = name.toLowerCase();

  switch (lower) {
    case "code": {
      const lang =
        extractParam(body, "language") ?? extractParam(body, "title") ?? "";
      const text = extractPlainTextBody(body);
      return protectBlock(
        `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`,
        protectedBlocks
      );
    }

    case "noformat": {
      const text = extractPlainTextBody(body);
      return protectBlock(`\n\n\`\`\`\n${text}\n\`\`\`\n\n`, protectedBlocks);
    }

    case "mermaid":
    case "mermaid-cloud":
    case "mermaid-diagram": {
      const text = extractParam(body, "code") ?? extractPlainTextBody(body);
      return protectBlock(
        `\n\n\`\`\`mermaid\n${text}\n\`\`\`\n\n`,
        protectedBlocks
      );
    }

    case "info":
    case "note":
    case "warning":
    case "tip":
    case "success":
    case "panel": {
      const inner = extractRichTextBody(body);
      const label = lower.toUpperCase();
      // The inner is already fully-resolved markdown from a recursive
      // converter call; stash it so the outer passes don't re-process
      // any code/inline marks/tags it contains.
      return protectBlock(
        `\n\n> [!${label}]\n${prefixLines(inner, "> ")}\n\n`,
        protectedBlocks
      );
    }

    case "expand": {
      const title = extractParam(body, "title") ?? "Details";
      const inner = extractRichTextBody(body);
      return protectBlock(
        `\n\n<details><summary>${title}</summary>\n\n${inner}\n\n</details>\n\n`,
        protectedBlocks
      );
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
  text = stripRemainingTags(text);
  text = decodeEntities(text);
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function pad(arr: string[], n: number): string[] {
  if (arr.length >= n) return arr.slice(0, n);
  return [...arr, ...Array(n - arr.length).fill("")];
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function resolveLists(text: string): string {
  // Recursive descent: find each top-level <ul>/<ol> and walk its tree.
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = findNextListOpen(text, i);
    if (!open) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open.start);
    const end = findMatchingListClose(text, open.openEnd, open.tag);
    if (end < 0) {
      // Unbalanced — degrade to leaving the rest as-is.
      out += text.slice(open.start);
      break;
    }
    const body = text.slice(open.openEnd, end);
    out += `\n${renderList(body, open.tag === "ol", 0)}\n`;
    i = end + `</${open.tag}>`.length;
  }
  return out;
}

interface ListOpen {
  start: number;
  openEnd: number;
  tag: "ul" | "ol";
}

function findNextListOpen(text: string, from: number): ListOpen | null {
  const re = /<(ul|ol)\b[^>]*>/gi;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return null;
  return {
    start: m.index,
    openEnd: m.index + m[0].length,
    tag: m[1].toLowerCase() as "ul" | "ol",
  };
}

/**
 * Find the index of the matching `</tag>` after `from`, accounting for
 * nested same-tag pairs.
 */
function findMatchingListClose(
  text: string,
  from: number,
  tag: "ul" | "ol"
): number {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`<\\/${tag}\\s*>`, "gi");
  let depth = 1;
  let cursor = from;
  while (cursor < text.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(text);
    const c = close.exec(text);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + o[0].length;
    } else {
      depth--;
      if (depth === 0) return c.index;
      cursor = c.index + c[0].length;
    }
  }
  return -1;
}

function renderList(listBody: string, ordered: boolean, depth: number): string {
  const items = splitTopLevelListItems(listBody);
  const lines: string[] = [];
  items.forEach((itemHtml, idx) => {
    const marker = ordered ? `${idx + 1}.` : "-";
    const indent = "  ".repeat(depth);
    const { firstLine, nestedBlocks } = renderListItem(itemHtml, depth);
    lines.push(`${indent}${marker} ${firstLine}`.replace(/\s+$/, ""));
    if (nestedBlocks) lines.push(nestedBlocks);
  });
  return lines.join("\n");
}

/**
 * Split a list body into the contents of its top-level `<li>` elements,
 * skipping any `<li>` that's nested inside a child `<ul>`/`<ol>`.
 */
function splitTopLevelListItems(listBody: string): string[] {
  const items: string[] = [];
  let i = 0;
  while (i < listBody.length) {
    const open = /<li\b[^>]*>/gi;
    open.lastIndex = i;
    const m = open.exec(listBody);
    if (!m) break;
    const itemStart = m.index + m[0].length;
    const itemEnd = findMatchingLiClose(listBody, itemStart);
    if (itemEnd < 0) break;
    items.push(listBody.slice(itemStart, itemEnd));
    i = itemEnd + "</li>".length;
  }
  return items;
}

function findMatchingLiClose(text: string, from: number): number {
  const open = /<li\b[^>]*>/gi;
  const close = /<\/li\s*>/gi;
  let depth = 1;
  let cursor = from;
  while (cursor < text.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(text);
    const c = close.exec(text);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      cursor = o.index + o[0].length;
    } else {
      depth--;
      if (depth === 0) return c.index;
      cursor = c.index + c[0].length;
    }
  }
  return -1;
}

/**
 * Render a single list item: extract the inline portion (first line) and
 * any nested lists (recursively rendered with deeper indentation).
 *
 * Uses the depth-aware list-close finder rather than a non-greedy regex,
 * so a top-level child `<ul>` containing further nested `<ul>` pairs is
 * peeled off as a balanced unit instead of stopping at the first
 * `</ul>`.
 */
function renderListItem(
  itemHtml: string,
  depth: number
): { firstLine: string; nestedBlocks: string } {
  const nestedRendered: string[] = [];
  let stripped = "";
  let i = 0;
  while (i < itemHtml.length) {
    const open = findNextListOpen(itemHtml, i);
    if (!open) {
      stripped += itemHtml.slice(i);
      break;
    }
    stripped += itemHtml.slice(i, open.start);
    const closeIdx = findMatchingListClose(itemHtml, open.openEnd, open.tag);
    if (closeIdx < 0) {
      stripped += itemHtml.slice(open.start);
      break;
    }
    const body = itemHtml.slice(open.openEnd, closeIdx);
    nestedRendered.push(renderList(body, open.tag === "ol", depth + 1));
    i = closeIdx + `</${open.tag}>`.length;
  }

  const firstLine = stripBlockTagsForListItem(stripped);
  const nestedBlocks = nestedRendered.filter((s) => s !== "").join("\n");
  return { firstLine, nestedBlocks };
}

function stripBlockTagsForListItem(html: string): string {
  let text = html.replace(/<\/?p[^>]*>/gi, "");
  text = resolveLinks(text);
  text = resolveInlineMarks(text);
  text = decodeEntities(text);
  text = stripRemainingTags(text);
  return text.trim();
}

// ─── Blockquotes ─────────────────────────────────────────────────────────────

function resolveBlockquotes(text: string): string {
  return text.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_m, body) => {
      const stripped = body.replace(/<\/?p[^>]*>/gi, "\n");
      const inner = stripRemainingTags(stripped).trim();
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
