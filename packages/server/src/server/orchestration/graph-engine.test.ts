import { describe, expect, test } from "vitest";

import type { OrchestrationGraph } from "@otto-code/protocol/orchestration";

import {
  type GraphEnginePort,
  type GraphEngineSpawnInput,
  buildRunFromGraph,
  executeGraphRun,
  substituteGraphInputs,
} from "./graph-engine.js";
import { DEFAULT_RUN_CAPS } from "./run-engine.js";

const NOW = "2026-07-20T00:00:00.000Z";

function makeGraph(overrides?: Partial<OrchestrationGraph>): OrchestrationGraph {
  return {
    id: "g1",
    name: "Test graph",
    inputs: [{ key: "goal", label: "Goal" }],
    nodes: [
      { id: "root", kind: "orchestrator", title: "Orchestrator" },
      { id: "a", kind: "agent", title: "A", role: "researcher", prompt: "Do {{inputs.goal}}" },
      { id: "b", kind: "agent", title: "B", role: "coder", prompt: "Build it" },
    ],
    edges: [
      { from: "root", to: "a" },
      { from: "a", to: "b" },
    ],
    ...overrides,
  };
}

interface FakePortOptions {
  /** Return the final message for a spawned agent (worker or judge). */
  finalMessage?: (input: GraphEngineSpawnInput, agentId: string) => string;
  failAgentIds?: Set<string>;
  /**
   * Stand in for what a node's agent submitted through submit_output. Returning
   * undefined means the tool was never called, which sends the engine to its
   * prose fallback — the local-model path.
   */
  submittedOutput?: (
    input: GraphEngineSpawnInput,
    agentId: string,
  ) => Record<string, unknown> | undefined;
  /** Agents that never settle — the shape a per-node time limit exists for. */
  hangAgentIds?: Set<string>;
}

function makePort(options?: FakePortOptions) {
  const spawns: GraphEngineSpawnInput[] = [];
  const notifications: string[] = [];
  const finalMessages = new Map<string, string>();
  const submissions = new Map<string, Record<string, unknown>>();
  const canceled: string[] = [];
  let counter = 0;
  const port: GraphEnginePort = {
    spawn: async (input) => {
      spawns.push(input);
      const agentId = `agent-${++counter}-${input.nodeId}-${input.purpose}`;
      finalMessages.set(
        agentId,
        options?.finalMessage?.(input, agentId) ?? `${input.nodeId} output`,
      );
      const submitted = options?.submittedOutput?.(input, agentId);
      if (submitted) {
        submissions.set(agentId, submitted);
      }
      return { agentId };
    },
    awaitAgent: async ({ agentId }) => {
      if (options?.hangAgentIds?.has(agentId)) {
        await new Promise<void>(() => {});
      }
      return {
        finalMessage: finalMessages.get(agentId) ?? null,
        failed: options?.failAgentIds?.has(agentId) ?? false,
        submittedOutput: submissions.get(agentId) ?? null,
      };
    },
    cancelAgent: async ({ agentId }) => {
      canceled.push(agentId);
    },
    notifyOrchestrator: async ({ text }) => {
      notifications.push(text);
    },
    emit: () => {},
    now: () => NOW,
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {},
    } as unknown as GraphEnginePort["logger"],
  };
  return { port, spawns, notifications, canceled };
}

function buildRun(graph: OrchestrationGraph, graphInputs: Record<string, string> = {}) {
  return buildRunFromGraph({
    graph,
    graphInputs,
    id: "run1",
    title: "Test run",
    now: NOW,
    conductorAgentId: "orchestrator-agent",
  });
}

describe("substituteGraphInputs", () => {
  test("replaces declared references and leaves unknown ones intact", () => {
    expect(substituteGraphInputs("Do {{inputs.goal}} and {{inputs.missing}}", { goal: "X" })).toBe(
      "Do X and {{inputs.missing}}",
    );
  });
});

describe("buildRunFromGraph", () => {
  test("projects worker nodes into phases with edge-derived dependsOn", () => {
    const run = buildRun(makeGraph(), { goal: "ship it" });
    expect(run.kind).toBe("graph");
    expect(run.graphId).toBe("g1");
    expect(run.phases.map((phase) => phase.id)).toEqual(["a", "b"]);
    // Root edges are ordering-only: phase "a" has no dependsOn.
    expect(run.phases[0]?.dependsOn).toBeUndefined();
    expect(run.phases[1]?.dependsOn).toEqual(["a"]);
    // Inputs substitute into the projected task.
    expect(run.phases[0]?.task).toBe("Do ship it");
  });

  test("rejects an invalid graph before any spawn", () => {
    const graph = makeGraph({ nodes: makeGraph().nodes.filter((n) => n.id !== "root") });
    expect(() => buildRun(graph)).toThrow(/Orchestrator/);
  });
});

