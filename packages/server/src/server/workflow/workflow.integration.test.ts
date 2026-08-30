import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { PromptTemplate, Run, RunPhase, RunPlan } from "@otto-code/protocol/workflow";
import {
  ORCHESTRATION_RUN_ID_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "@otto-code/protocol/agent-labels";

import { createTestOttoDaemon, type TestOttoDaemon } from "../test-utils/otto-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import {
  createTestAgentClients,
  type TestAgentPromptContext,
  type TestAgentPromptOutcome,
} from "../test-utils/fake-agent-client.js";
import { RunStore } from "./workflow-run-file-store.js";
import { WorkflowService, type GraphSpawnPort, type RunSpawnPort } from "./workflow-service.js";
import { summarizeRunOutput, type RunEngineCaps } from "./workflow-engine.js";
import { renderPromptTemplate, resolveTemplateVariables } from "./prompt-render.js";
import { STARTER_GRAPHS } from "./starter-graphs.js";

// Loop A - the deterministic integration layer. Unlike run-engine/run-service
// unit tests (which fake the spawn seam entirely), this drives the engine
// through REAL child agents spawned on a live in-process daemon. The agents are
// FakeAgentClients (no model, no tokens), scripted with exact test responses so
// the whole run is deterministic - but every hop the production start_workflow
// path takes is exercised: createAgent → session → agentManager → child turn →
// waitForAgentUpsert(idle) → getLastAssistantMessage → WorkflowService persist/emit.
//
// The spawn port here mirrors the one otto-tools.ts assembles inside start_workflow;
// team-role resolution is stubbed (covered by resolve-team-role.test.ts) so the
// focus stays on the real spawn/await/gather wiring.

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

interface IntegrationHarness {
  daemon: TestOttoDaemon;
  client: DaemonClient;
  cwd: string;
}

let harness: IntegrationHarness;
let activeWorkflowResponder: WorkflowResponder | null = null;

beforeAll(async () => {
  const daemon = await createTestOttoDaemon({
    logger: undefined,
    agentClients: createTestAgentClients({
      assistantOutcomeForPrompt(input) {
        return activeWorkflowResponder?.respond(input);
      },
    }),
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.70",
  });
  await client.connect();
  // Required handshake before the session processes other requests.
  await client.fetchAgents({ subscribe: { subscriptionId: "orchestration-int" } });
  harness = { daemon, client, cwd: daemon.ottoHome };
}, 40_000);

afterAll(async () => {
  await harness?.client.close().catch(() => undefined);
  await harness?.daemon.close().catch(() => undefined);
});

afterEach(() => {
  activeWorkflowResponder = null;
});

interface SpawnPortHooks {
  /** Records the effective task each phase's child was actually spawned with. */
  composedTasks: Map<string, string>;
  /** Total children spawned (to assert a hard-fail spawns none). */
  spawnCount: { value: number };
  /** A role the "team" lacks - resolveRole returns null for it. */
  missingRole?: string;
}

function makeIntegrationSpawnPort(hooks: SpawnPortHooks): RunSpawnPort {
  return {
    async resolveRole(role) {
      if (role === hooks.missingRole) {
        return null;
      }
      return { personalityId: `p_${role}` };
    },
    async spawn(input) {
      hooks.composedTasks.set(`${input.phaseId}#${input.attempt}.${input.index}`, input.task);
      hooks.spawnCount.value += 1;
      const agent = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: input.task,
      });
      return { agentId: agent.id, personalityId: `p_${input.role}` };
    },
    async awaitAgent({ agentId, signal }) {
      // Mirror the production port (otto-tools): wait for the worker's whole
      // subtree to settle, not just its first idle. quietMs is shortened here so
      // the deterministic suite stays fast; the logic is identical to production.
      const result = await harness.daemon.daemon.agentManager.waitForAgentFullySettled(agentId, {
        signal,
        quietMs: 300,
      });
      const finalMessage =
        result.lastMessage ??
        (await harness.daemon.daemon.agentManager.getLastAssistantMessage(agentId));
      return { finalMessage: finalMessage ?? null, failed: result.status === "error" };
    },
  };
}

interface GraphSpawnPortHooks {
  /** The fully assembled Graph tasks received by the fake-worker sessions. */
  composedTasks: Map<string, string>;
  /** Completion notices sent back to the Graph's already-created Orchestrator. */
  notifications: string[];
  /** Live children, used only by cancellation/timeout proof cases. */
  spawnedAgentIds?: string[];
  /** Optional production-equivalent node-template renderer. */
  renderPromptTemplate?: GraphSpawnPort["renderPromptTemplate"];
}

interface ScriptedWorkflowTurn {
  name: string;
  marker: string;
  taskIncludes: string[];
  outcome: TestAgentPromptOutcome;
}

interface WorkflowResponder {
  respond(input: TestAgentPromptContext): TestAgentPromptOutcome | undefined;
  assertConsumed(): void;
}

/**
 * Exercises the existing fake provider as a Workflow cast: every scripted
 * worker must receive its expected fully assembled task before it can produce
 * its exact response. Unrelated prompts retain normal fake-provider behavior.
 */
