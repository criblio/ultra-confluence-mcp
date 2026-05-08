#!/usr/bin/env node
// confluence-cli — shell client for Confluence. Parses argv into a flat
// args bag, dispatches one tool call, prints the trimmed summary as
// JSON, and writes the full untrimmed response to a temp file followed
// by a `ref: /path` line on stdout so the caller can `cat` it for
// detail.
//
// Direct mode only — reads CONFLUENCE_HOST / CONFLUENCE_EMAIL /
// CONFLUENCE_API_TOKEN from env (or .env.local), builds a
// ConfluenceClient in-process, and dispatches through the same
// handleToolWithRaw pipeline the MCP server uses. No server required.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import {
  getConfig,
  getToolFilterConfig,
  getTrimConfig,
} from "../config.js";
import {
  ConfluenceClient,
  ConfluenceApiError,
} from "../auth/confluence-client.js";
import {
  allTools,
  getFilteredTools,
  handleToolWithRaw,
  toolCategories,
} from "../tools/index.js";
import { installSkill, SKILL_CONTENT } from "./install-skill.js";

// --- Schema types (subset of JSON Schema we render and coerce) -------

interface JsonSchemaProperty {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  items?: JsonSchemaProperty;
}

interface JsonObjectSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

// --- Argv parsing ----------------------------------------------------

interface ParsedArgv {
  command: string;
  flags: Record<string, string | string[]>;
  help: boolean;
}

const BOOLEAN_FLAG_NAMES = new Set(["force", "print"]);

async function parseArgv(argv: readonly string[]): Promise<ParsedArgv> {
  const out: ParsedArgv = { command: "", flags: {}, help: false };
  let positional: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      if (positional === null) positional = a;
      else throw new Error(`Unexpected positional argument: ${a}`);
      continue;
    }
    const eq = a.indexOf("=");
    let key: string;
    let value: string;
    if (eq >= 0) {
      key = a.slice(2, eq);
      value = a.slice(eq + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      const lookahead = next === undefined || next.startsWith("--");
      if (lookahead && BOOLEAN_FLAG_NAMES.has(key)) {
        value = "";
      } else if (lookahead) {
        throw new Error(
          `Flag --${key} expects a value (use --${key}=value or --${key} value).`
        );
      } else {
        value = next;
        i++;
      }
    }
    if (!key) throw new Error(`Empty flag name in argument: ${a}`);
    const resolved = await resolveValue(value);
    const existing = out.flags[key];
    if (existing === undefined) {
      out.flags[key] = resolved;
    } else if (Array.isArray(existing)) {
      existing.push(resolved);
    } else {
      out.flags[key] = [existing, resolved];
    }
  }

  out.command = positional ?? "";
  return out;
}

async function resolveValue(value: string): Promise<string> {
  if (value === "-") {
    return readStdin();
  }
  if (value.startsWith("@")) {
    return fs.readFile(value.slice(1), "utf8");
  }
  return value;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

// --- Schema-driven coercion ------------------------------------------

// CLI flags arrive as strings (or arrays of strings for repeated
// flags). The tool layer expects properly-typed JSON values, so coerce
// per the inputSchema before dispatch. Unknown types pass through
// unchanged.
function coerceArgs(
  rawFlags: Record<string, string | string[]>,
  schema: JsonObjectSchema
): Record<string, unknown> {
  const props = schema.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawFlags)) {
    const prop = props[key];
    out[key] = coerceValue(value, prop);
  }
  return out;
}

function coerceValue(
  value: string | string[],
  prop: JsonSchemaProperty | undefined
): unknown {
  // No schema info: pass through. The handler will reject if needed.
  if (!prop) return value;

  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;

  if (type === "array") {
    const arr = Array.isArray(value) ? value : splitCommaList(value);
    return arr.map((v) => coerceScalar(v, prop.items));
  }

  // Repeated flag for a non-array param — take the last occurrence.
  // Repeated --pageId is most likely a typo, but silently honoring the
  // last value keeps shells consistent (later flags override).
  const scalar = Array.isArray(value) ? value[value.length - 1] : value;
  return coerceScalar(scalar, prop);
}