describe("executeGraphRun", () => {
  test("runs nodes in dependency order, feeding upstream output downstream", async () => {
    const graph = makeGraph();
    const run = buildRun(graph, { goal: "ship it" });
    const { port, spawns, notifications } = makePort();
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: { goal: "ship it" },
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns.map((s) => s.nodeId)).toEqual(["a", "b"]);
    // B's task carries A's labeled output (the all-inputs barrier held daemon-side).
    expect(spawns[1]?.task).toContain('Input from "A":\na output');
    // Deterministic policy rides every spawn (no autonomous flags in this graph).
    expect(spawns.every((s) => s.policy === "deterministic")).toBe(true);
    // The orchestrator heard both completions plus the wrap-up.
    expect(notifications.some((n) => n.includes('Node "A" finished'))).toBe(true);
    expect(notifications.at(-1)).toContain("Every node has settled");
    expect(terminal.phases.every((phase) => phase.status === "done")).toBe(true);
    expect(terminal.agentCount).toBe(2);
  });

  test("a failed node fails the run and skips its downstream nodes", async () => {
    const graph = makeGraph();
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      failAgentIds: new Set(["agent-1-a-worker"]),
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain('Node "A" failed');
    expect(spawns.map((s) => s.nodeId)).toEqual(["a"]); // b never spawned
    expect(terminal.phases.find((p) => p.id === "a")?.status).toBe("failed");
    const skipped = terminal.phases.find((p) => p.id === "b");
    expect(skipped?.status).toBe("skipped");
    // A skip says why — machine-readable for clients, a sentence for humans.
    expect(skipped?.skipReason).toBe("upstream-failed");
    expect(skipped?.notes).toBe("An upstream node failed.");
  });

  test("a skip cascades as skipped, never as failed", async () => {
    // root → a → b → c. `a` is skipped by an upstream failure; `b` and `c` must
    // report "upstream-skipped", not inherit the failure.
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "boom", kind: "agent", title: "Boom", role: "coder", prompt: "p" },
        { id: "a", kind: "agent", title: "A", role: "coder", prompt: "p" },
        { id: "b", kind: "agent", title: "B", role: "coder", prompt: "p" },
      ],
      edges: [
        { from: "boom", to: "a" },
        { from: "a", to: "b" },
      ],
    });
    const run = buildRun(graph);
    const { port } = makePort({ failAgentIds: new Set(["agent-1-boom-worker"]) });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.phases.find((p) => p.id === "a")?.skipReason).toBe("upstream-failed");
    expect(terminal.phases.find((p) => p.id === "b")?.skipReason).toBe("upstream-skipped");
  });

  test("the wrap-up names every node that did not run", async () => {
    const graph = makeGraph();
    const run = buildRun(graph);
    const { port, notifications } = makePort({ failAgentIds: new Set(["agent-1-a-worker"]) });
    await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    const wrapUp = notifications.at(-1) ?? "";
    expect(wrapUp).toContain("- B: skipped — An upstream node failed.");
  });

  test("until-loop re-dispatches with judge feedback and stops on pass", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "work",
          kind: "agent",
          title: "Work",
          role: "coder",
          prompt: "Do the thing",
          loop: { until: { criteria: ["It works"], max: 3 } },
        },
      ],
      edges: [{ from: "root", to: "work" }],
    });
    const run = buildRun(graph);
    let judgeCalls = 0;
    const { port, spawns } = makePort({
      finalMessage: (input) => {
        if (input.purpose === "judge") {
          judgeCalls += 1;
          // Fail the first iteration, pass the second.
          return judgeCalls === 1
            ? '{"verdict":"fail","summary":"Missing tests."}'
            : '{"verdict":"pass","score":0.9}';
        }
        return "work output";
      },
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    const workerSpawns = spawns.filter((s) => s.purpose === "worker");
    const judgeSpawns = spawns.filter((s) => s.purpose === "judge");
    expect(workerSpawns).toHaveLength(2);
    expect(judgeSpawns).toHaveLength(2);
    // The retry carries the judge's feedback.
    expect(workerSpawns[1]?.task).toContain("Missing tests.");
    // Judges default to the judger role and are always deterministic.
    expect(judgeSpawns.every((s) => s.role === "judger" && s.policy === "deterministic")).toBe(
      true,
    );
  });

  test("until-loop that never passes fails the node", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "work",
          kind: "agent",
          title: "Work",
          role: "coder",
          prompt: "Do the thing",
          loop: { until: { criteria: ["It works"], max: 2 } },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port } = makePort({
      finalMessage: (input) =>
        input.purpose === "judge" ? '{"verdict":"fail","summary":"No."}' : "work output",
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain("Never passed the judge within 2 iterations");
  });

  test("times-loop runs exactly N iterations and feeds the previous output forward", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "iterate",
          kind: "agent",
          title: "Iterate",
          role: "writer",
          prompt: "Refine",
          loop: { times: 3 },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    let iteration = 0;
    const { port, spawns } = makePort({
      finalMessage: () => `draft ${++iteration}`,
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns).toHaveLength(3);
    expect(spawns[1]?.task).toContain("Your previous iteration produced:\ndraft 1");
    expect(spawns[2]?.task).toContain("draft 2");
  });

  test("nodes nothing else consumes deliver their full output in the wrap-up", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "a", kind: "agent", title: "Research", role: "researcher", prompt: "pa" },
        { id: "b", kind: "agent", title: "Answer", role: "writer", prompt: "pb" },
      ],
      edges: [
        { from: "root", to: "a" },
        // Nothing consumes b, so b's output is the graph's final answer.
        { from: "a", to: "b" },
      ],
    });
    const run = buildRun(graph);
    const { port, notifications } = makePort();
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    const wrapUp = notifications.at(-1) ?? "";
    expect(wrapUp).toContain("this graph's final answers");
    expect(wrapUp).toContain("## Answer");
    expect(wrapUp).toContain("b output");
    // Nodes feeding another node aren't re-dumped in the wrap-up block.
    expect(wrapUp).not.toContain("## Research");
  });

  test("autonomous nodes spawn with the autonomous policy", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "free",
          kind: "agent",
          title: "Free agent",
          role: "coder",
          prompt: "Go wild",
          autonomous: true,
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port, spawns } = makePort();
    await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(spawns[0]?.policy).toBe("autonomous");
  });

  test("declared output fields ride the spawn and reach the next node as data", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "classify",
          kind: "agent",
          title: "Classify",
          role: "researcher",
          prompt: "Classify it",
          output: {
            fields: [
              { key: "complexity", type: "string", description: "simple or complex" },
              { key: "score", type: "number" },
            ],
          },
        },
        { id: "answer", kind: "agent", title: "Answer", role: "writer", prompt: "Answer it" },
      ],
      edges: [{ from: "classify", to: "answer" }],
    });
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      submittedOutput: (input) =>
        input.nodeId === "classify" ? { complexity: "simple", score: 0.9 } : undefined,
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    // The contract travels with the spawn so the agent's own tool catalog can
    // mint submit_output for it — that is what makes this provider-neutral.
    const classifySpawn = spawns.find((s) => s.nodeId === "classify");
    expect(classifySpawn?.outputFields?.map((f) => f.key)).toEqual(["complexity", "score"]);
    expect(classifySpawn?.task).toContain("call the submit_output tool exactly once");
    // Downstream receives values, not prose it has to re-read.
    const answerSpawn = spawns.find((s) => s.nodeId === "answer");
    expect(answerSpawn?.task).toContain('Input from "Classify" (fields):');
    expect(answerSpawn?.task).toContain('"complexity": "simple"');
    // And the validated fields are persisted for clients and later phases.
    const candidate = terminal.phases.find((p) => p.id === "classify")?.candidates?.[0];
    expect(candidate?.outputFields).toEqual({ complexity: "simple", score: 0.9 });
  });

  test("fields written as prose are recovered when the tool was not called", async () => {
    // The local-model path: a small model that writes correct JSON instead of
    // calling the tool has still done the work.
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "classify",
          kind: "agent",
          title: "Classify",
          role: "researcher",
          prompt: "Classify it",
          output: { fields: [{ key: "complexity", type: "string" }] },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port } = makePort({
      finalMessage: () => 'My answer:\n```json\n{"complexity":"complex"}\n```',
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(terminal.phases[0]?.candidates?.[0]?.outputFields).toEqual({ complexity: "complex" });
  });

  test("a node that declares fields and delivers none fails, naming the contract", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "classify",
          kind: "agent",
          title: "Classify",
          role: "researcher",
          prompt: "Classify it",
          output: { fields: [{ key: "complexity", type: "string" }] },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port } = makePort({ finalMessage: () => "I had a lovely time thinking about it." });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain("complexity");
    expect(terminal.error).toContain("submit_output");
  });

  // The diamond: a classifier gates two branches, and the join runs off
  // whichever branch executed. This is the shape conditional edges exist for.
  function makeDiamond(): OrchestrationGraph {
    return makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "classify",
          kind: "agent",
          title: "Classify",
          role: "researcher",
          prompt: "Classify",
          output: { fields: [{ key: "complexity", type: "string" }] },
        },
        { id: "quick", kind: "agent", title: "Quick", role: "writer", prompt: "Answer fast" },
        { id: "deep", kind: "agent", title: "Deep", role: "coder", prompt: "Answer deeply" },
        { id: "review", kind: "agent", title: "Review", role: "judger", prompt: "Review" },
      ],
      edges: [
        { from: "classify", to: "quick", when: { expression: 'complexity = "simple"' } },
        { from: "classify", to: "deep", when: { expression: 'complexity = "complex"' } },
        { from: "quick", to: "review" },
        { from: "deep", to: "review" },
      ],
    });
  }

  test("a condition prunes one branch and the join runs off the other", async () => {
    const graph = makeDiamond();
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      submittedOutput: (input) =>
        input.nodeId === "classify" ? { complexity: "simple" } : undefined,
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns.map((s) => s.nodeId)).toEqual(["classify", "quick", "review"]);
    const deep = terminal.phases.find((p) => p.id === "deep");
    expect(deep?.status).toBe("skipped");
    expect(deep?.skipReason).toBe("condition");
    expect(deep?.notes).toContain("Classify");
    // The join ran, and saw only the branch that executed.
    const review = spawns.find((s) => s.nodeId === "review");
    expect(review?.task).toContain('Input from "Quick"');
    expect(review?.task).not.toContain('Input from "Deep"');
    expect(terminal.phases.find((p) => p.id === "review")?.status).toBe("done");
  });

  test("the other branch wins when the condition says so", async () => {
    const graph = makeDiamond();
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      submittedOutput: (input) =>
        input.nodeId === "classify" ? { complexity: "complex" } : undefined,
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns.map((s) => s.nodeId)).toEqual(["classify", "deep", "review"]);
    expect(terminal.phases.find((p) => p.id === "quick")?.skipReason).toBe("condition");
  });

  test("an edge carries only the fields it selects", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "a",
          kind: "agent",
          title: "A",
          role: "researcher",
          prompt: "p",
          output: {
            fields: [
              { key: "keep", type: "string" },
              { key: "drop", type: "string" },
            ],
          },
        },
        { id: "b", kind: "agent", title: "B", role: "writer", prompt: "p" },
      ],
      edges: [{ from: "a", to: "b", fields: ["keep"] }],
    });
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      submittedOutput: (input) => (input.nodeId === "a" ? { keep: "yes", drop: "no" } : undefined),
    });
    await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    const bTask = spawns.find((s) => s.nodeId === "b")?.task ?? "";
    expect(bTask).toContain('"keep": "yes"');
    expect(bTask).not.toContain("drop");
  });

  test("a condition that cannot be evaluated fails the node instead of pruning it", async () => {
    // A typo in a condition would otherwise silently prune half the graph.
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "a",
          kind: "agent",
          title: "A",
          role: "researcher",
          prompt: "p",
          output: { fields: [{ key: "n", type: "number" }] },
        },
        { id: "b", kind: "agent", title: "B", role: "writer", prompt: "p" },
      ],
      edges: [{ from: "a", to: "b", when: { expression: "$nonexistentFunction(n)" } }],
    });
    const run = buildRun(graph);
    const { port } = makePort({
      submittedOutput: (input) => (input.nodeId === "a" ? { n: 1 } : undefined),
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain("could not be evaluated");
  });

  test("a graph with an unparseable condition never spawns anything", async () => {
    const graph = makeGraph({
      edges: [
        { from: "root", to: "a" },
        { from: "a", to: "b", when: { expression: "complexity = = broken" } },
      ],
    });
    expect(() => buildRun(graph)).toThrow(/is invalid/);
  });

  test("a retry recovers a node whose first attempt failed", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "flaky",
          kind: "agent",
          title: "Flaky",
          role: "coder",
          prompt: "p",
          retry: { maxAttempts: 3, backoffMs: 0 },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    // Only the first spawn's agent fails; the retry spawns a fresh one.
    const { port, spawns } = makePort({ failAgentIds: new Set(["agent-1-flaky-worker"]) });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns).toHaveLength(2);
    expect(terminal.phases[0]?.retryAttempts).toBe(1);
    // Every attempt is charged to the run, never a private allowance.
    expect(terminal.agentCount).toBe(2);
  });

  test("retry gives up within its bound and fails the run", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "doomed",
          kind: "agent",
          title: "Doomed",
          role: "coder",
          prompt: "p",
          retry: { maxAttempts: 3, backoffMs: 0 },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port, spawns } = makePort({
      failAgentIds: new Set([
        "agent-1-doomed-worker",
        "agent-2-doomed-worker",
        "agent-3-doomed-worker",
      ]),
    });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    // Bounded: three attempts, not an unbounded compounding retry.
    expect(spawns).toHaveLength(3);
  });

  test("a node that exceeds its time limit is canceled, not merely abandoned", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "hang", kind: "agent", title: "Hang", role: "coder", prompt: "p", timeoutMs: 1000 },
        { id: "other", kind: "agent", title: "Other", role: "writer", prompt: "p" },
      ],
      edges: [],
    });
    const run = buildRun(graph);
    const { port, canceled } = makePort({ hangAgentIds: new Set(["agent-1-hang-worker"]) });
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain("time limit");
    // The agent was really stopped — otherwise it keeps running and spending.
    expect(canceled).toEqual(["agent-1-hang-worker"]);
    const phase = terminal.phases.find((p) => p.id === "hang");
    expect(phase?.timedOut).toBe(true);
    // An independent branch still finished.
    expect(terminal.phases.find((p) => p.id === "other")?.status).toBe("done");
  });

  test("a node bound to a template uses it, and falls back when it cannot render", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        {
          id: "a",
          kind: "agent",
          title: "A",
          role: "researcher",
          prompt: "inline fallback",
          promptTemplate: { templateId: "research", variables: { topic: "$inputs.goal" } },
        },
        {
          id: "b",
          kind: "agent",
          title: "B",
          role: "writer",
          prompt: "inline fallback",
          promptTemplate: { templateId: "deleted" },
        },
      ],
      edges: [],
    });
    const run = buildRun(graph, { goal: "ship it" });
    const { port, spawns } = makePort();
    // A renders; B's template is gone, so B degrades to its inline prompt
    // rather than failing — deleting a shared template must not break graphs.
    port.renderPromptTemplate = async ({ ref, graphInputs }) =>
      ref.templateId === "research" ? `Rendered for ${graphInputs.goal}` : null;
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: { goal: "ship it" },
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    expect(spawns.find((s) => s.nodeId === "a")?.task).toContain("Rendered for ship it");
    expect(spawns.find((s) => s.nodeId === "b")?.task).toContain("inline fallback");
  });

  test("parallel fan-in waits for every upstream node", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "x", kind: "agent", title: "X", role: "researcher", prompt: "px" },
        { id: "y", kind: "agent", title: "Y", role: "researcher", prompt: "py" },
        { id: "z", kind: "agent", title: "Z", role: "writer", prompt: "pz" },
      ],
      edges: [
        { from: "x", to: "z" },
        { from: "y", to: "z" },
      ],
    });
    const run = buildRun(graph);
    const { port, spawns } = makePort();
    const terminal = await executeGraphRun({
      run,
      graph,
      graphInputs: {},
      caps: DEFAULT_RUN_CAPS,
      signal: new AbortController().signal,
      port,
    });
    expect(terminal.status).toBe("done");
    const zSpawn = spawns.find((s) => s.nodeId === "z");
    expect(zSpawn?.task).toContain('Input from "X":\nx output');
    expect(zSpawn?.task).toContain('Input from "Y":\ny output');
    // Z spawned last.
    expect(spawns.at(-1)?.nodeId).toBe("z");
  });
});
