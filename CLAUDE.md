# Notes for Claude / agents working in this repo

This repo is the **Confluence MCP server**. When you're operating this codebase as an agent, a few things are worth knowing up front.

## Context-efficient reads

Several tools (`confluence_get_page`, `confluence_get_blog_post`, `confluence_get_*_comments`) offload large bodies to a temp cache and return a `bodyPath` instead of inlining the body. Two follow-ups, with very different context costs:

- **`confluence_render_body { bodyPath }`** — returns the rendered markdown in the response. **The full body lands in your context.** Use only when you actually need to read or transform the content.
- **`confluence_render_body { bodyPath, outputPath }`** — writes the rendered markdown straight to `outputPath` on disk. The response only contains `{ representation, sourceLength, outputPath, bytesWritten }`. **Zero body bytes in your context.** Use this when you're restoring/pulling a doc to disk and don't need to inspect the contents.

When pulling N pages back to local files, prefer `outputPath`. The savings compound: 5 pages × 10 KB each = 50 KB of context saved, every time.

The same parameter works with `format: "raw"` if you want the source ADF JSON / storage XHTML on disk rather than markdown.

## Confluence link rewriting on upload

When you call `confluence_create_page_from_markdown` or `confluence_update_page_from_markdown`, the renderer normalizes any `https://<host>/wiki/.../pages/<id>/<slug>` URL it recognizes as same-instance into an internal `confluence://page/<title>` reference. This resolves by **page title** at render time. Practical implications:

- If you set page titles to match the slug portion of the URLs you link to, cross-doc links in a doc set will resolve cleanly. (E.g. titling pages `cases`, `mitigations`, `chat` so links like `[cases](.../pages/123/cases)` work.)
- Relative `.md` links (e.g. `[cases](cases.md)`) do **not** get rewritten — they pass through literally and 404. Use absolute Confluence URLs in markdown intended for upload.
- The instance hostname matters. For a Cribl reader: it's `taktak.atlassian.net`, not `cribl.atlassian.net`. Hand-rolled URLs with the wrong host won't resolve.

## Mermaid in pages

`confluence_create_page_from_markdown` (ADF path) renders ` ```mermaid ` code blocks as live Mermaid diagrams via the Confluence Mermaid Forge app. The legacy storage variant does *not* — there it stays as a syntax-highlighted code block.

Two parser gotchas that bite repeatedly:

- **No `;` inside arrow messages in `sequenceDiagram`.** Mermaid treats `;` as a statement terminator even inside quoted message strings. Use `,` or em-dash instead. Symptom: "Parse error … expecting arrow tokens, got NEWLINE".
- **Quadrant chart labels render to the right of the dot.** Putting points at `x ≥ 0.85` makes labels overflow the viewport. Cap data positions around `x ≈ 0.78` and shorten labels (or both) so nothing clips.

## Building & testing

```bash
npm run build          # tsc compile
npx vitest run         # full suite
npx vitest run tests/render-body.test.ts   # single file
```

Integration tests under `tests/integration/` may fail without proper env wiring — that's separate from unit-test breakage. Always check whether a failure reproduces on `main` before assuming your change caused it.

## When something doesn't render in Confluence

- **Empty body in a `get_page` response** — you forgot `bodyFormat`. Default is no body. Pass `"storage"` or `"atlas_doc_format"`.
- **Mermaid shows as plain code in legacy uploads** — that's expected. Use the non-legacy ADF tool.
- **Cross-page links go to literal `*.md`** — you wrote relative markdown links. Rewrite to absolute Confluence URLs before upload.
