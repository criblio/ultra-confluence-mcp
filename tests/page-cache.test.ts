import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  BodyCacheTooLargeError,
  prunePageCache,
  readPageBody,
  writePageBody,
  getCacheRoot,
} from "../src/core/page-cache.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "confluence-mcp-cache-"));
  process.env.CONFLUENCE_BODY_CACHE_DIR = tmpRoot;
});

afterEach(async () => {
  delete process.env.CONFLUENCE_BODY_CACHE_DIR;
  delete process.env.CONFLUENCE_BODY_CACHE_TTL_DAYS;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("getCacheRoot", () => {
  it("uses CONFLUENCE_BODY_CACHE_DIR when set", () => {
    expect(getCacheRoot()).toBe(resolve(tmpRoot));
  });

  it("falls back to os.tmpdir()/confluence-mcp when unset", () => {
    delete process.env.CONFLUENCE_BODY_CACHE_DIR;
    expect(getCacheRoot()).toBe(join(tmpdir(), "confluence-mcp"));
  });
});

describe("writePageBody / readPageBody", () => {
  it("writes a {value, representation} pair and round-trips it via readPageBody", async () => {
    const path = await writePageBody("pages", 12345, 7, {
      value: "<p>hello</p>",
      representation: "storage",
    });
    expect(path.startsWith(tmpRoot + sep)).toBe(true);
    expect(path.endsWith(`pages${sep}12345-v7.json`)).toBe(true);

    const round = await readPageBody(path);
    expect(round).toEqual({
      value: "<p>hello</p>",
      representation: "storage",
    });
  });

  it("places blogposts and comments in their own subdirectories", async () => {
    await writePageBody("pages", 1, 1, {
      value: "p",
      representation: "storage",
    });
    await writePageBody("blogposts", 2, 1, {
      value: "b",
      representation: "storage",
    });
    await writePageBody("comments", 3, 1, {
      value: "c",
      representation: "storage",
    });

    const kinds = (await readdir(tmpRoot)).sort();
    expect(kinds).toEqual(["blogposts", "comments", "pages"]);
  });

  it("uses version-suffixed filenames so updates create new files", async () => {
    const v7 = await writePageBody("pages", 12345, 7, {
      value: "old",
      representation: "storage",
    });
    const v8 = await writePageBody("pages", 12345, 8, {
      value: "new",
      representation: "storage",
    });
    expect(v7).not.toBe(v8);
    expect(await readPageBody(v7)).toEqual({
      value: "old",
      representation: "storage",
    });
    expect(await readPageBody(v8)).toEqual({
      value: "new",
      representation: "storage",
    });
  });

  it("write is idempotent for the same id+version (overwrites in place)", async () => {
    const first = await writePageBody("pages", 1, 1, {
      value: "a",
      representation: "storage",
    });
    const second = await writePageBody("pages", 1, 1, {
      value: "b",
      representation: "storage",
    });
    expect(first).toBe(second);
    expect(await readPageBody(first)).toEqual({
      value: "b",
      representation: "storage",
    });
  });

  it("sanitizes id components that contain path separators", async () => {
    const path = await writePageBody("pages", "../etc/passwd", 1, {
      value: "x",
      representation: "storage",
    });
    expect(path.startsWith(tmpRoot + sep)).toBe(true);
    expect(path.includes("..")).toBe(false);
  });

  it("readPageBody rejects paths outside the cache root", async () => {
    const outside = join(tmpdir(), "not-the-cache.json");
    await writeFile(
      outside,
      JSON.stringify({ value: "x", representation: "storage" }),
      "utf-8"
    );
    try {
      await expect(readPageBody(outside)).rejects.toThrow(
        /outside the cache root/
      );
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("readPageBody rejects relative paths", async () => {
    await expect(readPageBody("pages/1-v1.json")).rejects.toThrow(
      /must be absolute/
    );
  });

  it("readPageBody rejects malformed JSON", async () => {
    const dir = join(tmpRoot, "pages");
    const path = join(dir, "junk-v1.json");
    await writePageBody("pages", "junk", 1, {
      value: "x",
      representation: "storage",
    });
    await writeFile(path, "{not json", "utf-8");
    await expect(readPageBody(path)).rejects.toThrow(/valid JSON/);
  });

  it("readPageBody rejects files that aren't a {value,representation} pair", async () => {
    const path = await writePageBody("pages", 99, 1, {
      value: "ok",
      representation: "storage",
    });
    await writeFile(path, JSON.stringify({ foo: "bar" }), "utf-8");
    await expect(readPageBody(path)).rejects.toThrow(
      /value, representation/
    );
  });
});

describe("readPageBody — cross-platform path containment", () => {
  it("accepts a legitimate path (relative-based check, not string-prefix)", async () => {
    // Regression: the previous string-prefix check `startsWith(root + "/")`
    // failed for every legitimate Windows path because the separator was
    // hardcoded as `/`. Now uses `path.relative(root, path)`.
    const path = await writePageBody("pages", 1234, 1, {
      value: "ok",
      representation: "storage",
    });
    await expect(readPageBody(path)).resolves.toBeDefined();
  });

  it("rejects a path that shares a string prefix but is outside the cache root", async () => {
    // E.g. cache root `/tmp/cache`, attacker passes `/tmp/cache-but-elsewhere`.
    // Naive `startsWith(root)` would accept this; `relative` correctly rejects.
    const sibling = `${tmpRoot}-sibling/x.json`;
    await expect(readPageBody(sibling)).rejects.toThrow(
      /outside the cache root/
    );
  });
});

describe("writePageBody — atomic write", () => {
  it("does not leave .tmp files behind on success", async () => {
    const path = await writePageBody("pages", 9999, 1, {
      value: "x",
      representation: "storage",
    });
    const dir = join(tmpRoot, "pages");
    const entries = await readdir(dir);
    expect(entries).toContain("9999-v1.json");
    // No leftover .tmp.* files after a successful write.
    expect(entries.every((e) => !e.includes(".tmp"))).toBe(true);
    expect(path.endsWith("9999-v1.json")).toBe(true);
  });

  it("survives concurrent writers for the same id+version (last writer wins, no torn JSON)", async () => {
    // Run 8 parallel writes with distinct payloads. Whichever wins the
    // rename race, the resulting file must always parse cleanly.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writePageBody("pages", 5555, 1, {
          value: `payload-${i}`,
          representation: "storage",
        })
      )
    );
    const path = join(tmpRoot, "pages", "5555-v1.json");
    const round = await readPageBody(path);
    expect(round.representation).toBe("storage");
    expect(round.value).toMatch(/^payload-\d$/);
  });
});

describe("writePageBody — size cap", () => {
  it("rejects bodies above CONFLUENCE_BODY_CACHE_MAX_BYTES with BodyCacheTooLargeError", async () => {
    process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES = "100";
    try {
      const big = "x".repeat(500);
      let caught: unknown;
      try {
        await writePageBody("pages", 7777, 1, {
          value: big,
          representation: "storage",
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BodyCacheTooLargeError);
      expect((caught as BodyCacheTooLargeError).max).toBe(100);
    } finally {
      delete process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES;
    }
  });

  it("counts bytes (not UTF-16 code units) so multibyte content can't sneak past the cap", async () => {
    // Each emoji is 2 UTF-16 code units (so `String#length` undercounts)
    // but 4 UTF-8 bytes on disk. With a 200-byte cap, ~40 emoji = 160 raw
    // bytes plus the {value,representation} JSON envelope (~50 bytes)
    // sits right around the limit. Use 100 emoji to comfortably exceed
    // the byte cap while staying under any naive code-unit count.
    process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES = "200";
    try {
      const emoji = "\u{1F600}".repeat(100);
      let caught: unknown;
      try {
        await writePageBody("pages", 7779, 1, {
          value: emoji,
          representation: "storage",
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BodyCacheTooLargeError);
      // The reported size should reflect actual UTF-8 bytes (~400),
      // not UTF-16 code units (~200).
      expect((caught as BodyCacheTooLargeError).bytes).toBeGreaterThan(300);
    } finally {
      delete process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES;
    }
  });

  it("does not cap below the configured threshold", async () => {
    process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES = "10000";
    try {
      const small = "x".repeat(200);
      const path = await writePageBody("pages", 7778, 1, {
        value: small,
        representation: "storage",
      });
      expect(path).toBeDefined();
    } finally {
      delete process.env.CONFLUENCE_BODY_CACHE_MAX_BYTES;
    }
  });
});

describe("getCacheRoot — fallback is resolved", () => {
  it("returns an absolute (resolved) path even when CONFLUENCE_BODY_CACHE_DIR is unset", () => {
    delete process.env.CONFLUENCE_BODY_CACHE_DIR;
    const root = getCacheRoot();
    expect(root).toBe(resolve(root));
  });
});

describe("prunePageCache", () => {
  it("removes files older than the TTL", async () => {
    const path = await writePageBody("pages", 1, 1, {
      value: "old",
      representation: "storage",
    });
    // Backdate the file 30 days.
    const past = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { utimes } = await import("node:fs/promises");
    await utimes(path, past / 1000, past / 1000);

    process.env.CONFLUENCE_BODY_CACHE_TTL_DAYS = "7";
    await prunePageCache();
    await expect(stat(path)).rejects.toThrow();
  });

  it("keeps files newer than the TTL", async () => {
    const path = await writePageBody("pages", 2, 1, {
      value: "new",
      representation: "storage",
    });
    process.env.CONFLUENCE_BODY_CACHE_TTL_DAYS = "7";
    await prunePageCache();
    await expect(stat(path)).resolves.toBeDefined();
  });

  it("is a no-op when the cache root does not exist", async () => {
    process.env.CONFLUENCE_BODY_CACHE_DIR = join(tmpRoot, "nonexistent");
    await expect(prunePageCache()).resolves.toBeUndefined();
  });
});
