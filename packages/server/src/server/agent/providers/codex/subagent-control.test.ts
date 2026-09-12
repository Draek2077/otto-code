import { describe, expect, it, vi } from "vitest";
import { CodexAppServerAgentSession } from "../codex-app-server-agent.js";

function harness() {
  const request = vi.fn().mockResolvedValue({
    thread: {
      turns: [
        { id: "old", status: "completed", items: [] },
        { id: "active-child-turn", status: "inProgress", items: [] },
      ],
    },
  });
  const session = Object.assign(Object.create(CodexAppServerAgentSession.prototype), {
    client: { request },
    currentThreadId: "parent-thread",
    subAgentCallIdByChildThreadId: new Map([["child-thread", "spawn-call"]]),
  }) as CodexAppServerAgentSession;
  return { session, request };
}

describe("Codex child stop", () => {
  it("reads and interrupts the child's active turn without touching the parent", async () => {
    const h = harness();
    await h.session.stopProviderSubagent("child-thread");
    expect(h.request.mock.calls).toEqual([
      ["thread/read", { threadId: "child-thread", includeTurns: true }],
      ["turn/interrupt", { threadId: "child-thread", turnId: "active-child-turn" }, 2000],
    ]);
  });
  it("refuses a parent or an unrelated thread", async () => {
    const h = harness();
    await expect(h.session.stopProviderSubagent("parent-thread")).rejects.toThrow(
      "does not belong",
    );
    await expect(h.session.stopProviderSubagent("unrelated-thread")).rejects.toThrow(
      "does not belong",
    );
    expect(h.request).not.toHaveBeenCalled();
  });
  it("propagates cancellation failures", async () => {
    const h = harness();
    h.request.mockImplementation(async (method: string) => {
      if (method === "turn/interrupt") throw new Error("connection lost");
      return { thread: { turns: [{ id: "turn", status: "inProgress", items: [] }] } };
    });
    await expect(h.session.stopProviderSubagent("child-thread")).rejects.toThrow("connection lost");
  });
});
