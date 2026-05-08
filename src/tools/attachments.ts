import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluenceAttachment, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for attachments

export const attachmentTools = [
  {
    name: "confluence_get_page_attachments",
    description: "Get attachments on a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        mediaType: {
          type: "string",
          description: "Filter by media type (e.g., image/png, application/pdf)",
        },
        filename: {
          type: "string",
          description: "Filter by filename",
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
    name: "confluence_get_blog_post_attachments",
    description: "Get attachments on a specific blog post. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        mediaType: {
          type: "string",
          description: "Filter by media type",
        },
        filename: {
          type: "string",
          description: "Filter by filename",
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
    name: "confluence_get_attachment",
    description: "Get a specific attachment by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        attachmentId: {
          type: "string",
          description: "The ID of the attachment",
        },
        version: {
          type: "number",
          description: "Specific version number to retrieve",
        },
      },
      required: ["attachmentId"],
    },
  },
  {
    name: "confluence_delete_attachment",
    description: "Delete an attachment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        attachmentId: {
          type: "string",
          description: "The ID of the attachment to delete",
        },
        purge: {
          type: "boolean",
          description: "If true, permanently delete (only works on trashed attachments)",
        },
      },
      required: ["attachmentId"],
    },
  },
];

// Input schemas for validation
const GetPageAttachmentsSchema = z.object({
  pageId: z.coerce.number(),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetBlogPostAttachmentsSchema = z.object({
  blogPostId: z.coerce.number(),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetAttachmentSchema = z.object({
  attachmentId: z.string(),
  version: z.coerce.number().optional(),
});

const DeleteAttachmentSchema = z.object({
  attachmentId: z.string(),
  purge: z.boolean().optional(),
});

// Tool handlers
export async function handleAttachmentTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_attachments": {
      const input = GetPageAttachmentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.mediaType) queryParams["mediaType"] = input.mediaType;
      if (input.filename) queryParams["filename"] = input.filename;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceAttachment>>(
        `/pages/${input.pageId}/attachments`,
        queryParams
      );
    }

    case "confluence_get_blog_post_attachments": {
      const input = GetBlogPostAttachmentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.mediaType) queryParams["mediaType"] = input.mediaType;
      if (input.filename) queryParams["filename"] = input.filename;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceAttachment>>(
        `/blogposts/${input.blogPostId}/attachments`,
        queryParams
      );
    }

    case "confluence_get_attachment": {
      const input = GetAttachmentSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.version) queryParams["version"] = input.version;

      return client.get<ConfluenceAttachment>(
        `/attachments/${input.attachmentId}`,
        queryParams
      );
    }

    case "confluence_delete_attachment": {
      const input = DeleteAttachmentSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.purge) queryParams["purge"] = true;

      await client.delete(`/attachments/${input.attachmentId}`, queryParams);
      return { success: true, deleted: input.attachmentId };
    }

    default:
      throw new Error(`Unknown attachment tool: ${toolName}`);
  }
}
