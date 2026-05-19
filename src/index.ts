#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getConfig,
  getToolFilterConfig,
  getTrimConfig,
  ToolFilterConfig,
  TrimConfig,
} from "./config.js";
import { ConfluenceClient, ConfluenceApiError } from "./auth/confluence-client.js";
import { getFilteredTools, handleTool } from "./tools/index.js";
import { prunePageCache } from "./core/page-cache.js";
import {
  resourceDefinitions,
  resourceTemplates,
  handleResource,
} from "./resources/index.js";

// Create the MCP server using the lower-level Server class for more control
const server = new Server(
  {
    name: "ultra-confluence-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Initialize Confluence client (will be created on first use)
let confluenceClient: ConfluenceClient | null = null;

function getClient(): ConfluenceClient {
  if (!confluenceClient) {
    const config = getConfig();
    confluenceClient = new ConfluenceClient(config);
  }
  return confluenceClient;
}

// Cache tool filter and trim config at startup
const toolFilterConfig: ToolFilterConfig = getToolFilterConfig();
const trimConfig: TrimConfig = getTrimConfig();
const filteredTools = getFilteredTools(toolFilterConfig);

if (trimConfig.disabled) {
  console.error("Response trimming disabled (CONFLUENCE_DISABLE_TRIM)");
}

// Log filtering info if any filtering is active
if (toolFilterConfig.enabledCategories.length > 0) {
  console.error(
    `Tool categories enabled: ${toolFilterConfig.enabledCategories.join(", ")}`
  );
}
if (toolFilterConfig.disabledTools.length > 0) {
  console.error(
    `Tools disabled: ${toolFilterConfig.disabledTools.join(", ")}`
  );
}
if (filteredTools.length < 50) {
  // Only log if significantly filtered
  console.error(`Total tools available: ${filteredTools.length}`);
}

// Register tools list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: filteredTools };
});

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const client = getClient();
    const result = await handleTool(
      client,
      name,
      args || {},
      toolFilterConfig,
      trimConfig
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof ConfluenceApiError) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: error.message,
                statusCode: error.statusCode,
                details: error.response,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Unknown error occurred" }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Register resources list handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: resourceDefinitions };
});

// Register resource templates list handler
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return { resourceTemplates };
});

// Register resource read handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    const client = getClient();
    return await handleResource(client, uri);
  } catch (error) {
    if (error instanceof ConfluenceApiError) {
      throw new Error(
        `Confluence API error (${error.statusCode}): ${error.message}`
      );
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Confluence MCP server running on stdio");

  // Best-effort prune of stale on-disk page cache entries. Fire-and-
  // forget so a cold cache with thousands of entries can't delay the
  // MCP transport from accepting traffic. Errors are logged inside
  // prunePageCache.
  void prunePageCache().catch((err) => {
    console.error("[ultra-confluence-mcp] prunePageCache rejected:", err);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
