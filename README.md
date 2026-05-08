# Confluence MCP Server

A Model Context Protocol (MCP) server that provides AI models with full access to Confluence Cloud functionality via the REST API v2.

## Installation

Run directly from GitHub:

```bash
npx -y https://github.com/scottlepp/confluence-mcp
```

Or clone and build locally:

```bash
git clone https://github.com/scottlepp/confluence-mcp.git
cd confluence-mcp
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

npx -y -p github:scottlepp/confluence-mcp confluence-cli confluence_get_page --pageId=12345
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
npx -y -p github:scottlepp/confluence-mcp confluence-cli install-skill
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

| Variable | Description | Required |
|----------|-------------|----------|
| CONFLUENCE_HOST | Your Confluence instance URL (e.g., https://yourcompany.atlassian.net) | Yes |
| CONFLUENCE_EMAIL | Your Atlassian account email | Yes |
| CONFLUENCE_API_TOKEN | API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens) | Yes |
| CONFLUENCE_CLOUD_ID | Cloud ID for scoped tokens (auto-fetched if not provided) | No |
| CONFLUENCE_ENABLED_CATEGORIES | Comma-separated list of tool categories to enable (default: all) | No |
| CONFLUENCE_DISABLED_TOOLS | Comma-separated list of specific tools to disable | No |

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
      "args": ["-y", "https://github.com/scottlepp/confluence-mcp"],
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
      "args": ["-y", "https://github.com/scottlepp/confluence-mcp"],
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
  "bodyPath": "/var/folders/.../confluence-mcp/pages/12345-v3.json"
}
```

**Direct-to-disk rendering** (recommended when the agent already knows where the file should land — e.g. pulling a doc back to a working tree). Add `outputPath` and the rendered output is written there; the response carries only `{ representation, sourceLength, outputPath, bytesWritten }` — the body bytes never traverse the agent's context:

```json
{
  "bodyPath": "/var/folders/.../confluence-mcp/pages/12345-v3.json",
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
    { "type": "paragraph", "content": [{ "type": "text", "text": "Hello world" }] }
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
      "content": [{ "type": "text", "text": "sequenceDiagram\n    Alice->>Bob: Hello" }]
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