function coerceScalar(value: string, prop: JsonSchemaProperty | undefined): unknown {
  if (!prop) return value;
  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  switch (type) {
    case "number":
    case "integer": {
      if (value === "") return value;
      const n = Number(value);
      // Don't second-guess the user — if it's not a number, pass the
      // string through and let the API surface a clear error.
      return Number.isFinite(n) ? n : value;
    }
    case "boolean": {
      if (value === "" || value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return value;
    }
    default:
      return value;
  }
}

function splitCommaList(value: string): string[] {
  // Empty string → empty array (vs [""]); a bare --foo= shouldn't add
  // a phantom element.
  if (value === "") return [];
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

// --- Help ------------------------------------------------------------

function topLevelHelp(tools: ToolDef[]): string {
  const byCategory = new Map<string, ToolDef[]>();
  for (const t of tools) {
    // Use the same category classification the MCP server uses
    // (page, space, blogPost, …) so the help listing matches the
    // CONFLUENCE_ENABLED_CATEGORIES env var values exactly.
    const cat = toolCategories[t.name] ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(t);
    byCategory.set(cat, list);
  }
  const lines: string[] = [
    "confluence-cli — call Confluence tools from a shell.",
    "",
    "Reads CONFLUENCE_HOST / CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN from",
    "env (or .env.local), builds a ConfluenceClient in-process, and calls",
    "Confluence directly. No MCP server required.",
    "",
    "Usage:",
    "  confluence-cli <tool> [--flag=value ...]",
    "  confluence-cli <tool> --help     show args for one tool",
    "  confluence-cli --help            show this listing",
    "  confluence-cli install-skill     install a Claude Code skill so",
    "                                   agents discover this CLI",
    "",
    "Flag forms:",
    "  --key=value         --key value         --key=@/path/to/file",
    "  --key=-             read value from stdin",
    "  --key=a --key=b     repeat to build an array (also: --key=a,b)",
    "  --full=true         bypass response trimming (raw Confluence shape)",
    "",
    "On success: trimmed summary on stdout (JSON), full-response path on",
    "the final line as: ref: /tmp/.../...json",
    "",
    "Tools:",
  ];
  const cats = Array.from(byCategory.keys()).sort();
  for (const cat of cats) {
    lines.push(`  ${cat}`);
    for (const t of byCategory.get(cat)!) {
      const desc = firstSentence(t.description);
      lines.push(`    ${t.name.padEnd(46)} ${desc}`);
    }
  }
  return lines.join("\n");
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.\n]{0,140}\./);
  return m ? m[0] : s.slice(0, 140);
}

function toolHelp(tool: ToolDef): string {
  const schema = (tool.inputSchema as JsonObjectSchema) ?? {};
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const lines: string[] = [
    `${tool.name} — ${tool.description}`,
    "",
    "Parameters:",
  ];
  const names = Object.keys(props);
  if (names.length === 0) {
    lines.push("  (none)");
  } else {
    for (const name of names) {
      const p = props[name];
      const type = Array.isArray(p.type) ? p.type.join("|") : p.type ?? "any";
      const req = required.has(name) ? "required" : "optional";
      const enumPart = p.enum ? ` (one of: ${p.enum.join(", ")})` : "";
      const desc = p.description ? ` — ${p.description}` : "";
      lines.push(
        `  --${name.padEnd(28)} ${String(type).padEnd(8)} ${req}${enumPart}${desc}`
      );
    }
  }
  return lines.join("\n");
}

// --- Ref-file persistence --------------------------------------------

// Where to drop the full response so the agent can `cat` it later.
// $CONFLUENCE_CLI_REF_DIR overrides for tests; default lives under
// the OS tempdir to avoid polluting the cwd.
function refDir(): string {
  const override = process.env.CONFLUENCE_CLI_REF_DIR;
  if (override) return override;
  return path.join(os.tmpdir(), "confluence-cli", "refs");
}

async function writeRef(toolName: string, raw: unknown): Promise<string> {
  const dir = refDir();
  await fs.mkdir(dir, { recursive: true });
  // Random suffix avoids collisions when the same tool is called many
  // times in one second (timestamp alone isn't unique enough).
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  const file = path.join(dir, `${toolName}-${ts}-${rand}.json`);
  const body = JSON.stringify(raw, null, 2);
  await fs.writeFile(file, body, "utf8");
  return file;
}

// --- Meta commands ---------------------------------------------------

async function runInstallSkill(parsed: ParsedArgv): Promise<number> {
  if (parsed.help) {
    process.stdout.write(
      [
        "confluence-cli install-skill — install a Claude Code skill",
        "that teaches the agent how to call this CLI.",
        "",
        "Writes ~/.claude/skills/confluence/SKILL.md. Once installed,",
        "the skill loads on demand whenever the user mentions Confluence.",
        "",
        "Flags:",
        "  --force    overwrite an existing SKILL.md",
        "  --print    print the rendered SKILL.md to stdout (no write)",
        "",
      ].join("\n")
    );
    return 0;
  }

  const known = new Set(["force", "print"]);
  const unknown = Object.keys(parsed.flags).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    process.stderr.write(
      `confluence-cli: unknown flag(s) for install-skill: ${unknown.join(", ")}.\n`
    );
    return 2;
  }

  const force = "force" in parsed.flags;
  const print = "print" in parsed.flags;

  if (print) {
    process.stdout.write(SKILL_CONTENT);
    return 0;
  }

  const result = await installSkill({ force });
  switch (result.action) {
    case "wrote":
      process.stdout.write(`Wrote ${result.path}\n`);
      return 0;
    case "overwrote":
      process.stdout.write(`Overwrote ${result.path}\n`);
      return 0;
    case "exists":
      process.stderr.write(
        `${result.path} already exists. Use --force to overwrite, or --print to dump the new content to stdout.\n`
      );
      return 1;
    case "printed":
      return 0;
  }
}

