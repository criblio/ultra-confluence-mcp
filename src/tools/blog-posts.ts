import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import {
  ConfluenceBlogPost,
  ConfluenceBlogPostSingle,
  MultiEntityResult,
} from "../types/confluence.js";

// Tool definitions for blog posts

export const blogPostTools = [
  {
    name: "confluence_get_blog_posts",
    description:
      "Get all blog posts. Returns blog posts filtered by various parameters. Results are paginated - use the returned cursor to fetch more pages if you don't find what you need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "array",
          items: { type: "number" },
          description: "Filter by space IDs",
        },
        status: {
          type: "array",
          items: { type: "string" },
          description: "Filter by status (current, trashed, deleted, draft)",
        },
        title: {
          type: "string",
          description: "Filter by exact title match",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the body content to return",
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
    name: "confluence_get_blog_post",
    description:
      "Get a specific blog post by ID. Returns detailed blog post information including body content.",
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
          description: "The format of the body content to return",
        },
        getDraft: {
          type: "boolean",
          description: "If true, returns the draft version if available",
        },
        version: {
          type: "number",
          description: "Specific version number to retrieve",
        },
        includeLabels: {
          type: "boolean",
          description: "Include labels in the response",
        },
        includeProperties: {
          type: "boolean",
          description: "Include content properties in the response",
        },
        includeVersions: {
          type: "boolean",
          description: "Include version history in the response",
        },
      },
      required: ["blogPostId"],
    },
  },
  {
    name: "confluence_create_blog_post",
    description:
      "Create a new blog post in a space. Requires space ID, title, and body content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "string",
          description: "The ID of the space to create the blog post in",
        },
        title: {
          type: "string",
          description: "The title of the blog post",
        },
        body: {
          type: "string",
          description:
            "The body content (in storage format: XHTML-based markup)",
        },
        status: {
          type: "string",
          enum: ["current", "draft"],
          description: "Blog post status (default: current)",
        },
      },
      required: ["spaceId", "title", "body"],
    },
  },
  {
    name: "confluence_update_blog_post",
    description:
      "Update an existing blog post. Requires blog post ID, new title, body, and current version number.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "string",
          description: "The ID of the blog post to update",
        },
        title: {
          type: "string",
          description: "The new title of the blog post",
        },
        body: {
          type: "string",
          description:
            "The new body content (in storage format: XHTML-based markup)",
        },
        version: {
          type: "number",
          description:
            "The current version number (required for optimistic locking)",
        },
        status: {
          type: "string",
          enum: ["current", "draft"],
          description: "Blog post status",
        },
        versionMessage: {
          type: "string",
          description: "Optional message describing the changes",
        },
      },
      required: ["blogPostId", "title", "body", "version"],
    },
  },
  {
    name: "confluence_delete_blog_post",
    description:
      "Delete a blog post. By default moves to trash; use purge=true to permanently delete.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post to delete",
        },
        purge: {
          type: "boolean",
          description:
            "If true, permanently delete (only works on trashed blog posts)",
        },
        draft: {
          type: "boolean",
          description: "If true, delete a draft blog post",
        },
      },
      required: ["blogPostId"],
    },
  },
  {
    name: "confluence_get_blog_posts_in_space",
    description:
      "Get all blog posts in a specific space. Results are paginated - use the returned cursor to fetch more pages if you don't find what you need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceId: {
          type: "number",
          description: "The ID of the space",
        },
        status: {
          type: "array",
          items: { type: "string" },
          description: "Filter by status",
        },
        title: {
          type: "string",
          description: "Filter by exact title match",
        },
        bodyFormat: {
          type: "string",
          enum: ["storage", "atlas_doc_format", "view"],
          description: "The format of the body content to return",
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
];

