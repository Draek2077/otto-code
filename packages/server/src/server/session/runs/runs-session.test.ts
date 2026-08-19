import { describe, expect, it, vi } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { RunsSession, type RunsSessionOptions } from "./runs-session.js";

// The runs.* RPCs the domain dispatches, with the response type each must answer.
// session.ts keeps one registration line for the whole domain, so this is the
// contract that line relies on.
const graph = { id: "g1", name: "G", nodes: [], edges: [], inputs: [], builtIn: true };
const template = { id: "t1", name: "T", prompt: "p", builtIn: true };

const cases: Array<[SessionInboundMessage, string]> = [
  [{ type: "runs.get_snapshot.request", requestId: "r" }, "runs.get_snapshot.response"],
  [
    { type: "runs.gate_respond.request", requestId: "r", runId: "run", approved: true },
    "runs.gate_respond.response",
  ],
  [{ type: "runs.cancel.request", requestId: "r", runId: "run" }, "runs.cancel.response"],
  [{ type: "runs.clear.request", requestId: "r" }, "runs.clear.response"],
  [{ type: "runs.delete.request", requestId: "r", runId: "run" }, "runs.delete.response"],
  [{ type: "runs.graphs.list.request", requestId: "r" }, "runs.graphs.list.response"],
  [
    { type: "runs.graphs.save.request", requestId: "r", graph } as unknown as SessionInboundMessage,
    "runs.graphs.save.response",
  ],
  [
    { type: "runs.graphs.delete.request", requestId: "r", graphId: "g1" },
    "runs.graphs.delete.response",
  ],
  [{ type: "runs.templates.list.request", requestId: "r" }, "runs.templates.list.response"],
  [
    {
      type: "runs.templates.save.request",
      requestId: "r",
      template,
    } as unknown as SessionInboundMessage,
    "runs.templates.save.response",
  ],
  [
    { type: "runs.templates.delete.request", requestId: "r", templateId: "t1" },
    "runs.templates.delete.response",
  ],
  [
    { type: "runs.start.request", requestId: "r", flavor: "autonomous", cwd: "/w" },
    "runs.start.response",
  ],
];

function buildSession(overrides: Partial<RunsSessionOptions> = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const runService = {
    listRuns: vi.fn(() => []),
    respondToGate: vi.fn(() => true),
    cancelRun: vi.fn(() => true),
    clearFinishedRuns: vi.fn(async () => []),
    deleteRun: vi.fn(async () => ({ deleted: true })),
  };
  const graphStore = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const promptTemplateStore = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const session = new RunsSession({
    host: {
      emit: (msg) => emitted.push(msg),
      createOttoWorktree: vi.fn(),
      scheduleAutoTitle: vi.fn(),
    },
    runService: runService as unknown as RunsSessionOptions["runService"],
    graphStore: graphStore as unknown as RunsSessionOptions["graphStore"],
    nodeOutputStore: null,
    promptTemplateStore:
      promptTemplateStore as unknown as RunsSessionOptions["promptTemplateStore"],
    agentManager: {} as RunsSessionOptions["agentManager"],
    agentStorage: {} as RunsSessionOptions["agentStorage"],
    terminalManager: null,
    providerSnapshotManager: {} as RunsSessionOptions["providerSnapshotManager"],
    daemonConfigStore: {} as RunsSessionOptions["daemonConfigStore"],
    agentUpdates: {} as RunsSessionOptions["agentUpdates"],
    ottoHome: "/otto",
    worktreesRoot: undefined,
    logger: {
      child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as RunsSessionOptions["logger"],
    ...overrides,
  });
  return { session, emitted, runService, graphStore, promptTemplateStore };
}

describe("RunsSession", () => {
  it.each(cases)("answers %j with the matching response", async (msg, responseType) => {
    // runs.start is exercised on a host without orchestration: the domain must still
    // answer, with the error in the payload, rather than throw out of the dispatcher.
    const { session, emitted } = buildSession(
      msg.type === "runs.start.request" ? { runService: null, graphStore: null } : {},
    );
    const handled = session.dispatch(msg);
    await handled;
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe(responseType);
    expect((emitted[0] as { payload: { requestId: string } }).payload.requestId).toBe("r");
  });

  it("refuses to delete a built-in graph and says so in the response", async () => {
    const { session, emitted, graphStore } = buildSession();
    graphStore.get.mockResolvedValueOnce(graph as never);
    await session.dispatch({ type: "runs.graphs.delete.request", requestId: "r", graphId: "g1" });
    expect(graphStore.delete).not.toHaveBeenCalled();
    expect(emitted[0]).toMatchObject({
      type: "runs.graphs.delete.response",
      payload: {
        deleted: false,
        error: "Built-in starter graphs can't be deleted.",
        requestId: "r",
      },
    });
  });

  it("returns undefined for messages outside the domain so the dispatch chain continues", () => {
    const { session, emitted } = buildSession();
    expect(session.dispatch({ type: "ping" } as unknown as SessionInboundMessage)).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });
});
