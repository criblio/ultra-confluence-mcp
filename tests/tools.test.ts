import { describe, it, expect, beforeEach, vi } from "vitest";
import { getFilteredTools, isToolEnabled, allTools } from "../src/tools/index.js";
import { ToolFilterConfig } from "../src/config.js";
import { getTrimKind } from "../src/core/trim-registry.js";

describe("tools", () => {
  describe("allTools", () => {
    it("should contain tools from all categories", () => {
      // Check for page tools
      expect(allTools.some((t) => t.name === "confluence_get_page")).toBe(true);
      expect(allTools.some((t) => t.name === "confluence_create_page")).toBe(true);

      // Check for space tools
      expect(allTools.some((t) => t.name === "confluence_get_spaces")).toBe(true);

      // Check for search tools
      expect(allTools.some((t) => t.name === "confluence_cql_search")).toBe(true);
      expect(allTools.some((t) => t.name === "confluence_search_generic_content")).toBe(true);

      // Check for user tools
      expect(allTools.some((t) => t.name === "confluence_get_current_user")).toBe(true);

      // Check for blog post tools
      expect(allTools.some((t) => t.name === "confluence_get_blog_posts")).toBe(true);

      // Check for comment tools
      expect(allTools.some((t) => t.name === "confluence_get_page_footer_comments")).toBe(true);

      // Check for label tools
      expect(allTools.some((t) => t.name === "confluence_get_page_labels")).toBe(true);
    });

    it("should have unique tool names", () => {
      const names = allTools.map((t) => t.name);
      const uniqueNames = [...new Set(names)];
      expect(names.length).toBe(uniqueNames.length);
    });

    it("should have descriptions for all tools", () => {
      for (const tool of allTools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
      }
    });

    it("should have input schemas for all tools", () => {
      for (const tool of allTools) {
        expect(tool.inputSchema).toBeTruthy();
        expect(typeof tool.inputSchema).toBe("object");
      }
    });

    it("exposes a `full` arg on every trimmed tool's inputSchema", () => {
      for (const tool of allTools) {
        const kind = getTrimKind(tool.name);
        if (kind === "passthrough") continue;
        const schema = tool.inputSchema as {
          properties?: Record<string, unknown>;
        };
        expect(
          schema.properties?.full,
          `expected ${tool.name} to expose a 'full' arg`
        ).toBeDefined();
      }
    });

    it("does not require `full` on any tool", () => {
      for (const tool of allTools) {
        const schema = tool.inputSchema as { required?: string[] };
        expect(schema.required ?? []).not.toContain("full");
      }
    });
  });

  describe("getFilteredTools", () => {
    it("should return all tools when no filtering is configured", () => {
      const config: ToolFilterConfig = {
        enabledCategories: [],
        disabledTools: [],
      };

      const filtered = getFilteredTools(config);

      expect(filtered.length).toBe(allTools.length);
    });

    it("should filter by enabled categories", () => {
      const config: ToolFilterConfig = {
        enabledCategories: ["page"],
        disabledTools: [],
      };

      const filtered = getFilteredTools(config);

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThan(allTools.length);

      // All filtered tools should be page tools
      for (const tool of filtered) {
        expect(tool.name).toMatch(/^confluence_.*page/);
      }
    });

    it("should filter out disabled tools", () => {
      const config: ToolFilterConfig = {
        enabledCategories: [],
        disabledTools: ["confluence_delete_page"],
      };

      const filtered = getFilteredTools(config);

      expect(filtered.some((t) => t.name === "confluence_delete_page")).toBe(false);
      expect(filtered.some((t) => t.name === "confluence_get_page")).toBe(true);
    });

    it("should combine category and tool filtering", () => {
      const config: ToolFilterConfig = {
        enabledCategories: ["page"],
        disabledTools: ["confluence_delete_page"],
      };

      const filtered = getFilteredTools(config);

      // Should not include delete_page
      expect(filtered.some((t) => t.name === "confluence_delete_page")).toBe(false);

      // Should not include space tools
      expect(filtered.some((t) => t.name === "confluence_get_spaces")).toBe(false);

      // Should include other page tools
      expect(filtered.some((t) => t.name === "confluence_get_page")).toBe(true);
    });
  });

  describe("isToolEnabled", () => {
    it("should return true when no filtering is configured", () => {
      const config: ToolFilterConfig = {
        enabledCategories: [],
        disabledTools: [],
      };

      expect(isToolEnabled("confluence_get_page", config)).toBe(true);
      expect(isToolEnabled("confluence_get_spaces", config)).toBe(true);
    });

    it("should return false for disabled tools", () => {
      const config: ToolFilterConfig = {
        enabledCategories: [],
        disabledTools: ["confluence_delete_page"],
      };

      expect(isToolEnabled("confluence_delete_page", config)).toBe(false);
      expect(isToolEnabled("confluence_get_page", config)).toBe(true);
    });

    it("should return false for tools outside enabled categories", () => {
      const config: ToolFilterConfig = {
        enabledCategories: ["page"],
        disabledTools: [],
      };

      expect(isToolEnabled("confluence_get_page", config)).toBe(true);
      expect(isToolEnabled("confluence_get_spaces", config)).toBe(false);
    });
  });
});
