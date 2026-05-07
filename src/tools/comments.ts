import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import {
  ConfluenceFooterComment,
  ConfluenceInlineComment,
  MultiEntityResult,
} from "../types/confluence.js";

// Tool definitions for comments

export const commentTools = [
  {
    name: "confluence_get_page_footer_comments",
    description: "Get footer comments on a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the comment body to return",
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
    name: "confluence_get_page_inline_comments",
    description: "Get inline comments on a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the comment body to return",
        },
        resolutionStatus: {
          type: "string",
          enum: ["open", "resolved", "reopened"],
          description: "Filter by resolution status",
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
    name: "confluence_get_blog_post_footer_comments",
    description: "Get footer comments on a specific blog post. Results are paginated - use the returned cursor to fetch more if needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the comment body to return",
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
    name: "confluence_get_footer_comment",
    description: "Get a specific footer comment by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: {
          type: "number",
          description: "The ID of the comment",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the comment body to return",
        },
      },
      required: ["commentId"],
    },
  },
  {
    name: "confluence_create_page_footer_comment",
    description: "Create a footer comment on a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "string",
          description: "The ID of the page",
        },
        body: {
          type: "string",
          description: "The comment body (in storage format)",
        },
      },
      required: ["pageId", "body"],
    },
  },
  {
    name: "confluence_create_blog_post_footer_comment",
    description: "Create a footer comment on a blog post.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "string",
          description: "The ID of the blog post",
        },
        body: {
          type: "string",
          description: "The comment body (in storage format)",
        },
      },
      required: ["blogPostId", "body"],
    },
  },
  {
    name: "confluence_update_footer_comment",
    description: "Update an existing footer comment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: {
          type: "number",
          description: "The ID of the comment",
        },
        body: {
          type: "string",
          description: "The new comment body (in storage format)",
        },
        version: {
          type: "number",
          description: "The current version number",
        },
      },
      required: ["commentId", "body", "version"],
    },
  },
  {
    name: "confluence_delete_footer_comment",
    description: "Delete a footer comment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commentId: {
          type: "number",
          description: "The ID of the comment to delete",
        },
      },
      required: ["commentId"],
    },
  },
];

// Input schemas for validation
const GetPageFooterCommentsSchema = z.object({
  pageId: z.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().optional(),
});

const GetPageInlineCommentsSchema = z.object({
  pageId: z.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  resolutionStatus: z.enum(["open", "resolved", "reopened"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().optional(),
});

const GetBlogPostFooterCommentsSchema = z.object({
  blogPostId: z.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().optional(),
});

const GetFooterCommentSchema = z.object({
  commentId: z.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
});

const CreatePageFooterCommentSchema = z.object({
  pageId: z.string(),
  body: z.string(),
});

const CreateBlogPostFooterCommentSchema = z.object({
  blogPostId: z.string(),
  body: z.string(),
});

const UpdateFooterCommentSchema = z.object({
  commentId: z.number(),
  body: z.string(),
  version: z.number(),
});

const DeleteFooterCommentSchema = z.object({
  commentId: z.number(),
});

// Tool handlers
export async function handleCommentTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown,
  full = false
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_footer_comments": {
      const input = GetPageFooterCommentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) {
        queryParams["body-format"] = input.bodyFormat;
      } else if (!full) {
        queryParams["body-format"] = "atlas_doc_format";
      }
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceFooterComment>>(
        `/pages/${input.pageId}/footer-comments`,
        queryParams
      );
    }

    case "confluence_get_page_inline_comments": {
      const input = GetPageInlineCommentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) {
        queryParams["body-format"] = input.bodyFormat;
      } else if (!full) {
        queryParams["body-format"] = "atlas_doc_format";
      }
      if (input.resolutionStatus)
        queryParams["resolution-status"] = input.resolutionStatus;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceInlineComment>>(
        `/pages/${input.pageId}/inline-comments`,
        queryParams
      );
    }

    case "confluence_get_blog_post_footer_comments": {
      const input = GetBlogPostFooterCommentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) {
        queryParams["body-format"] = input.bodyFormat;
      } else if (!full) {
        queryParams["body-format"] = "atlas_doc_format";
      }
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceFooterComment>>(
        `/blogposts/${input.blogPostId}/footer-comments`,
        queryParams
      );
    }

    case "confluence_get_footer_comment": {
      const input = GetFooterCommentSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) {
        queryParams["body-format"] = input.bodyFormat;
      } else if (!full) {
        queryParams["body-format"] = "atlas_doc_format";
      }

      return client.get<ConfluenceFooterComment>(
        `/footer-comments/${input.commentId}`,
        queryParams
      );
    }

    case "confluence_create_page_footer_comment": {
      const input = CreatePageFooterCommentSchema.parse(args);

      const body = {
        pageId: input.pageId,
        body: {
          representation: "storage",
          value: input.body,
        },
      };

      return client.post<ConfluenceFooterComment>("/footer-comments", body);
    }

    case "confluence_create_blog_post_footer_comment": {
      const input = CreateBlogPostFooterCommentSchema.parse(args);

      const body = {
        blogPostId: input.blogPostId,
        body: {
          representation: "storage",
          value: input.body,
        },
      };

      return client.post<ConfluenceFooterComment>("/footer-comments", body);
    }

    case "confluence_update_footer_comment": {
      const input = UpdateFooterCommentSchema.parse(args);

      const body = {
        body: {
          representation: "storage",
          value: input.body,
        },
        version: {
          number: input.version + 1,
        },
      };

      return client.put<ConfluenceFooterComment>(
        `/footer-comments/${input.commentId}`,
        body
      );
    }

    case "confluence_delete_footer_comment": {
      const input = DeleteFooterCommentSchema.parse(args);

      await client.delete(`/footer-comments/${input.commentId}`);
      return { success: true, deleted: input.commentId };
    }

    default:
      throw new Error(`Unknown comment tool: ${toolName}`);
  }
}
