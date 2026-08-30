import { describe, expect, test } from "vitest";

import {
  GRAPH_CHECK_OUTPUT_PORTS,
  GRAPH_DOCUMENT_FORMAT,
  GRAPH_DOCUMENT_FORMAT_VERSION,
  OrchestrationGraphSchema,
  RunPlanSchema,
  RunSchema,
  RunsGateRespondRequestSchema,
  WorkflowsStartConfirmationRespondRequestSchema,
  describeRunPlanStart,
  defaultRoleForPhaseType,
  isRunPhaseType,
  isTerminalPhaseStatus,
  isTerminalRunStatus,
  validateGraphDocument,
  validateOrchestrationGraph,
} from "./orchestration.js";

describe("Check output ports", () => {
  test("keeps the pass/fail port vocabulary narrow without narrowing the wire", () => {
    expect(GRAPH_CHECK_OUTPUT_PORTS).toEqual(["pass", "fail"]);
    const graph = OrchestrationGraphSchema.parse({
      id: "check_ports",
      name: "Check ports",
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "check", kind: "check", title: "Verify", check: { expression: "true" } },
        { id: "next", kind: "agent", title: "Next", prompt: "Continue" },
      ],
      edges: [{ from: "check", to: "next", fromPort: "unknown-future-port" }],
    });

    // The schema remains additive so an old peer can parse the document; the
    // shared execution validator is where the actionable contract lives.
    expect(validateOrchestrationGraph(graph)).toContain(
      'Check "Verify" has edge port "unknown-future-port"; use "pass" or "fail".',
    );
  });
});

describe("phase type → role mapping", () => {
  test("each type maps to its filling role, gate to nobody", () => {
    expect(defaultRoleForPhaseType("research")).toBe("researcher");
    expect(defaultRoleForPhaseType("plan")).toBe("planner");
    expect(defaultRoleForPhaseType("implement")).toBe("coder");
    expect(defaultRoleForPhaseType("refactor")).toBe("coder");
    expect(defaultRoleForPhaseType("design")).toBe("designer");
    expect(defaultRoleForPhaseType("verify")).toBe("judger");
    expect(defaultRoleForPhaseType("gate")).toBeNull();
    expect(defaultRoleForPhaseType("deliver")).toBe("coder");
  });

  test("isRunPhaseType guards the known set", () => {
    expect(isRunPhaseType("verify")).toBe(true);
    expect(isRunPhaseType("ship")).toBe(false);
  });
});

describe("terminal status helpers", () => {
  test("run terminal states", () => {
    expect(isTerminalRunStatus("done")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("canceled")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("paused")).toBe(false);
  });

  test("phase terminal states", () => {
    expect(isTerminalPhaseStatus("done")).toBe(true);
    expect(isTerminalPhaseStatus("failed")).toBe(true);
    expect(isTerminalPhaseStatus("skipped")).toBe(true);
    expect(isTerminalPhaseStatus("running")).toBe(false);
    expect(isTerminalPhaseStatus("blocked")).toBe(false);
  });
});

describe("RunPlanSchema", () => {
  test("accepts a fan-out research plan with a judged loop target", () => {
    const plan = RunPlanSchema.parse({
      title: "Research the caching layer from six angles",
      requirements: ["Cover eviction, invalidation, and warmup"],
      phases: [
        {
          id: "survey",
          type: "research",
          title: "Six-angle survey",
          task: "Investigate one angle of the caching layer and report findings.",
          fanOut: 6,
          keepBest: 4,
          judge: { role: "judger", criteria: ["grounded in real files", "non-duplicative"] },
        },
        {
          id: "report",
          type: "deliver",
          title: "Synthesize the final report",
          task: "Combine the passing findings into one report.",
          role: "writer",
          dependsOn: ["survey"],
        },
      ],
    });
    expect(plan.phases).toHaveLength(2);
    expect(plan.autopilot).toBeUndefined(); // attended by default
    expect(plan.phases[0]?.fanOut).toBe(6);
  });

  test("rejects a plan with no phases", () => {
    expect(() => RunPlanSchema.parse({ title: "empty", phases: [] })).toThrow();
  });

  test("rejects a fanOut above the cap", () => {
    expect(() =>
      RunPlanSchema.parse({
        title: "too wide",
        phases: [{ id: "a", type: "research", title: "t", task: "do it", fanOut: 99 }],
      }),
    ).toThrow();
  });

  test("describes the known agent and fan-out shape without inventing a cost", () => {
    const shape = describeRunPlanStart({
      title: "Parallel review",
      phases: [
        { id: "read", type: "research", title: "Read", task: "Read", fanOut: 3 },
        { id: "gate", type: "gate", title: "Approve", task: "Approve" },
      ],
    });
    expect(shape).toEqual({ plannedAgentCount: 3, fanOutPhaseCount: 1, phaseCount: 2 });
  });
});

