import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readPiSearchHistory } from "./search-history.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function history(entries: unknown[]) {
  const directory = await mkdtemp(join(tmpdir(), "otto-pi-search-"));
  directories.push(directory);
  const file = join(directory, "history.jsonl");
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}
test("reads only the active branch without launching a provider", async () => {
  const file = await history([
    { type: "session", id: "session", version: 3 },
    { type: "message", id: "u1", parentId: null, message: { role: "user", content: "Question" } },
    {
      type: "message",
      id: "old",
      parentId: "u1",
      message: { role: "assistant", content: [{ type: "text", text: "Discarded answer" }] },
    },
    {
      type: "message",
      id: "new",
      parentId: "u1",
      message: { role: "assistant", content: [{ type: "text", text: "Current answer" }] },
    },
  ]);
  const result = await readPiSearchHistory(file, "pi");
  expect(result.map((entry) => entry.item)).toEqual([
    expect.objectContaining({ type: "user_message", text: "Question" }),
    expect.objectContaining({ type: "assistant_message", text: "Current answer" }),
  ]);
});
test.each([
  { entries: [{ id: "broken", parentId: "missing" }] },
  { entries: [{ id: "cycle", parentId: "cycle" }] },
])("rejects incomplete or cyclic branch history", async ({ entries }) => {
  await expect(readPiSearchHistory(await history(entries), "pi")).rejects.toThrow();
});
test("reports malformed native history instead of indexing an empty conversation", async () => {
  const file = await history([]);
  await writeFile(file, '{"id":"truncated"');
  await expect(readPiSearchHistory(file, "pi")).rejects.toThrow();
});
