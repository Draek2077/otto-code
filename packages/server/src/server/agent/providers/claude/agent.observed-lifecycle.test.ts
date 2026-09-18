import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expect, test, vi } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

interface Internals {
  translateMessageToEvents(message: SDKMessage): AgentStreamEvent[];
  query: { stopTask(taskId: string): Promise<void> };
}

async function harness() {
  const session = await new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
  }).createSession({ provider: "claude", cwd: process.cwd() });
  const internal = session as unknown as Internals;
  const send = (message: unknown) => internal.translateMessageToEvents(message as SDKMessage);
  const start = (toolUseId: string, taskId = "native-task") =>
    send({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      task_type: "local_agent",
      subagent_type: "general-purpose",
      description: "Fix server tests",
    });
  return { session, internal, send, start };
}

function updates(events: AgentStreamEvent[]) {
  return events.flatMap((event) =>
    event.type === "observed_subagent_updated" ? [event.update] : [],
  );
}

test("resumed progress, sidechain and completion keep the original observed identity", async () => {
  const h = await harness();
  h.start("original");
  h.send({
    type: "system",
    subtype: "task_updated",
    task_id: "native-task",
    patch: { status: "completed" },
  });
  h.start("resumed");
  const events = [
    ...h.send({
      type: "system",
      subtype: "task_progress",
      task_id: "native-task",
      tool_use_id: "resumed",
      usage: { total_tokens: 100, tool_uses: 2 },
    }),
    ...h.send({
      type: "assistant",
      parent_tool_use_id: "resumed",
      message: {
        id: "reply",
        content: [{ type: "text", text: "Finished" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    }),
    ...h.send({
      type: "system",
      subtype: "task_notification",
      task_id: "native-task",
      tool_use_id: "resumed",
      status: "completed",
    }),
  ];
  expect(updates(events).map((update) => update.key)).toEqual(expect.arrayContaining(["original"]));
  expect(updates(events).every((update) => update.key === "original")).toBe(true);
  expect(updates(events).at(-1)).toMatchObject({ key: "original", status: "idle" });
  expect(
    events
      .filter((event) => event.type === "observed_subagent_timeline")
      .every((event) => event.key === "original"),
  ).toBe(true);
});

test("undeclared sidechains cannot bypass the task filter through observed rows", async () => {
  const h = await harness();
  h.start("declared");
  const events = h.send({
    type: "assistant",
    parent_tool_use_id: "undeclared",
    message: {
      content: [{ type: "text", text: "Internal work" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  });
  expect(events).toEqual([]);
});

test("late usage retains completion instead of resurrecting a finished subagent", async () => {
  const h = await harness();
  h.start("original");
  h.send({
    type: "system",
    subtype: "task_updated",
    task_id: "native-task",
    patch: { status: "completed" },
  });
  const events = h.send({
    type: "assistant",
    parent_tool_use_id: "original",
    message: {
      id: "tail",
      content: [{ type: "text", text: "Final report" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  });
  expect(updates(events)).toContainEqual(
    expect.objectContaining({ key: "original", status: "idle", usage: expect.any(Object) }),
  );
});

test("an acknowledged Stop settles the child without waiting for a notification", async () => {
  const h = await harness();
  h.start("original");
  h.start("sibling", "sibling-task");
  const stopTask = vi.fn(async () => {});
  h.internal.query = { stopTask };
  const events: AgentStreamEvent[] = [];
  h.session.subscribe((event) => events.push(event));
  await h.session.stopTask!("native-task");
  expect(stopTask).toHaveBeenCalledExactlyOnceWith("native-task");
  expect(updates(events).map((update) => update.key)).toEqual(["original"]);
  expect(updates(events)).toContainEqual(
    expect.objectContaining({ key: "original", status: "closed" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "provider_subagent",
      event: { type: "upsert", id: "original", status: "canceled" },
    }),
  );
});

test("a rejected Stop keeps the child running and reports failure", async () => {
  const h = await harness();
  h.start("original");
  h.internal.query = {
    stopTask: vi.fn(async () => {
      throw new Error("stop rejected");
    }),
  };
  const events: AgentStreamEvent[] = [];
  h.session.subscribe((event) => events.push(event));
  await expect(h.session.stopTask!("native-task")).rejects.toThrow("stop rejected");
  expect(updates(events)).toEqual([]);
});

test("Claude's killed task status closes the observed row", async () => {
  const h = await harness();
  h.start("original");
  const events = h.send({
    type: "system",
    subtype: "task_updated",
    task_id: "native-task",
    patch: { status: "killed" },
  });
  expect(updates(events)).toEqual([{ key: "original", status: "closed" }]);
});

test("the background membership signal settles both views when the completion edge is lost", async () => {
  const h = await harness();
  h.start("original");
  h.send({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [{ task_id: "native-task", task_type: "local_agent", description: "Fix tests" }],
  });
  const events = h.send({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  expect(updates(events)).toEqual([{ key: "original", status: "idle" }]);
  expect(events).toContainEqual({
    type: "provider_subagent",
    provider: "claude",
    event: { type: "upsert", id: "original", status: "completed" },
  });
});

test("turn completion settles foreground children and leaves explicit background work running", async () => {
  const h = await harness();
  h.start("foreground", "foreground-task");
  h.start("background", "background-task");
  h.send({
    type: "system",
    subtype: "task_updated",
    task_id: "background-task",
    patch: { is_backgrounded: true },
  });
  const events = h.send({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0,
  });
  expect(updates(events)).toEqual([{ key: "foreground", status: "idle" }]);
});
