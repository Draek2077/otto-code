import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { BrowserHistoryStore, historyUrl } from "./history-store.js";

const parent = fileURLToPath(
  new URL("../../../../../../.tmp/browser-history-store/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, "case-"));
  roots.push(home);
  const project = "retained-0.9-project";
  const directory = path.join(home, "browser-history");
  await mkdir(directory);
  const file = path.join(directory, createHash("sha256").update(project).digest("hex") + ".json");
  return { home, project, file, store: new BrowserHistoryStore(home) };
}
const first = {
  url: "https://example.test/original",
  title: "Original title",
  visitedAt: "2026-01-01T00:00:00.000Z",
};
test("0.9 history is read in place; revisits retain a useful title and unknown stored fields", async () => {
  const f = await fixture();
  await writeFile(f.file, JSON.stringify([{ ...first, future: { retained: true } }]));
  expect(await f.store.search(f.project, "ORIGINAL TITLE")).toEqual([first]);
  await f.store.record(f.project, first.url, "");
  const stored: unknown = JSON.parse(await readFile(f.file, "utf8"));
  expect(stored).toEqual([{ ...first, visitedAt: expect.any(String), future: { retained: true } }]);
  expect(await f.store.search(f.project, "")).toEqual([
    { ...first, visitedAt: expect.any(String) },
  ]);
});
test("the store retains at most 1,000 distinct URLs and returns at most ten suggestions", async () => {
  const f = await fixture();
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    ...first,
    url: `https://example.test/page-${index}`,
    title: `Page ${index}`,
  }));
  await writeFile(f.file, JSON.stringify(entries));
  await f.store.record(f.project, "https://example.test/new", "New page");
  expect(await f.store.search(f.project, "")).toHaveLength(10);
  expect(await f.store.search(f.project, "page-999")).toEqual([]);
  await f.store.record(f.project, "https://example.test/page-1", "Renamed");
  const value: unknown = JSON.parse(await readFile(f.file, "utf8"));
  expect(value).toHaveLength(1000);
  expect((await f.store.search(f.project, ""))[0]).toMatchObject({
    url: "https://example.test/page-1",
    title: "Renamed",
  });
});
test("visits remove user information before storage and projects remain separate", async () => {
  const f = await fixture();
  await f.store.record(
    f.project,
    "https://user:private-password@example.test/path",
    "Private page",
  );
  expect(await readFile(f.file, "utf8")).not.toContain("private-password");
  expect(await f.store.search(f.project, "path")).toEqual([
    { url: "https://example.test/path", title: "Private page", visitedAt: expect.any(String) },
  ]);
  expect(await f.store.search("different-project", "")).toEqual([]);
});
test("all instances serialize visits, clears and reads against the same project file", async () => {
  const f = await fixture();
  const peer = new BrowserHistoryStore(f.home);
  const one = f.store.record(f.project, first.url, first.title);
  const two = peer.clear(f.project);
  const three = f.store.record(f.project, "https://example.test/after-clear", "After");
  await Promise.all([one, two, three]);
  expect(await peer.search(f.project, "")).toEqual([
    { url: "https://example.test/after-clear", title: "After", visitedAt: expect.any(String) },
  ]);
});
test.each(["not-json", JSON.stringify({ version: 9, entries: [first] })])(
  "invalid/newer storage is preserved on reads, visits and clear",
  async (raw) => {
    const f = await fixture();
    await writeFile(f.file, raw);
    await expect(f.store.search(f.project, "")).rejects.toThrow();
    await expect(f.store.record(f.project, first.url, "Changed")).rejects.toThrow();
    await expect(f.store.clear(f.project)).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(raw);
  },
);
test("clear changes only the owning project history, never browser cookies or other files", async () => {
  const f = await fixture();
  const marker = path.join(f.home, "Cookies.fixture");
  await writeFile(marker, "signed-in session fixture");
  await f.store.record(f.project, first.url, first.title);
  await f.store.record("other-project", first.url, "Other");
  await f.store.clear(f.project);
  expect(await f.store.search(f.project, "")).toEqual([]);
  expect(await f.store.search("other-project", "")).toEqual([
    { ...first, title: "Other", visitedAt: expect.any(String) },
  ]);
  expect(await readFile(marker, "utf8")).toBe("signed-in session fixture");
});
test.each(["file:///private", "javascript:alert(1)", "data:text/html,hi", "not a URL"])(
  "history rejects non-web address %s",
  (url) => {
    expect(() => historyUrl(url)).toThrow();
  },
);