function createWorkflowResponder(turns: readonly ScriptedWorkflowTurn[]): WorkflowResponder {
  const remaining = [...turns];
  return {
    respond({ prompt }) {
      const matched = remaining.find((turn) => prompt.includes(turn.marker));
      if (!matched) {
        return undefined;
      }
      const expected = remaining[0];
      if (!expected || expected !== matched) {
        throw new Error(`Workflow fake received "${matched.name}" out of order.`);
      }
      for (const expectedFragment of expected.taskIncludes) {
        if (!prompt.includes(expectedFragment)) {
          throw new Error(`Workflow fake "${expected.name}" did not receive: ${expectedFragment}`);
        }
      }
      remaining.shift();
      return expected.outcome;
    },
    assertConsumed() {
      if (remaining.length > 0) {
        throw new Error(
          `Workflow fake did not run: ${remaining.map((turn) => turn.name).join(", ")}`,
        );
      }
    },
  };
}

/**
 * The Graph equivalent of makeIntegrationSpawnPort. The workers are real
 * FakeAgentClient sessions on the in-process daemon; only their final response
 * is made deterministic. That exercises Graph run persistence, task assembly,
 * child lifecycle and structured-output recovery without an external model.
 */
function makeGraphIntegrationSpawnPort(hooks: GraphSpawnPortHooks): GraphSpawnPort {
  return {
    async spawn(input) {
      hooks.composedTasks.set(`${input.nodeId}#${input.attempt}.${input.purpose}`, input.task);
      const agent = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: input.task,
      });
      hooks.spawnedAgentIds?.push(agent.id);
      return { agentId: agent.id };
    },
    async awaitAgent({ agentId, signal }) {
      const result = await harness.daemon.daemon.agentManager.waitForAgentFullySettled(agentId, {
        signal,
        quietMs: 300,
      });
      const finalMessage =
        result.lastMessage ??
        (await harness.daemon.daemon.agentManager.getLastAssistantMessage(agentId));
      return { finalMessage: finalMessage ?? null, failed: result.status === "error" };
    },
    async cancelAgent({ agentId }) {
      await harness.daemon.daemon.agentManager.cancelAgentRun(agentId);
    },
    async notifyOrchestrator({ text }) {
      hooks.notifications.push(text);
    },
    ...(hooks.renderPromptTemplate ? { renderPromptTemplate: hooks.renderPromptTemplate } : {}),
  };
}

function allVerdictsPass(candidates: readonly { verdict?: { verdict: string } }[]): boolean {
  return candidates.every((c) => c.verdict?.verdict === "pass");
}

// Small extractors so assertions don't nest a callback 4 deep (lint cap).
function phaseById(run: Run, id: string): RunPhase | undefined {
  return run.phases.find((p) => p.id === id);
}
function phaseStatuses(run: Run): string[] {
  return run.phases.map((p) => p.status);
}
function phaseIds(run: Run): string[] {
  return run.phases.map((p) => p.id);
}
function allPhasesDone(run: Run): boolean {
  return run.phases.every((p) => p.status === "done");
}
async function waitForSpawnedAgent(spawnedAgentIds: readonly string[]): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const agentId = spawnedAgentIds[0];
    if (agentId) {
      return agentId;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Graph worker did not spawn within 2.5 seconds");
}
async function waitForAgentLifecycle(agentId: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (harness.daemon.daemon.agentManager.getAgent(agentId)?.lifecycle === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Graph worker did not become ${expected} within 2.5 seconds`);
}
async function waitForRunStatus(
  service: WorkflowService,
  runId: string,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.getRun(runId)?.status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not become ${expected} within 2.5 seconds`);
}

