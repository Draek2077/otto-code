import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { SuggestedTaskInfo } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";
import { selectSuggestedTasksForParent } from "./select";

const SERVER = "host-1";
const PARENT = "agent-1";

const contextSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../contexts/session-context.tsx"),
  "utf8",
);

/**
 * The daemon-pushed full-list reconciliations that are the ONLY way these store
 * maps are ever populated: `initializeSession` seeds each one with an empty Map
 * and nothing else writes to them.
 *
 * This pairing is asserted because losing it is silent. The Paseo v0.2.5 merge
 * (5e3cc1def) dropped both `client.on(...)` calls out of session-context while
 * leaving the store reducers, the selectors, the overlays and the agent-panel
 * wiring in place. Everything still typechecked, still linted and still
 * rendered - the suggested-task card simply had no data and returned null
 * forever, so "an agent suggested work" stopped reaching the user at all. A
 * reducer with no caller is the shape of that bug, so the test watches for it.
 */
const PUSH_WIRING = [
  { message: "suggested_tasks_changed", reducer: "setSuggestedTasksForParent" },
  { message: "background_shell_tasks_changed", reducer: "setBackgroundShellTasksForParent" },
] as const;

describe("daemon push wiring for per-parent task lists", () => {
  it.each(PUSH_WIRING)("subscribes to $message and feeds $reducer", ({ message, reducer }) => {
    // Whitespace-tolerant: the formatter wraps the longer of these two calls
    // across lines, and that is not a difference worth failing on.
    expect(contextSource).toMatch(new RegExp(`client\\.on\\(\\s*"${message}"`));
    expect(contextSource).toContain(`${reducer}(serverId, parentAgentId, tasks)`);
  });

  it.each(PUSH_WIRING)("releases the $message subscription on teardown", ({ message }) => {
    // The handle name the subscription is assigned to has to appear a second
    // time, in the effect's cleanup - a subscription that outlives the effect
    // leaks a handler per reconnect.
    const assignment = new RegExp(`const (\\w+) = client\\.on\\(\\s*"${message}"`);
    const handle = assignment.exec(contextSource)?.[1];
    expect(handle, `no subscription handle found for ${message}`).toBeDefined();
    expect(contextSource).toContain(`${handle}();`);
  });
});

function task(overrides: Partial<SuggestedTaskInfo> & { taskId: string }): SuggestedTaskInfo {
  return {
    parentAgentId: PARENT,
    title: `title ${overrides.taskId}`,
    tldr: `tldr ${overrides.taskId}`,
    state: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rows() {
  return selectSuggestedTasksForParent(useSessionStore.getState(), {
    serverId: SERVER,
    parentAgentId: PARENT,
  });
}

describe("suggested tasks reducer and selector", () => {
  beforeEach(() => {
    useSessionStore.getState().initializeSession(SERVER, null as unknown as DaemonClient);
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER);
  });

  it("shows nothing until the daemon pushes a list", () => {
    expect(rows()).toEqual([]);
  });

  it("surfaces pushed pending tasks oldest first", () => {
    useSessionStore
      .getState()
      .setSuggestedTasksForParent(SERVER, PARENT, [
        task({ taskId: "b", createdAt: "2026-01-01T00:00:02.000Z" }),
        task({ taskId: "a", createdAt: "2026-01-01T00:00:01.000Z" }),
      ]);
    expect(rows().map((row) => row.taskId)).toEqual(["a", "b"]);
  });

  it("hides tasks that are no longer pending", () => {
    useSessionStore
      .getState()
      .setSuggestedTasksForParent(SERVER, PARENT, [
        task({ taskId: "a" }),
        task({ taskId: "b", state: "dismissed" }),
      ]);
    expect(rows().map((row) => row.taskId)).toEqual(["a"]);
  });

  it("replaces the parent's whole list rather than merging into it", () => {
    const store = useSessionStore.getState();
    store.setSuggestedTasksForParent(SERVER, PARENT, [
      task({ taskId: "a" }),
      task({ taskId: "b" }),
    ]);
    store.setSuggestedTasksForParent(SERVER, PARENT, [task({ taskId: "b" })]);
    expect(rows().map((row) => row.taskId)).toEqual(["b"]);
  });

  it("leaves another parent's tasks alone", () => {
    const store = useSessionStore.getState();
    store.setSuggestedTasksForParent(SERVER, PARENT, [task({ taskId: "a" })]);
    store.setSuggestedTasksForParent(SERVER, "agent-2", [
      task({ taskId: "z", parentAgentId: "agent-2" }),
    ]);
    expect(rows().map((row) => row.taskId)).toEqual(["a"]);
  });
});
