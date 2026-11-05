import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EditorSearches } from "./search.js";
import { EditorRenames } from "./rename.js";
import { SearchMatcher } from "./search-matcher.js";
const options = {
  query: "café",
  caseSensitive: false,
  wholeWord: true,
  regexp: false,
  include: "*.ts",
  exclude: "skip*",
};
it("searches bounded UTF-8 sources, reviews replacement, preserves dirty peers and BOM/CRLF, and safely undoes only its own changes", async () => {
  const base = path.resolve("../../.tmp/editor-search-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "search-"));
  const file = path.join(root, "example.ts"),
    original = "\uFEFFconst café = 'café';\r\n";
  const searches = new EditorSearches();
  let dirty = false;
  const edits = new EditorRenames(() => (dirty ? ["unsaved peer"] : []));
  try {
    await writeFile(file, original);
    await writeFile(path.join(root, "skip.ts"), "café");
    await writeFile(path.join(root, "binary.ts"), Buffer.from([0, 1, 2]));
    const found = await searches.search("client", root, options, () => true);
    expect(found.matches.map((match) => [match.line, match.column, match.length])).toEqual([
      [1, 7, 4],
      [1, 15, 4],
    ]);
    dirty = true;
    await expect(
      searches.plan("client", found.searchId, [file], "fresh", edits, () => true),
    ).rejects.toThrow("draft changed");
    dirty = false;
    await expect(
      searches.plan("peer", found.searchId, [file], "fresh", edits, () => true),
    ).rejects.toThrow("expired");
    const plan = await searches.plan("client", found.searchId, [file], "$&", edits, () => true);
    expect(plan.files[0].after).toBe("\uFEFFconst $& = '$&';\r\n");
    expect(await readFile(file, "utf8")).toBe(original);
    const run = await edits.apply("client", plan.planId);
    expect(run.files[0].state).toBe("applied");
    expect((await edits.undo("client", run.runId)).files[0].state).toBe("restored");
    const stale = await searches.search("client", root, options, () => true);
    await writeFile(file, original + "peer change\r\n");
    await expect(
      searches.plan("client", stale.searchId, [file], "fresh", edits, () => true),
    ).rejects.toThrow("changed");
  } finally {
    await edits.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects malformed regex and terminates pathological regex without blocking the daemon event loop", async () => {
  const matcher = new SearchMatcher();
  try {
    await expect(matcher.match("text", { ...options, regexp: true, query: "[" })).rejects.toThrow();
    const timer = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10));
    const slow = matcher.match("a".repeat(1000) + "!", {
      ...options,
      regexp: true,
      wholeWord: false,
      query: "(a+)+$",
    });
    expect(await timer).toBe(true);
    await expect(slow).rejects.toThrow("time limit");
  } finally {
    await matcher.close();
  }
});
