import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import type { ConfluenceClient } from "../auth/confluence-client.js";
import { readPageBody } from "../core/page-cache.js";
import { adfToMarkdown } from "../utils/adf-to-markdown.js";
import { storageXhtmlToMarkdown } from "../utils/storage-to-markdown.js";

/**
 * Tools for working with page bodies cached on disk.
 *
 * When a single-page read returns a body too large to inline, the trim
 * layer writes the raw API response to disk and surfaces a `bodyPath`.
 * `confluence_render_body` is the agent's way to convert that path into
 * markdown without re-hitting the Confluence API.
 *
 * If the cache write fails or is skipped (e.g. response missing
 * version), the read response carries `bodyMarkdownPartial` (a partial
 * excerpt) plus `bodyCacheSkippedReason`. In that case there is no
 * `bodyPath` to pass to this tool — refetch the page with `full=true`
 * to recover the full body.
 *
 * If the agent already knows where the rendered output should go on
 * disk (e.g. pulling several pages back to local files), it can pass
 * `outputPath` to write directly there. The response then carries only
 * the path and byte count — the rendered content never traverses the
 * agent's context.
 */

export const bodyTools = [
  {
    name: "confluence_render_body",
    description:
      "Render a page body that was offloaded to disk by an earlier read. " +
      "Reads the file at `bodyPath` (returned by confluence_get_page / _blog_post / _comment when the body exceeds the inline limit) " +
      "and converts the raw Confluence body (ADF JSON or storage XHTML) to markdown. " +
      "No additional Confluence API call is made. " +
      "Default response: `{ representation, sourceLength, bodyMarkdown }` for `format=\"markdown\"`, " +
      "or `{ representation, sourceLength, bodyRaw }` for `format=\"raw\"`. " +
      "If `outputPath` is provided, the rendered output is written to that file instead and the response omits the body, " +
      "carrying `{ representation, sourceLength, outputPath, bytesWritten }`. " +
      "Use `outputPath` when restoring a doc to disk so the content doesn't pass through the agent's context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        bodyPath: {
          type: "string",
          description:
            "Absolute path to a body file written by the trim layer (the `bodyPath` field on a previous tool response).",
        },
        format: {
          type: "string",
          enum: ["markdown", "raw"],
          default: "markdown",
          description:
            "Output format. `markdown` runs the body through the ADF→markdown or storage→markdown converter. `raw` returns the persisted source string under `bodyRaw`.",
        },
        outputPath: {
          type: "string",
          description:
            "Optional absolute path to write the rendered output to. When set, the rendered content is written there and the response omits `bodyMarkdown`/`bodyRaw`, returning `outputPath` and `bytesWritten` instead. Parent directories are created if missing. Existing files are overwritten. Avoids inlining the body into the agent's context.",
        },
      },
      required: ["bodyPath"],
    },
  },
];

const RenderBodySchema = z.object({
  bodyPath: z.string(),
  format: z.enum(["markdown", "raw"]).optional(),
  outputPath: z.string().optional(),
});

export interface RenderBodyResponse {
  representation: string;
  sourceLength: number;
  bodyMarkdown?: string;
  bodyRaw?: string;
  outputPath?: string;
  bytesWritten?: number;
}

export async function handleBodyTool(
  _client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_render_body": {
      const input = RenderBodySchema.parse(args);
      const body = await readPageBody(input.bodyPath);
      const format = input.format ?? "markdown";

      const content = format === "raw" ? body.value : renderBody(body);

      const envelope: RenderBodyResponse = {
        representation: body.representation,
        sourceLength: body.value.length,
      };

      if (input.outputPath !== undefined) {
        if (!isAbsolute(input.outputPath)) {
          throw new Error("outputPath must be absolute");
        }
        await mkdir(dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, content, "utf-8");
        envelope.outputPath = input.outputPath;
        envelope.bytesWritten = Buffer.byteLength(content, "utf-8");
      } else if (format === "raw") {
        envelope.bodyRaw = content;
      } else {
        envelope.bodyMarkdown = content;
      }

      return envelope;
    }

    default:
      throw new Error(`Unknown body tool: ${toolName}`);
  }
}

function renderBody(body: { value: string; representation: string }): string {
  switch (body.representation) {
    case "atlas_doc_format":
      return adfToMarkdown(body.value).trim();
    case "storage":
    case "view":
      return storageXhtmlToMarkdown(body.value).trim();
    default:
      // Unknown representation — try storage as the most permissive
      // fallback (handles plain HTML, plain text, etc.).
      return storageXhtmlToMarkdown(body.value).trim();
  }
}
