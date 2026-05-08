import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { extractNextCursor } from "../core/pagination.js";
import {
  ConfluenceSpace,
  ConfluenceSpaceSingle,
  MultiEntityResult,
} from "../types/confluence.js";

// Tool definitions for spaces

export const spaceTools = [
  {
    name: "confluence_get_spaces",
    description:
      "Get all spaces. Returns spaces filtered by various parameters. Results are paginated - use the returned cursor to fetch more pages if you don't find what you need. " +
      "To find a space by name, use `nameContains` (case-insensitive substring match), which auto-pages server-side and returns matching results without forcing the caller to walk every page. " +
      "For an exact-name lookup, CQL search (`type = \"space\" AND title = \"...\"`) is also fast.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: {
          type: "array",
          items: { type: "number" },
          description: "Filter by space IDs",
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Filter by space keys",
        },
        type: {
          type: "string",
          enum: ["global", "personal"],
          description: "Filter by space type",
        },
        status: {
          type: "string",
          enum: ["current", "archived"],
          description: "Filter by space status",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Filter by labels",
        },
        sort: {
          type: "string",
          enum: ["id", "-id", "key", "-key", "name", "-name"],
          description: "Sort order (prefix with - for descending)",
        },
        descriptionFormat: {
          type: "string",
          enum: ["plain", "view"],
          description: "Format for space description",
        },
        cursor: {
          type: "string",
          description: "Cursor for pagination",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 25, max 250)",
        },
        nameContains: {
          type: "string",
          description:
            "Case-insensitive substring filter on space name. Applied client-side; the server does not natively support name search. The handler pages through up to `nameSearchMaxScanned` spaces (default 2000) until enough matches are found. Combine with `type` to narrow the scan.",
        },
        nameSearchMaxScanned: {
          type: "number",
          description:
            "Maximum number of spaces to scan when filtering by `nameContains`. Default 2000.",
        },
      },
      required: [],
    },
  },
  {
    name: "confluence_get_space",
    description:
      "Get a specific space by ID or key. Returns detailed space information. " +
      "Provide either spaceId (numeric) or spaceKey (e.g. 'ENG' or '~712020...' for personal spaces). " +
      "When spaceKey is given, it is resolved to a numeric id via /spaces?keys=...",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The numeric ID of the space. Provide this OR spaceKey.",
        },
        spaceKey: {
          type: "string",
          description:
            "The space key (e.g. 'ENG', or '~712020...' for personal spaces). Provide this OR spaceId.",
        },
        descriptionFormat: {
          type: "string",
          enum: ["plain", "view"],
          description: "Format for space description",
        },
        includeLabels: {
          type: "boolean",
          description: "Include labels in the response",
        },
        includeProperties: {
          type: "boolean",
          description: "Include space properties in the response",
        },
        includeOperations: {
          type: "boolean",
          description: "Include permitted operations in the response",
        },
      },
      required: [],
    },
  },
  {
    name: "confluence_create_space",
    description: "Create a new space. Requires name and key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The name of the space",
        },
        key: {
          type: "string",
          description:
            "The unique key for the space (uppercase letters and numbers only)",
        },
        description: {
          type: "string",
          description: "Description of the space (plain text)",
        },
        type: {
          type: "string",
          enum: ["global", "personal"],
          description: "Type of space (default: global)",
        },
      },
      required: ["name", "key"],
    },
  },
  {
    name: "confluence_update_space",
    description: "Update an existing space. Can update name, description, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space to update",
        },
        name: {
          type: "string",
          description: "The new name of the space",
        },
        description: {
          type: "string",
          description: "The new description (plain text)",
        },
        status: {
          type: "string",
          enum: ["current", "archived"],
          description: "Update space status",
        },
      },
      required: ["spaceId"],
    },
  },
  {
    name: "confluence_delete_space",
    description:
      "Delete a space. This permanently deletes the space and all its content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space to delete",
        },
      },
      required: ["spaceId"],
    },
  },
];

