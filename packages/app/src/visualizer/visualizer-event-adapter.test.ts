import { describe, expect, test } from "vitest";
import type { AgentTimelineItem, ToolCallDetail } from "@otto-code/protocol/agent-types";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import {
  buildAgentCompleteEvent,
  buildAgentIdleEvent,
  buildContextUpdateEvent,
  buildModelDetectedEvent,
  buildObservedSubagentSpawnEvent,
  buildPermissionRequestedEvent,
  buildRootAgentSpawnEvent,
  isVisualizerAgentTerminal,
  resolveAgentNodeName,
  resolveVisualizerRuntime,
  streamEventToSimulationEvents,
  summarizeToolCallArgs,
  summarizeToolCallResult,
  timelineItemToSimulationEvents,
  toolCallDetailFilePath,
  truncateSessionLabel,
} from "./visualizer-event-adapter";

const CTX = { name: "Main Agent", sessionId: "agent-root" };

describe("resolveVisualizerRuntime", () => {
  test("maps claude to the claude logo", () => {
    expect(resolveVisualizerRuntime("claude")).toBe("claude");
  });

  test("maps any codex-family provider to the codex logo", () => {
    expect(resolveVisualizerRuntime("codex")).toBe("codex");
    expect(resolveVisualizerRuntime("codex-cli")).toBe("codex");
  });

  test("maps the other builtin CLI providers to their own generic mark", () => {
    expect(resolveVisualizerRuntime("copilot")).toBe("copilot");
    expect(resolveVisualizerRuntime("opencode")).toBe("opencode");
    expect(resolveVisualizerRuntime("pi")).toBe("pi");
  });

  test("maps the bundled openai-compatible provider (omp) to openai-compat", () => {
    expect(resolveVisualizerRuntime("omp")).toBe("openai-compat");
  });

  test("omits unrecognized (custom openai-compatible) providers", () => {
    expect(resolveVisualizerRuntime("my-custom-lmstudio")).toBeUndefined();
  });
});

describe("truncateSessionLabel", () => {
  test("leaves short labels untouched (trimmed)", () => {
    expect(truncateSessionLabel("  Fix login bug  ")).toBe("Fix login bug");
  });

  test("caps long labels at 24 chars with an ellipsis", () => {
    const label = truncateSessionLabel("Fix the visualizer sync bug in the companion pane");
    expect(label).toBe("Fix the visualizer sync…");
    // Never more than the cap of visible chars ahead of the ellipsis glyph.
    expect([...label.replace(/…$/, "")].length).toBeLessThanOrEqual(24);
  });

  test("keeps a label sitting exactly on the cap without an ellipsis", () => {
    const exactly24 = "123456789012345678901234";
    expect(truncateSessionLabel(exactly24)).toBe(exactly24);
  });

  test("trims trailing whitespace exposed by the cut before the ellipsis", () => {
    expect(truncateSessionLabel("Investigate the flaky   test suite")).toBe(
      "Investigate the flaky…",
    );
  });
});

describe("isVisualizerAgentTerminal", () => {
  const base = {
    status: "running" as const,
    attend: undefined,
    archived: false,
    requiresAttention: false,
  };

  test("closed is terminal regardless of attend", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "closed" })).toBe(true);
    expect(isVisualizerAgentTerminal({ ...base, status: "closed", attend: "observed" })).toBe(true);
  });

  test("archived is terminal regardless of status", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "running", archived: true })).toBe(true);
  });

  test("an observed subagent that ends idle is terminal (Claude Task done)", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "idle", attend: "observed" })).toBe(true);
  });

  test("an observed subagent that errors is terminal", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "error", attend: "observed" })).toBe(true);
  });

  test("an attention-flagged observed subagent stays visible (signal not buried)", () => {
    expect(
      isVisualizerAgentTerminal({
        ...base,
        status: "error",
        attend: "observed",
        requiresAttention: true,
      }),
    ).toBe(false);
    expect(
      isVisualizerAgentTerminal({
        ...base,
        status: "idle",
        attend: "observed",
        requiresAttention: true,
      }),
    ).toBe(false);
  });

  test("an idle attended (native/root) agent is NOT terminal — it idles between turns", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "idle", attend: "attended" })).toBe(false);
    expect(isVisualizerAgentTerminal({ ...base, status: "idle", attend: undefined })).toBe(false);
  });

  test("a running observed subagent is not terminal", () => {
    expect(isVisualizerAgentTerminal({ ...base, status: "running", attend: "observed" })).toBe(
      false,
    );
  });
});

