import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import {
  ConfluenceContentProperty,
  MultiEntityResult,
} from "../types/confluence.js";

// Tool definitions for content properties

export const contentPropertyTools = [
  {
    name: "confluence_get_page_properties",
    description: "Get content properties for a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
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
          description: "Maximum number of results",
        },
      },
      required: ["pageId"],
    },
  },
  {
    name: "confluence_get_page_property",
    description: "Get a specific content property by key for a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        propertyId: {
          type: "number",
          description: "The ID of the property",
        },
      },
      required: ["pageId", "propertyId"],
    },
  },
  {
    name: "confluence_create_page_property",
    description: "Create a content property on a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        key: {
          type: "string",
          description: "The property key",
        },
        value: {
          description: "The property value (can be any JSON value)",
        },
      },
      required: ["pageId", "key", "value"],
    },
  },
  {
    name: "confluence_update_page_property",
    description: "Update a content property on a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        propertyId: {
          type: "number",
          description: "The ID of the property",
        },
        key: {
          type: "string",
          description: "The property key",
        },
        value: {
          description: "The new property value",
        },
        version: {
          type: "number",
          description: "Current version number of the property",
        },
      },
      required: ["pageId", "propertyId", "key", "value", "version"],
    },
  },
  {
    name: "confluence_delete_page_property",
    description: "Delete a content property from a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        propertyId: {
          type: "number",
          description: "The ID of the property to delete",
        },
      },
      required: ["pageId", "propertyId"],
    },
  },
];

// Input schemas for validation
const GetPagePropertiesSchema = z.object({
  pageId: z.coerce.number(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetPagePropertySchema = z.object({
  pageId: z.coerce.number(),
  propertyId: z.coerce.number(),
});

const CreatePagePropertySchema = z.object({
  pageId: z.coerce.number(),
  key: z.string(),
  value: z.unknown(),
});

const UpdatePagePropertySchema = z.object({
  pageId: z.coerce.number(),
  propertyId: z.coerce.number(),
  key: z.string(),
  value: z.unknown(),
  version: z.coerce.number(),
});

const DeletePagePropertySchema = z.object({
  pageId: z.coerce.number(),
  propertyId: z.coerce.number(),
});

// Tool handlers
export async function handleContentPropertyTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_properties": {
      const input = GetPagePropertiesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceContentProperty>>(
        `/pages/${input.pageId}/properties`,
        queryParams
      );
    }

    case "confluence_get_page_property": {
      const input = GetPagePropertySchema.parse(args);

      return client.get<ConfluenceContentProperty>(
        `/pages/${input.pageId}/properties/${input.propertyId}`
      );
    }

    case "confluence_create_page_property": {
      const input = CreatePagePropertySchema.parse(args);

      const body = {
        key: input.key,
        value: input.value,
      };

      return client.post<ConfluenceContentProperty>(
        `/pages/${input.pageId}/properties`,
        body
      );
    }

    case "confluence_update_page_property": {
      const input = UpdatePagePropertySchema.parse(args);

      const body = {
        key: input.key,
        value: input.value,
        version: {
          number: input.version + 1,
        },
      };

      return client.put<ConfluenceContentProperty>(
        `/pages/${input.pageId}/properties/${input.propertyId}`,
        body
      );
    }

    case "confluence_delete_page_property": {
      const input = DeletePagePropertySchema.parse(args);

      await client.delete(
        `/pages/${input.pageId}/properties/${input.propertyId}`
      );
      return {
        success: true,
        pageId: input.pageId,
        propertyId: input.propertyId,
      };
    }

    default:
      throw new Error(`Unknown content property tool: ${toolName}`);
  }
}
