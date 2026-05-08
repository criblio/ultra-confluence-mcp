import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluenceVersionDetail, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for versions

export const versionTools = [
  {
    name: "confluence_get_page_versions",
    description: "Get version history for a specific page. Results are paginated - use the returned cursor to fetch more if needed.",
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
      required: ["pageId"],
    },
  },
  {
    name: "confluence_get_page_version",
    description: "Get a specific version of a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: {
          type: "number",
          description: "The ID of the page",
        },
        versionNumber: {
          type: "number",
          description: "The version number to retrieve",
        },
      },
      required: ["pageId", "versionNumber"],
    },
  },
  {
    name: "confluence_get_blog_post_versions",
    description: "Get version history for a specific blog post. Results are paginated - use the returned cursor to fetch more if needed.",
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
    name: "confluence_get_blog_post_version",
    description: "Get a specific version of a blog post.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blogPostId: {
          type: "number",
          description: "The ID of the blog post",
        },
        versionNumber: {
          type: "number",
          description: "The version number to retrieve",
        },
      },
      required: ["blogPostId", "versionNumber"],
    },
  },
];

// Input schemas for validation
const GetPageVersionsSchema = z.object({
  pageId: z.coerce.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetPageVersionSchema = z.object({
  pageId: z.coerce.number(),
  versionNumber: z.coerce.number(),
});

const GetBlogPostVersionsSchema = z.object({
  blogPostId: z.coerce.number(),
  bodyFormat: z.enum(["storage", "atlas_doc_format", "view"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

const GetBlogPostVersionSchema = z.object({
  blogPostId: z.coerce.number(),
  versionNumber: z.coerce.number(),
});

// Tool handlers
export async function handleVersionTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_page_versions": {
      const input = GetPageVersionsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) queryParams["body-format"] = input.bodyFormat;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceVersionDetail>>(
        `/pages/${input.pageId}/versions`,
        queryParams
      );
    }

    case "confluence_get_page_version": {
      const input = GetPageVersionSchema.parse(args);

      return client.get<ConfluenceVersionDetail>(
        `/pages/${input.pageId}/versions/${input.versionNumber}`
      );
    }

    case "confluence_get_blog_post_versions": {
      const input = GetBlogPostVersionsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined> =
        {};

      if (input.bodyFormat) queryParams["body-format"] = input.bodyFormat;
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      return client.get<MultiEntityResult<ConfluenceVersionDetail>>(
        `/blogposts/${input.blogPostId}/versions`,
        queryParams
      );
    }

    case "confluence_get_blog_post_version": {
      const input = GetBlogPostVersionSchema.parse(args);

      return client.get<ConfluenceVersionDetail>(
        `/blogposts/${input.blogPostId}/versions/${input.versionNumber}`
      );
    }

    default:
      throw new Error(`Unknown version tool: ${toolName}`);
  }
}
