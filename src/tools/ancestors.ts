import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluenceAncestor, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for ancestors

export const ancestorTools = [
  {
    name: "confluence_get_page_ancestors",
    description:
      "Get ancestors (parent pages) of a specific page, from immediate parent to root.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        limit: {
          type: "number",
          description: "Maximum number of ancestors to return",
        },
      },
      required: ["pageId"],
    },
  },
];

// Input schemas for validation
const GetPageAncestorsSchema = z.object({
  pageId: z.coerce.number(),
  limit: z.coerce.number().optional(),
});

// Tool handlers
export async function handleAncestorTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_ancestors": {
      const input = GetPageAncestorsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceAncestor>>(
        `/pages/${input.pageId}/ancestors`,
        queryParams
      );
    }

    default:
      throw new Error(`Unknown ancestor tool: ${toolName}`);
  }
}
