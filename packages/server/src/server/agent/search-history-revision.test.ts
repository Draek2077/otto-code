import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { validateSearchHistoryJsonl } from "./search-history-revision.js";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
test.each(["broken", '{"type":', "null", "[]"])(
  "rejects invalid native logs: %s",
  async (content) => {
    const directory = await mkdtemp(join(tmpdir(), "otto-history-validation-"));
    directories.push(directory);
    const file = join(directory, "history.jsonl");
    await writeFile(file, '{"type":"session"}\n' + content);
    await expect(validateSearchHistoryJsonl(file)).rejects.toThrow();
  },
);
test("accepts valid records and blank separators", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otto-history-validation-"));
  directories.push(directory);
  const file = join(directory, "history.jsonl");
  await writeFile(file, '\n{"type":"session"}\n\n{"type":"user","message":{"content":"Hello"}}\n');
  await expect(validateSearchHistoryJsonl(file)).resolves.toBeUndefined();
});
