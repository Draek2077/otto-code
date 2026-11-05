import type { WorkflowLaunch } from "@getpaseo/plugin/otto/workflows";
import { workflowFixture, aiDocument } from "./fixture.js";
import { WorkflowHost } from "../host.js";
import type { WorkflowAgentRequest, WorkflowRuntimePorts } from "../runtime-ports.js";
import type { RunEngineAwaitResult } from "../workflow-engine.js";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
export async function workflowHostFixture() {
  const f = await workflowFixture();
  const agents = new Map<string, WorkflowAgentRequest>();
  const canceled: string[] = [];
  const closed: string[] = [];
  const turns: Array<{ id: string; text: string }> = [];
  const notices: Array<{ id: string; text: string }> = [];
  let listener: ((agentId: string, state: "archived" | "deleted" | "canceled") => void) | null =
    null;
  let subscriptions = 0;
  const hooks: {
    create?: (request: WorkflowAgentRequest) => Promise<void>;
    turn?: (
      request: WorkflowAgentRequest,
      text: string,
      signal: AbortSignal,
    ) => Promise<RunEngineAwaitResult>;
    validate?: WorkflowRuntimePorts["validateSeat"];
    close?: (id: string) => Promise<void>;
  } = {};
  const ports: WorkflowRuntimePorts = {
    waitUntilIdle: async () => {},
    notice: async (id, text) => {
      notices.push({ id, text });
    },
    workspace: async (scope, id) => ({ workspaceId: id, projectId: scope.projectId, cwd: f.repo }),
    validateSeat: async (...args) => (hooks.validate ? hooks.validate(...args) : []),
    createAgent: async (request) => {
      agents.set(request.agentId, request);
      await hooks.create?.(request);
    },
    turn: async (id, text, signal) => {
      turns.push({ id, text });
      const request = agents.get(id);
      if (!request) throw new Error("No fake session");
      return hooks.turn
        ? hooks.turn(request, text, signal)
        : { failed: false, finalMessage: `Output from ${request.role}` };
    },
    cancelAgent: async (id) => {
      canceled.push(id);
    },
    closeAgent: async (id) => {
      closed.push(id);
      await hooks.close?.(id);
    },
    ownsAgent: async (id, run, owner) => {
      const request = agents.get(id);
      return request?.runId === run && request.ownerInstance === owner;
    },
    observe: (callback) => {
      listener = callback;
      subscriptions++;
      return () => {
        listener = null;
        subscriptions--;
      };
    },
    now: () => new Date().toISOString(),
    logger: { info() {}, warn() {}, error() {} },
  };
  const host = new WorkflowHost(f.library, ports);
  await host.initialize();
  const ai: WorkflowLaunch = { kind: "ai", definition: aiDocument().value };
  const graph: WorkflowLaunch = {
    kind: "graph",
    graph: {
      id: "graph",
      name: "Graph",
      nodes: [
        { id: "root", kind: "orchestrator", title: "Root" },
        { id: "worker", kind: "agent", title: "Worker", prompt: "Do the work" },
      ],
      edges: [{ from: "root", to: "worker" }],
    },
    inputs: {},
    seats: ai.definition.seats,
    limits: ai.definition.limits,
  };
  return {
    ...f,
    host,
    ports,
    hooks,
    agents,
    canceled,
    closed,
    turns,
    notices,
    ai,
    graph,
    subscriptions: () => subscriptions,
    event: (id: string, state: "archived" | "deleted" | "canceled") => listener?.(id, state),
    async start(launch: WorkflowLaunch = ai, operationId = "operation-1") {
      const review = await host.review(f.scope, "workspace-1", launch, operationId);
      return host.start(f.scope, review.token, operationId);
    },
    async cleanup() {
      await host.close();
      await f.cleanup();
    },
  };
}
