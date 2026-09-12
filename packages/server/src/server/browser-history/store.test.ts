import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserHistoryStore } from "./store.js";

let home: string;
beforeEach(async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  home = await mkdtemp(path.join(scratch, "browser-history-test-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("project browser history", () => {
  it("persists visits by project, deduplicates URLs, strips user-info and searches titles", async () => {
    const store = new BrowserHistoryStore(home);
    await store.record("project-a", "https://example.com/old", "Older visit");
    await store.record("project-b", "https://private.example/", "Other project");
    await store.record("project-a", "https://user:password@example.com/docs", "Documentation");
    await store.record("project-a", "https://example.com/docs", "Updated guide");
    const restored = new BrowserHistoryStore(home);
    expect((await restored.search("project-a", "")).map(({ url }) => url)).toEqual([
      "https://example.com/docs",
      "https://example.com/old",
    ]);
    expect((await restored.search("project-a", "GUIDE")).map(({ title }) => title)).toEqual([
      "Updated guide",
    ]);
    expect(await restored.search("project-a", "private")).toEqual([]);
    await expect(store.record("project-a", "file:///secret", "File")).rejects.toThrow(
      "Unsupported browser URL",
    );
  });

  it("serializes visits and clear across sessions without reviving cleared entries", async () => {
    const first = new BrowserHistoryStore(home);
    const second = new BrowserHistoryStore(home);
    await Promise.all([
      first.record("a", "https://example.com/1", "one"),
      second.record("a", "https://example.com/2", "two"),
    ]);
    expect((await first.search("a", "")).map(({ title }) => title)).toEqual(["two", "one"]);
    const pending = first.record("a", "https://example.com/3", "three");
    const clear = second.clear("a");
    await Promise.all([pending, clear]);
    expect(await first.search("a", "")).toEqual([]);
    await first.record("a", "https://example.com/4", "four");
    expect((await second.search("a", "")).map(({ title }) => title)).toEqual(["four"]);
  });
});
