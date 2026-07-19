import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { AgentTimelineRow } from "../../agent-manager.js";
import { projectTimelineRows } from "../../timeline-projection.js";
import { ClaudeAgentClient } from "./agent.js";
import { streamSession } from "../test-utils/session-stream-adapter.js";

const queryFactory = vi.fn();

interface QueryMock {
  next: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  return: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setPermissionMode: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  supportedModels: ReturnType<typeof vi.fn>;
  supportedCommands: ReturnType<typeof vi.fn>;
  rewindFiles: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator]: () => AsyncIterator<Record<string, unknown>, void>;
}

function buildQueryMock(events: unknown[]): QueryMock {
  let index = 0;
  return {
    next: vi.fn(async () => {
      if (index >= events.length) {
        return { done: true, value: undefined };
      }
      const value = events[index];
      index += 1;
      return { done: false, value };
    }),
    interrupt: vi.fn(async () => undefined),
    return: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

async function collectUntilTerminal(
  stream: AsyncGenerator<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      break;
    }
  }
  return events;
}

function buildTailScenarioEvents(actionCount: number): unknown[] {
  const actionEvents = Array.from({ length: actionCount }, (_, index) => {
    const actionNumber = index + 1;
    return {
      type: "stream_event",
      parent_tool_use_id: "task-tail-1",
      event: {
        type: "content_block_start",
        index: actionNumber,
        content_block: {
          type: "tool_use",
          id: `sub-read-${actionNumber}`,
          name: "Read",
          input: {
            file_path: `file-${actionNumber}.md`,
          },
        },
      },
    };
  });

  return [
    {
      type: "system",
      subtype: "init",
      session_id: "sidechain-tail-session",
      permissionMode: "default",
      model: "opus",
    },
    {
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "task-tail-1",
          name: "Task",
          input: {
            subagent_type: "Explore",
            description: "Tail latest sub-agent activity",
          },
        },
      },
    },
    ...actionEvents,
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-tail-1",
            tool_name: "Task",
            content: "done",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
      total_cost_usd: 0,
    },
  ];
}

// A plain Task sub-agent whose live sidechain assistant frame carries the full
// `message.usage` split + a (cheaper) model — the real per-frame API numbers.
function buildSidechainUsageEvents(): unknown[] {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: "sidechain-usage-session",
      permissionMode: "default",
      model: "opus",
    },
    {
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "task-usage-1",
          name: "Task",
          input: { subagent_type: "Explore", description: "Summarize the module" },
        },
      },
    },
    // The sub-agent's assistant turn on the sidechain, carrying real usage + model.
    {
      type: "assistant",
      parent_tool_use_id: "task-usage-1",
      message: {
        id: "sub-usage-msg-1",
        role: "assistant",
        model: "claude-haiku-4-5-20251001",
        content: [{ type: "text", text: "Subagent narration." }],
        usage: {
          input_tokens: 4,
          output_tokens: 913,
          cache_creation_input_tokens: 726,
          cache_read_input_tokens: 68161,
        },
      },
    },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "task-usage-1",
            tool_name: "Task",
            content: "done",
            is_error: false,
          },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
      total_cost_usd: 0,
    },
  ];
}

function buildWorkflowScenarioEvents(
  notificationStatus: "completed" | "failed" | "stopped",
): unknown[] {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: "workflow-session",
      permissionMode: "default",
      model: "opus",
    },
    // The Workflow tool call is a normal top-level tool_use, cached under its id
    // so task_* system messages can be classified as a workflow run.
    {
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "wf-call-1",
          name: "Workflow",
          input: { name: "spec" },
        },
      },
    },
    {
      type: "system",
      subtype: "task_started",
      session_id: "workflow-session",
      task_id: "wf-task-1",
      tool_use_id: "wf-call-1",
      task_type: "local_workflow",
      workflow_name: "spec",
      description: "Deep research workflow",
    },
    {
      type: "system",
      subtype: "task_progress",
      session_id: "workflow-session",
      task_id: "wf-task-1",
      tool_use_id: "wf-call-1",
      description: "Fanning out research agents",
      summary: "Phase 1: gather sources",
      usage: { total_tokens: 1200, tool_uses: 4, duration_ms: 5000 },
    },
    {
      type: "system",
      subtype: "task_notification",
      session_id: "workflow-session",
      task_id: "wf-task-1",
      tool_use_id: "wf-call-1",
      status: notificationStatus,
      output_file: "/tmp/workflow-out.md",
      summary: "Synthesis complete",
      usage: { total_tokens: 4800, tool_uses: 12, duration_ms: 42000 },
    },
    {
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
      total_cost_usd: 0,
    },
  ];
}

