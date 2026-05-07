import { ConfluenceClient } from "../auth/confluence-client.js";
import {
  getToolFilterConfig,
  getTrimConfig,
  ToolCategory,
  ToolFilterConfig,
  TrimConfig,
} from "../config.js";
import { applyTrim } from "../core/trim.js";
import { getTrimKind } from "../core/trim-registry.js";

// Import all tool definitions and handlers
import { pageTools, handlePageTool } from "./pages.js";
import { spaceTools, handleSpaceTool } from "./spaces.js";
import { blogPostTools, handleBlogPostTool } from "./blog-posts.js";
import { commentTools, handleCommentTool } from "./comments.js";
import { attachmentTools, handleAttachmentTool } from "./attachments.js";
import { labelTools, handleLabelTool } from "./labels.js";
import { searchTools, handleSearchTool } from "./search.js";
import { userTools, handleUserTool } from "./users.js";
import { versionTools, handleVersionTool } from "./versions.js";
import { contentPropertyTools, handleContentPropertyTool } from "./content-properties.js";
import { ancestorTools, handleAncestorTool } from "./ancestors.js";
import { descendantTools, handleDescendantTool } from "./descendants.js";
import { serverTools, handleServerTool } from "./server.js";

// Tool type definition
interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface ObjectSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

const FULL_ARG_DESCRIPTION =
  "If true, bypass response trimming and return the raw Confluence API response.";

const FULL_HINT_SENTENCE =
  "Output is trimmed by default (drops _links, _expandable, body content, etc.); pass full=true to receive the raw Confluence response.";

/**
 * Inject the `full` escape-hatch arg into the inputSchema of every tool
 * whose response is trimmed, and append a hint to its description so
 * agents discover the arg without inspecting the schema. Done centrally
 * so per-file tool definitions don't have to repeat the boilerplate, and
 * new tools pick it up the moment they're added to TOOL_TRIM_MAP.
 */
function injectFullArg(tool: Tool): Tool {
  if (getTrimKind(tool.name) === "passthrough") return tool;

  const schema = tool.inputSchema;
  if (
    typeof schema !== "object" ||
    schema === null ||
    (schema as ObjectSchema).type !== "object"
  ) {
    return tool;
  }

  const objSchema = schema as ObjectSchema;
  const properties = objSchema.properties ?? {};
  const alreadyInjected = "full" in properties;

  const description = tool.description.includes("full=true")
    ? tool.description
    : `${tool.description.replace(/\s*$/, "")} ${FULL_HINT_SENTENCE}`;

  return {
    ...tool,
    description,
    inputSchema: alreadyInjected
      ? objSchema
      : {
          ...objSchema,
          properties: {
            ...properties,
            full: { type: "boolean", description: FULL_ARG_DESCRIPTION },
          },
        },
  };
}

// Map category names to their tools (with `full` arg injected on read tools)
const toolsByCategory: Record<ToolCategory, Tool[]> = {
  page: pageTools.map(injectFullArg),
  space: spaceTools.map(injectFullArg),
  blogPost: blogPostTools.map(injectFullArg),
  comment: commentTools.map(injectFullArg),
  attachment: attachmentTools.map(injectFullArg),
  label: labelTools.map(injectFullArg),
  search: searchTools.map(injectFullArg),
  user: userTools.map(injectFullArg),
  version: versionTools.map(injectFullArg),
  contentProperty: contentPropertyTools.map(injectFullArg),
  ancestor: ancestorTools.map(injectFullArg),
  descendant: descendantTools.map(injectFullArg),
  server: serverTools.map(injectFullArg),
};

// Export all tools as a single array (unfiltered)
export const allTools: Tool[] = Object.values(toolsByCategory).flat();

// Map of tool names to their categories for routing
const toolCategories: Record<string, ToolCategory> = {};

// Populate tool categories
for (const [category, tools] of Object.entries(toolsByCategory)) {
  for (const tool of tools) {
    toolCategories[tool.name] = category as ToolCategory;
  }
}

