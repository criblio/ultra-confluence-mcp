import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
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
      "Get all spaces. Returns spaces filtered by various parameters. Results are paginated - use the returned cursor to fetch more pages if you don't find what you need.",
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
      },
      required: [],
    },
  },
  {
    name: "confluence_get_space",
    description:
      "Get a specific space by ID. Returns detailed space information.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space",
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
      required: ["spaceId"],
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
});

const GetSpaceSchema = z.object({
  spaceId: z.coerce.number(),
  descriptionFormat: z.enum(["plain", "view"]).optional(),
  includeLabels: z.boolean().optional(),
  includeProperties: z.boolean().optional(),
  includeOperations: z.boolean().optional(),
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

      return client.get<ConfluenceSpaceSingle>(
        `/spaces/${input.spaceId}`,
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
