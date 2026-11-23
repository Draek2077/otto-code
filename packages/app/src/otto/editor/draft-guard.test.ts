import { expect, it } from "vitest";
import { EditorDraftGuard, flushEditorDraftGuards } from "./draft-guard";
it("serializes dirty/clean transitions and holds workspace writes until inactive draft protection is acknowledged", async () => {
  let acknowledge: () => void = () => {};
  const first = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const calls: [boolean, number][] = [];
  const guard = new EditorDraftGuard("host", async (modified, revision) => {
    calls.push([modified, revision]);
    if (revision === 1) await first;
  });
  try {
    guard.update(true);
    guard.update(true);
    guard.update(false);
    let done = false;
    const flush = flushEditorDraftGuards("host").then(() => {
      done = true;
      return undefined;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(calls).toEqual([[true, 1]]);
    acknowledge();
    await flush;
    expect(calls).toEqual([
      [true, 1],
      [false, 2],
    ]);
  } finally {
    acknowledge();
    await guard.close();
  }
});
it("blocks edits on failed protection without blocking a different host and clears on close", async () => {
  const guard = new EditorDraftGuard("offline", async () => {
    throw new Error("lost connection");
  });
  guard.update(true);
  await expect(flushEditorDraftGuards("offline")).rejects.toThrow("Draft protection");
  await flushEditorDraftGuards("another-host");
  await guard.close();
  await flushEditorDraftGuards("offline");
});
