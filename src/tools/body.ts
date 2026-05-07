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
 */

export const bodyTools = [
  {
    name: "confluence_render_body",
    description:
      "Render a page body that was offloaded to disk by an earlier read. " +
      "Reads the file at `bodyPath` (returned by confluence_get_page / _blog_post / _comment when the body exceeds the inline limit) " +
      "and converts the raw Confluence body (ADF JSON or storage XHTML) to markdown. " +
      "No additional Confluence API call is made.",
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
          description:
            "Output format. `markdown` (default) runs the body through the ADF→markdown or storage→markdown converter. `raw` returns `{value, representation}` unchanged.",
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

export async function handleBodyTool(
  _client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_render_body": {
      const input = RenderBodySchema.parse(args);
      const body = await readPageBody(input.bodyPath);

      if (input.format === "raw") {
        return body;
      }

      const markdown = renderBody(body);
      return {
        bodyMarkdown: markdown,
        representation: body.representation,
        sourceLength: body.value.length,
      };
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