describe("resolveAgentNodeName", () => {
  test("uses the trimmed title when unique", () => {
    expect(
      resolveAgentNodeName({
        agentId: "agent-1",
        title: "  Fix login bug  ",
        usedNames: new Set(),
      }),
    ).toBe("Fix login bug");
  });

  test("falls back to a short agent id when there is no title", () => {
    expect(
      resolveAgentNodeName({ agentId: "3f8a91c2-abcd", title: null, usedNames: new Set() }),
    ).toBe("Agent 3f8a91");
  });

  test("suffixes with a short id on name collision", () => {
    const name = resolveAgentNodeName({
      agentId: "3f8a91c2-abcd",
      title: "Fix login bug",
      usedNames: new Set(["Fix login bug"]),
    });
    expect(name).toBe("Fix login bug (3f8a91)");
  });
});

describe("spawn/lifecycle event builders", () => {
  test("root agent spawn is the main node and carries a mapped runtime", () => {
    const event = buildRootAgentSpawnEvent({
      ctx: CTX,
      model: "claude-sonnet-5",
      provider: "claude",
      time: 100,
    });
    expect(event).toEqual({
      time: 100,
      sessionId: "agent-root",
      type: "agent_spawn",
      payload: { name: "Main Agent", isMain: true, model: "claude-sonnet-5", runtime: "claude" },
    });
  });

  test("root agent spawn omits model/runtime when unavailable", () => {
    const event = buildRootAgentSpawnEvent({
      ctx: CTX,
      model: null,
      provider: "my-custom-lmstudio",
      time: 0,
    });
    expect(event.payload).toEqual({ name: "Main Agent", isMain: true });
  });

  test("observed subagent spawn keys on parent, not isMain", () => {
    const event = buildObservedSubagentSpawnEvent({
      ctx: { name: "Sub Agent", sessionId: "agent-root" },
      parentName: "Main Agent",
      task: "Investigate flaky test",
      time: 50,
    });
    expect(event).toEqual({
      time: 50,
      sessionId: "agent-root",
      type: "agent_spawn",
      payload: { name: "Sub Agent", parent: "Main Agent", task: "Investigate flaky test" },
    });
  });

  test("agent_complete and agent_idle key on `name`, not `agent`", () => {
    expect(buildAgentCompleteEvent({ ctx: CTX, time: 1 }).payload).toEqual({ name: "Main Agent" });
    expect(buildAgentIdleEvent({ ctx: CTX, time: 1 }).payload).toEqual({ name: "Main Agent" });
  });

  test("permission_requested and model_detected key on `agent`", () => {
    expect(buildPermissionRequestedEvent({ ctx: CTX, time: 1 }).payload).toEqual({
      agent: "Main Agent",
    });
    expect(buildModelDetectedEvent({ ctx: CTX, model: "gpt-5", time: 1 }).payload).toEqual({
      agent: "Main Agent",
      model: "gpt-5",
    });
  });
});

describe("buildContextUpdateEvent", () => {
  test("omits the event entirely with no context-window reading", () => {
    expect(buildContextUpdateEvent({ ctx: CTX, usage: {}, time: 1 })).toBeNull();
  });

  test("carries tokens and tokensMax, omitting contextBreakdown", () => {
    const event = buildContextUpdateEvent({
      ctx: CTX,
      usage: { contextWindowUsedTokens: 1000, contextWindowMaxTokens: 200000 },
      time: 1,
    });
    expect(event?.payload).toEqual({ agent: "Main Agent", tokens: 1000, tokensMax: 200000 });
  });

  test("a lifetime total alone is worth emitting — without a tokens field", () => {
    const event = buildContextUpdateEvent({ ctx: CTX, cumulativeTokens: 19000, time: 1 });
    expect(event?.payload).toEqual({ agent: "Main Agent", cumulativeTokens: 19000 });
  });

  test("carries both readings when both are known", () => {
    const event = buildContextUpdateEvent({
      ctx: CTX,
      usage: { contextWindowUsedTokens: 1000, contextWindowMaxTokens: 200000 },
      cumulativeTokens: 55000,
      time: 1,
    });
    expect(event?.payload).toEqual({
      agent: "Main Agent",
      tokens: 1000,
      tokensMax: 200000,
      cumulativeTokens: 55000,
    });
  });
});

