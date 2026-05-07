#!/usr/bin/env node
/**
 * Reproducible benchmark for the trim layer + body cache.
 *
 * Pulls real Confluence data via the same client the MCP server uses
 * and measures three cost dimensions for representative scenarios:
 *
 *   raw   = JSON.stringify(rawApiResponse).length          (legacy main)
 *   trim  = JSON.stringify(applyTrim(name, raw, ...)).length  (v2 default)
 *   off   = JSON.stringify(rawApiResponse).length when CONFLUENCE_DISABLE_TRIM=1
 *
 * Plus a tool-list-cost section that measures the bytes paid every
 * conversation just to advertise the tool surface (no API calls).
 *
 * Usage:
 *   npm run build
 *   npm run bench
 *
 * Output is plain text suitable for pasting into docs/BENCHMARK.md.
 *
 * Requires CONFLUENCE_HOST / CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN
 * in the environment (or .env / .env.local).
 *
 * The targets are picked from the same "Scotts" space the integration
 * tests use (id 5353898365). Folder search uses the global CQL surface
 * since the Scotts space has no folders.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

import { ConfluenceClient } from "../build/auth/confluence-client.js";
import { getConfig, getToolFilterConfig } from "../build/config.js";
import { applyTrim } from "../build/core/trim.js";
import { getFilteredTools } from "../build/tools/index.js";

const SPACE_ID = "5353898365";

// Target pages in the Scotts space. The body sizes (storage / ADF)
// printed in the discovery probe earlier:
//   5356749914  Mermaid API Test         ~1KB / ~1KB
//   5426874944  Short Doc Storage        ~3KB / ~9KB
//   5425597351  Long Doc Storage         ~12KB / ~37KB
//   5358485527  Confluence MCP - README  ~39KB / ~47KB
const PAGE_TARGETS = [
  { label: "tiny page (~1KB body)", id: 5356749914 },
  { label: "short page (~3KB body)", id: 5426874944 },
  { label: "long page (~12KB body)", id: 5425597351 },
  { label: "huge page (~39KB body)", id: 5358485527 },
];

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
function fmt(n) {
  return NUMBER_FORMAT.format(n);
}
function bytes(s) {
  return Buffer.byteLength(s, "utf-8");
}
function jsonBytes(x) {
  return bytes(JSON.stringify(x));
}
// Convention used by jira-mcp's BENCHMARK.md and most LLM tooling: ~4
// bytes per token. Approximation, not precise.
function toks(b) {
  return Math.round(b / 4);
}
function ratio(a, b) {
  if (b === 0) return "∞";
  return (a / b).toFixed(2) + "×";
}

function header(title) {
  console.log("");
  console.log(`### ${title}`);
  console.log("");
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// ─── Tool-list cost ─────────────────────────────────────────────────────────

function measureToolList(label, env) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    const filterConfig = getToolFilterConfig();
    const tools = getFilteredTools(filterConfig);
    const wire = JSON.stringify({ tools });
    return {
      label,
      tools: tools.length,
      bytes: bytes(wire),
      tokens: toks(bytes(wire)),
    };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── Per-call cost (single page) ────────────────────────────────────────────

async function measureSinglePage(client, target, format) {
  const raw = await client.get(`/pages/${target.id}`, {
    "body-format": format,
  });
  const rawBytes = jsonBytes(raw);
  const trimmed = await applyTrim("confluence_get_page", raw, {});
  const trimBytes = jsonBytes(trimmed);
  return {
    label: `${target.label} (${format})`,
    raw: rawBytes,
    trim: trimBytes,
    ratio: ratio(rawBytes, trimBytes),
  };
}

// ─── Per-call cost (page list) ──────────────────────────────────────────────

async function measurePageList(client) {
  const raw = await client.get(`/spaces/${SPACE_ID}/pages`, {
    "body-format": "atlas_doc_format",
    limit: 25,
  });
  const rawBytes = jsonBytes(raw);
  const trimmed = await applyTrim("confluence_get_pages_in_space", raw, {});
  const trimBytes = jsonBytes(trimmed);
  return {
    label: `25-page list in space (with bodies)`,
    raw: rawBytes,
    trim: trimBytes,
    ratio: ratio(rawBytes, trimBytes),
  };
}

// ─── Per-call cost (CQL search) ─────────────────────────────────────────────

async function measureCqlSearch(client, label, cql, limit = 25) {
  const raw = await client.getV1("/search", { cql, limit });
  const rawBytes = jsonBytes(raw);
  const trimmed = await applyTrim("confluence_cql_search", raw, {});
  const trimBytes = jsonBytes(trimmed);
  return {
    label,
    raw: rawBytes,
    trim: trimBytes,
    ratio: ratio(rawBytes, trimBytes),
  };
}

// ─── Driver ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("# Confluence MCP — Benchmark");
  console.log("");
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Source: live Confluence instance via the standard client`);
  console.log("");

  // Tool-list footprint
  header("Tool-list footprint (per-conversation overhead)");
  const toolListRows = [
    measureToolList("default (all categories)", {
      CONFLUENCE_ENABLED_CATEGORIES: undefined,
      CONFLUENCE_DISABLED_TOOLS: undefined,
    }),
    measureToolList("3 categories (page, search, body)", {
      CONFLUENCE_ENABLED_CATEGORIES: "page,search,body",
      CONFLUENCE_DISABLED_TOOLS: undefined,
    }),
    measureToolList("3 categories minus destructive ops", {
      CONFLUENCE_ENABLED_CATEGORIES: "page,search,body",
      CONFLUENCE_DISABLED_TOOLS:
        "confluence_delete_page,confluence_create_page,confluence_update_page",
    }),
  ];
  const baseToolBytes = toolListRows[0].bytes;
  console.log(
    "| filter | tools | bytes | ~tokens | factor |"
  );
  console.log("|---|---:|---:|---:|---:|");
  for (const row of toolListRows) {
    console.log(
      `| ${row.label} | ${row.tools} | ${fmt(row.bytes)} | ${fmt(
        row.tokens
      )} | ${ratio(baseToolBytes, row.bytes)} |`
    );
  }

  // Per-call cost
  const client = new ConfluenceClient(getConfig());

  header("Per-call cost — single page reads");
  const singlePageRows = [];
  for (const target of PAGE_TARGETS) {
    for (const format of ["storage", "atlas_doc_format"]) {
      singlePageRows.push(await measureSinglePage(client, target, format));
    }
  }
  console.log("| scenario | raw bytes | trimmed bytes | reduction |");
  console.log("|---|---:|---:|---:|");
  for (const r of singlePageRows) {
    console.log(
      `| ${r.label} | ${fmt(r.raw)} | ${fmt(r.trim)} | ${r.ratio} |`
    );
  }

  header("Per-call cost — page list (`confluence_get_pages_in_space`, 25 items)");
  const list = await measurePageList(client);
  console.log("| scenario | raw bytes | trimmed bytes | reduction |");
  console.log("|---|---:|---:|---:|");
  console.log(
    `| ${list.label} | ${fmt(list.raw)} | ${fmt(list.trim)} | ${list.ratio} |`
  );

  header("Per-call cost — CQL search");
  const cqlPages = await measureCqlSearch(
    client,
    `text search ("README")`,
    'text~"README"',
    25
  );
  const cqlFolders = await measureCqlSearch(
    client,
    `folder search (type=folder)`,
    "type=folder",
    25
  );
  console.log("| scenario | raw bytes | trimmed bytes | reduction |");
  console.log("|---|---:|---:|---:|");
  for (const r of [cqlPages, cqlFolders]) {
    console.log(
      `| ${r.label} | ${fmt(r.raw)} | ${fmt(r.trim)} | ${r.ratio} |`
    );
  }

  // Aggregate row
  header("Per-call summary (sum across all per-call scenarios above)");
  const allCalls = [...singlePageRows, list, cqlPages, cqlFolders];
  const sumRaw = allCalls.reduce((a, x) => a + x.raw, 0);
  const sumTrim = allCalls.reduce((a, x) => a + x.trim, 0);
  console.log("| | raw bytes | trimmed bytes | reduction |");
  console.log("|---|---:|---:|---:|");
  console.log(
    `| **${allCalls.length} scenarios combined** | ${fmt(sumRaw)} | ${fmt(
      sumTrim
    )} | ${ratio(sumRaw, sumTrim)} |`
  );

  console.log("");
  console.log("Tokens approximate at ~4 bytes/token (LLM tooling convention).");
}

main().catch((err) => {
  console.error("benchmark failed:", err);
  process.exit(1);
});
