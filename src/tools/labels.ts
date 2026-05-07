import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluenceLabel, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for labels

export const labelTools = [
  {
    name: "confluence_get_page_labels",
    description: "Get labels on a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        prefix: {
          type: "string",
          description: "Filter by label prefix",
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
    name: "confluence_add_page_label",
    description: "Add a label to a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        label: {
          type: "string",
          description: "The label to add",
        },
        prefix: {
          type: "string",
          description: "The label prefix (default: global)",
        },
      },
      required: ["pageId", "label"],
    },
  },
  {
    name: "confluence_remove_page_label",
    description: "Remove a label from a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        labelId: {
          type: "number",
          description: "The ID of the label to remove",
        },
      },
      required: ["pageId", "labelId"],
    },
  },
  {
    name: "confluence_get_blog_post_labels",
    description: "Get labels on a specific blog post. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        prefix: {
          type: "string",
          description: "Filter by label prefix",
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
      required: ["blogPostId"],
    },
  },
  {
    name: "confluence_add_blog_post_label",
    description: "Add a label to a blog post.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        label: {
          type: "string",
          description: "The label to add",
        },
        prefix: {
          type: "string",
          description: "The label prefix (default: global)",
        },
      },
      required: ["blogPostId", "label"],
    },
  },
  {
    name: "confluence_remove_blog_post_label",
    description: "Remove a label from a blog post.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        labelId: {
          type: "number",
          description: "The ID of the label to remove",
        },
      },
      required: ["blogPostId", "labelId"],
    },
  },
  {
    name: "confluence_get_space_labels",
    description: "Get labels on a specific space. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space",
        },
        prefix: {
          type: "string",
          description: "Filter by label prefix",
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
      required: ["spaceId"],
    },
  },
  {
    name: "confluence_add_space_label",
    description: "Add a label to a space.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space",
        },
        label: {
          type: "string",
          description: "The label to add",
        },
        prefix: {
          type: "string",
          description: "The label prefix (default: global)",
        },
      },
      required: ["spaceId", "label"],
    },
  },
  {
    name: "confluence_remove_space_label",
    description: "Remove a label from a space.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space",
        },
        labelId: {
          type: "number",
          description: "The ID of the label to remove",
        },
      },
      required: ["spaceId", "labelId"],
    },
  },
];

// Input schemas for validation
const GetPageLabelsSchema = z.object({
  pageId: z.coerce.number(),
  prefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const AddPageLabelSchema = z.object({
  pageId: z.coerce.number(),
  label: z.string(),
  prefix: z.string().optional(),
});

const RemovePageLabelSchema = z.object({
  pageId: z.coerce.number(),
  labelId: z.coerce.number(),
});

const GetBlogPostLabelsSchema = z.object({
  blogPostId: z.coerce.number(),
  prefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const AddBlogPostLabelSchema = z.object({
  blogPostId: z.coerce.number(),
  label: z.string(),
  prefix: z.string().optional(),
});

const RemoveBlogPostLabelSchema = z.object({
  blogPostId: z.coerce.number(),
  labelId: z.coerce.number(),
});

const GetSpaceLabelsSchema = z.object({
  spaceId: z.coerce.number(),
  prefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const AddSpaceLabelSchema = z.object({
  spaceId: z.coerce.number(),
  label: z.string(),
  prefix: z.string().optional(),
});

const RemoveSpaceLabelSchema = z.object({
  spaceId: z.coerce.number(),
  labelId: z.coerce.number(),
});

// Tool handlers
export async function handleLabelTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_labels": {
      const input = GetPageLabelsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.prefix) queryParams["prefix"] = input.prefix;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceLabel>>(
        `/pages/${input.pageId}/labels`,
        queryParams
      );
    }

    case "confluence_add_page_label": {
      const input = AddPageLabelSchema.parse(args);

      const body = {
        name: input.label,
        prefix: input.prefix || "global",
      };

      return client.post<ConfluenceLabel>(
        `/pages/${input.pageId}/labels`,
        body
      );
    }

    case "confluence_remove_page_label": {
      const input = RemovePageLabelSchema.parse(args);

      await client.delete(`/pages/${input.pageId}/labels/${input.labelId}`);
      return { success: true, pageId: input.pageId, labelId: input.labelId };
    }

    case "confluence_get_blog_post_labels": {
      const input = GetBlogPostLabelsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.prefix) queryParams["prefix"] = input.prefix;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceLabel>>(
        `/blogposts/${input.blogPostId}/labels`,
        queryParams
      );
    }

    case "confluence_add_blog_post_label": {
      const input = AddBlogPostLabelSchema.parse(args);

      const body = {
        name: input.label,
        prefix: input.prefix || "global",
      };

      return client.post<ConfluenceLabel>(
        `/blogposts/${input.blogPostId}/labels`,
        body
      );
    }

    case "confluence_remove_blog_post_label": {
      const input = RemoveBlogPostLabelSchema.parse(args);

      await client.delete(
        `/blogposts/${input.blogPostId}/labels/${input.labelId}`
      );
      return {
        success: true,
        blogPostId: input.blogPostId,
        labelId: input.labelId,
      };
    }

    case "confluence_get_space_labels": {
      const input = GetSpaceLabelsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.prefix) queryParams["prefix"] = input.prefix;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceLabel>>(
        `/spaces/${input.spaceId}/labels`,
        queryParams
      );
    }

    case "confluence_add_space_label": {
      const input = AddSpaceLabelSchema.parse(args);

      const body = {
        name: input.label,
        prefix: input.prefix || "global",
      };

      return client.post<ConfluenceLabel>(
        `/spaces/${input.spaceId}/labels`,
        body
      );
    }

    case "confluence_remove_space_label": {
      const input = RemoveSpaceLabelSchema.parse(args);

      await client.delete(`/spaces/${input.spaceId}/labels/${input.labelId}`);
      return { success: true, spaceId: input.spaceId, labelId: input.labelId };
    }

    default:
      throw new Error(`Unknown label tool: ${toolName}`);
  }
}