async function waitForDaemonRunStatus(runId: string, expected: string): Promise<Run> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = (await harness.client.getRunsSnapshot()).find(
      (candidate) => candidate.id === runId,
    );
    if (run?.status === expected) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Daemon run ${runId} did not become ${expected} within 10 seconds`);
}
function briefToDecisionStarter() {
  const graph = STARTER_GRAPHS.find((candidate) => candidate.id === "starter-brief-to-decision");
  if (!graph) {
    throw new Error("Brief to Decision starter Graph is missing");
  }
  return graph;
}
function triageStarter() {
  const graph = STARTER_GRAPHS.find((candidate) => candidate.id === "starter-triage");
  if (!graph) {
    throw new Error("Triage starter Graph is missing");
  }
  return graph;
}
function researchBuildVerifyStarter() {
  const graph = STARTER_GRAPHS.find(
    (candidate) => candidate.id === "starter-research-build-verify",
  );
  if (!graph) {
    throw new Error("Research Build Verify starter Graph is missing");
  }
  return graph;
}
function templatedBriefToDecisionGraph() {
  const graph = briefToDecisionStarter();
  const briefIndex = graph.nodes.findIndex((node) => node.id === "brief");
  const brief = graph.nodes[briefIndex];
  if (!brief) {
    throw new Error("Brief to Decision starter has no research node");
  }
  const nodes = [...graph.nodes];
  nodes[briefIndex] = {
    ...brief,
    prompt: "Inline template fallback should not be used.",
    promptTemplate: {
      templateId: "workflow-research-template",
      variables: { question: "$inputs.question" },
    },
  };
  return {
    ...graph,
    id: "test-templated-brief-to-decision",
    nodes,
  };
}
function retryingBriefToDecisionGraph() {
  const graph = briefToDecisionStarter();
  const briefIndex = graph.nodes.findIndex((node) => node.id === "brief");
  const brief = graph.nodes[briefIndex];
  if (!brief) {
    throw new Error("Brief to Decision starter has no research node");
  }
  const nodes = [...graph.nodes];
  nodes[briefIndex] = { ...brief, retry: { maxAttempts: 2, backoffMs: 0 } };
  return {
    ...graph,
    id: "test-brief-to-decision-retry",
    nodes,
  };
}
function timingOutBriefToDecisionGraph() {
  const graph = briefToDecisionStarter();
  const briefIndex = graph.nodes.findIndex((node) => node.id === "brief");
  const brief = graph.nodes[briefIndex];
  if (!brief) {
    throw new Error("Brief to Decision starter has no research node");
  }
  const nodes = [...graph.nodes];
  nodes[briefIndex] = { ...brief, timeoutMs: 1_000 };
  return {
    ...graph,
    id: "test-brief-to-decision-timeout",
    nodes,
  };
}
function gatedBriefToDecisionGraph() {
  const graph = briefToDecisionStarter();
  return {
    ...graph,
    id: "test-brief-to-decision-gate",
    nodes: [
      ...graph.nodes,
      {
        id: "review",
        kind: "gate",
        title: "Review brief",
        prompt: "Review the research brief before the decision is made.",
      },
    ],
    edges: [
      { from: "root", to: "brief" },
      { from: "brief", to: "review" },
      { from: "brief", to: "decision", fields: ["brief"] },
      { from: "review", to: "decision" },
    ],
  };
}

function checkedBriefToDecisionGraph() {
  const graph = briefToDecisionStarter();
  return {
    ...graph,
    id: "test-brief-to-decision-check",
    nodes: [
      ...graph.nodes,
      {
        id: "brief-ready",
        kind: "check",
        title: "Research brief is ready",
        check: {
          expression: "upstream.brief.fields.brief = 'BRIEF_ALPHA'",
          message: "The research brief is not ready for the decision.",
        },
      },
    ],
    edges: [
      { from: "root", to: "brief" },
      { from: "brief", to: "brief-ready" },
      { from: "brief", to: "decision", fields: ["brief"] },
      { from: "brief-ready", to: "decision" },
    ],
  };
}

async function withWorkflowService(
  fn: (service: WorkflowService, store: RunStore) => Promise<void>,
  caps?: RunEngineCaps,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "otto-run-int-"));
  const store = new RunStore(join(dir, "runs"));
  const service = new WorkflowService({ store, logger: silentLogger, ...(caps ? { caps } : {}) });
  try {
    await fn(service, store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("orchestration integration (real fake-backed child agents)", () => {
  test("persists an AI Workflow before its real planning chat settles", async () => {
    const workspace = await harness.client.createWorkspace({
      source: { kind: "directory", path: harness.cwd },
      title: "AI Workflow integration",
    });
    expect(workspace.error).toBeNull();
    if (!workspace.workspace) {
      throw new Error("AI Workflow integration workspace was not created");
    }
    const started = await harness.client.startWorkflow({
      flavor: "ai",
      cwd: harness.cwd,
      workspaceId: workspace.workspace.id,
      title: "Investigate the release blocker",
      description: "Find the cause and report a safe remediation.",
      prompt: "Investigate the release blocker and coordinate the work.",
      orchestratorProvider: "claude",
    });
    expect(started.runId).toBeTruthy();
    expect(started.agentId).toBeTruthy();

    const agent = harness.daemon.daemon.agentManager.getAgent(started.agentId!);
    expect(agent?.labels?.[ORCHESTRATION_RUN_ID_LABEL]).toBe(started.runId);

    // The fake planning agent makes no tool call on its first turn. The record
    // must stay in Planning while the chat is alive (a real orchestrator may
    // ask a clarifying question first), and only become a durable failure once
    // the chat is archived without ever declaring a plan.
    await harness.daemon.daemon.agentManager.waitForAgentFullySettled(started.agentId!, {
      quietMs: 200,
    });
    const planning = (await harness.client.getRunsSnapshot()).find(
      (candidate) => candidate.id === started.runId,
    );
    expect(planning).toMatchObject({
      id: started.runId,
      kind: "ai",
      status: "pending",
      title: "Investigate the release blocker",
      description: "Find the cause and report a safe remediation.",
      conductorAgentId: started.agentId,
    });

    await harness.daemon.daemon.agentManager.archiveAgent(started.agentId!);
    const run = await waitForDaemonRunStatus(started.runId!, "failed");
    expect(run.error).toContain("archived before it declared a workflow plan");
  });

  test("runs the Brief to Decision starter Graph through a durable two-worker hand-off", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = briefToDecisionStarter();
      const responder = createWorkflowResponder([
        {
          name: "research brief",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "message", text: '{"brief":"BRIEF_ALPHA"}' },
        },
        {
          name: "decision",
          marker: "Use the research brief above",
          taskIncludes: ["BRIEF_ALPHA"],
          outcome: { type: "message", text: '{"decision":"DECISION_BETA"}' },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic Graph Workflow.",
      });
      const composedTasks = new Map<string, string>();
      const notifications: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Brief to Decision proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({ composedTasks, notifications }),
      });

      // A launch has a durable Graph projection before the workers settle.
      expect(run.kind).toBe("graph");
      expect(run.graphId).toBe("starter-brief-to-decision");
      expect(run.graphSnapshot).toEqual(graph);
      expect(phaseIds(run)).toEqual(["brief", "decision"]);

      const outcome = await settled;
      expect(outcome.status).toBe("done");
      expect(allPhasesDone(outcome)).toBe(true);
      expect(outcome.phases[0]?.candidates?.[0]?.outputFields).toEqual({ brief: "BRIEF_ALPHA" });
      expect(outcome.phases[1]?.candidates?.[0]?.outputFields).toEqual({
        decision: "DECISION_BETA",
      });
      expect(composedTasks.get("brief#0.worker")).toContain("Which path should the team take?");
      expect(composedTasks.get("decision#0.worker")).toContain("BRIEF_ALPHA");
      expect(notifications.at(-1)).toContain("Every node has settled");
      expect((await store.get(run.id))?.status).toBe("done");
      expect((await store.get(run.id))?.graphSnapshot).toEqual(graph);
      responder.assertConsumed();
    });
  }, 60_000);

  test("pauses a Graph at a human gate and resumes its real downstream worker", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = gatedBriefToDecisionGraph();
      const responder = createWorkflowResponder([
        {
          name: "brief before review",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "message", text: '{"brief":"GATED_BRIEF"}' },
        },
        {
          name: "decision after approval",
          marker: "Use the research brief above",
          taskIncludes: ["GATED_BRIEF"],
          outcome: { type: "message", text: '{"decision":"APPROVED_DECISION"}' },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic attended Graph Workflow.",
      });
      const spawnedAgentIds: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Brief to Decision attended-gate proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({
          composedTasks: new Map(),
          notifications: [],
          spawnedAgentIds,
        }),
      });

      await waitForRunStatus(service, run.id, "paused");
      const paused = service.getRun(run.id);
      expect(paused).not.toBeNull();
      const review = paused ? phaseById(paused, "review") : undefined;
      expect(review).toMatchObject({
        type: "gate",
        status: "blocked",
      });
      expect(spawnedAgentIds).toHaveLength(1);
      expect(
        service.respondToGate({
          runId: run.id,
          phaseId: "review",
          decision: { approved: true, note: "Reviewed." },
        }),
      ).toBe(true);

      const outcome = await settled;
      expect(outcome.status).toBe("done");
      expect(phaseById(outcome, "review")).toMatchObject({
        type: "gate",
        status: "done",
        notes: "Reviewed.",
      });
      expect(phaseById(outcome, "decision")?.candidates?.[0]?.outputFields).toEqual({
        decision: "APPROVED_DECISION",
      });
      expect(spawnedAgentIds).toHaveLength(2);
      expect((await store.get(run.id))?.status).toBe("done");
      responder.assertConsumed();
    });
  }, 60_000);

  test("runs a deterministic Check through the durable daemon Graph lifecycle", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = checkedBriefToDecisionGraph();
      const responder = createWorkflowResponder([
        {
          name: "research brief for check",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "message", text: '{"brief":"BRIEF_ALPHA"}' },
        },
        {
          name: "decision after check",
          marker: "Use the research brief above",
          taskIncludes: ["BRIEF_ALPHA"],
          outcome: { type: "message", text: '{"decision":"DECISION_BETA"}' },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic checked Graph Workflow.",
      });
      const composedTasks = new Map<string, string>();
      const notifications: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Checked Brief to Decision proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({ composedTasks, notifications }),
      });

      const outcome = await settled;
      expect(outcome.error).toBeUndefined();
      expect(outcome.status).toBe("done");
      expect(phaseById(outcome, "brief-ready")).toMatchObject({
        type: "check",
        status: "done",
        notes: "Check passed: upstream.brief.fields.brief = 'BRIEF_ALPHA'",
      });
      expect(outcome.agentCount).toBe(2);
      expect(composedTasks.get("decision#0.worker")).toContain("BRIEF_ALPHA");
      expect(notifications).toContain('Check "Research brief is ready" passed.');
      expect((await store.get(run.id))?.graphSnapshot).toEqual(graph);
      responder.assertConsumed();
    });
  }, 60_000);

  test("renders an EJS node template and its stored snippet into the real child task", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = templatedBriefToDecisionGraph();
      const templates = new Map<string, PromptTemplate>([
        [
          "workflow-research-template",
          {
            id: "workflow-research-template",
            name: "Workflow research",
            content:
              "Template research question: <%= question %>\n<%- include('workflow-research-rules') %>",
          },
        ],
        [
          "workflow-research-rules",
          {
            id: "workflow-research-rules",
            name: "Workflow research rules",
            snippet: true,
            content: "Return only a JSON object with the requested fields.",
          },
        ],
      ]);
      const responder = createWorkflowResponder([
        {
          name: "EJS-rendered research brief",
          marker: "Template research question",
          taskIncludes: [
            "What should the release do?",
            "Return only a JSON object with the requested fields.",
          ],
          outcome: { type: "message", text: '{"brief":"TEMPLATED_BRIEF"}' },
        },
        {
          name: "decision from templated brief",
          marker: "Use the research brief above",
          taskIncludes: ["TEMPLATED_BRIEF"],
          outcome: { type: "message", text: '{"decision":"TEMPLATED_DECISION"}' },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic EJS Graph Workflow.",
      });
      const composedTasks = new Map<string, string>();
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "What should the release do?" },
        title: "EJS template execution proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({
          composedTasks,
          notifications: [],
          renderPromptTemplate: async ({ ref, graphInputs, upstreamFields }) => {
            const template = templates.get(ref.templateId);
            if (!template) {
              return null;
            }
            return renderPromptTemplate({
              template,
              variables: resolveTemplateVariables({
                bindings: ref.variables,
                graphInputs,
                upstreamFields,
              }),
              resolveSnippet: (id) => templates.get(id) ?? null,
            });
          },
        }),
      });

      const outcome = await settled;
      expect(outcome.status).toBe("done");
      expect(composedTasks.get("brief#0.worker")).toContain("Template research question");
      expect(composedTasks.get("brief#0.worker")).toContain(
        "Return only a JSON object with the requested fields.",
      );
      expect(phaseById(outcome, "decision")?.candidates?.[0]?.outputFields).toEqual({
        decision: "TEMPLATED_DECISION",
      });
      expect((await store.get(run.id))?.status).toBe("done");
      responder.assertConsumed();
    });
  }, 60_000);

  test("stops a Graph before a second child would exceed its agent cap", async () => {
    await withWorkflowService(
      async (service, store) => {
        const graph = briefToDecisionStarter();
        const responder = createWorkflowResponder([
          {
            name: "only permitted research brief",
            marker: "Research this question",
            taskIncludes: ["Which path should the team take?"],
            outcome: { type: "message", text: '{"brief":"CAP_BRIEF"}' },
          },
        ]);
        activeWorkflowResponder = responder;
        const orchestrator = await harness.client.createAgent({
          provider: "claude",
          cwd: harness.cwd,
          initialPrompt: "Host the deterministic capped Graph Workflow.",
        });
        const spawnedAgentIds: string[] = [];
        const { run, settled } = service.startGraphRun({
          graph,
          graphInputs: { question: "Which path should the team take?" },
          title: "Brief to Decision cap proof",
          orchestratorAgentId: orchestrator.id,
          cwd: harness.cwd,
          spawnPort: makeGraphIntegrationSpawnPort({
            composedTasks: new Map(),
            notifications: [],
            spawnedAgentIds,
          }),
        });

        const outcome = await settled;
        expect(outcome.status).toBe("failed");
        expect(outcome.error).toContain("Agent cap reached (1)");
        expect(outcome.agentCount).toBe(1);
        expect(phaseById(outcome, "brief")?.status).toBe("done");
        expect(phaseById(outcome, "decision")?.status).toBe("failed");
        expect(spawnedAgentIds).toHaveLength(1);
        expect((await store.get(run.id))?.status).toBe("failed");
        responder.assertConsumed();
      },
      { maxConcurrency: 1, maxAgents: 1, maxLoopAttempts: 1 },
    );
  }, 60_000);

  test("retries an explicitly failed fake worker before handing its output downstream", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = retryingBriefToDecisionGraph();
      const responder = createWorkflowResponder([
        {
          name: "first research attempt",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "failure", error: "Transient research provider failure" },
        },
        {
          name: "retried research attempt",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "message", text: '{"brief":"BRIEF_RECOVERED"}' },
        },
        {
          name: "decision after recovery",
          marker: "Use the research brief above",
          taskIncludes: ["BRIEF_RECOVERED"],
          outcome: { type: "message", text: '{"decision":"DECISION_RECOVERED"}' },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic retry Graph Workflow.",
      });
      const composedTasks = new Map<string, string>();
      const notifications: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Brief to Decision retry proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({ composedTasks, notifications }),
      });

      const outcome = await settled;
      const brief = phaseById(outcome, "brief");
      expect(outcome.status).toBe("done");
      expect(brief?.retryAttempts).toBe(1);
      expect(brief?.candidates).toHaveLength(2);
      expect(brief?.candidates?.[1]?.outputFields).toEqual({ brief: "BRIEF_RECOVERED" });
      expect(phaseById(outcome, "decision")?.candidates?.[0]?.outputFields).toEqual({
        decision: "DECISION_RECOVERED",
      });
      // Graph-engine spawn `attempt` is the node's loop iteration; retries are
      // represented durably by retryAttempts/candidate count instead.
      expect(composedTasks.get("brief#0.worker")).toContain("Which path should the team take?");
      expect(composedTasks.get("decision#0.worker")).toContain("BRIEF_RECOVERED");
      expect(notifications.at(-1)).toContain("Every node has settled");
      expect((await store.get(run.id))?.status).toBe("done");
      responder.assertConsumed();
    });
  }, 60_000);

  test("cancels a held fake worker and skips its downstream Graph node", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = briefToDecisionStarter();
      const responder = createWorkflowResponder([
        {
          name: "held research brief",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "hold" },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic cancellation Graph Workflow.",
      });
      const spawnedAgentIds: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Brief to Decision cancellation proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({
          composedTasks: new Map(),
          notifications: [],
          spawnedAgentIds,
        }),
      });

      const workerId = await waitForSpawnedAgent(spawnedAgentIds);
      await waitForAgentLifecycle(workerId, "running");
      expect(service.cancelRun(run.id)).toBe(true);

      const outcome = await settled;
      expect(outcome.status).toBe("canceled");
      // The active worker was stopped by the user, not by an error: its phase
      // is canceled, downstream work is skipped as canceled, and the run is
      // terminally canceled.
      expect(phaseById(outcome, "brief")?.status).toBe("canceled");
      expect(phaseById(outcome, "decision")?.status).toBe("skipped");
      expect(phaseById(outcome, "decision")?.skipReason).toBe("canceled");
      expect(spawnedAgentIds).toHaveLength(1);
      await waitForAgentLifecycle(workerId, "idle");
      expect((await store.get(run.id))?.status).toBe("canceled");
      responder.assertConsumed();
    });
  }, 60_000);

  test("times out a held fake worker, cancels it, and skips downstream work", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = timingOutBriefToDecisionGraph();
      const responder = createWorkflowResponder([
        {
          name: "held time-limited research brief",
          marker: "Research this question",
          taskIncludes: ["Which path should the team take?"],
          outcome: { type: "hold" },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic timeout Graph Workflow.",
      });
      const spawnedAgentIds: string[] = [];
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Which path should the team take?" },
        title: "Brief to Decision timeout proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({
          composedTasks: new Map(),
          notifications: [],
          spawnedAgentIds,
        }),
      });

      const workerId = await waitForSpawnedAgent(spawnedAgentIds);
      const outcome = await settled;
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toContain("time limit");
      expect(phaseById(outcome, "brief")?.status).toBe("failed");
      expect(phaseById(outcome, "brief")?.timedOut).toBe(true);
      expect(phaseById(outcome, "decision")?.status).toBe("skipped");
      expect(phaseById(outcome, "decision")?.skipReason).toBe("upstream-failed");
      expect(spawnedAgentIds).toHaveLength(1);
      await waitForAgentLifecycle(workerId, "idle");
      expect((await store.get(run.id))?.status).toBe("failed");
      responder.assertConsumed();
    });
  }, 60_000);

  test("routes structured triage output down one conditional branch and reviews it", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = triageStarter();
      const responder = createWorkflowResponder([
        {
          name: "triage classifier",
          marker: "Decide how much work this question deserves",
          taskIncludes: ["Can we rename this heading?"],
          outcome: {
            type: "message",
            text: '{"complexity":"simple","rationale":"The edit is isolated."}',
          },
        },
        {
          name: "quick branch",
          marker: "Answer this directly and briefly",
          taskIncludes: ["Can we rename this heading?"],
          outcome: { type: "message", text: "QUICK_ANSWER" },
        },
        {
          name: "branch review",
          marker: "Review the answer above",
          taskIncludes: ["QUICK_ANSWER"],
          outcome: { type: "message", text: "REVIEWED_QUICK_ANSWER" },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic triage Graph Workflow.",
      });
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { question: "Can we rename this heading?" },
        title: "Triage conditional-edge proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({
          composedTasks: new Map(),
          notifications: [],
        }),
      });

      const outcome = await settled;
      expect(outcome.status).toBe("done");
      expect(phaseById(outcome, "classify")?.candidates?.[0]?.outputFields).toEqual({
        complexity: "simple",
        rationale: "The edit is isolated.",
      });
      expect(phaseById(outcome, "quick")?.status).toBe("done");
      expect(phaseById(outcome, "deep")?.status).toBe("skipped");
      expect(phaseById(outcome, "deep")?.skipReason).toBe("condition");
      expect(phaseById(outcome, "review")?.status).toBe("done");
      expect(phaseById(outcome, "review")?.candidates?.[0]?.summary).toContain(
        "REVIEWED_QUICK_ANSWER",
      );
      expect((await store.get(run.id))?.status).toBe("done");
      responder.assertConsumed();
    });
  }, 60_000);

  test("feeds a judge failure into the next Graph iteration before it passes", async () => {
    await withWorkflowService(async (service, store) => {
      const graph = researchBuildVerifyStarter();
      const responder = createWorkflowResponder([
        {
          name: "research",
          marker: "Research everything needed to accomplish this goal",
          taskIncludes: ["Ship the scoped change."],
          outcome: { type: "message", text: "RESEARCH_RESULT" },
        },
        {
          name: "plan",
          marker: "Turn the research into a concrete",
          taskIncludes: ["RESEARCH_RESULT"],
          outcome: { type: "message", text: "IMPLEMENTATION_PLAN" },
        },
        {
          name: "first build attempt",
          marker: "Execute the plan",
          taskIncludes: ["IMPLEMENTATION_PLAN"],
          outcome: { type: "message", text: "FIRST_BUILD" },
        },
        {
          name: "first judge verdict",
          marker: "You are judging one candidate's work",
          taskIncludes: ["FIRST_BUILD"],
          outcome: {
            type: "message",
            text: '{"verdict":"fail","summary":"Need stronger proof."}',
          },
        },
        {
          name: "second build attempt",
          marker: "Execute the plan",
          taskIncludes: ["Need stronger proof."],
          outcome: { type: "message", text: "SECOND_BUILD" },
        },
        {
          name: "second judge verdict",
          marker: "You are judging one candidate's work",
          taskIncludes: ["SECOND_BUILD"],
          outcome: {
            type: "message",
            text: '{"verdict":"pass","summary":"The proof is sufficient."}',
          },
        },
      ]);
      activeWorkflowResponder = responder;
      const orchestrator = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: "Host the deterministic judge-loop Graph Workflow.",
      });
      const composedTasks = new Map<string, string>();
      const { run, settled } = service.startGraphRun({
        graph,
        graphInputs: { goal: "Ship the scoped change." },
        title: "Research Build Verify judge-loop proof",
        orchestratorAgentId: orchestrator.id,
        cwd: harness.cwd,
        spawnPort: makeGraphIntegrationSpawnPort({ composedTasks, notifications: [] }),
      });

      const outcome = await settled;
      const build = phaseById(outcome, "build");
      expect(outcome.status).toBe("done");
      expect(build?.status).toBe("done");
      expect(build?.notes).toBe("Passed judge on iteration 2 of 3.");
      expect(build?.candidates).toHaveLength(4);
      expect(build?.candidates?.[1]?.verdict?.verdict).toBe("fail");
      expect(build?.candidates?.[3]?.verdict?.verdict).toBe("pass");
      expect(composedTasks.get("build#1.worker")).toContain("Need stronger proof.");
      expect((await store.get(run.id))?.status).toBe("done");
      responder.assertConsumed();
    });
  }, 60_000);

  test("threads a real upstream child's output into the dependent phase and comes full circle", async () => {
    await withWorkflowService(async (service, store) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks,
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Haiku then note",
        phases: [
          {
            id: "haiku",
            type: "implement",
            title: "Write haiku",
            task: "Write a haiku about caching. respond with exactly: HAIKU_ALPHA",
          },
          {
            id: "note",
            type: "deliver",
            title: "Combine into note",
            task: "Combine the haiku into a note. respond with exactly: NOTE_BETA",
            dependsOn: ["haiku"],
          },
        ],
      };

      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });

      // The real child produced its scripted output, gathered back into the run.
      expect(outcome.status).toBe("done");
      expect(outcome.phases[0]?.candidates?.[0]?.summary).toBe("HAIKU_ALPHA");

      // The dependent phase's child was spawned with the upstream output folded in.
      const noteTask = composedTasks.get("note#0.0");
      expect(noteTask).toContain("HAIKU_ALPHA");
      expect(noteTask).toContain("Combine the haiku into a note");

      // Full circle: the run's headline deliverable is the final phase's output.
      expect(summarizeRunOutput(outcome)).toBe("NOTE_BETA");

      // Persisted to disk as done.
      expect((await store.get(run.id))?.status).toBe("done");
    });
  }, 60_000);

  test("pauses at a gate between two real phases and resumes on approval", async () => {
    await withWorkflowService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Plan, approve, build",
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Outline it. respond with exactly: THE_PLAN",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
            dependsOn: ["gate"],
          },
        ],
      };

      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const paused = await service.settleOrPause({ runId: run.id, settled });
      expect(paused.status).toBe("paused");
      expect(paused.phases[0]?.candidates?.[0]?.summary).toBe("THE_PLAN");

      expect(
        service.respondToGate({
          runId: run.id,
          phaseId: "gate",
          decision: { approved: true, note: "go" },
        }),
      ).toBe(true);
      const final = await settled;
      expect(final.status).toBe("done");
      expect(final.phases[2]?.candidates?.[0]?.summary).toBe("BUILT");
    });
  }, 60_000);

  test("fans out multiple real children and grades each with a real judger", async () => {
    await withWorkflowService(async (service) => {
      const spawnCount = { value: 0 };
      const spawnPort = makeIntegrationSpawnPort({ composedTasks: new Map(), spawnCount });
      const plan: RunPlan = {
        title: "Fan out and judge",
        phases: [
          {
            id: "explore",
            type: "research",
            title: "Explore angles",
            // "PASS" marker makes the real judger children return a pass verdict.
            task: "Investigate an angle. respond with exactly: PASS_ANGLE",
            fanOut: 3,
            judge: { criteria: ["grounded"] },
          },
        ],
      };

      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });

      expect(outcome.status).toBe("done");
      const candidates = outcome.phases[0]?.candidates ?? [];
      expect(candidates).toHaveLength(3);
      expect(allVerdictsPass(candidates)).toBe(true);
      // 3 maker children + 3 judger children all really spawned and awaited.
      expect(spawnCount.value).toBe(6);
    });
  }, 90_000);

  test("hard-fails and names the gap when the team lacks a role - spawning no child for it", async () => {
    await withWorkflowService(async (service) => {
      const spawnCount = { value: 0 };
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount,
        missingRole: "designer",
      });
      const plan: RunPlan = {
        title: "Needs a designer",
        phases: [{ id: "design", type: "design", title: "Style it", task: "make it pretty" }],
      };

      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const final = await service.settleOrPause({ runId: run.id, settled });
      expect(final.status).toBe("failed");
      expect(final.error).toContain("designer");
      expect(spawnCount.value).toBe(0);
    });
  }, 30_000);

  test("runs a verify phase whose child IS the judger", async () => {
    await withWorkflowService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Build then verify",
        phases: [
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
          },
          {
            id: "check",
            type: "verify",
            title: "Review",
            task: 'Review the build. respond with exactly: {"verdict":"pass","score":1}',
            dependsOn: ["build"],
          },
        ],
      };
      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(outcome.phases[1]?.candidates?.[0]?.verdict?.verdict).toBe("pass");
    });
  }, 60_000);

  test("autopilot runs straight through a gate without pausing", async () => {
    await withWorkflowService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Autopilot pipeline",
        autopilot: true,
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Plan it. respond with exactly: PLANNED",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
            dependsOn: ["gate"],
          },
        ],
      };
      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(phaseById(outcome, "gate")?.notes).toContain("autopilot");
      expect(outcome.phases[2]?.candidates?.[0]?.summary).toBe("BUILT");
    });
  }, 60_000);

  test("cancels a run parked at a gate; downstream never runs", async () => {
    await withWorkflowService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Cancelable",
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Plan it. respond with exactly: PLANNED",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "build",
            dependsOn: ["gate"],
          },
        ],
      };
      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const paused = await service.settleOrPause({ runId: run.id, settled });
      expect(paused.status).toBe("paused");
      expect(service.cancelRun(run.id)).toBe(true);
      const final = await settled;
      expect(final.status).toBe("canceled");
      expect(phaseById(final, "build")?.status).toBe("pending");
    });
  }, 60_000);

  test("threads multiple dependencies' outputs into a joining phase", async () => {
    await withWorkflowService(async (service) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({ composedTasks, spawnCount: { value: 0 } });
      const plan: RunPlan = {
        title: "Two inputs, one join",
        phases: [
          {
            id: "a",
            type: "research",
            title: "Angle A",
            task: "Research A. respond with exactly: OUTPUT_A",
          },
          {
            id: "b",
            type: "research",
            title: "Angle B",
            task: "Research B. respond with exactly: OUTPUT_B",
          },
          {
            id: "join",
            type: "deliver",
            title: "Join",
            task: "Combine both. respond with exactly: JOINED",
            dependsOn: ["a", "b"],
          },
        ],
      };
      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      const joinTask = composedTasks.get("join#0.0");
      expect(joinTask).toContain("OUTPUT_A");
      expect(joinTask).toContain("OUTPUT_B");
    });
  }, 60_000);

  test("drives a full research → implement → deliver pipeline end to end", async () => {
    await withWorkflowService(async (service, store) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({ composedTasks, spawnCount: { value: 0 } });
      const plan: RunPlan = {
        title: "Full pipeline",
        phases: [
          {
            id: "research",
            type: "research",
            title: "Survey",
            task: "Survey the space. respond with exactly: PASS_FINDINGS",
            fanOut: 2,
            judge: {},
          },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build on the findings. respond with exactly: IMPLEMENTED",
            dependsOn: ["research"],
          },
          {
            id: "ship",
            type: "deliver",
            title: "Ship",
            task: "Ship it. respond with exactly: SHIPPED",
            dependsOn: ["build"],
          },
        ],
      };
      const { run, settled } = service.startWorkflow({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(phaseStatuses(outcome)).toEqual(["done", "done", "done"]);
      // Findings thread into build; build threads into ship.
      expect(composedTasks.get("build#0.0")).toContain("PASS_FINDINGS");
      expect(composedTasks.get("ship#0.0")).toContain("IMPLEMENTED");
      // 2 researchers + 2 judgers + 1 builder + 1 shipper.
      expect(outcome.agentCount).toBe(6);
      expect(summarizeRunOutput(outcome)).toBe("SHIPPED");
      expect((await store.get(run.id))?.status).toBe("done");
    });
  }, 90_000);

  test("waitForAgentFullySettled waits for a worker's busy child agent", async () => {
    const agentManager = harness.daemon.daemon.agentManager;
    const parent = await harness.client.createAgent({
      provider: "claude",
      cwd: harness.cwd,
      initialPrompt: "hello",
    });
    await harness.client.waitForAgentUpsert(parent.id, (s) => s.status === "idle", 15_000);

    // A child labeled under the now-idle parent, started with a long-running
    // prompt so it stays busy - nothing re-invokes the parent, so the ONLY reason
    // settle should wait is the busy descendant in the subtree.
    const child = await harness.client.createAgent({
      provider: "claude",
      cwd: harness.cwd,
      initialPrompt: "emit 2000 coalesced agent stream updates",
      labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
    });
    await harness.client.waitForAgentUpsert(child.id, (s) => s.status === "running", 15_000);

    const settledAt = agentManager
      .waitForAgentFullySettled(parent.id, { quietMs: 300 })
      .then(() => Date.now());
    const childDoneAt = harness.client
      .waitForAgentUpsert(child.id, (s) => s.status !== "running", 30_000)
      .then(() => Date.now());

    const [settled, childDone] = await Promise.all([settledAt, childDoneAt]);
    expect(settled).toBeGreaterThanOrEqual(childDone);
  }, 60_000);
});