// Input schemas for validation
const GetSpacesSchema = z.object({
  ids: z.array(z.coerce.number()).optional(),
  keys: z.array(z.string()).optional(),
  type: z.enum(["global", "personal"]).optional(),
  status: z.enum(["current", "archived"]).optional(),
  labels: z.array(z.string()).optional(),
  sort: z.enum(["id", "-id", "key", "-key", "name", "-name"]).optional(),
  descriptionFormat: z.enum(["plain", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
  nameContains: z.string().optional(),
  nameSearchMaxScanned: z.coerce.number().optional(),
});

const GetSpaceSchema = z
  .object({
    spaceId: z.coerce.number().optional(),
    spaceKey: z.string().optional(),
    descriptionFormat: z.enum(["plain", "view"]).optional(),
    includeLabels: z.boolean().optional(),
    includeProperties: z.boolean().optional(),
    includeOperations: z.boolean().optional(),
  })
  .refine((v) => v.spaceId !== undefined || v.spaceKey !== undefined, {
    message: "Either 'spaceId' or 'spaceKey' must be provided.",
  });

const CreateSpaceSchema = z.object({
  name: z.string(),
  key: z.string(),
  description: z.string().optional(),
  type: z.enum(["global", "personal"]).optional(),
});

const UpdateSpaceSchema = z.object({
  spaceId: z.coerce.number(),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["current", "archived"]).optional(),
});

const DeleteSpaceSchema = z.object({
  spaceId: z.coerce.number(),
});

// Tool handlers
export async function handleSpaceTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_spaces": {
      const input = GetSpacesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.ids) queryParams["ids"] = input.ids.join(",");
      if (input.keys) queryParams["keys"] = input.keys.join(",");
      if (input.type) queryParams["type"] = input.type;
      if (input.status) queryParams["status"] = input.status;
      if (input.labels) queryParams["labels"] = input.labels.join(",");
      if (input.sort) queryParams["sort"] = input.sort;
      if (input.descriptionFormat)
        queryParams["description-format"] = input.descriptionFormat;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      if (input.nameContains) {
        const needle = input.nameContains.toLowerCase();
        const wanted = input.limit ?? 25;
        const maxScanned = input.nameSearchMaxScanned ?? 2000;
        const matches: ConfluenceSpace[] = [];
        let scanned = 0;
        let cursor = input.cursor;
        const pageSize = 250;
        const pageParams: Record<
          string,
          string | number | boolean | undefined
        > = { ...queryParams, limit: pageSize };

        while (scanned < maxScanned && matches.length < wanted) {
          if (cursor) pageParams["cursor"] = cursor;
          else delete pageParams["cursor"];
          const page = await client.get<MultiEntityResult<ConfluenceSpace>>(
            "/spaces",
            pageParams
          );
          const results = page.results ?? [];
          scanned += results.length;
          for (const s of results) {
            if (s.name?.toLowerCase().includes(needle)) {
              matches.push(s);
              if (matches.length >= wanted) break;
            }
          }
          const next = extractNextCursor(page._links?.next);
          if (!next || results.length === 0) {
            cursor = undefined;
            break;
          }
          cursor = next;
        }

        return {
          results: matches,
          _links: {},
          nameSearch: {
            needle: input.nameContains,
            scanned,
            matched: matches.length,
            truncated: scanned >= maxScanned && matches.length < wanted,
            nextCursor: cursor,
          },
        };
      }

      return client.get<MultiEntityResult<ConfluenceSpace>>(
        "/spaces",
        queryParams
      );
    }

    case "confluence_get_space": {
      const input = GetSpaceSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.descriptionFormat)
        queryParams["description-format"] = input.descriptionFormat;
      if (input.includeLabels) queryParams["include-labels"] = true;
      if (input.includeProperties) queryParams["include-properties"] = true;
      if (input.includeOperations) queryParams["include-operations"] = true;

      let spaceId = input.spaceId;
      if (spaceId === undefined && input.spaceKey) {
        const lookup = await client.get<MultiEntityResult<ConfluenceSpace>>(
          "/spaces",
          { keys: input.spaceKey, limit: 1 }
        );
        const match = lookup.results?.[0];
        if (!match) {
          throw new Error(
            `No space found with key '${input.spaceKey}'.`
          );
        }
        spaceId = Number(match.id);
      }

      return client.get<ConfluenceSpaceSingle>(
        `/spaces/${spaceId}`,
        queryParams
      );
    }

    case "confluence_create_space": {
      const input = CreateSpaceSchema.parse(args);

      const body: Record<string, unknown> = {
        name: input.name,
        key: input.key,
      };

      if (input.description) {
        body.description = {
          plain: {
            value: input.description,
            representation: "plain",
          },
        };
      }
      if (input.type) body.type = input.type;

      return client.post<ConfluenceSpaceSingle>("/spaces", body);
    }

    case "confluence_update_space": {
      const input = UpdateSpaceSchema.parse(args);

      const body: Record<string, unknown> = {};

      if (input.name) body.name = input.name;
      if (input.description) {
        body.description = {
          plain: {
            value: input.description,
            representation: "plain",
          },
        };
      }
      if (input.status) body.status = input.status;

      return client.put<ConfluenceSpaceSingle>(
        `/spaces/${input.spaceId}`,
        body
      );
    }

    case "confluence_delete_space": {
      const input = DeleteSpaceSchema.parse(args);

      await client.delete(`/spaces/${input.spaceId}`);
      return { success: true, deleted: input.spaceId };
    }

    default:
      throw new Error(`Unknown space tool: ${toolName}`);
  }
}