/**
 * Get filtered tools based on environment configuration
 *
 * Filtering rules:
 * 1. If CONFLUENCE_ENABLED_CATEGORIES is set, only include tools from those categories
 * 2. Remove any tools listed in CONFLUENCE_DISABLED_TOOLS
 */
export function getFilteredTools(filterConfig?: ToolFilterConfig): Tool[] {
  const config = filterConfig ?? getToolFilterConfig();

  let tools = allTools;

  // Filter by enabled categories (if specified)
  if (config.enabledCategories.length > 0) {
    const enabledSet = new Set(config.enabledCategories);
    tools = tools.filter((tool) => {
      const category = toolCategories[tool.name];
      return category && enabledSet.has(category);
    });
  }

  // Remove disabled tools
  if (config.disabledTools.length > 0) {
    const disabledSet = new Set(config.disabledTools);
    tools = tools.filter((tool) => !disabledSet.has(tool.name));
  }

  return tools;
}

/**
 * Check if a tool is enabled based on the filter configuration
 */
export function isToolEnabled(
  toolName: string,
  filterConfig?: ToolFilterConfig
): boolean {
  const config = filterConfig ?? getToolFilterConfig();

  // Check if tool is explicitly disabled
  if (config.disabledTools.includes(toolName)) {
    return false;
  }

  // Check if category filtering is enabled
  if (config.enabledCategories.length > 0) {
    const category = toolCategories[toolName];
    if (!category || !config.enabledCategories.includes(category)) {
      return false;
    }
  }

  return true;
}

/**
 * Strip the `full` escape-hatch arg before handing args to category
 * handlers — it's a trim-layer concern, not a Confluence-API param.
 */
function extractFullFlag(args: unknown): { full: boolean; rest: unknown } {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { full: false, rest: args };
  }
  const obj = args as Record<string, unknown>;
  const full = obj.full === true;
  if (!("full" in obj)) {
    return { full: false, rest: args };
  }
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "full") rest[k] = v;
  }
  return { full, rest };
}

// Main tool handler that routes to the appropriate category handler
export async function handleTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown,
  filterConfig?: ToolFilterConfig,
  trimConfig?: TrimConfig
): Promise<unknown> {
  const category = toolCategories[toolName];

  if (!category) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Check if tool is enabled
  if (!isToolEnabled(toolName, filterConfig)) {
    throw new Error(`Tool "${toolName}" is disabled`);
  }

  const { full, rest } = extractFullFlag(args);

  let raw: unknown;
  switch (category) {
    case "page":
      raw = await handlePageTool(client, toolName, rest);
      break;
    case "space":
      raw = await handleSpaceTool(client, toolName, rest);
      break;
    case "blogPost":
      raw = await handleBlogPostTool(client, toolName, rest);
      break;
    case "comment":
      raw = await handleCommentTool(client, toolName, rest);
      break;
    case "attachment":
      raw = await handleAttachmentTool(client, toolName, rest);
      break;
    case "label":
      raw = await handleLabelTool(client, toolName, rest);
      break;
    case "search":
      raw = await handleSearchTool(client, toolName, rest);
      break;
    case "user":
      raw = await handleUserTool(client, toolName, rest);
      break;
    case "version":
      raw = await handleVersionTool(client, toolName, rest);
      break;
    case "contentProperty":
      raw = await handleContentPropertyTool(client, toolName, rest);
      break;
    case "ancestor":
      raw = await handleAncestorTool(client, toolName, rest);
      break;
    case "descendant":
      raw = await handleDescendantTool(client, toolName, rest);
      break;
    case "server":
      raw = await handleServerTool(client, toolName, rest);
      break;
    default:
      throw new Error(`Unknown tool category: ${category}`);
  }

  const trim = trimConfig ?? getTrimConfig();
  return applyTrim(toolName, raw, { full, disabled: trim.disabled });
}
