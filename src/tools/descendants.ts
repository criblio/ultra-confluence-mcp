import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluencePage, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for descendants

export const descendantTools = [
  {
    name: "confluence_get_page_descendants",
    description:
      "Get descendants (child pages, grandchildren, etc.) of a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        cursor: {
          type: "string",
          description: "Cursor for pagination",
        },
        limit: {
          type: "number",
          description: "Maximum number of descendants to return",
        },
      },
      required: ["pageId"],
    },
  },
  {
    name: "confluence_get_page_children",
    description: "Get direct children of a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        cursor: {
          type: "string",
          description: "Cursor for pagination",
        },
        limit: {
          type: "number",
          description: "Maximum number of children to return",
        },
      },
      required: ["pageId"],
    },
  },
];

// Input schemas for validation
const GetPageDescendantsSchema = z.object({
  pageId: z.coerce.number(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetPageChildrenSchema = z.object({
  pageId: z.coerce.number(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

// Tool handlers
export async function handleDescendantTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_descendants": {
      const input = GetPageDescendantsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluencePage>>(
        `/pages/${input.pageId}/descendants`,
        queryParams
      );
    }

    case "confluence_get_page_children": {
      const input = GetPageChildrenSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluencePage>>(
        `/pages/${input.pageId}/children`,
        queryParams
      );
    }

    default:
      throw new Error(`Unknown descendant tool: ${toolName}`);
  }
}
