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
  useSessionStore.setState({
    sessions: {
      [SERVER_ID]: {
        client: { listProjectKnowledge },
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
});