// Input schemas for validation
const GetBlogPostsSchema = z.object({
  spaceId: z.array(z.coerce.number()).optional(),
  status: z.array(z.string()).optional(),
  title: z.string().optional(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetBlogPostSchema = z.object({
  blogPostId: z.coerce.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  getDraft: z.boolean().optional(),
  version: z.coerce.number().optional(),
  includeLabels: z.boolean().optional(),
  includeProperties: z.boolean().optional(),
  includeVersions: z.boolean().optional(),
});

const CreateBlogPostSchema = z.object({
  spaceId: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["current", "draft"]).optional(),
});

const UpdateBlogPostSchema = z.object({
  blogPostId: z.string(),
  title: z.string(),
  body: z.string(),
  version: z.coerce.number(),
  status: z.enum(["current", "draft"]).optional(),
  versionMessage: z.string().optional(),
});

const DeleteBlogPostSchema = z.object({
  blogPostId: z.coerce.number(),
  purge: z.boolean().optional(),
  draft: z.boolean().optional(),
});

const GetBlogPostsInSpaceSchema = z.object({
  spaceId: z.coerce.number(),
  status: z.array(z.string()).optional(),
  title: z.string().optional(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

// Tool handlers
export async function handleBlogPostTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown,
  full = false
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_blog_posts": {
      const input = GetBlogPostsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.spaceId) queryParams["space-id"] = input.spaceId.join(",");
      if (input.status) queryParams["status"] = input.status.join(",");
      if (input.title) queryParams["title"] = input.title;
      if (input.bodyFormat) queryParams["body-format"] = input.bodyFormat;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceBlogPost>>(
        "/blogposts",
        queryParams
      );
    }

    case "confluence_get_blog_post": {
      const input = GetBlogPostSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) {
        queryParams["body-format"] = input.bodyFormat;
      } else if (!full) {
        queryParams["body-format"] = "atlas_doc_format";
      }
      if (input.getDraft) queryParams["get-draft"] = input.getDraft;
      if (input.version) queryParams["version"] = input.version;
      if (input.includeLabels) queryParams["include-labels"] = true;
      if (input.includeProperties) queryParams["include-properties"] = true;
      if (input.includeVersions) queryParams["include-versions"] = true;

      return client.get<ConfluenceBlogPostSingle>(
        `/blogposts/${input.blogPostId}`,
        queryParams
      );
    }

    case "confluence_create_blog_post": {
      const input = CreateBlogPostSchema.parse(args);

      const body: Record<string, unknown> = {
        spaceId: input.spaceId,
        title: input.title,
        body: {
          representation: "storage",
          value: input.body,
        },
      };

      if (input.status) body.status = input.status;

      return client.post<ConfluenceBlogPostSingle>("/blogposts", body);
    }

    case "confluence_update_blog_post": {
      const input = UpdateBlogPostSchema.parse(args);

      const body: Record<string, unknown> = {
        id: input.blogPostId,
        status: input.status || "current",
        title: input.title,
        body: {
          representation: "storage",
          value: input.body,
        },
        version: {
          number: input.version + 1,
          message: input.versionMessage,
        },
      };

      return client.put<ConfluenceBlogPostSingle>(
        `/blogposts/${input.blogPostId}`,
        body
      );
    }

    case "confluence_delete_blog_post": {
      const input = DeleteBlogPostSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.purge) queryParams["purge"] = true;
      if (input.draft) queryParams["draft"] = true;

      await client.delete(`/blogposts/${input.blogPostId}`, queryParams);
      return { success: true, deleted: input.blogPostId };
    }

    case "confluence_get_blog_posts_in_space": {
      const input = GetBlogPostsInSpaceSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.status) queryParams["status"] = input.status.join(",");
      if (input.title) queryParams["title"] = input.title;
      if (input.bodyFormat) queryParams["body-format"] = input.bodyFormat;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceBlogPost>>(
        `/spaces/${input.spaceId}/blogposts`,
        queryParams
      );
    }

    default:
      throw new Error(`Unknown blog post tool: ${toolName}`);
  }
}
