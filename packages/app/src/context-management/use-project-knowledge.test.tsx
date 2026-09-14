/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { useProjectKnowledge } from "./use-project-knowledge";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-1";
const listProjectKnowledge = vi.fn();
const getProjectKnowledgeRoot = vi.fn();
const getProjectKnowledge = vi.fn();

const view = {
  records: [],
  rootPages: [],
  findings: [],
  brief: "",
  briefTokens: 0,
  includedIds: [],
  omittedCount: 0,
};

beforeEach(() => {
  listProjectKnowledge.mockReset();
  getProjectKnowledgeRoot.mockReset();
  getProjectKnowledge.mockReset();
  useSessionStore.setState({
    sessions: {
      [SERVER_ID]: {
        client: { listProjectKnowledge, getProjectKnowledge, getProjectKnowledgeRoot },
        serverInfo: { features: { projectKnowledge: true } },
      },
    },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useSessionStore.setState({ sessions: {} } as never);
});

describe("useProjectKnowledge", () => {
  it("keeps loading and retries after a host timeout", async () => {
    vi.useFakeTimers();
    listProjectKnowledge
      .mockRejectedValueOnce(new Error("Timeout waiting for message (60000ms)"))
      .mockResolvedValueOnce(view);

    const { result } = renderHook(() => useProjectKnowledge(SERVER_ID, WORKSPACE_ID));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.view).toEqual(view);
    expect(result.current.loading).toBe(false);
    expect(listProjectKnowledge).toHaveBeenCalledTimes(2);
  });

  it("replaces a mutation response in the loaded view without reloading the pane", async () => {
    const originalRecord = { id: "record-1", title: "Before", updatedAt: "2026-08-27T00:00:00Z" };
    const updatedRecord = { ...originalRecord, title: "After", updatedAt: "2026-08-27T00:01:00Z" };
    const originalRoot = { slug: "architecture", title: "Architecture", body: "Before" };
    const updatedRoot = { ...originalRoot, body: "After" };
    listProjectKnowledge.mockResolvedValueOnce({
      ...view,
      records: [originalRecord],
      rootPages: [originalRoot],
    });

    const { result } = renderHook(() => useProjectKnowledge(SERVER_ID, WORKSPACE_ID));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.replaceRecord(updatedRecord as never);
      result.current.replaceRoot(updatedRoot as never);
    });

    expect(result.current.view?.records).toEqual([updatedRecord]);
    expect(result.current.view?.rootPages).toEqual([updatedRoot]);
    expect(listProjectKnowledge).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it("keeps the loaded Knowledge view when the caller rerenders to select another article", async () => {
    listProjectKnowledge.mockResolvedValueOnce(view);

    const { rerender } = renderHook(() => useProjectKnowledge(SERVER_ID, WORKSPACE_ID));
    await act(async () => {
      await Promise.resolve();
    });

    rerender();

    expect(listProjectKnowledge).toHaveBeenCalledTimes(1);
  });

  it("defers the catalog until the selected article has had first priority", async () => {
    listProjectKnowledge.mockResolvedValueOnce(view);

    const { result } = renderHook(() =>
      useProjectKnowledge(SERVER_ID, WORKSPACE_ID, { deferInitialLoad: true }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(listProjectKnowledge).not.toHaveBeenCalled();
    act(() => result.current.load());
    await act(async () => {
      await Promise.resolve();
    });

    expect(listProjectKnowledge).toHaveBeenCalledTimes(1);
  });

  it("requests root summaries only when the connected host advertises support", async () => {
    listProjectKnowledge.mockResolvedValueOnce(view);
    useSessionStore.setState({
      sessions: {
        [SERVER_ID]: {
          client: { listProjectKnowledge, getProjectKnowledge, getProjectKnowledgeRoot },
          serverInfo: {
            features: { projectKnowledge: true, projectKnowledgeDeferredRootBodies: true },
          },
        },
      },
    } as never);

    renderHook(() => useProjectKnowledge(SERVER_ID, WORKSPACE_ID));
    await act(async () => {
      await Promise.resolve();
    });

    expect(listProjectKnowledge).toHaveBeenCalledWith(WORKSPACE_ID, {
      includeRootBodies: false,
    });
  });
});

describe("useProjectKnowledge full record reads", () => {
  const summary = {
    id: "record-1",
    title: "T",
    statement: "",
    updatedAt: "2026-09-13T00:00:00Z",
  };
  const full = { ...summary, statement: "The full article." };

  async function renderLoaded() {
    listProjectKnowledge.mockResolvedValue({ ...view, records: [summary] });
    const hook = renderHook(() => useProjectKnowledge(SERVER_ID, WORKSPACE_ID));
    await act(async () => {
      await Promise.resolve();
    });
    return hook;
  }

  it("reuses a read article until the catalog reloads", async () => {
    getProjectKnowledge.mockResolvedValue({ record: full });
    const { result } = await renderLoaded();
    expect(result.current.cachedRecord(summary.id)).toBeNull();

    await act(async () => {
      await result.current.readRecord(summary.id);
    });
    expect(result.current.cachedRecord(summary.id)).toEqual(full);

    act(() => result.current.reload());
    expect(result.current.cachedRecord(summary.id)).toBeNull();
  });

  it("drops a read that straddles a reload", async () => {
    let resolveRead: (value: { record: typeof full }) => void = () => undefined;
    getProjectKnowledge.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const { result } = await renderLoaded();

    let read: Promise<unknown> = Promise.resolve();
    act(() => {
      read = result.current.readRecord(summary.id);
    });
    act(() => result.current.reload());
    await act(async () => {
      resolveRead({ record: full });
      await read;
    });

    expect(result.current.cachedRecord(summary.id)).toBeNull();
  });

  it("keeps a mutation response as the full article", async () => {
    const { result } = await renderLoaded();

    act(() => result.current.replaceRecord(full as never));

    expect(result.current.cachedRecord(summary.id)).toEqual(full);
    expect(getProjectKnowledge).not.toHaveBeenCalled();
  });
});
