import { z } from "zod";
import { ConfluenceClient } from "../auth/confluence-client.js";
import { ConfluenceUser, MultiEntityResult } from "../types/confluence.js";

// Tool definitions for users

export const userTools = [
  {
    name: "confluence_get_current_user",
    description:
      "Get information about the currently authenticated user (the user associated with the API token).",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "confluence_get_user",
    description: "Get a specific user by account ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountId: {
          type: "string",
          description: "The account ID of the user",
        },
      },
      required: ["accountId"],
    },
  },
  {
    name: "confluence_get_users",
    description: "Get multiple users. Results are paginated - use the returned cursor to fetch more pages if you don't find what you need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cursor: {
          type: "string",
          description: "Cursor for pagination",
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
        },
      },
      required: [],
    },
  },
];

// Input schemas for validation
const GetUserSchema = z.object({
  accountId: z.string(),
});

const GetUsersSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().optional(),
});

// Tool handlers
//
// All user tools route through the v1 REST API
// (/wiki/rest/api/...). The v2 API does not expose user endpoints —
// hitting /wiki/api/v2/users/* returns HTTP 400 because Confluence's
// path matcher interprets `users` as a generic-content-type and
// rejects with `Provided value {users} for 'generic-content-type'`.
export async function handleUserTool(
  client: ConfluenceClient,
  toolName: string,
  args: unknown
): Promise<unknown> {
  switch (toolName) {
    case "confluence_get_current_user": {
      return client.getV1<ConfluenceUser>("/user/current");
    }

    case "confluence_get_user": {
      const input = GetUserSchema.parse(args);
      return client.getV1<ConfluenceUser>("/user", {
        accountId: input.accountId,
      });
    }

    case "confluence_get_users": {
      const input = GetUsersSchema.parse(args);
      // No plain "list all users" endpoint exists in Confluence
      // Cloud's API. The closest is `/wiki/rest/api/search/user` with
      // `cql=type=user`, which returns a search-wrapped shape:
      // `{ results: [{ user: {...}, title, score, ... }, ...] }`.
      // Unwrap to a `MultiEntityResult<ConfluenceUser>` so the
      // existing `userList` trim projector (and any caller relying on
      // the documented response shape) keeps working.
      const queryParams: Record<string, string | number | boolean | undefined> =
        { cql: "type=user" };
      if (input.cursor) queryParams["cursor"] = input.cursor;
      if (input.limit) queryParams["limit"] = input.limit;

      const search = await client.getV1<{
        results?: Array<{ user?: ConfluenceUser }>;
        _links?: { next?: string };
      }>("/search/user", queryParams);

      const users = (search.results ?? [])
        .map((r) => r.user)
        .filter((u): u is ConfluenceUser => !!u);

      return {
        results: users,
        _links: search._links,
      } satisfies MultiEntityResult<ConfluenceUser>;
    }

    default:
      throw new Error(`Unknown user tool: ${toolName}`);
  }
}
