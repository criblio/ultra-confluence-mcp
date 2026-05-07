import { config } from "dotenv";

// Load environment variables from .env files
// Priority: .env.local > .env (later calls override earlier)
config({ path: ".env" });
config({ path: ".env.local", override: true });

// Token types based on prefix:
// - ATATT: Scoped API token (user)
// - ATSTT: Scoped API token (service account)
// - No prefix / other: Classic API token
export type TokenType = "scoped" | "classic";

// Available tool categories
export const ALL_CATEGORIES = [
  "page",
  "space",
  "blogPost",
  "comment",
  "attachment",
  "label",
  "search",
  "user",
  "version",
  "contentProperty",
  "ancestor",
  "descendant",
  "server",
  "body",
] as const;

export type ToolCategory = (typeof ALL_CATEGORIES)[number];

export interface ConfluenceConfig {
  host: string;
  email: string;
  apiToken: string;
  tokenType: TokenType;
  cloudId?: string; // Required for scoped tokens, can be auto-fetched
}

export interface ToolFilterConfig {
  enabledCategories: ToolCategory[]; // Categories to enable (all if empty)
  disabledTools: string[]; // Specific tools to disable
}

export interface TrimConfig {
  /** When true, disables response trimming server-wide. */
  disabled: boolean;
}

/**
 * Detect token type based on prefix
 * - ATATT: Scoped API token (user)
 * - ATSTT: Scoped API token (service account)
 * - Other: Classic API token
 */
function detectTokenType(token: string): TokenType {
  if (token.startsWith("ATATT") || token.startsWith("ATSTT")) {
    return "scoped";
  }
  return "classic";
}

export function getConfig(): ConfluenceConfig {
  const host = process.env.CONFLUENCE_HOST;
  const email = process.env.CONFLUENCE_EMAIL;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  const cloudId = process.env.CONFLUENCE_CLOUD_ID;

  const missing: string[] = [];

  if (!host) missing.push("CONFLUENCE_HOST");
  if (!email) missing.push("CONFLUENCE_EMAIL");
  if (!apiToken) missing.push("CONFLUENCE_API_TOKEN");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n\n` +
        "Please set the following environment variables:\n" +
        "  CONFLUENCE_HOST - Your Confluence instance URL (e.g., https://yourcompany.atlassian.net)\n" +
        "  CONFLUENCE_EMAIL - Your Atlassian account email\n" +
        "  CONFLUENCE_API_TOKEN - API token from https://id.atlassian.com/manage-profile/security/api-tokens\n" +
        "  CONFLUENCE_CLOUD_ID - (Optional) Cloud ID for scoped tokens, will be auto-fetched if not provided"
    );
  }

  // Normalize host URL (remove trailing slash)
  const normalizedHost = host!.replace(/\/+$/, "");

  const tokenType = detectTokenType(apiToken!);

  return {
    host: normalizedHost,
    email: email!,
    apiToken: apiToken!,
    tokenType,
    cloudId,
  };
}

/**
 * Get tool filtering configuration from environment variables
 *
 * CONFLUENCE_ENABLED_CATEGORIES: Comma-separated list of categories to enable
 * If not set, all categories are enabled
 * Example: "page,space,search"
 *
 * CONFLUENCE_DISABLED_TOOLS: Comma-separated list of specific tool names to disable
 * Example: "confluence_delete_page,confluence_delete_space"
 */
export function getToolFilterConfig(): ToolFilterConfig {
  const enabledCategoriesEnv = process.env.CONFLUENCE_ENABLED_CATEGORIES;
  const disabledToolsEnv = process.env.CONFLUENCE_DISABLED_TOOLS;

  let enabledCategories: ToolCategory[] = [];

  if (enabledCategoriesEnv) {
    const requested = enabledCategoriesEnv
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    // Validate categories
    for (const cat of requested) {
      if (ALL_CATEGORIES.includes(cat as ToolCategory)) {
        enabledCategories.push(cat as ToolCategory);
      } else {
        console.error(
          `Warning: Unknown category "${cat}" in CONFLUENCE_ENABLED_CATEGORIES`
        );
      }
    }
  }

  const disabledTools = disabledToolsEnv
    ? disabledToolsEnv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];

  return {
    enabledCategories,
    disabledTools,
  };
}

/**
 * CONFLUENCE_DISABLE_TRIM=1: bypass response trimming for all tools.
 * Useful for debugging or when downstream consumers depend on the raw
 * Confluence API shape.
 */
export function getTrimConfig(): TrimConfig {
  const raw = process.env.CONFLUENCE_DISABLE_TRIM;
  const disabled =
    raw !== undefined &&
    raw !== "" &&
    raw !== "0" &&
    raw.toLowerCase() !== "false";
  return { disabled };
}