describe("tool call detail summaries", () => {
  test("read/edit/write expose file_path", () => {
    const detail: ToolCallDetail = { type: "read", filePath: "/src/index.ts" };
    expect(toolCallDetailFilePath(detail)).toBe("/src/index.ts");
    expect(summarizeToolCallArgs(detail)).toBe("/src/index.ts");
  });

  test("shell summarizes command and output", () => {
    expect(summarizeToolCallArgs({ type: "shell", command: "npm test" })).toBe("npm test");
    expect(summarizeToolCallResult({ type: "shell", command: "npm test", exitCode: 1 })).toBe(
      "exit 1",
    );
  });

  test("search prefers a match/file count over raw content", () => {
    expect(summarizeToolCallResult({ type: "search", query: "foo", numMatches: 3 })).toBe(
      "3 matches",
    );
  });

  test("unknown detail summarizes to an empty string", () => {
    expect(summarizeToolCallArgs({ type: "unknown", input: {}, output: {} })).toBe("");
  });
});

describe("timelineItemToSimulationEvents", () => {
  test("maps user/assistant/reasoning to message events with the right role", () => {
    const userItem: AgentTimelineItem = { type: "user_message", text: "hi" };
    const assistantItem: AgentTimelineItem = { type: "assistant_message", text: "hello" };
    const reasoningItem: AgentTimelineItem = { type: "reasoning", text: "thinking..." };

    expect(timelineItemToSimulationEvents({ ctx: CTX, item: userItem, time: 1 })).toEqual([
      {
        time: 1,
        sessionId: "agent-root",
        type: "message",
        payload: { agent: "Main Agent", content: "hi", role: "user" },
      },
    ]);
    expect(
      timelineItemToSimulationEvents({ ctx: CTX, item: assistantItem, time: 2 })[0]?.payload.role,
    ).toBe("assistant");
    expect(
      timelineItemToSimulationEvents({ ctx: CTX, item: reasoningItem, time: 3 })[0]?.payload.role,
    ).toBe("thinking");
  });

  test("running tool_call emits tool_call_start with inputData.file_path for edit", () => {
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-1",
      name: "Edit",
      status: "running",
      error: null,
      detail: { type: "edit", filePath: "/src/app.ts" },
    };
    expect(timelineItemToSimulationEvents({ ctx: CTX, item, time: 10 })).toEqual([
      {
        time: 10,
        sessionId: "agent-root",
        type: "tool_call_start",
        payload: {
          agent: "Main Agent",
          tool: "Edit",
          args: "/src/app.ts",
          inputData: { file_path: "/src/app.ts" },
        },
      },
    ]);
  });

  test("failed tool_call emits tool_call_end with isError and errorMessage", () => {
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-1",
      name: "Bash",
      status: "failed",
      error: { message: "command not found" },
      detail: { type: "shell", command: "foo" },
    };
    expect(timelineItemToSimulationEvents({ ctx: CTX, item, time: 11 })).toEqual([
      {
        time: 11,
        sessionId: "agent-root",
        type: "tool_call_end",
        payload: {
          agent: "Main Agent",
          tool: "Bash",
          result: "",
          isError: true,
          errorMessage: "command not found",
        },
      },
    ]);
  });

  test("sub_agent tool_call additionally emits subagent_dispatch/return", () => {
    const runningItem: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-2",
      name: "Task",
      status: "running",
      error: null,
      detail: { type: "sub_agent", description: "Investigate flaky test", log: "" },
    };
    const events = timelineItemToSimulationEvents({ ctx: CTX, item: runningItem, time: 20 });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      time: 20,
      sessionId: "agent-root",
      type: "subagent_dispatch",
      payload: {
        parent: "Main Agent",
        child: "Investigate flaky test",
        task: "Investigate flaky test",
      },
    });

    const completedItem: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-2",
      name: "Task",
      status: "completed",
      error: null,
      detail: { type: "sub_agent", description: "Investigate flaky test", log: "done" },
    };
    const endEvents = timelineItemToSimulationEvents({ ctx: CTX, item: completedItem, time: 21 });
    expect(endEvents).toHaveLength(2);
    expect(endEvents[1]?.type).toBe("subagent_return");
  });

  test("sub_agent dispatch/return child label matches the observed node title rule", () => {
    // The page keys dispatch/return particles on the parent→child edge by
    // child NAME — which is the daemon-frozen observed row title. A named
    // subAgentType must win over the description (title rule), else the
    // particle targets an edge that doesn't exist and silently never renders.
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-6",
      name: "Agent",
      status: "running",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "code-explorer",
        description: "Investigate flaky test",
        log: "",
      },
    };
    const events = timelineItemToSimulationEvents({ ctx: CTX, item, time: 22 });
    expect(events[1]?.payload).toMatchObject({ child: "code-explorer" });

    // Generic catch-all types defer to the description, same as the title.
    const genericItem: AgentTimelineItem = {
      ...item,
      callId: "call-7",
      detail: {
        type: "sub_agent",
        subAgentType: "general-purpose",
        description: "Investigate flaky test",
        log: "",
      },
    };
    const genericEvents = timelineItemToSimulationEvents({ ctx: CTX, item: genericItem, time: 23 });
    expect(genericEvents[1]?.payload).toMatchObject({ child: "Investigate flaky test" });
  });

  test("synthesizeToolCallStart prepends the start a coalesced terminal item never had", () => {
    // The daemon's stream coalescer collapses running -> terminal within its
    // flush window into a single terminal item (live and persisted); the page
    // drops a tool_call_end with no running match, so the stateful layer asks
    // for a synthesized start when it never saw the running snapshot.
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-3",
      name: "Read",
      status: "completed",
      error: null,
      detail: { type: "read", filePath: "/src/auth.ts", content: "142 lines" },
    };
    const events = timelineItemToSimulationEvents({
      ctx: CTX,
      item,
      time: 30,
      synthesizeToolCallStart: true,
    });
    expect(events.map((event) => event.type)).toEqual(["tool_call_start", "tool_call_end"]);
    expect(events[0]).toEqual({
      time: 30,
      sessionId: "agent-root",
      type: "tool_call_start",
      payload: {
        agent: "Main Agent",
        tool: "Read",
        args: "/src/auth.ts",
        inputData: { file_path: "/src/auth.ts" },
      },
    });
    expect(events[1]?.payload).toMatchObject({ tool: "Read", isError: false });
  });

  test("synthesizeToolCallStart on a sub_agent terminal item keeps dispatch/return pairing", () => {
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-4",
      name: "Task",
      status: "completed",
      error: null,
      detail: { type: "sub_agent", description: "Investigate flaky test", log: "done" },
    };
    const events = timelineItemToSimulationEvents({
      ctx: CTX,
      item,
      time: 31,
      synthesizeToolCallStart: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      "tool_call_start",
      "subagent_dispatch",
      "tool_call_end",
      "subagent_return",
    ]);
  });

  test("synthesizeToolCallStart is a no-op on a running item (no double start)", () => {
    const item: AgentTimelineItem = {
      type: "tool_call",
      callId: "call-5",
      name: "Bash",
      status: "running",
      error: null,
      detail: { type: "shell", command: "ls" },
    };
    const events = timelineItemToSimulationEvents({
      ctx: CTX,
      item,
      time: 32,
      synthesizeToolCallStart: true,
    });
    expect(events.map((event) => event.type)).toEqual(["tool_call_start"]);
  });

  test("todo/error/compaction items have no SimulationEvent equivalent", () => {
    expect(
      timelineItemToSimulationEvents({
        ctx: CTX,
        item: { type: "todo", items: [] },
        time: 1,
      }),
    ).toEqual([]);
    expect(
      timelineItemToSimulationEvents({
        ctx: CTX,
        item: { type: "error", message: "oops" },
        time: 1,
      }),
    ).toEqual([]);
    expect(
      timelineItemToSimulationEvents({
        ctx: CTX,
        item: { type: "compaction", status: "completed" },
        time: 1,
      }),
    ).toEqual([]);
  });
});

