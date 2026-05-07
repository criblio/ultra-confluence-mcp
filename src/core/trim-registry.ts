/**
 * Maps each MCP tool name to a TrimKind that selects the projector applied
 * to its response. Tools not in the map default to `passthrough` (no trimming).
 *
 * Adding a new tool: pick the kind whose projector best matches its response
 * shape, or use `passthrough` if the response is already minimal (writes,
 * deletes, simple acknowledgements).
 */

export type TrimKind =
  | "page"
  | "pageList"
  | "blogPost"
  | "blogPostList"
  | "comment"
  | "commentList"
  | "search"
  | "attachment"
  | "attachmentList"
  | "space"
  | "spaceList"
  | "label"
  | "labelList"
  | "version"
  | "versionList"
  | "user"
  | "userList"
  | "ancestorList"
  | "passthrough";

export const TOOL_TRIM_MAP: Record<string, TrimKind> = {
  // Pages
  confluence_get_page: "page",
  confluence_get_pages: "pageList",
  confluence_get_pages_in_space: "pageList",
  confluence_get_pages_for_label: "pageList",
  confluence_get_page_descendants: "pageList",
  confluence_get_page_children: "pageList",
  confluence_create_page: "page",
  confluence_update_page: "page",
  confluence_create_page_from_markdown: "page",
  confluence_update_page_from_markdown: "page",
  confluence_create_page_from_markdown_adf: "page",
  confluence_update_page_from_markdown_adf: "page",

  // Ancestors are page-shaped but a flat array, no body
  confluence_get_page_ancestors: "ancestorList",

  // Blog posts
  confluence_get_blog_post: "blogPost",
  confluence_get_blog_posts: "blogPostList",
  confluence_get_blog_posts_in_space: "blogPostList",
  confluence_create_blog_post: "blogPost",
  confluence_update_blog_post: "blogPost",

  // Comments
  confluence_get_footer_comment: "comment",
  confluence_get_page_footer_comments: "commentList",
  confluence_get_page_inline_comments: "commentList",
  confluence_get_blog_post_footer_comments: "commentList",
  confluence_create_page_footer_comment: "comment",
  confluence_create_blog_post_footer_comment: "comment",
  confluence_update_footer_comment: "comment",

  // Attachments
  confluence_get_attachment: "attachment",
  confluence_get_page_attachments: "attachmentList",
  confluence_get_blog_post_attachments: "attachmentList",

  // Spaces
  confluence_get_space: "space",
  confluence_get_spaces: "spaceList",
  confluence_create_space: "space",
  confluence_update_space: "space",

  // Labels
  confluence_get_page_labels: "labelList",
  confluence_get_blog_post_labels: "labelList",
  confluence_get_space_labels: "labelList",
  confluence_add_page_label: "label",
  confluence_add_blog_post_label: "label",
  confluence_add_space_label: "label",

  // Versions
  confluence_get_page_versions: "versionList",
  confluence_get_page_version: "version",
  confluence_get_blog_post_versions: "versionList",
  confluence_get_blog_post_version: "version",

  // Users
  confluence_get_current_user: "user",
  confluence_get_user: "user",
  confluence_get_users: "userList",

  // Search
  confluence_cql_search: "search",
  confluence_search_content: "search",
  confluence_search_generic_content: "search",

  // Everything else (deletes, label removals, content properties, server info,
  // search_generic_content) falls through to passthrough.
};

export function getTrimKind(toolName: string): TrimKind {
  return TOOL_TRIM_MAP[toolName] ?? "passthrough";
}
