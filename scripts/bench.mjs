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
import { getConfig } from "../build/config.js";
import { applyTrim } from "../build/core/trim.js";
import { getFilteredTools } from "../build/tools/index.js";

// Default targets are pages in the author's "Scotts" space (the same
// space the integration tests use). Override via env when running
// against a different tenant — see docs/BENCHMARK.md.
//
//   BENCH_SPACE_ID         space id for the page-list scenario
//   BENCH_PAGE_IDS         comma-separated page ids (4 representative
//                          sizes; bench discovers labels from the API)
//   BENCH_DISCOVER_FROM    space id; if set and BENCH_PAGE_IDS is not,
//                          pick 4 pages of varying body size from that
//                          space automatically
const DEFAULT_SPACE_ID = "5353898365"; // Scotts
const DEFAULT_PAGE_IDS = [5356749914, 5426874944, 5425597351, 5358485527];

const SPACE_ID = process.env.BENCH_SPACE_ID ?? DEFAULT_SPACE_ID;

if (
  !process.env.BENCH_SPACE_ID &&
  !process.env.BENCH_PAGE_IDS &&
  !process.env.BENCH_DISCOVER_FROM
) {
  console.warn(
    "bench: no BENCH_* env vars set — using author defaults (Scotts space, " +
      "page ids that only exist in the author's tenant). If you're not the " +
      "author, expect 404s. Set BENCH_DISCOVER_FROM=<spaceId> to auto-pick " +
      "representative pages from your own tenant. See docs/BENCHMARK.md.\n"
  );
}

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

// ─── Tool-list cost ─────────────────────────────────────────────────────────

/**
 * Measure the wire size of `{ tools: [...] }` for a given filter.
 * Passes the filter config explicitly to `getFilteredTools` rather
 * than mutating `process.env` — keeps the bench independent of any
 * caching the filter machinery might do at first call.
 */
function measureToolList(label, filterConfig) {
  const tools = getFilteredTools(filterConfig);
  const wire = JSON.stringify({ tools });
  const wireBytes = bytes(wire);
  return {
    label,
    tools: tools.length,
    bytes: wireBytes,
    tokens: toks(wireBytes),
  };
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

/**
 * Resolve the page targets to use for the single-page-read scenarios.
 *
 * Priority:
 *   1. `BENCH_PAGE_IDS=12,34,56,78` — explicit list (any count, but 4
 *      is what the report tables expect).
 *   2. `BENCH_DISCOVER_FROM=<spaceId>` — pick representative pages
 *      from that space by body size.
 *   3. Author defaults from the Scotts space.
 *
 * In all cases each target's body size is probed via the API so the
 * label reflects the real content rather than a baked-in description.
 */
async function resolvePageTargets(client) {
  const explicit = process.env.BENCH_PAGE_IDS;
  if (explicit) {
    const ids = explicit
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return labelTargets(client, ids);
  }

  const discoverFrom = process.env.BENCH_DISCOVER_FROM;
  if (discoverFrom) {
    const ids = await discoverPageIds(client, discoverFrom);
    return labelTargets(client, ids);
  }

  return labelTargets(client, DEFAULT_PAGE_IDS);
}

async function labelTargets(client, ids) {
  const out = [];
  for (const id of ids) {
    try {
      const page = await client.get(`/pages/${id}`, {
        "body-format": "atlas_doc_format",
      });
      const body = page.body?.atlas_doc_format?.value ?? "";
      const sizeKB = Math.max(1, Math.round(body.length / 1024));
      out.push({
        label: `page ~${sizeKB}KB body ("${(page.title || "").slice(0, 40)}")`,
        id,
      });
    } catch (err) {
      console.error(`bench: skipping page ${id}: ${err.message}`);
    }
  }
  if (out.length === 0) {
    throw new Error(
      `bench: no usable page targets (tried ${ids.length} ids — see errors ` +
        `above). Set BENCH_PAGE_IDS or BENCH_DISCOVER_FROM to point at pages ` +
        `that exist in your tenant.`
    );
  }
  return out;
}

async function discoverPageIds(client, spaceId, want = 4) {
  const list = await client.get(`/spaces/${spaceId}/pages`, {
    "body-format": "atlas_doc_format",
    limit: 100,
  });
  const ranked = (list.results ?? [])
    .map((p) => ({
      id: Number(p.id),
      size: (p.body?.atlas_doc_format?.value ?? "").length,
    }))
    .filter((p) => Number.isFinite(p.id) && p.size > 0)
    .sort((a, b) => a.size - b.size);

  if (ranked.length <= want) return ranked.map((p) => p.id);

  // Pick `want` pages spanning the size distribution: smallest,
  // largest, and evenly-spaced points in between.
  const picks = [];
  for (let i = 0; i < want; i++) {
    const idx = Math.round((i * (ranked.length - 1)) / (want - 1));
    picks.push(ranked[idx].id);
  }
  return Array.from(new Set(picks));
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
  // Uses getV1 (legacy `/wiki/rest/api/search`) intentionally: the v2
  // `/search` endpoint rejects `type=folder` ("Provided value {search}
  // for 'generic-content-type' is not the correct type") so the
  // folder-search scenario can't run through the v2 surface. Text
  // search is on v1 too for parity. Not an oversight.
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
      enabledCategories: [],
      disabledTools: [],
    }),
    measureToolList("3 categories (page, search, body)", {
      enabledCategories: ["page", "search", "body"],
      disabledTools: [],
    }),
    measureToolList("3 categories minus destructive ops", {
      enabledCategories: ["page", "search", "body"],
      disabledTools: [
        "confluence_delete_page",
        "confluence_create_page",
        "confluence_update_page",
      ],
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
  const pageTargets = await resolvePageTargets(client);
  const singlePageRows = [];
  for (const target of pageTargets) {
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
