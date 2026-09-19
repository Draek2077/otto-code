/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FileWatchEventPayload } from "@otto-code/client/internal/daemon-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorController } from "./editor-contract";
import { useEditorBufferStore } from "./editor-buffer-store";
import { useEditorBuffer } from "./use-editor-buffer";

interface DiskFile {
  content: string;
  hash: string;
  modifiedAt: string;
  eol: "lf";
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const harness = vi.hoisted(() => ({
  client: null as unknown,
  confirm: vi.fn<(input: unknown) => Promise<boolean>>(),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ sessions: { srv: { client: harness.client } } }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: () => {} }) }));
vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: (input: unknown) => harness.confirm(input),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function file(content: string, hash: string, modifiedAt: string): DiskFile {
  return { content, hash, modifiedAt, eol: "lf" };
}

function changed(hash: string | null, modifiedAt: string): FileWatchEventPayload {
  return { cwd: "/root", path: "a.ts", change: "changed", hash, modifiedAt, size: 1 };
}

/** A daemon whose reads resolve only when the test says so, one per call. */
function mountBuffer() {
  const reads: Deferred<DiskFile>[] = [];
  let onEvent: ((event: FileWatchEventPayload) => void) | null = null;
  harness.client = {
    readTextFile: vi.fn(() => {
      const read = createDeferred<DiskFile>();
      reads.push(read);
      return read.promise;
    }),
    watchFile: (_cwd: string, _path: string, listener: (event: FileWatchEventPayload) => void) => {
      onEvent = listener;
      return () => {};
    },
    writeFile: vi.fn(),
  };
  const setDoc = vi.fn<(doc: string) => void>();
  const controllerRef = { current: { setDoc } as unknown as EditorController };
  const hook = renderHook(() =>
    useEditorBuffer({
      serverId: "srv",
      workspaceId: "ws",
      workspaceRoot: "/root",
      path: "a.ts",
      controllerRef,
    }),
  );
  return {
    hook,
    reads,
    setDoc,
    emit: (event: FileWatchEventPayload) => act(() => onEvent?.(event)),
    resolveRead: (index: number, value: DiskFile) =>
      act(async () => {
        reads[index]?.resolve(value);
        await reads[index]?.promise;
      }),
  };
}

afterEach(() => {
  cleanup();
  useEditorBufferStore.setState({ buffers: {} });
  harness.confirm.mockReset();
});

describe("useEditorBuffer disk sync", () => {
  it("follows a second agent write that lands while the first reload's doc sync is pending", async () => {
    const { hook, setDoc, emit, resolveRead } = mountBuffer();
    await resolveRead(0, file("v1", "h1", "m1"));

    emit(changed("h2", "m2"));
    await resolveRead(1, file("v2", "h2", "m2"));
    expect(setDoc).toHaveBeenLastCalledWith("v2");

    // The editor reports back after installing "v2": a forced dirty report and
    // a debounced doc sync. Neither is the user typing.
    emit(changed("h3", "m3"));
    act(() => {
      hook.result.current.onDirtyChanged(false);
      hook.result.current.onDocSync("v2");
    });
    await resolveRead(2, file("v3", "h3", "m3"));

    expect(setDoc).toHaveBeenLastCalledWith("v3");
    expect(hook.result.current.buffer?.baseline?.content).toBe("v3");
    expect(hook.result.current.buffer?.diskChange).toBeNull();
  });

  it("keeps edits typed during an automatic read and shows the disk change", async () => {
    const { hook, setDoc, emit, resolveRead } = mountBuffer();
    await resolveRead(0, file("v1", "h1", "m1"));

    emit(changed("h2", "m2"));
    act(() => hook.result.current.onDirtyChanged(true));
    await resolveRead(1, file("v2", "h2", "m2"));

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.buffer?.baseline?.content).toBe("v1");
    expect(hook.result.current.buffer?.diskChange).toEqual({
      kind: "changed",
      hash: "h2",
      modifiedAt: "m2",
    });
  });

  it("leaves the document alone when Reload from disk finds no change", async () => {
    const { hook, setDoc, resolveRead } = mountBuffer();
    await resolveRead(0, file("v1", "h1", "m1"));

    let refreshing: Promise<void> | undefined;
    act(() => {
      refreshing = hook.result.current.refresh();
    });
    await resolveRead(1, file("v1", "h1", "m1-touched"));
    await act(async () => refreshing);

    expect(setDoc).not.toHaveBeenCalled();
    expect(hook.result.current.buffer?.baseline?.modifiedAt).toBe("m1-touched");
  });

  it("asks before Reload from disk discards unsaved edits", async () => {
    const { hook, reads, setDoc, resolveRead } = mountBuffer();
    await resolveRead(0, file("v1", "h1", "m1"));
    act(() => hook.result.current.onDirtyChanged(true));

    harness.confirm.mockResolvedValueOnce(false);
    await act(async () => hook.result.current.refresh());
    expect(reads).toHaveLength(1);

    harness.confirm.mockResolvedValueOnce(true);
    let refreshing: Promise<void> | undefined;
    await act(async () => {
      refreshing = hook.result.current.refresh();
      await Promise.resolve();
    });
    await resolveRead(1, file("v2", "h2", "m2"));
    await act(async () => refreshing);

    expect(setDoc).toHaveBeenLastCalledWith("v2");
    expect(hook.result.current.buffer?.dirty).toBe(false);
  });

  it("handles a file too large for the daemon to hash", async () => {
    const { hook, emit, resolveRead } = mountBuffer();
    await resolveRead(0, file("v1", "h1", "m1"));
    act(() => hook.result.current.onDirtyChanged(true));

    // Our own save echoing back: same mtime, no hash to compare.
    emit(changed(null, "m1"));
    expect(hook.result.current.buffer?.diskChange).toBeNull();

    emit(changed(null, "m2"));
    expect(hook.result.current.buffer?.diskChange).toEqual({
      kind: "changed",
      hash: null,
      modifiedAt: "m2",
    });
  });
});
