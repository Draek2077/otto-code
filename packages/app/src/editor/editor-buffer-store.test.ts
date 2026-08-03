import { beforeEach, describe, expect, test } from "vitest";
import {
  buildEditorBufferKey,
  releaseCleanEditorBuffer,
  useEditorBufferStore,
} from "./editor-buffer-store";
import type { EditorBufferBaseline } from "./editor-buffer-state";

const bufferId = { serverId: "s1", workspaceId: "w1", path: "src/app.ts" };
const key = buildEditorBufferKey(bufferId);

const baseline: EditorBufferBaseline = {
  content: "alpha\n",
  modifiedAt: "2026-08-02T00:00:00.000Z",
  hash: "hash-1",
  eol: "lf",
};

function loadReadyBuffer(): void {
  const store = useEditorBufferStore.getState();
  store.beginLoad(key, "/repo");
  store.finishLoad(key, baseline);
}

beforeEach(() => {
  useEditorBufferStore.setState({ buffers: {} });
});

describe("releaseCleanEditorBuffer", () => {
  test("drops a clean buffer so a closed tab gives its file text back", () => {
    loadReadyBuffer();

    expect(releaseCleanEditorBuffer(bufferId)).toBe(true);
    expect(useEditorBufferStore.getState().buffers[key]).toBeUndefined();
  });

  test("retains a dirty buffer — a non-interactive close must not discard edits", () => {
    loadReadyBuffer();
    useEditorBufferStore.getState().setDirty(key, true);
    useEditorBufferStore.getState().setDraft(key, "alpha edited\n");

    expect(releaseCleanEditorBuffer(bufferId)).toBe(false);
    expect(useEditorBufferStore.getState().buffers[key]?.draft).toBe("alpha edited\n");
  });

  test("retains a buffer that still holds a draft even once it reads clean", () => {
    loadReadyBuffer();
    useEditorBufferStore.getState().setDraft(key, "alpha typed\n");

    expect(releaseCleanEditorBuffer(bufferId)).toBe(false);
    expect(useEditorBufferStore.getState().buffers[key]?.draft).toBe("alpha typed\n");
  });

  test("retains a conflicted buffer", () => {
    loadReadyBuffer();
    useEditorBufferStore.getState().registerConflict(key, {
      modifiedAt: "2026-08-02T00:01:00.000Z",
      hash: "hash-2",
      content: "alpha from disk\n",
      eol: "lf",
    });

    expect(releaseCleanEditorBuffer(bufferId)).toBe(false);
    expect(useEditorBufferStore.getState().buffers[key]?.conflict).not.toBeNull();
  });

  test("is a no-op for a file that was never opened", () => {
    expect(releaseCleanEditorBuffer(bufferId)).toBe(false);
  });
});
