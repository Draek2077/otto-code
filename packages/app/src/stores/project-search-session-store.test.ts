import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchSummary } from "@otto-code/protocol/file-operations";
import {
  buildProjectSearchScopeKey,
  readProjectSearchScrollOffset,
  rememberProjectSearchScrollOffset,
  useProjectSearchSessionStore,
  type SearchFileResult,
} from "./project-search-session-store";

const file = (path: string): SearchFileResult => ({ path, hash: `${path}-hash`, matches: [] });

const summary: FileSearchSummary = {
  cwd: "/repo",
  status: "completed",
  error: null,
  fileCount: 1,
  matchCount: 1,
  requestId: "req-1",
};

function resetStore(): void {
  useProjectSearchSessionStore.setState({ sessions: {}, order: [] });
}

describe("project search session store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keys a session per workspace, falling back to the root when there is no id", () => {
    expect(
      buildProjectSearchScopeKey({ serverId: "h1", workspaceId: "w1", workspaceRoot: "/r" }),
    ).toBe("h1:w1");
    expect(buildProjectSearchScopeKey({ serverId: "h1", workspaceRoot: "/r" })).toBe("h1:/r");
  });

  it("batches streamed results instead of writing one per event", () => {
    const store = useProjectSearchSessionStore.getState();
    const token = store.beginRun("scope");
    store.appendResult("scope", token, file("a.ts"));
    store.appendResult("scope", token, file("b.ts"));

    // Still buffered: a burst of results must not re-render the list per file.
    expect(useProjectSearchSessionStore.getState().sessions.scope?.results).toEqual([]);

    vi.runAllTimers();
    expect(
      useProjectSearchSessionStore.getState().sessions.scope?.results.map((entry) => entry.path),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("drains the buffer when the run finishes", () => {
    const store = useProjectSearchSessionStore.getState();
    const token = store.beginRun("scope");
    store.appendResult("scope", token, file("a.ts"));
    store.finishRun("scope", token, { summary });

    const session = useProjectSearchSessionStore.getState().sessions.scope;
    expect(session?.results.map((entry) => entry.path)).toEqual(["a.ts"]);
    expect(session?.phase).toBe("done");
  });

  it("ignores results and outcomes from a superseded run", () => {
    const store = useProjectSearchSessionStore.getState();
    const stale = store.beginRun("scope");
    const current = store.beginRun("scope");

    store.appendResult("scope", stale, file("stale.ts"));
    store.finishRun("scope", stale, { failed: true });
    vi.runAllTimers();

    const session = useProjectSearchSessionStore.getState().sessions.scope;
    expect(session?.results).toEqual([]);
    expect(session?.phase).toBe("searching");
    expect(store.isCurrentRun("scope", current)).toBe(true);
  });

  it("clears the query and results, keeping the search modes", () => {
    const store = useProjectSearchSessionStore.getState();
    store.updateSession("scope", { query: "otto", regexp: true, replaceOpen: true });
    const token = store.beginRun("scope");
    store.appendResult("scope", token, file("a.ts"));
    vi.runAllTimers();

    store.clearSession("scope");

    const session = useProjectSearchSessionStore.getState().sessions.scope;
    expect(session?.query).toBe("");
    expect(session?.results).toEqual([]);
    expect(session?.phase).toBe("idle");
    expect(session?.regexp).toBe(true);
    expect(session?.replaceOpen).toBe(true);
    // Late results from the run that was cleared must not repopulate the list.
    store.appendResult("scope", token, file("late.ts"));
    vi.runAllTimers();
    expect(useProjectSearchSessionStore.getState().sessions.scope?.results).toEqual([]);
  });

  it("retains a bounded number of workspaces, evicting the least recently used", () => {
    const store = useProjectSearchSessionStore.getState();
    for (const scope of ["a", "b", "c"]) {
      store.updateSession(scope, { query: scope });
    }
    rememberProjectSearchScrollOffset("a", 400);
    // Touching "a" makes "b" the oldest.
    store.updateSession("a", { query: "a2" });
    store.updateSession("d", { query: "d" });

    const { sessions } = useProjectSearchSessionStore.getState();
    expect(Object.keys(sessions).sort()).toEqual(["a", "c", "d"]);
    expect(sessions.a?.query).toBe("a2");
  });

  it("drops an evicted workspace's scroll offset with its session", () => {
    const store = useProjectSearchSessionStore.getState();
    store.updateSession("a", { query: "a" });
    rememberProjectSearchScrollOffset("a", 400);
    expect(readProjectSearchScrollOffset("a")).toBe(400);

    for (const scope of ["b", "c", "d"]) {
      store.updateSession(scope, { query: scope });
    }
    expect(readProjectSearchScrollOffset("a")).toBe(0);
  });
});
