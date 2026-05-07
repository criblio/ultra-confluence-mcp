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
 */

export const bodyTools = [
  {
    name: "confluence_render_body",
    description:
      "Render a page body that was offloaded to disk by an earlier read. " +
      "Reads the file at `bodyPath` (returned by confluence_get_page / _blog_post / _comment when the body exceeds the inline limit) " +
      "and converts the raw Confluence body (ADF JSON or storage XHTML) to markdown. " +
      "No additional Confluence API call is made. " +
      "Returns the same envelope shape regardless of `format`: " +
      "`{ representation, sourceLength, bodyMarkdown }` for `format=\"markdown\"` (default), " +
      "or `{ representation, sourceLength, bodyRaw }` for `format=\"raw\"`.",
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
      },
      required: ["bodyPath"],
    },
  },
];

const RenderBodySchema = z.object({
  bodyPath: z.string(),
  format: z.enum(["markdown", "raw"]).optional(),
});

export interface RenderBodyResponse {
  representation: string;
  sourceLength: number;
  bodyMarkdown?: string;
  bodyRaw?: string;
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

      const envelope: RenderBodyResponse = {
        representation: body.representation,
        sourceLength: body.value.length,
      };

      if (format === "raw") {
        envelope.bodyRaw = body.value;
      } else {
        envelope.bodyMarkdown = renderBody(body);
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
