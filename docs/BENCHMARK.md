# Benchmark — Trim Layer & Body Cache

Run-it-yourself benchmark of the v2 trim layer and on-disk body cache
versus the legacy raw-API behavior on `main`. Numbers are bytes of the
JSON wire response — what the agent actually pays in context.

Tokens are approximated at **~4 bytes/token** (the convention used by
most LLM tooling). Wall-clock is irrelevant here; this is about
context-window cost.

## How to reproduce

```bash
# .env.local must contain:
#   CONFLUENCE_HOST=https://your-tenant.atlassian.net
#   CONFLUENCE_EMAIL=...
#   CONFLUENCE_API_TOKEN=...

npm run bench
```

By default the bench targets the author's "Scotts" space (id
`5353898365`) and four hand-picked pages — the same fixtures the
integration tests use. To run against your own tenant, point the
bench at one of your spaces:

```bash
# Pick any 4 representative pages from a space (auto-discovered by body size):
BENCH_DISCOVER_FROM=<spaceId> npm run bench

# Or specify pages explicitly:
BENCH_SPACE_ID=<spaceId> BENCH_PAGE_IDS=12345,67890,...,99999 npm run bench
```

The page-list scenario uses `BENCH_SPACE_ID` (defaults to Scotts).
The CQL folder search runs globally (`type=folder`) regardless,
since not every space has folders. See [`scripts/bench.mjs`](../scripts/bench.mjs)
for the full driver.

The numbers below were captured on **2026-05-07** against the
author's Scotts space defaults.

---

## Tool-list footprint (per-conversation overhead)

What the agent pays at the start of every conversation just to learn
which tools exist. No API calls happen here — this is purely the
shape of `ListToolsResult` for a given filter config.

| filter | tools | bytes | ~tokens | factor |
|---|---:|---:|---:|---:|
| default (all categories) | 63 | 49,629 | 12,407 | 1.00× |
| 3 categories (page, search, body) | 15 | 18,483 | 4,621 | 2.69× |
| 3 categories minus destructive ops | 12 | 15,691 | 3,923 | 3.16× |

A typical agent-only deployment (`CONFLUENCE_ENABLED_CATEGORIES=page,search,body`)
saves ~31 KB of context per conversation versus the default. Add a few
`CONFLUENCE_DISABLED_TOOLS` to drop destructive operations and you're
under 4,000 tokens for the entire tool surface.

## Per-call cost — single page reads

Each row is one read of `/pages/{id}` against a real Confluence page.
"Raw" is what `main` returns (JSON.stringified API response). "Trimmed"
is what v2 returns by default — markdown body when small, `bodyPath`
ref when large.

| scenario | raw bytes | trimmed bytes | reduction |
|---|---:|---:|---:|
| tiny page (~1KB body, storage) | 1,887 | 855 | 2.21× |
| tiny page (~1KB body, ADF) | 1,810 | 685 | 2.64× |
| short page (~3KB body, storage) | 4,022 | 2,164 | 1.86× |
| short page (~3KB body, ADF) | 11,450 | 2,527 | 4.53× |
| long page (~12KB body, storage) | 13,673 | 513 | 26.65× |
| long page (~12KB body, ADF) | 44,206 | 513 | 86.17× |
| huge page (~39KB body, storage) | 40,633 | 480 | 84.65× |
| huge page (~39KB body, ADF) | 54,624 | 479 | 114.04× |

Two regimes are visible:

- **Small pages** — body fits inline. 2–5× reduction comes from
  dropping `_links`/`_expandable`/etc. and converting ADF→markdown
  (markdown is much denser than ADF JSON for the same content).
- **Long/huge pages** — body exceeds the inline limit (default
  4,000 chars), so the trim layer offloads the raw body to disk and
  returns a `bodyPath` reference. The agent's context cost is constant
  (~500 bytes) regardless of how big the page is. Agents that need
  full content call `confluence_render_body` to read from disk —
  no second Confluence API call.

ADF is bigger than storage on the wire (more structural noise per
character of content), so the savings are larger on the ADF side.
Since v2 forces `body-format=atlas_doc_format` as the default, agents
get the better path automatically.

## Per-call cost — page list

`confluence_get_pages_in_space` against the Scotts space, default
limit (25 items), bodies in the API response.

| scenario | raw bytes | trimmed bytes | reduction |
|---|---:|---:|---:|
| 25-page list in space (with bodies) | 526,694 | 9,753 | 54.00× |

List endpoints drop body content entirely — agents are expected to
follow up with `confluence_get_page` for the few pages they actually
care about, instead of receiving full bodies for all 25 up front.

## Per-call cost — CQL search

| scenario | raw bytes | trimmed bytes | reduction |
|---|---:|---:|---:|
| text search ("README") | 35,341 | 15,239 | 2.32× |
| folder search (type=folder) | 22,143 | 4,727 | 4.68× |

Search trimming flattens `breadcrumbs` from `[{label, url, separator}]`
to `[label]`, strips Confluence's `@@@hl@@@` highlight markers from
excerpts, and drops `iconCssClass`/`friendlyLastModified`/
`searchDuration`. Folder responses are smaller than text-search
responses because the per-result excerpts are shorter, so the relative
savings are larger.

## Combined

Adding all 11 per-call scenarios together gives a representative
"chunk of work":

| | raw bytes | trimmed bytes | reduction |
|---|---:|---:|---:|
| **11 scenarios combined** | 756,483 | 37,935 | 19.94× |

Roughly **20× per-call reduction** across the mix.

## Caveats

- Numbers depend on page content. A space full of mostly-empty
  pages will show smaller absolute savings; one full of long-form
  docs will show larger. The per-call ratio for the long/huge
  scenarios is bounded above only by the page size — there's no
  ceiling.
- Token approximation at 4 bytes/token is rough. The actual ratio
  depends on the tokenizer; for ASCII-heavy markdown it's close,
  for content with lots of CJK or symbols it can drift.
- The bench measures the trim layer and body cache only; it does
  not measure tool-call overhead, MCP transport framing, or agent
  reasoning cost.
