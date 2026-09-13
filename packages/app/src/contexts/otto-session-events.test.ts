import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { applyOttoAgentStreamEvent, subscribeOttoSessionEvents } from "./otto-session-events";

const state = vi.hoisted(() => ({
  setSuggestedTasksForParent: vi.fn(),
  setBackgroundShellTasksForParent: vi.fn(),
  setAgentPromptSuggestion: vi.fn(),
  setAgentRateLimit: vi.fn(),
  mergeEntries: vi.fn(),
}));
vi.mock("@/stores/session-store", () => ({ useSessionStore: { getState: () => state } }));
vi.mock("@/git/log-store", () => ({ useGitLogStore: { getState: () => state } }));

function connection() {
  const handlers = new Map<string, (message: SessionOutboundMessage) => void>();
  const on = (type: string, handler: (message: SessionOutboundMessage) => void) => {
    handlers.set(type, handler);
    return () => {
      handlers.delete(type);
    };
  };
  return {
    client: { on } as Pick<DaemonClient, "on">,
    emit: (message: SessionOutboundMessage) => handlers.get(message.type)?.(message),
    handlers,
  };
}
beforeEach(() => vi.clearAllMocks());

describe("Otto session event subscriptions", () => {
  it("projects complete suggested-task snapshots, including removal, for the owning host and parent", () => {
    const host = connection();
    const dispose = subscribeOttoSessionEvents(host.client, "host-A");
    const tasks = [
      {
        taskId: "task",
        parentAgentId: "parent",
        title: "Review",
        tldr: "Check changes",
        state: "pending" as const,
        createdAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z",
      },
    ];
    host.emit({ type: "suggested_tasks_changed", payload: { parentAgentId: "parent", tasks } });
    host.emit({ type: "suggested_tasks_changed", payload: { parentAgentId: "parent", tasks: [] } });
    expect(state.setSuggestedTasksForParent.mock.calls).toEqual([
      ["host-A", "parent", tasks],
      ["host-A", "parent", []],
    ]);
    dispose();
    expect(host.handlers.size).toBe(0);
    host.emit({ type: "suggested_tasks_changed", payload: { parentAgentId: "parent", tasks } });
    expect(state.setSuggestedTasksForParent).toHaveBeenCalledTimes(2);
  });
  it("keeps identical parent and Git checkout IDs isolated between two hosts", () => {
    const a = connection();
    const b = connection();
    subscribeOttoSessionEvents(a.client, "host-A");
    subscribeOttoSessionEvents(b.client, "host-B");
    const taskMessage = {
      type: "background_shell_tasks_changed" as const,
      payload: { parentAgentId: "same-parent", tasks: [] },
    };
    a.emit(taskMessage);
    b.emit(taskMessage);
    expect(state.setBackgroundShellTasksForParent.mock.calls).toEqual([
      ["host-A", "same-parent", []],
      ["host-B", "same-parent", []],
    ]);
    const payload = {
      cwd: "/same-checkout",
      operation: "pull",
      entries: [
        {
          seq: 3,
          timestamp: "2026-09-13T00:00:00Z",
          level: "output" as const,
          text: "Already up to date",
        },
      ],
    };
    a.emit({ type: "checkout.git.log_appended.notification", payload });
    b.emit({ type: "checkout.git.log_appended.notification", payload });
    expect(state.mergeEntries.mock.calls).toEqual([
      [{ serverId: "host-A", ...payload }],
      [{ serverId: "host-B", ...payload }],
    ]);
  });
  it("resets prompt suggestions at a new turn and forwards rate-limit recovery without taking turn ownership", () => {
    applyOttoAgentStreamEvent("host-A", "agent", {
      type: "prompt_suggestion",
      provider: "claude",
      suggestion: "Review this",
    });
    applyOttoAgentStreamEvent("host-A", "agent", {
      type: "turn_started",
      provider: "claude",
      turnId: "turn-next",
    });
    expect(state.setAgentPromptSuggestion.mock.calls).toEqual([
      ["host-A", "agent", "Review this"],
      ["host-A", "agent", null],
    ]);
    applyOttoAgentStreamEvent("host-A", "agent", {
      type: "rate_limit_updated",
      provider: "claude",
      info: { status: "warning", utilizationPercent: 92 },
    });
    applyOttoAgentStreamEvent("host-A", "agent", {
      type: "rate_limit_updated",
      provider: "claude",
      info: { status: "allowed" },
    });
    expect(state.setAgentRateLimit.mock.calls).toEqual([
      ["host-A", "agent", { status: "warning", utilizationPercent: 92 }],
      ["host-A", "agent", { status: "allowed" }],
    ]);
    // These subscriptions own UI sidebands; no stream/timeline/turn mutator exists in this test port.
    expect(state.mergeEntries).not.toHaveBeenCalled();
  });
});
