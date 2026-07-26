import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteRange, fixFindings } from "./finding-fix.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "otto-finding-fix-")));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("deleteRange", () => {
  it("drops a whole bullet line when the token is all it holds", () => {
    const text = "Rules.\n\n- @docs/gone.md\n- keep me\n";
    const start = text.indexOf("@docs/gone.md");
    const end = start + "@docs/gone.md".length;
    expect(deleteRange(text, { start, end })).toBe("Rules.\n\n- keep me\n");
  });

  it("removes only the token from inline prose and collapses the seam", () => {
    const text = "See @docs/gone.md for detail.\n";
    const start = text.indexOf("@docs/gone.md");
    const end = start + "@docs/gone.md".length;
    expect(deleteRange(text, { start, end })).toBe("See for detail.\n");
  });

  it("drops a whole duplicated block and collapses the resulting blank run", () => {
    const text = "Block A.\n\nBlock B, repeated.\n\nBlock C.\n";
    const start = text.indexOf("Block B, repeated.\n") - 0;
    const end = start + "Block B, repeated.".length;
    expect(deleteRange(text, { start, end })).toBe("Block A.\n\nBlock C.\n");
  });
});

describe("fixFindings", () => {
  it("deletes a fixable finding's range and writes the file", async () => {
    const filePath = path.join(tempRoot, "CLAUDE.md");
    const original = "Rules.\n\n- @docs/gone.md\n- keep me\n";
    await fs.writeFile(filePath, original, "utf8");
    const snippet = "@docs/gone.md";
    const start = original.indexOf(snippet);

    const result = await fixFindings([
      { filePath, range: { start, end: start + snippet.length }, snippet },
    ]);

    expect(result).toEqual({ fixedCount: 1, failedCount: 0, errors: [] });
    expect(await fs.readFile(filePath, "utf8")).toBe("Rules.\n\n- keep me\n");
  });

  it("applies several findings in one file back-to-front without offset drift", async () => {
    const filePath = path.join(tempRoot, "CLAUDE.md");
    const original = "- @docs/a.md\n- @docs/b.md\n- keep me\n";
    await fs.writeFile(filePath, original, "utf8");
    const snippetA = "@docs/a.md";
    const snippetB = "@docs/b.md";
    const aStart = original.indexOf(snippetA);
    const bStart = original.indexOf(snippetB);

    const result = await fixFindings([
      { filePath, range: { start: aStart, end: aStart + snippetA.length }, snippet: snippetA },
      { filePath, range: { start: bStart, end: bStart + snippetB.length }, snippet: snippetB },
    ]);

    expect(result).toEqual({ fixedCount: 2, failedCount: 0, errors: [] });
    expect(await fs.readFile(filePath, "utf8")).toBe("- keep me\n");
  });

  it("skips a finding whose snippet no longer matches, without touching the rest of the file", async () => {
    const filePath = path.join(tempRoot, "CLAUDE.md");
    await fs.writeFile(filePath, "- @docs/changed.md\n- keep me\n", "utf8");

    const result = await fixFindings([
      { filePath, range: { start: 2, end: 17 }, snippet: "@docs/gone.md" },
    ]);

    expect(result.fixedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(await fs.readFile(filePath, "utf8")).toBe("- @docs/changed.md\n- keep me\n");
  });

  it("reports a readable error for a missing file instead of throwing", async () => {
    const result = await fixFindings([
      {
        filePath: path.join(tempRoot, "nope.md"),
        range: { start: 0, end: 5 },
        snippet: "hello",
      },
    ]);

    expect(result.fixedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