describe("streamEventToSimulationEvents", () => {
  test("timeline events delegate to timelineItemToSimulationEvents", () => {
    const event: AgentStreamEventPayload = {
      type: "timeline",
      provider: "claude",
      item: { type: "user_message", text: "hi" },
    };
    expect(streamEventToSimulationEvents({ ctx: CTX, event, time: 1 })).toEqual([
      {
        time: 1,
        sessionId: "agent-root",
        type: "message",
        payload: { agent: "Main Agent", content: "hi", role: "user" },
      },
    ]);
  });

  test("turn_completed emits context_update (when usage present) then agent_idle", () => {
    const event: AgentStreamEventPayload = {
      type: "turn_completed",
      provider: "claude",
      usage: { contextWindowUsedTokens: 500 },
    };
    expect(streamEventToSimulationEvents({ ctx: CTX, event, time: 1 })).toEqual([
      {
        time: 1,
        sessionId: "agent-root",
        type: "context_update",
        payload: { agent: "Main Agent", tokens: 500 },
      },
      {
        time: 1,
        sessionId: "agent-root",
        type: "agent_idle",
        payload: { name: "Main Agent", resting: true },
      },
    ]);
  });

  test("turn_completed without usage emits only agent_idle", () => {
    const event: AgentStreamEventPayload = { type: "turn_completed", provider: "claude" };
    expect(streamEventToSimulationEvents({ ctx: CTX, event, time: 1 })).toEqual([
      {
        time: 1,
        sessionId: "agent-root",
        type: "agent_idle",
        payload: { name: "Main Agent", resting: true },
      },
    ]);
  });

  test("turn_failed and turn_canceled both emit agent_idle", () => {
    const failed: AgentStreamEventPayload = {
      type: "turn_failed",
      provider: "claude",
      error: "boom",
    };
    const canceled: AgentStreamEventPayload = {
      type: "turn_canceled",
      provider: "claude",
      reason: "user",
    };
    expect(streamEventToSimulationEvents({ ctx: CTX, event: failed, time: 1 })[0]?.type).toBe(
      "agent_idle",
    );
    expect(streamEventToSimulationEvents({ ctx: CTX, event: canceled, time: 1 })[0]?.type).toBe(
      "agent_idle",
    );
  });

  test("permission_requested/resolved map to permission_requested/agent_idle", () => {
    const requested: AgentStreamEventPayload = {
      type: "permission_requested",
      provider: "claude",
      request: { id: "p1", provider: "claude", name: "Bash", kind: "tool" },
    };
    const resolved: AgentStreamEventPayload = {
      type: "permission_resolved",
      provider: "claude",
      requestId: "p1",
      resolution: { behavior: "allow" },
    };
    expect(streamEventToSimulationEvents({ ctx: CTX, event: requested, time: 1 })).toEqual([
      {
        time: 1,
        sessionId: "agent-root",
        type: "permission_requested",
        payload: { agent: "Main Agent" },
      },
    ]);
    expect(streamEventToSimulationEvents({ ctx: CTX, event: resolved, time: 1 })).toEqual([
      { time: 1, sessionId: "agent-root", type: "agent_idle", payload: { name: "Main Agent" } },
    ]);
  });

  test("thread_started/turn_started/attention_required have no SimulationEvent equivalent", () => {
    const threadStarted: AgentStreamEventPayload = {
      type: "thread_started",
      sessionId: "s1",
      provider: "claude",
    };
    const turnStarted: AgentStreamEventPayload = { type: "turn_started", provider: "claude" };
    const attention: AgentStreamEventPayload = {
      type: "attention_required",
      provider: "claude",
      reason: "finished",
      timestamp: "2026-01-01T00:00:00.000Z",
      shouldNotify: false,
    };
    expect(streamEventToSimulationEvents({ ctx: CTX, event: threadStarted, time: 1 })).toEqual([]);
    expect(streamEventToSimulationEvents({ ctx: CTX, event: turnStarted, time: 1 })).toEqual([]);
    expect(streamEventToSimulationEvents({ ctx: CTX, event: attention, time: 1 })).toEqual([]);
  });
});
