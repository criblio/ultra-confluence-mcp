# ultra-confluence-mcp

A Model Context Protocol (MCP) server for Confluence Cloud, designed around one
question: **how much of the agent's context window does a Confluence call
actually need to consume?**

Most Confluence MCP servers pass the
Confluence REST API through more or less verbatim. That's fine for occasional
use, but a single `getPage` on a long doc can dump 40 KB of ADF JSON into the
conversation, and a 25-page list response runs over 500 KB. Agents pay that
cost on every call, and it crowds out the actual work.

This server takes a different stance.

## Why use this over other Confluence/Atlassian MCPs

### 1. Per-call responses are trimmed by ~20× on average

A built-in projection layer drops `_links`, `_expandable`, formatter noise,
and other fields agents never read, and converts ADF/storage bodies to
markdown on the way out. Concrete numbers from the benchmark in
[docs/BENCHMARK.md](docs/BENCHMARK.md):

| call                        |       raw |  trimmed | reduction |
| --------------------------- | --------: | -------: | --------: |
| 25-page list (with bodies)  | 526,694 B |  9,753 B |   **54×** |
| huge page (~39 KB ADF body) |  54,624 B |    479 B |  **114×** |
| CQL text search ("README")  |  35,341 B | 15,239 B |      2.3× |
| 11 mixed scenarios combined | 756,483 B | 37,935 B |   **20×** |

### 2. Large bodies offload to disk, not into context

When a page body would exceed the inline limit, the trim layer writes the
raw API response to a temp file and returns a tiny `bodyPath` reference
(~500 bytes) instead. Agents that need the content call
`confluence_render_body` to read from disk — **and can pass `outputPath` to
write the rendered markdown straight to a file, so the body bytes never
enter the conversation at all.** Restoring five 10 KB pages costs zero
context bytes with this path; an MCP that inlines bodies pays ~50 KB.

### 3. The per-conversation tool surface is small and tunable

The MCP tool-list response itself costs context — every conversation pays
for it up front, before any work happens. With `CONFLUENCE_ENABLED_CATEGORIES`
you can scope the surface to what an agent actually needs:

| filter                             | tools |  bytes | ~tokens |
| ---------------------------------- | ----: | -----: | ------: |
| default (all categories)           |    63 | 49,629 |  12,407 |
| `page,search,body`                 |    15 | 18,483 |   4,621 |
| 3 categories minus destructive ops |    12 | 15,691 |   3,923 |

