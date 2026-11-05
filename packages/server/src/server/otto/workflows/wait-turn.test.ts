import { describe, test, expect } from "vitest";
import { waitForWorkflowChatIdle } from "./wait-turn.js";
import type { AgentManager } from "../../agent/agent-manager.js";
function fixture() {
  let busy = true;
  let state: "idle" | "running" | "closed" = "running";
  let listener: Parameters<AgentManager["subscribe"]>[0] | null = null;
  let releases = 0;
  const agents = {
    hasInFlightRun: () => busy,
    getAgent: () => ({ id: "owned", lifecycle: state }),
    subscribe: (fn: Parameters<AgentManager["subscribe"]>[0]) => {
      listener = fn;
      return () => {
        listener = null;
        releases++;
      };
    },
  } as unknown as Pick<AgentManager, "hasInFlightRun" | "getAgent" | "subscribe">;
  return {
    agents,
    idle() {
      state = "idle";
      listener?.({ type: "agent_state", agent: { id: "owned", lifecycle: state } } as Parameters<
        NonNullable<typeof listener>
      >[0]);
      busy = false;
    },
    close() {
      state = "closed";
      listener?.({ type: "agent_state", agent: { id: "owned", lifecycle: state } } as Parameters<
        NonNullable<typeof listener>
      >[0]);
    },
    ready() {
      busy = false;
    },
    releases: () => releases,
  };
}
describe("event-owned conductor idle boundary", () => {
  test("already idle creates no demand", async () => {
    const f = fixture();
    f.ready();
    await waitForWorkflowChatIdle(f.agents, "owned", new AbortController().signal);
    expect(f.releases()).toBe(0);
  });
  test("observes the iterator-finally boundary once and releases", async () => {
    const f = fixture();
    const wait = waitForWorkflowChatIdle(f.agents, "owned", new AbortController().signal);
    f.idle();
    await wait;
    expect(f.releases()).toBe(1);
  });
  test("abort releases exact demand and rejects", async () => {
    const f = fixture();
    const abort = new AbortController();
    const wait = waitForWorkflowChatIdle(f.agents, "owned", abort.signal);
    abort.abort(new Error("Stop"));
    await expect(wait).rejects.toThrow("Stop");
    expect(f.releases()).toBe(1);
  });
  test("closed session rejects instead of admitting a late turn", async () => {
    const f = fixture();
    const wait = waitForWorkflowChatIdle(f.agents, "owned", new AbortController().signal);
    f.close();
    await expect(wait).rejects.toThrow("closed");
    expect(f.releases()).toBe(1);
  });
});
