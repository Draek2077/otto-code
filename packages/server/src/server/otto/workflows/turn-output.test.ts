import { describe, test, expect, vi } from "vitest";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import { consumeWorkflowTurn } from "./turn-output.js";
import { NodeOutputStore } from "./node-output.js";

function stream(events: AgentStreamEvent[]): Pick<AgentManager, "streamAgent" | "cancelAgentRun"> {
  return {
    streamAgent: vi.fn(async function* () {
      yield* events;
    }),
    cancelAgentRun: vi.fn(async () => ({ status: "not_running" as const })),
  };
}
function message(text: string): AgentStreamEvent {
  return { type: "timeline", provider: "fixture", item: { type: "assistant_message", text } };
}
const log = { warn: vi.fn() };
const permission: AgentStreamEvent = {
  type: "permission_requested",
  provider: "fixture",
  request: { id: "approval", provider: "fixture", name: "write", kind: "tool" },
};
describe("bounded Workflow turn consumption", () => {
  test("owned workers deny interactive permissions before continuing the stream", async () => {
    const deny = vi.fn(async () => undefined);
    const client = stream([permission, message("Denied tool, continuing safely")]);
    const result = await consumeWorkflowTurn(
      client,
      "worker",
      "Task",
      new AbortController().signal,
      {},
      new NodeOutputStore(),
      log,
      deny,
    );
    expect(deny).toHaveBeenCalledExactlyOnceWith("approval");
    expect(result.finalMessage).toBe("Denied tool, continuing safely");
    expect(client.cancelAgentRun).not.toHaveBeenCalled();
  });
  test("failed permission denial cancels only the owned turn and preserves its cause", async () => {
    const failure = new Error("denial failed");
    const client = stream([permission]);
    await expect(
      consumeWorkflowTurn(
        client,
        "worker",
        "Task",
        new AbortController().signal,
        {},
        new NodeOutputStore(),
        log,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toMatchObject({ cause: failure });
    expect(client.cancelAgentRun).toHaveBeenCalledExactlyOnceWith("worker");
  });
  test("attended conductor stream leaves permission handling with the normal chat", async () => {
    const client = stream([permission, message("Normal attended turn")]);
    const result = await consumeWorkflowTurn(
      client,
      "conductor",
      "Task",
      new AbortController().signal,
      {},
      new NodeOutputStore(),
      log,
    );
    expect(result.finalMessage).toBe("Normal attended turn");
    expect(client.cancelAgentRun).not.toHaveBeenCalled();
  });
  test("returns the final contiguous assistant segment and structured output without retaining tool payloads", async () => {
    const client = stream([
      message("Earlier"),
      { type: "timeline", provider: "fixture", item: { type: "reasoning", text: "unretained" } },
      message("Final "),
      message("reply"),
      { type: "turn_completed", provider: "fixture" },
    ]);
    const outputs = new NodeOutputStore();
    outputs.record("agent", { score: 1 });
    const result = await consumeWorkflowTurn(
      client,
      "agent",
      "/not-a-command",
      new AbortController().signal,
      {},
      outputs,
      log,
    );
    expect(result).toEqual({
      failed: false,
      finalMessage: "Final reply",
      submittedOutput: { score: 1 },
    });
    expect(outputs.take("agent")).toBeNull();
    expect(client.streamAgent).toHaveBeenCalledWith(
      "agent",
      [{ type: "text", text: "/not-a-command" }],
      {},
    );
  });
  test("oversized replies stay bounded and explicitly disclose truncation", async () => {
    const result = await consumeWorkflowTurn(
      stream([message("x".repeat(100000))]),
      "agent",
      "Task",
      new AbortController().signal,
      {},
      new NodeOutputStore(),
      log,
    );
    expect(result.finalMessage?.length).toBeLessThan(64200);
    expect(result.finalMessage).toContain("truncated");
  });
  test("provider failures remain failed and bounded", async () => {
    const result = await consumeWorkflowTurn(
      stream([{ type: "turn_failed", provider: "fixture", error: "e".repeat(10000) }]),
      "agent",
      "Task",
      new AbortController().signal,
      {},
      new NodeOutputStore(),
      log,
    );
    expect(result.failed).toBe(true);
    expect(result.error).toHaveLength(2000);
  });
  test("an already canceled request never admits a Paseo turn", async () => {
    const client = stream([]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      consumeWorkflowTurn(client, "agent", "Task", abort.signal, {}, new NodeOutputStore(), log),
    ).rejects.toThrow();
    expect(client.streamAgent).not.toHaveBeenCalled();
  });
});