describe("RunSchema", () => {
  test("phases default to an empty array and survive round-trip", () => {
    const run = RunSchema.parse({ id: "run_1", title: "A run", status: "pending" });
    expect(run.phases).toEqual([]);
  });

  test("carries candidates with verdicts", () => {
    const run = RunSchema.parse({
      id: "run_2",
      title: "Judged run",
      status: "running",
      phases: [
        {
          id: "p1",
          type: "verify",
          title: "Judge",
          task: "grade it",
          status: "done",
          candidates: [{ agentId: "agent_x", verdict: { verdict: "pass", score: 0.8 } }],
        },
      ],
    });
    expect(run.phases[0]?.candidates?.[0]?.verdict?.verdict).toBe("pass");
  });

  test("preserves AI-run gate projection and its phase-specific approval request", () => {
    const run = RunSchema.parse({
      id: "run_ai_gate",
      title: "AI attended Workflow",
      kind: "ai",
      status: "paused",
      phases: [
        {
          id: "approval",
          type: "gate",
          title: "Review the AI plan",
          task: "Wait for the user to approve or reject the plan.",
          status: "blocked",
        },
      ],
    });
    const response = RunsGateRespondRequestSchema.parse({
      type: "runs.gate_respond.request",
      requestId: "request_ai_gate",
      runId: run.id,
      phaseId: run.phases[0]?.id,
      approved: true,
    });

    expect(run.kind).toBe("ai");
    expect(run.status).toBe("paused");
    expect(response.phaseId).toBe("approval");
  });

  test("keeps start confirmation separate from an attended plan gate", () => {
    const run = RunSchema.parse({
      id: "run_start_confirmation",
      title: "AI plan",
      kind: "ai",
      status: "paused",
      phases: [],
      startConfirmation: {
        reason: "model-plan-declared",
        plannedAgentCount: 2,
        fanOutPhaseCount: 1,
        phaseCount: 1,
        agentCap: 40,
        threshold: 4,
      },
    });
    const response = WorkflowsStartConfirmationRespondRequestSchema.parse({
      type: "workflows.start_confirmation.respond.request",
      requestId: "request_start_confirmation",
      runId: run.id,
      approved: true,
    });
    expect(run.startConfirmation?.reason).toBe("model-plan-declared");
    expect(response.approved).toBe(true);
  });

  test("accepts an additive exact Graph document snapshot", () => {
    const run = RunSchema.parse({
      id: "run_graph",
      title: "Graph run",
      status: "done",
      kind: "graph",
      graphId: "graph_1",
      graphSnapshot: {
        id: "graph_1",
        name: "Build",
        nodes: [{ id: "root", kind: "orchestrator", title: "Orchestrator", futureField: true }],
        edges: [],
        futureGraphField: "preserved",
      },
    });
    expect(run.graphSnapshot).toMatchObject({
      id: "graph_1",
      name: "Build",
      futureGraphField: "preserved",
    });
  });
});

describe("Graph document compatibility", () => {
  const graph = OrchestrationGraphSchema.parse({
    id: "graph_test",
    name: "Test Graph",
    nodes: [{ id: "root", kind: "orchestrator", title: "Orchestrator" }],
  });

  test("accepts legacy unversioned Graphs with an export warning", () => {
    expect(validateGraphDocument(graph)).toEqual([
      expect.objectContaining({ code: "GRAPH_DOCUMENT_LEGACY_UNVERSIONED", severity: "warning" }),
    ]);
    expect(validateOrchestrationGraph(graph)).toEqual([]);
  });

  test("does not reinterpret a legacy passthrough format field as a document header", () => {
    const legacyGraph = OrchestrationGraphSchema.parse({ ...graph, format: "canvas-layout-v0" });

    expect(validateGraphDocument(legacyGraph)).toEqual([
      expect.objectContaining({ code: "GRAPH_DOCUMENT_LEGACY_UNVERSIONED", severity: "warning" }),
    ]);
    expect(validateOrchestrationGraph(legacyGraph)).toEqual([]);
  });

  test("rejects a newer portable document version without dropping its fields", () => {
    const newerGraph = OrchestrationGraphSchema.parse({
      ...graph,
      format: GRAPH_DOCUMENT_FORMAT,
      formatVersion: GRAPH_DOCUMENT_FORMAT_VERSION + 1,
      futureDocumentField: true,
    });

    expect(validateGraphDocument(newerGraph)).toEqual([
      expect.objectContaining({
        code: "GRAPH_DOCUMENT_VERSION_UNSUPPORTED",
        path: "/formatVersion",
      }),
    ]);
    expect(validateOrchestrationGraph(newerGraph)).toContain(
      `Graph document version ${GRAPH_DOCUMENT_FORMAT_VERSION + 1} is newer than this Otto host supports.`,
    );
    expect(newerGraph.futureDocumentField).toBe(true);
  });

  test("rejects duplicate Graph input keys before execution", () => {
    expect(
      validateOrchestrationGraph(
        OrchestrationGraphSchema.parse({
          ...graph,
          inputs: [
            { key: "goal", label: "Goal" },
            { key: "goal", label: "Duplicate goal" },
          ],
        }),
      ),
    ).toContain('Duplicate Graph input key "goal".');
  });
});
