import { expect, it } from "vitest";
import { EditorDraftGuards } from "./draft-guards.js";
import { EditorRenames } from "./rename.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
it("protects inactive peer drafts without a language-server lease, through planning and application, and releases only the owning session", async () => {
  const base = path.resolve("../../.tmp/editor-guard-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "root-")),
    file = path.join(root, "file.ts");
  const guards = new EditorDraftGuards();
  const edits = new EditorRenames(
    () => [],
    undefined,
    (directory, target) => guards.blocked(directory, target),
  );
  const files = [{ file, before: "const x = 1;", after: "const y = 1;", editCount: 1 }];
  try {
    await writeFile(file, files[0].before);
    guards.update("peer", "inactive", { root, file, modified: true, revision: 1 });
    guards.releaseClient("other");
    await expect(edits.review("client", root, files)).rejects.toThrow("draft changed");
    guards.update("peer", "inactive", { root, file, modified: false, revision: 2 });
    const plan = await edits.review("client", root, files);
    guards.update("peer", "inactive", { root, file, modified: true, revision: 3 });
    expect((await edits.apply("client", plan.planId)).files[0].state).toBe("conflict");
    guards.releaseWorkspace(root);
    expect(guards.blocked(root, file)).toBe(false);
  } finally {
    await edits.close();
    await rm(root, { recursive: true, force: true });
  }
});
