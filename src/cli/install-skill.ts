// `confluence-cli install-skill` — write a Claude Code skill so an
// agent in a standalone (no-MCP) session knows how to call this CLI.
//
// The MCP path teaches the agent via the tool-list response. The
// standalone path needs an out-of-band hint, and a skill is the
// idiomatic shape: loaded on demand by the harness when the user
// mentions Confluence, instead of burning context every session like
// a CLAUDE.md entry would.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const SKILL_CONTENT = `---
name: confluence
description: >-
  Query Confluence pages, spaces, blog posts, comments, attachments, and CQL
  searches via the bundled confluence-cli shell binary. Use when the user
  mentions Confluence, asks to look up a page by ID or title, references a
  space key, or asks about Confluence content.
---
# Confluence CLI

Query Confluence from the shell via \`confluence-cli\`. Run it with \`npx\`:

\`\`\`bash
npx -y -p github:scottlepp/confluence-mcp confluence-cli <tool> [--flag=value ...]
\`\`\`

## First call in a session

Run \`confluence-cli --help\` once to see every tool. The list is stable
across calls — don't re-fetch it on every Confluence task.

For a specific tool's flags: \`confluence-cli <tool> --help\`.

## Common tools

- \`confluence_get_page --pageId=12345\` — fetch one page (body inlined or
  offloaded to disk via \`bodyPath\`)
- \`confluence_search_content --cql='space = DOC AND type = page' --limit=10\` — CQL search
- \`confluence_get_pages_in_space --spaceId=98765 --limit=25\` — list pages
- \`confluence_create_page_from_markdown --spaceId=... --title='...' --markdown='...'\` — create a page
- \`confluence_get_page_footer_comments --pageId=12345\` — list page comments

## Output shape

Every successful call prints:

1. A trimmed summary as JSON on stdout (the fields agents usually need —
   id, title, status, bodyMarkdown, etc.)
2. A final line of the form \`ref: /path/to/full.json\` pointing at the
   complete untrimmed Confluence response on disk. \`cat\` that file when
   the summary leaves out detail you need.

Pass \`--full=true\` to skip trimming entirely and dump the raw response
to stdout instead — useful in scripts but expensive in agent context.

## Credentials

The CLI reads \`CONFLUENCE_HOST\`, \`CONFLUENCE_EMAIL\`, and
\`CONFLUENCE_API_TOKEN\` from its own environment (or a \`.env.local\` in
the cwd). The agent never sees these — the user exports them in their
shell once. If a call fails with "Missing required environment
variables", ask the user to set them; do not put them on the command
line.

## Tool filtering

\`CONFLUENCE_ENABLED_CATEGORIES\` (e.g. \`page,space,search\`) and
\`CONFLUENCE_DISABLED_TOOLS\` (e.g. \`confluence_delete_page\`) are
honored in the CLI exactly as in the MCP server. Calls to disabled
tools error before any HTTP request.
`;

export interface InstallSkillOpts {
  // Force overwrite if SKILL.md already exists. Without this, an
  // existing file aborts the install — protects the user from
  // clobbering customizations they made to the skill.
  force?: boolean;
  // Print the rendered SKILL.md to stdout instead of writing it.
  print?: boolean;
  // Override target dir. Production uses ~/.claude/skills/confluence;
  // tests pass a tmpdir. Not a public CLI flag.
  targetDir?: string;
}

export interface InstallSkillResult {
  path: string;
  action: "wrote" | "overwrote" | "exists" | "printed";
}

export async function installSkill(
  opts: InstallSkillOpts = {}
): Promise<InstallSkillResult> {
  const dir =
    opts.targetDir ?? path.join(os.homedir(), ".claude", "skills", "confluence");
  const file = path.join(dir, "SKILL.md");

  if (opts.print) {
    return { path: file, action: "printed" };
  }

  let existed = false;
  try {
    await fs.access(file);
    existed = true;
  } catch {
    // Doesn't exist — happy path.
  }

  if (existed && !opts.force) {
    return { path: file, action: "exists" };
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, SKILL_CONTENT, "utf8");

  return {
    path: file,
    action: existed ? "overwrote" : "wrote",
  };
}