By comparison, many combined Atlassian MCP servers expose over 70 tools across Jira _and_
Confluence — fine if you want both products, but a lot of schema for an
agent that just needs to read and write Confluence pages. If you also need
Jira or Bitbucket, the companion servers
[ultra-jira-mcp](https://github.com/scottlepp/ultra-jira-mcp) and
[ultra-bitbucket-mcp](https://github.com/scottlepp/ultra-bitbucket-mcp)
apply the same trimming philosophy — wire up only the ones you need
instead of paying for one monolithic Atlassian surface.

### 4. There's a CLI for agents that prefer shelling out

`confluence-cli` is a standalone binary that calls Confluence directly — no
MCP host required. Same trimmed output shape, plus a `ref: /path` line
pointing at the full untrimmed response on disk. Per-conversation overhead
is a single 2.3 KB `SKILL.md` loaded on demand by the Claude Code harness,
versus ~50 KB of tool schemas. The two paths share all the trim logic, so
you can mix or switch without behavior drift.

### 5. No Docker, no Python, no runtime to install

It's a Node package. If you already have Node (you probably do — Claude Code
ships with it), `npx -y https://github.com/scottlepp/ultra-confluence-mcp` is
the whole install. No container to pull, no Python virtualenv to manage, no
`uv`/`pipx`/`poetry` to learn first, no `docker run` line with seven `-e`
flags in your MCP config. Drop the `npx` command into Claude Desktop /
Claude Code / Cursor and you're done.

### 6. Self-healing — humans aren't the bottleneck

The repo is maintained by a small fleet of bots so updates don't stall
waiting on a human reviewer:

- **Dependencies stay current.** Dependabot opens grouped PRs on a weekly
  cadence, and a nightly auto-sync workflow rebases and merges them once
  CI is green — no manual chasing of patch bumps.
- **Bug reports get triaged automatically.** A scheduled `bug-fix` agent
  reads open issues labeled as bugs, validates them against the codebase,
  implements a fix, and opens a PR. See [scripts/agents/](scripts/agents/).
- **PRs get a first-pass review without waiting on a human.** Every PR
  triggers a review agent that flags logic, security, and test-coverage
  issues so the human reviewer (when there is one) starts from a known
  baseline.

This matters for a context-efficiency tool specifically: the value
proposition decays fast if the trim layer falls behind a Confluence API
change or a CVE in a dependency. Self-healing keeps the surface fresh
without a maintainer in the loop.

### What this server is NOT

- **Not multi-product.** Jira lives in [ultra-jira-mcp](https://github.com/scottlepp/ultra-jira-mcp) and Bitbucket in [ultra-bitbucket-mcp](https://github.com/scottlepp/ultra-bitbucket-mcp); this server is Confluence Cloud only, by design to keep the tools light.
- **Not Server/Data Center.** Cloud REST API v2 only.
- **Not for human-readable conversations.** The trimming is aggressive
  because agents read JSON, not docs — if you want pretty browser-style
  output, use the Atlassian web UI.

If you need Jira + Confluence + Bitbucket + Server/DC + OAuth in one server,
there are MCP servers for that, but you'll pay the price. If your agents
are blowing through context windows on Confluence reads, use this — and
pair it with [ultra-jira-mcp](https://github.com/scottlepp/ultra-jira-mcp)
or [ultra-bitbucket-mcp](https://github.com/scottlepp/ultra-bitbucket-mcp)
when you need those too.

---

## Installation

Run directly from GitHub:

```bash
npx -y https://github.com/scottlepp/ultra-confluence-mcp
```

Or clone and build locally:

```bash
git clone https://github.com/scottlepp/ultra-confluence-mcp.git
cd ultra-confluence-mcp
npm install
npm run build
node build/index.js
```

## Standalone CLI (no MCP server)

A `confluence-cli` binary ships alongside the MCP server. It reads the
same env vars (`CONFLUENCE_HOST`, `CONFLUENCE_EMAIL`,
`CONFLUENCE_API_TOKEN`), builds a Confluence client in-process, and
calls Confluence directly — no MCP host required.

```bash
export CONFLUENCE_HOST=https://yourcompany.atlassian.net
export CONFLUENCE_EMAIL=you@example.com
export CONFLUENCE_API_TOKEN=...

npx -y -p github:scottlepp/ultra-confluence-mcp confluence-cli confluence_get_page --pageId=12345
```

Discovery:

```bash
confluence-cli --help                       # list every tool
confluence-cli <tool> --help                # show flags for one tool
```

Flag forms: `--key=value`, `--key value`, `--key=@/path/to/file` (read
from file), `--key=-` (read from stdin), repeated `--key=a --key=b` to
build an array (or comma-separated `--key=a,b`).

On success the CLI prints a trimmed JSON summary to stdout, then a
final `ref: /tmp/.../...json` line pointing at the full untrimmed
response on disk — `cat` it when the summary leaves out detail you
need. Pass `--full=true` to skip trimming and dump the raw response
inline instead.

### Claude Code skill

To make the CLI discoverable to Claude Code agents in standalone
sessions, install the bundled skill:

```bash
npx -y -p github:scottlepp/ultra-confluence-mcp confluence-cli install-skill
```

This writes `~/.claude/skills/confluence/SKILL.md`. Use `--force` to
overwrite, or `--print` to dump the skill content to stdout without
writing.

### MCP vs CLI — which should I use?

There's a popular claim that CLIs are categorically more
context-efficient than MCP. The benchmark in
[docs/BENCHMARK.md](docs/BENCHMARK.md#mcp-vs-cli--agent-context-overhead)
disagrees: with aggressive tool filtering
(`CONFLUENCE_ENABLED_CATEGORIES`), the MCP path's per-conversation
overhead is within a few KB of the CLI's `SKILL.md`. Per-call output
is identical in both paths (same trimmed shape from the same `applyTrim`
projection). Without filtering, the CLI's footprint is ~22× smaller
than the full MCP tool list — but anyone who's filtering is already in
the same ballpark.

The CLI's real edge is **ergonomic**: scriptable, pipeable, doesn't
require an MCP host, runs from any shell. Use whichever fits your
workflow; on token cost it's mostly a wash for reasonable filter
configs.

## Configuration

Set the following environment variables:

| Variable                      | Description                                                                                              | Required |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| CONFLUENCE_HOST               | Your Confluence instance URL (e.g., https://yourcompany.atlassian.net)                                   | Yes      |
| CONFLUENCE_EMAIL              | Your Atlassian account email                                                                             | Yes      |
| CONFLUENCE_API_TOKEN          | API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens) | Yes      |
| CONFLUENCE_CLOUD_ID           | Cloud ID for scoped tokens (auto-fetched if not provided)                                                | No       |
| CONFLUENCE_ENABLED_CATEGORIES | Comma-separated list of tool categories to enable (default: all)                                         | No       |
| CONFLUENCE_DISABLED_TOOLS     | Comma-separated list of specific tools to disable                                                        | No       |

### Tool Filtering

You can limit which tools are exposed to the AI model using environment variables:

**Enable only specific categories:**

```bash
CONFLUENCE_ENABLED_CATEGORIES=page,space,search
```

**Disable specific tools (e.g., destructive operations):**

```bash
CONFLUENCE_DISABLED_TOOLS=confluence_delete_page,confluence_delete_space,confluence_delete_blog_post
```

**Available categories:** `page`, `space`, `blogPost`, `comment`, `attachment`, `label`, `search`, `user`, `version`, `contentProperty`, `ancestor`, `descendant`, `server`

## Claude Desktop Setup

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "confluence": {
      "command": "npx",
      "args": ["-y", "https://github.com/scottlepp/ultra-confluence-mcp"],
      "env": {
        "CONFLUENCE_HOST": "https://yourcompany.atlassian.net",
        "CONFLUENCE_EMAIL": "your-email@example.com",
        "CONFLUENCE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

**With tool filtering (recommended for limited access):**

```json
{
  "mcpServers": {
    "confluence": {
      "command": "npx",
      "args": ["-y", "https://github.com/scottlepp/ultra-confluence-mcp"],
      "env": {
        "CONFLUENCE_HOST": "https://yourcompany.atlassian.net",
        "CONFLUENCE_EMAIL": "your-email@example.com",
        "CONFLUENCE_API_TOKEN": "your-api-token",
        "CONFLUENCE_ENABLED_CATEGORIES": "page,space,search,comment",
        "CONFLUENCE_DISABLED_TOOLS": "confluence_delete_page,confluence_delete_space"
      }
    }
  }
}
```

## Available Tools

### Pages

- `confluence_get_pages` - Get all pages with optional filters
- `confluence_get_page` - Get a specific page by ID
- `confluence_create_page` - Create a new page
- `confluence_update_page` - Update an existing page
- `confluence_delete_page` - Delete a page
- `confluence_get_pages_in_space` - Get all pages in a space
- `confluence_get_pages_for_label` - Get pages with a specific label
- `confluence_render_body` - Convert a cached page body (ADF/storage on disk) to markdown. Pass `outputPath` to write straight to disk so the rendered body never inflates the agent's context. See [Reading large bodies](#reading-large-bodies-without-context-bloat).

### Spaces

- `confluence_get_spaces` - List all accessible spaces
- `confluence_get_space` - Get space details
- `confluence_create_space` - Create a new space
- `confluence_update_space` - Update space
- `confluence_delete_space` - Delete space

### Blog Posts

- `confluence_get_blog_posts` - Get all blog posts
- `confluence_get_blog_post` - Get blog post details
- `confluence_create_blog_post` - Create a new blog post
- `confluence_update_blog_post` - Update blog post
- `confluence_delete_blog_post` - Delete blog post
- `confluence_get_blog_posts_in_space` - Get blog posts in a space

### Comments

- `confluence_get_page_footer_comments` - Get footer comments on a page
- `confluence_get_page_inline_comments` - Get inline comments on a page
- `confluence_get_blog_post_footer_comments` - Get footer comments on a blog post
- `confluence_get_footer_comment` - Get a specific comment
- `confluence_create_page_footer_comment` - Add comment to page
- `confluence_create_blog_post_footer_comment` - Add comment to blog post
- `confluence_update_footer_comment` - Update comment
- `confluence_delete_footer_comment` - Delete comment

### Attachments

- `confluence_get_page_attachments` - Get attachments on a page
- `confluence_get_blog_post_attachments` - Get attachments on a blog post
- `confluence_get_attachment` - Get attachment details
- `confluence_delete_attachment` - Delete attachment

### Labels

- `confluence_get_page_labels` - Get labels on a page
- `confluence_add_page_label` - Add label to page
- `confluence_remove_page_label` - Remove label from page
- `confluence_get_blog_post_labels` - Get labels on a blog post
- `confluence_add_blog_post_label` - Add label to blog post
- `confluence_remove_blog_post_label` - Remove label from blog post
- `confluence_get_space_labels` - Get labels on a space
- `confluence_add_space_label` - Add label to space
- `confluence_remove_space_label` - Remove label from space

### Search

- `confluence_cql_search` - Advanced search using CQL (Confluence Query Language) for pages, blog posts, attachments, comments
- `confluence_search_content` - Simple text search for pages and blog posts
- `confluence_search_generic_content` - Search for databases, whiteboards, folders, or embeds (NOT for pages/blog posts)

### Users

- `confluence_get_current_user` - Get authenticated user
- `confluence_get_user` - Get user by account ID
- `confluence_get_users` - Get all users

### Versions

- `confluence_get_page_versions` - Get page version history
- `confluence_get_page_version` - Get specific page version
- `confluence_get_blog_post_versions` - Get blog post version history
- `confluence_get_blog_post_version` - Get specific blog post version

### Content Properties

- `confluence_get_page_properties` - Get content properties for a page
- `confluence_get_page_property` - Get a specific property
- `confluence_create_page_property` - Create a property
- `confluence_update_page_property` - Update a property
- `confluence_delete_page_property` - Delete a property

### Ancestors & Descendants

- `confluence_get_page_ancestors` - Get parent pages
- `confluence_get_page_descendants` - Get all descendant pages
- `confluence_get_page_children` - Get direct children pages

### Server

- `confluence_get_server_info` - Get Confluence server info

## Available Resources

- `confluence://spaces` - List of all accessible spaces
- `confluence://myself` - Current user info
- `confluence://space/{id}` - Space details
- `confluence://page/{id}` - Page details
- `confluence://blogpost/{id}` - Blog post details

## Reading large bodies without context bloat

When a single-page read returns a body too large to inline, the trim layer offloads the raw API response to disk and surfaces a `bodyPath` field on the response. Two ways to use it:

**Inline rendering (default).** Call `confluence_render_body` with just `bodyPath` to get the converted markdown back in the response under `bodyMarkdown`:

```json
{
  "bodyPath": "/var/folders/.../ultra-confluence-mcp/pages/12345-v3.json"
}
```

**Direct-to-disk rendering** (recommended when the agent already knows where the file should land — e.g. pulling a doc back to a working tree). Add `outputPath` and the rendered output is written there; the response carries only `{ representation, sourceLength, outputPath, bytesWritten }` — the body bytes never traverse the agent's context:

```json
{
  "bodyPath": "/var/folders/.../ultra-confluence-mcp/pages/12345-v3.json",
  "outputPath": "/abs/path/to/page.md"
}
```

This is dramatically more context-efficient when restoring multiple pages. Five docs of ~10 KB each cost ~50 KB through inline rendering and effectively 0 through `outputPath`. Parent directories are created if missing; existing files are overwritten.

Both forms work with `format: "raw"` if you want the original ADF JSON / storage XHTML rather than markdown.

## Body Formats

Confluence supports multiple body formats:

- `storage` - XHTML-based storage format (default)
- `atlas_doc_format` - Atlassian Document Format (ADF) - supports Forge app extensions
- `view` - Rendered HTML (read-only)

### Storage Format (default)

```html
<p>This is a paragraph.</p>
<h1>This is a heading</h1>
<ul>
  <li>List item 1</li>
  <li>List item 2</li>
</ul>
```

### ADF Format

Use `bodyFormat: "atlas_doc_format"` when creating/updating pages to insert Forge app macros (like Mermaid diagrams). The body should be a JSON-stringified ADF document:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Hello world" }]
    }
  ]
}
```

See [Inserting Forge App Macros](#inserting-forge-app-macros-eg-mermaid-diagrams) for advanced usage.

## Inserting Forge App Macros (e.g., Mermaid Diagrams)

You can programmatically insert Forge app macros like Mermaid diagrams using the ADF (Atlassian Document Format) body format.

### Mermaid Diagram Example

To insert a Mermaid diagram, use `bodyFormat: "atlas_doc_format"` with both a code block and an extension node:

```json
{
  "spaceId": "123456",
  "title": "Page with Mermaid Diagram",
  "bodyFormat": "atlas_doc_format",
  "body": "{\"version\":1,\"type\":\"doc\",\"content\":[{\"type\":\"codeBlock\",\"attrs\":{\"language\":\"mermaid\"},\"content\":[{\"type\":\"text\",\"text\":\"sequenceDiagram\\n    Alice->>Bob: Hello\\n    Bob-->>Alice: Hi!\"}]},{\"type\":\"extension\",\"attrs\":{\"extensionKey\":\"23392b90-4271-4239-98ca-a3e96c663cbb/63d4d207-ac2f-4273-865c-0240d37f044a/static/mermaid-diagram\",\"extensionType\":\"com.atlassian.ecosystem\",\"parameters\":{\"localId\":\"mermaid-1\"},\"localId\":\"mermaid-1\"}}]}"
}
```

### ADF Structure for Mermaid

The ADF document structure (before JSON stringification):

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {
      "type": "codeBlock",
      "attrs": { "language": "mermaid" },
      "content": [
        { "type": "text", "text": "sequenceDiagram\n    Alice->>Bob: Hello" }
      ]
    },
    {
      "type": "extension",
      "attrs": {
        "extensionKey": "23392b90-4271-4239-98ca-a3e96c663cbb/63d4d207-ac2f-4273-865c-0240d37f044a/static/mermaid-diagram",
        "extensionType": "com.atlassian.ecosystem",
        "parameters": { "localId": "mermaid-1" },
        "localId": "mermaid-1"
      }
    }
  ]
}
```

**Key points:**

- The `extensionKey` is for the **Mermaid diagrams viewer** app by Atlassian Labs (must be installed on your Confluence instance)
- The `localId` must be in **both** `parameters.localId` AND `attrs.localId`
- The Mermaid macro auto-detects code blocks by position (1st extension → 1st code block, 2nd → 2nd, etc.)
- Use `"parameters": { "index": N }` to explicitly select which code block (0-based index)

### Finding Extension Keys for Other Forge Apps

To find the extension key for other Forge apps:

1. Manually insert the macro on a Confluence page
2. Fetch the page with `bodyFormat: "atlas_doc_format"`
3. Look for the `extensionKey` in the extension node

## CQL Search Examples

The `confluence_cql_search` tool uses Confluence Query Language (CQL):

```
# Search by content type
type=page AND space=DEV

# Full-text search
text~"search term"

# Search by creator
creator=currentUser()

# Search by date
created>=now("-7d")

# Combined search
type=page AND space=DEV AND text~"api" AND created>=now("-30d")
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run with inspector
npm run inspector
```

## Self-Healing Agents

This repository includes AI agents for automated maintenance in `scripts/agents/`:

- **BugFixAgent**: Reads bug issues, validates them, implements fixes, and creates PRs
- **PRReviewAgent**: Reviews pull requests, identifies issues, and suggests improvements

### Running Agents

```bash
cd scripts/agents
npm install

# Run bug fix agent
GITHUB_TOKEN=xxx ISSUE_NUMBER=123 npm run bug-fix

# Run PR review agent
GITHUB_TOKEN=xxx PR_NUMBER=123 PR_DIFF_FILE=diff.txt npm run pr-review
```

### Supported AI Providers

The agents support multiple AI providers with automatic fallback:

- Google AI (Gemini)
- OpenAI (GPT-4)
- Anthropic (Claude)
- Groq
- Mistral
- Perplexity
- DeepSeek
- OpenRouter

Set at least one API key:

```bash
GOOGLE_API_KEY=xxx
OPENAI_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
# etc.
```

## License

MIT