describe("ClaudeAgentSession sub-agent sidechain updates", () => {
  const logger = createTestLogger();

  beforeEach(() => {
    const largeOldText = "VERY_LARGE_OLD_STRING".repeat(50);
    queryFactory.mockImplementation(() =>
      buildQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "sidechain-session",
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "task-call-1",
              name: "Task",
              input: {
                subagent_type: "Explore",
                description: "Inspect repository structure",
              },
            },
          },
        },
        {
          type: "stream_event",
          parent_tool_use_id: "task-call-1",
          event: {
            type: "content_block_start",
            index: 1,
            content_block: {
              type: "tool_use",
              id: "sub-read-1",
              name: "Read",
              input: {
                file_path: "README.md",
              },
            },
          },
        },
        {
          type: "stream_event",
          parent_tool_use_id: "task-call-1",
          event: {
            type: "content_block_start",
            index: 2,
            content_block: {
              type: "tool_use",
              id: "sub-edit-1",
              name: "Edit",
              input: {
                file_path: "src/index.ts",
                old_string: largeOldText,
                new_string: "replacement",
              },
            },
          },
        },
        {
          type: "tool_progress",
          tool_use_id: "sub-edit-1",
          tool_name: "Edit",
          parent_tool_use_id: "task-call-1",
          elapsed_time_seconds: 1,
        },
        {
          type: "assistant",
          parent_tool_use_id: "task-call-1",
          message: {
            id: "subagent-message-1",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Sub-agent narration belongs inside the Task row, not the parent transcript.",
              },
            ],
          },
        },
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "task-call-1",
                tool_name: "Task",
                content: "done",
                is_error: false,
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
          total_cost_usd: 0,
        },
      ]),
    );
  });

  afterEach(() => {
    queryFactory.mockReset();
  });

  test("accumulates lightweight sub_agent detail and preserves callId lifecycle collapse", async () => {
    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "delegate work"));
    await session.close();

    const timelineToolCalls = events
      .filter(
        (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
          event.type === "timeline" && event.item.type === "tool_call",
      )
      .map((event) => event.item)
      .filter((item) => item.callId === "task-call-1");

    expect(timelineToolCalls.length).toBeGreaterThanOrEqual(2);

    const subAgentUpdates = timelineToolCalls.filter((item) => item.detail.type === "sub_agent");
    expect(subAgentUpdates.length).toBeGreaterThanOrEqual(1);

    const latest = subAgentUpdates[subAgentUpdates.length - 1];
    expect(latest).toBeDefined();
    if (!latest || latest.detail.type !== "sub_agent") {
      throw new Error("expected sub_agent detail");
    }

    expect(latest.detail.subAgentType).toBe("Explore");
    expect(latest.detail.description).toBe("Inspect repository structure");
    expect(latest.detail.log).toContain("[Read] README.md");
    expect(latest.detail.log).toContain("[Edit] src/index.ts");
    expect(latest.detail.log).not.toContain("VERY_LARGE_OLD_STRING");

    const rows: AgentTimelineRow[] = timelineToolCalls.map((item, index) => ({
      seq: index + 1,
      timestamp: `2026-02-01T00:00:0${index}.000Z`,
      item,
    }));
    const projected = projectTimelineRows({ rows, mode: "projected" });
    const projectedTaskCalls = projected.filter(
      (entry) => entry.item.type === "tool_call" && entry.item.callId === "task-call-1",
    );

    expect(projectedTaskCalls).toHaveLength(1);
  });

  test("keeps sidechain assistant text out of the parent transcript", async () => {
    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "delegate work"));
    await session.close();

    const visibleAssistantText = events
      .flatMap((event) =>
        event.type === "timeline" && event.item.type === "assistant_message"
          ? [event.item.text]
          : [],
      )
      .join("");

    expect(visibleAssistantText).not.toContain("Sub-agent narration");

    const latestSubAgentUpdate = events
      .filter(
        (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
          event.type === "timeline" &&
          event.item.type === "tool_call" &&
          event.item.callId === "task-call-1" &&
          event.item.detail.type === "sub_agent",
      )
      .map((event) => event.item)
      .at(-1);

    expect(latestSubAgentUpdate?.detail).toMatchObject({
      type: "sub_agent",
      log: expect.stringContaining("[Read] README.md"),
    });
  });

  test("promotes the sidechain to observed subagent lifecycle + timeline events", async () => {
    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "delegate work"));
    await session.close();

    const updates = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_updated" }> =>
        event.type === "observed_subagent_updated",
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);

    const first = updates[0];
    expect(first?.update).toMatchObject({
      key: "task-call-1",
      status: "running",
      subAgentType: "Explore",
      description: "Inspect repository structure",
    });

    // The Task tool_result settles the observed row.
    const last = updates[updates.length - 1];
    expect(last?.update).toMatchObject({ key: "task-call-1", status: "idle" });

    // Sidechain assistant text lands in the observed subagent's own timeline.
    const observedTimeline = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_timeline" }> =>
        event.type === "observed_subagent_timeline",
    );
    expect(
      observedTimeline.some(
        (event) =>
          event.key === "task-call-1" &&
          event.item.type === "assistant_message" &&
          event.item.text.includes("Sub-agent narration"),
      ),
    ).toBe(true);
  });

  test("emits the plain Task sub-agent's real usage split + model from the live sidechain", async () => {
    queryFactory.mockImplementation(() => buildQueryMock(buildSidechainUsageEvents()));

    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "delegate work"));
    await session.close();

    const withUsage = events.findLast(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_updated" }> =>
        event.type === "observed_subagent_updated" &&
        event.update.key === "task-usage-1" &&
        event.update.usage !== undefined,
    );

    expect(withUsage).toBeDefined();
    // cache_read → cachedInputTokens, cache_creation → cacheCreationInputTokens.
    expect(withUsage?.update.usage).toMatchObject({
      inputTokens: 4,
      cachedInputTokens: 68161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
    // Priced on the subagent's own (Haiku) model, not the parent's (opus).
    expect(withUsage?.update.usage?.totalCostUsd).toBeGreaterThan(0);
    // The sub-agent ran a cheaper model than the parent (opus) — pricing must
    // use THIS model, so it has to be reported.
    expect(withUsage?.update.model).toBe("claude-haiku-4-5-20251001");
  });

  test("tails sub-agent actions instead of dropping latest entries at cap", async () => {
    queryFactory.mockImplementation(() => buildQueryMock(buildTailScenarioEvents(205)));

    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "delegate work"));
    await session.close();

    const timelineToolCalls = events
      .filter(
        (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
          event.type === "timeline" && event.item.type === "tool_call",
      )
      .map((event) => event.item)
      .filter((item) => item.callId === "task-tail-1");
    const subAgentUpdates = timelineToolCalls.filter((item) => item.detail.type === "sub_agent");
    const latest = subAgentUpdates[subAgentUpdates.length - 1];
    expect(latest).toBeDefined();
    if (!latest || latest.detail.type !== "sub_agent") {
      throw new Error("expected sub_agent detail");
    }

    expect(latest.detail.log).not.toContain("[Read] file-1.md");
    expect(latest.detail.log).not.toContain("[Read] file-5.md");
    expect(latest.detail.log).toContain("[Read] file-6.md");
    expect(latest.detail.log).toContain("[Read] file-205.md");
  });

  test("surfaces a Workflow orchestration run as an observed subagent", async () => {
    queryFactory.mockImplementation(() => buildQueryMock(buildWorkflowScenarioEvents("completed")));

    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "ultracode: research this"));
    await session.close();

    const updates = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_updated" }> =>
        event.type === "observed_subagent_updated",
    );
    // task_started + task_progress + task_notification all route to the observed row.
    expect(updates.length).toBeGreaterThanOrEqual(2);

    const first = updates[0];
    expect(first?.update).toMatchObject({
      key: "wf-call-1",
      taskId: "wf-task-1",
      status: "running",
      // The workflow name becomes the frozen row label so it reads as a workflow.
      subAgentType: "Workflow: spec",
    });

    // The completion notification settles the observed row and carries the run's
    // cumulative token cost.
    const last = updates[updates.length - 1];
    expect(last?.update).toMatchObject({ key: "wf-call-1", status: "idle" });
    expect(last?.update.cumulativeTokens).toBe(4800);
  });

  test("surfaces a failed Workflow run as an error requiring attention", async () => {
    queryFactory.mockImplementation(() => buildQueryMock(buildWorkflowScenarioEvents("failed")));

    const session = await new ClaudeAgentClient({
      logger,
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    const events = await collectUntilTerminal(streamSession(session, "ultracode: research this"));
    await session.close();

    const updates = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_updated" }> =>
        event.type === "observed_subagent_updated",
    );
    // The previously-invisible failure signal must surface as error + attention.
    const last = updates[updates.length - 1];
    expect(last?.update).toMatchObject({
      key: "wf-call-1",
      status: "error",
      requiresAttention: true,
    });
  });
});
