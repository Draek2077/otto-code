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
}

function makePort(options?: FakePortOptions) {
  const spawns: GraphEngineSpawnInput[] = [];
  const notifications: string[] = [];
  const finalMessages = new Map<string, string>();
  let counter = 0;
  const port: GraphEnginePort = {
    spawn: async (input) => {
      spawns.push(input);
      const agentId = `agent-${++counter}-${input.nodeId}-${input.purpose}`;
      finalMessages.set(
        agentId,
        options?.finalMessage?.(input, agentId) ?? `${input.nodeId} output`,
      );
      return { agentId };
    },
    awaitAgent: async ({ agentId }) => ({
      finalMessage: finalMessages.get(agentId) ?? null,
      failed: options?.failAgentIds?.has(agentId) ?? false,
    }),
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
  return { port, spawns, notifications };
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
    expect(notifications.at(-1)).toContain("Every node has finished");
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
    expect(terminal.phases.find((p) => p.id === "b")?.status).toBe("skipped");
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
