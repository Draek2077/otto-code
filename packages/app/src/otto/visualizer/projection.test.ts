import { describe, expect, it } from "vitest";
import type { StreamItem, AgentToolCallData } from "@/types/stream";
import { VisualizerProjector, visualizerRuntime, type VisualizerAgentInput } from "./projection";
import { canonicalVisualizerPath } from "./file-collisions";
const agent = (overrides: Partial<VisualizerAgentInput> = {}): VisualizerAgentInput => ({
  id: "root",
  parentId: null,
  title: "Same title",
  provider: "openai-compatible",
  model: "local-model",
  cwd: "C:/repo",
  createdAt: 1000,
  updatedAt: 2000,
  phase: "working",
  ...overrides,
});
const message = (text: string, id = "reply"): StreamItem => ({
  kind: "assistant_message",
  id,
  text,
  timestamp: new Date(2000),
});
const tool = (overrides: Partial<AgentToolCallData> = {}): StreamItem => ({
  kind: "tool_call",
  id: "call",
  timestamp: new Date(2000),
  payload: {
    source: "agent",
    data: {
      callId: "call",
      name: "write_file",
      provider: "openai-compatible",
      status: "running",
      error: null,
      detail: { type: "write", filePath: "src/test.ts", content: "hello" },
      ...overrides,
    },
  },
});
function input(agents = [agent()], rows: StreamItem[] = []) {
  return { agents, timelines: new Map([["root", rows]]) };
}
function completedToolRows() {
  return Array.from({ length: 40 }, (_, index) => ({
    ...tool({ callId: `call-${index}`, status: "completed" }),
    id: `row-${index}`,
  }));
}
describe("canonical Visualizer projection", () => {
  it("reactivates a closed session without inventing a new chat identity", () => {
    const projector = new VisualizerProjector();
    projector.update(input([agent({ phase: "closed" })]));
    expect(
      projector.update(input()).events.filter((event) => event.type === "agent_spawn"),
    ).toEqual([
      expect.objectContaining({
        sessionId: "root",
        payload: expect.objectContaining({ name: "root" }),
      }),
    ]);
  });
  it("keeps a closed parent's session live while a real child is still working", () => {
    const result = new VisualizerProjector().update(
      input([agent({ phase: "closed" }), agent({ id: "child", parentId: "root" })]),
    );
    expect(result.sessions[0]).toMatchObject({ id: "root", status: "active" });
  });
  it.each(["openai-compatible", "brain", "plugin:custom"])(
    "uses a neutral runtime mark for %s",
    (provider) => {
      expect(visualizerRuntime(provider)).toBe("openai-compat");
    },
  );
  it("does not re-read immutable history rows for unrelated directory revisions", () => {
    let reads = 0;
    const row = message("History");
    Object.defineProperty(row, "text", {
      get() {
        reads++;
        return "History";
      },
    });
    const projector = new VisualizerProjector();
    projector.update(input([agent()], [row]));
    for (let index = 0; index < 20; index++)
      projector.update(input([agent({ title: `Title ${index}` })], [row]));
    expect(reads).toBe(1);
  });
  it("registers an empty root before any history arrives", () => {
    const result = new VisualizerProjector().update(input());
    expect(result.sessions).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "agent_spawn",
      sessionId: "root",
      payload: { name: "root", isMain: true },
    });
  });
  it("uses stable ids for equal titles and preserves child parent/root identity", () => {
    const result = new VisualizerProjector().update(
      input([agent(), agent({ id: "second" }), agent({ id: "child", parentId: "root" })]),
    );
    expect(result.sessions.map((item) => item.id)).toEqual(["root", "second"]);
    expect(
      result.events.filter((item) => item.type === "agent_spawn").map((item) => item.payload.name),
    ).toEqual(["root", "second", "child"]);
    expect(result.events.find((item) => item.payload.name === "child")).toMatchObject({
      sessionId: "root",
      payload: { parent: "root" },
    });
  });
  it("does not emit unchanged canonical rows or state twice", () => {
    const projector = new VisualizerProjector(),
      state = input([agent()], [message("Hello")]);
    projector.update(state);
    expect(projector.update(state).events).toEqual([]);
  });
  it("keeps a streaming message's canonical id as its text changes", () => {
    const projector = new VisualizerProjector();
    projector.update(input([agent()], [message("Hel")]));
    const changes = projector.update(input([agent()], [message("Hello")]));
    expect(changes.events.filter((event) => event.type === "message")).toEqual([
      expect.objectContaining({
        payload: { agent: "root", content: "Hello", messageId: "reply", role: "assistant" },
      }),
    ]);
  });
  it("does not restart an existing tool on its terminal update", () => {
    const projector = new VisualizerProjector();
    projector.update(input([agent()], [tool()]));
    const changes = projector.update(input([agent()], [tool({ status: "completed" })]));
    expect(changes.events.some((event) => event.type === "tool_call_start")).toBe(false);
    expect(changes.events.find((event) => event.type === "tool_call_end")).toMatchObject({
      payload: { callId: "call", isError: false },
    });
  });
  it("replays completed tools with start and terminal events", () => {
    const result = new VisualizerProjector().update(
      input([agent()], [tool({ status: "completed" })]),
    );
    expect(
      result.events
        .filter((event) => event.type.startsWith("tool_call_"))
        .map((event) => event.type),
    ).toEqual(["tool_call_start", "tool_call_end"]);
  });
  it("retains failed tool identity, bounded diagnostics and error discovery", () => {
    const result = new VisualizerProjector().update(
      input([agent()], [tool({ status: "failed", error: "Denied" })]),
    );
    expect(result.events.find((event) => event.type === "tool_call_end")).toMatchObject({
      payload: {
        callId: "call",
        isError: true,
        errorMessage: "Denied",
        discovery: { type: "error", content: "Denied" },
      },
    });
  });
  it("does not describe a canceled tool as a failed tool", () => {
    const result = new VisualizerProjector().update(
      input([agent()], [tool({ status: "canceled" })]),
    );
    expect(result.events.find((event) => event.type === "tool_call_end")).toMatchObject({
      payload: { result: "Canceled", isError: false },
    });
  });
  it("never invents a token count or price for an unpriced provider", () => {
    const events = new VisualizerProjector().update(input()).events;
    expect(events.some((event) => event.type === "context_update")).toBe(false);
  });
  it("uses reported context occupancy and cost without treating input/output as lifetime totals", () => {
    const events = new VisualizerProjector().update(
      input([
        agent({
          usage: {
            contextWindowUsedTokens: 123,
            contextWindowMaxTokens: 456,
            totalCostUsd: 0.01,
            inputTokens: 500,
          },
        }),
      ]),
    ).events;
    expect(events.find((event) => event.type === "context_update")?.payload).toEqual({
      agent: "root",
      tokens: 123,
      tokensMax: 456,
      costUsd: 0.01,
      contextKnown: true,
    });
  });
  it.each(["working", "idle", "waiting", "closed", "error"] as const)(
    "projects %s from real lifecycle state",
    (phase) => {
      const result = new VisualizerProjector().update(input([agent({ phase })]));
      const end = result.events.at(-1);
      if (phase === "waiting") expect(end?.type).toBe("permission_requested");
      else if (phase === "closed") expect(end?.type).toBe("agent_complete");
      else
        expect(end).toMatchObject({
          type: "agent_idle",
          payload: {
            working: phase === "working",
            resting: phase === "idle",
            error: phase === "error",
          },
        });
    },
  );
  it("bounds history/message size without mutating the canonical rows", () => {
    const rows = Array.from({ length: 300 }, (_, index) =>
      message("a".repeat(20000), `reply-${index}`),
    );
    const result = new VisualizerProjector().update(input([agent()], rows));
    expect(result.truncated).toBe(true);
    expect(result.events.filter((event) => event.type === "message")).toHaveLength(256);
    expect(
      String(result.events.find((event) => event.type === "message")?.payload.content).length,
    ).toBeLessThan(12010);
    expect(rows[0]).toMatchObject({ text: "a".repeat(20000) });
  });
  it("survives corrupt parent cycles without looping or merging roots", () => {
    const result = new VisualizerProjector().update(
      input([agent({ parentId: "second" }), agent({ id: "second", parentId: "root" })]),
    );
    expect(result.sessions).toHaveLength(2);
  });
  it("detects near-time writes by different agents to the same host path", () => {
    const result = new VisualizerProjector().update({
      agents: [agent(), agent({ id: "second" })],
      timelines: new Map([
        ["root", [tool()]],
        ["second", [tool()]],
      ]),
    });
    expect(result.events.find((event) => event.type === "file_collision")).toMatchObject({
      payload: { leftAgent: "root", rightAgent: "second", fileIdentity: "c:/repo/src/test.ts" },
    });
    expect(result.files.has("c:/repo/src/test.ts")).toBe(true);
  });
  it("normalizes Windows identity while preserving host scope and rejecting unresolved paths", () => {
    expect(canonicalVisualizerPath("C:\\REPO\\src\\..\\a.ts", "C:/repo")).toBe("c:/repo/a.ts");
    expect(canonicalVisualizerPath("a.ts", "")).toBeNull();
  });
  it("bounds pairwise collisions while retaining every admitted agent and tool result", () => {
    const agents = Array.from({ length: 64 }, (_, index) => agent({ id: `agent-${index}` }));
    const timelines = new Map(agents.map((value) => [value.id, completedToolRows()]));
    const result = new VisualizerProjector().update({ agents, timelines });
    expect(result.events.filter((event) => event.type === "agent_spawn")).toHaveLength(64);
    expect(result.events.filter((event) => event.type === "tool_call_end")).toHaveLength(64 * 27);
    expect(result.events.filter((event) => event.type === "file_collision")).toHaveLength(128);
    expect(result.events.length).toBeLessThan(6000);
    expect(result.truncated).toBe(true);
  });
});
