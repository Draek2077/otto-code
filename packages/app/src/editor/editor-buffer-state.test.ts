import { describe, expect, test } from "vitest";
import {
  applyBeginSave,
  applyConflictDismissed,
  applyDirtyChanged,
  applyDiskChangeDismissed,
  applyDiskChanged,
  applyDiskDeleted,
  applyLoaded,
  applyLoadError,
  applyRebaseline,
  applySaveConflict,
  applySaveError,
  applySaveOk,
  buildEditorBufferKey,
  createLoadingBuffer,
  normalizeToLf,
  type EditorBufferBaseline,
} from "./editor-buffer-state";

const baseline: EditorBufferBaseline = {
  content: "alpha\n",
  modifiedAt: "2026-07-09T00:00:00.000Z",
  hash: "hash-1",
  eol: "lf",
};

describe("editor buffer state", () => {
  test("normalizeToLf converts CRLF and lone CR", () => {
    expect(normalizeToLf("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  test("buildEditorBufferKey distinguishes workspaces and paths", () => {
    const left = buildEditorBufferKey({ serverId: "s", workspaceId: "w1", path: "a.txt" });
    const right = buildEditorBufferKey({ serverId: "s", workspaceId: "w2", path: "a.txt" });
    expect(left).not.toBe(right);
  });

  test("load lifecycle: loading → ready with a clean baseline", () => {
    const loading = createLoadingBuffer("/repo");
    expect(loading.status).toBe("loading");
    const ready = applyLoaded(loading, baseline);
    expect(ready.status).toBe("ready");
    expect(ready.baseline).toEqual(baseline);
    expect(ready.dirty).toBe(false);
    expect(ready.cwd).toBe("/repo");
  });

  test("load failure carries the message and clears the baseline", () => {
    const failed = applyLoadError(createLoadingBuffer("/repo"), "boom");
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("boom");
    expect(failed.baseline).toBeNull();
  });

  test("dirty transitions are idempotent", () => {
    const ready = applyLoaded(createLoadingBuffer("/repo"), baseline);
    const dirty = applyDirtyChanged(ready, true);
    expect(dirty.dirty).toBe(true);
    expect(applyDirtyChanged(dirty, true)).toBe(dirty);
  });

  test("successful save replaces the baseline and clears dirty", () => {
    const dirty = applyDirtyChanged(applyLoaded(createLoadingBuffer("/repo"), baseline), true);
    const saving = applyBeginSave(dirty);
    expect(saving.saving).toBe(true);
    const nextBaseline: EditorBufferBaseline = {
      content: "alpha\nbeta\n",
      modifiedAt: "2026-07-09T01:00:00.000Z",
      hash: "hash-2",
      eol: "lf",
    };
    const saved = applySaveOk(saving, nextBaseline);
    expect(saved.saving).toBe(false);
    expect(saved.dirty).toBe(false);
    expect(saved.baseline).toEqual(nextBaseline);
  });

  test("conflicted save keeps the buffer dirty and records the disk identity", () => {
    const dirty = applyDirtyChanged(applyLoaded(createLoadingBuffer("/repo"), baseline), true);
    const conflicted = applySaveConflict(applyBeginSave(dirty), {
      modifiedAt: "2026-07-09T02:00:00.000Z",
      hash: "hash-disk",
      content: "disk\n",
      eol: "lf",
    });
    expect(conflicted.saving).toBe(false);
    expect(conflicted.dirty).toBe(true);
    expect(conflicted.conflict?.hash).toBe("hash-disk");
    expect(conflicted.baseline).toEqual(baseline);
    const dismissed = applyConflictDismissed(conflicted);
    expect(dismissed.conflict).toBeNull();
    expect(dismissed.dirty).toBe(true);
  });

  test("failed save stops the spinner without losing state", () => {
    const dirty = applyDirtyChanged(applyLoaded(createLoadingBuffer("/repo"), baseline), true);
    const failed = applySaveError(applyBeginSave(dirty));
    expect(failed.saving).toBe(false);
    expect(failed.dirty).toBe(true);
    expect(failed.baseline).toEqual(baseline);
  });

  test("disk change under a dirty buffer raises the banner and rebaseline clears it", () => {
    const dirty = applyDirtyChanged(applyLoaded(createLoadingBuffer("/repo"), baseline), true);
    const changed = applyDiskChanged(dirty, {
      modifiedAt: "2026-07-09T03:00:00.000Z",
      hash: "hash-disk",
    });
    expect(changed.diskChange).toEqual({
      kind: "changed",
      modifiedAt: "2026-07-09T03:00:00.000Z",
      hash: "hash-disk",
    });
    expect(changed.dirty).toBe(true);

    const nextBaseline: EditorBufferBaseline = {
      content: "disk\n",
      modifiedAt: "2026-07-09T03:00:00.000Z",
      hash: "hash-disk",
      eol: "lf",
    };
    const kept = applyRebaseline(changed, nextBaseline);
    expect(kept.diskChange).toBeNull();
    expect(kept.baseline).toEqual(nextBaseline);
    expect(kept.dirty).toBe(true);
  });

  test("deletion marks missingOnDisk and survives banner dismissal", () => {
    const ready = applyLoaded(createLoadingBuffer("/repo"), baseline);
    const deleted = applyDiskDeleted(ready);
    expect(deleted.diskChange).toEqual({ kind: "deleted" });
    expect(deleted.missingOnDisk).toBe(true);

    const dismissed = applyDiskChangeDismissed(deleted);
    expect(dismissed.diskChange).toBeNull();
    expect(dismissed.missingOnDisk).toBe(true);

    const saved = applySaveOk(dismissed, baseline);
    expect(saved.missingOnDisk).toBe(false);
  });

  test("a save conflict supersedes a pending disk-change banner", () => {
    const dirty = applyDirtyChanged(applyLoaded(createLoadingBuffer("/repo"), baseline), true);
    const changed = applyDiskChanged(dirty, {
      modifiedAt: "2026-07-09T03:00:00.000Z",
      hash: "hash-disk",
    });
    const conflicted = applySaveConflict(applyBeginSave(changed), {
      modifiedAt: "2026-07-09T04:00:00.000Z",
      hash: "hash-newer",
      content: "newer\n",
      eol: "lf",
    });
    expect(conflicted.diskChange).toBeNull();
    expect(conflicted.conflict?.hash).toBe("hash-newer");
  });
});