// --- Main ------------------------------------------------------------

async function main(): Promise<number> {
  let parsed: ParsedArgv;
  try {
    parsed = await parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`confluence-cli: ${(err as Error).message}\n`);
    return 2;
  }

  // Apply the same category/disabled filter the MCP server uses, so a
  // tool disabled by env is not callable here either.
  const filterConfig = getToolFilterConfig();
  const filteredTools = getFilteredTools(filterConfig) as ToolDef[];

  if (parsed.command === "" && parsed.help) {
    process.stdout.write(`${topLevelHelp(filteredTools)}\n`);
    return 0;
  }
  if (parsed.command === "") {
    process.stderr.write(
      "confluence-cli: missing tool. Try `confluence-cli --help`.\n"
    );
    return 2;
  }

  if (parsed.command === "install-skill") {
    return runInstallSkill(parsed);
  }

  // Look up against unfiltered tools first to give a clearer "disabled"
  // vs "unknown" error.
  const tool = (allTools as ToolDef[]).find((t) => t.name === parsed.command);
  if (!tool) {
    process.stderr.write(
      `confluence-cli: unknown tool "${parsed.command}". Try \`confluence-cli --help\`.\n`
    );
    return 2;
  }

  const isEnabled = filteredTools.some((t) => t.name === tool.name);
  if (!isEnabled) {
    process.stderr.write(
      `confluence-cli: tool "${tool.name}" is disabled by CONFLUENCE_ENABLED_CATEGORIES / CONFLUENCE_DISABLED_TOOLS.\n`
    );
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(`${toolHelp(tool)}\n`);
    return 0;
  }

  const schema = (tool.inputSchema as JsonObjectSchema) ?? {};
  const knownFlagNames = new Set([
    ...Object.keys(schema.properties ?? {}),
    "full",
  ]);
  const unknownFlags = Object.keys(parsed.flags).filter(
    (k) => !knownFlagNames.has(k)
  );
  if (unknownFlags.length > 0) {
    process.stderr.write(
      `confluence-cli: unknown flag(s) for ${tool.name}: ${unknownFlags.join(", ")}. ` +
        `Try \`confluence-cli ${tool.name} --help\`.\n`
    );
    return 2;
  }

  // Coerce every known flag against its schema; pass `full` through
  // separately because it isn't declared in the per-tool schema.
  const { full: rawFull, ...inputFlags } = parsed.flags;
  const args = coerceArgs(inputFlags, schema);
  if (rawFull !== undefined) {
    const fullScalar = Array.isArray(rawFull) ? rawFull[rawFull.length - 1] : rawFull;
    args.full = coerceScalar(fullScalar, { type: "boolean" });
  }

  let client: ConfluenceClient;
  try {
    const config = getConfig();
    client = new ConfluenceClient(config);
  } catch (err) {
    process.stderr.write(`confluence-cli: ${(err as Error).message}\n`);
    return 1;
  }

  const trimConfig = getTrimConfig();
  let result: unknown;
  let raw: unknown;
  let full: boolean;
  try {
    ({ result, raw, full } = await handleToolWithRaw(
      client,
      tool.name,
      args,
      filterConfig,
      trimConfig
    ));
  } catch (err) {
    if (err instanceof ConfluenceApiError) {
      process.stderr.write(
        `confluence-cli: ConfluenceApiError (${err.statusCode}): ${err.message}\n`
      );
      return 1;
    }
    process.stderr.write(
      `confluence-cli: ${(err as Error).name}: ${(err as Error).message}\n`
    );
    return 1;
  }

  // Print summary, then a single trailing `ref:` line. When --full is
  // set the result is already the raw response, so don't write a
  // duplicate ref file — emitting the raw twice would just bloat the
  // agent's context for no gain.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!full) {
    try {
      const refPath = await writeRef(tool.name, raw);
      process.stdout.write(`ref: ${refPath}\n`);
    } catch (err) {
      process.stderr.write(
        `confluence-cli: failed to write ref file: ${(err as Error).message}\n`
      );
      // Don't fail the whole call — the summary already printed and
      // is the primary output. Ref is best-effort.
    }
  }
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `confluence-cli: unexpected error: ${(err as Error).stack ?? err}\n`
    );
    process.exit(1);
  }
);
