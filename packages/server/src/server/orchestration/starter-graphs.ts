import type { Logger } from "pino";

import type { OrchestrationGraph } from "@otto-code/protocol/orchestration";

import type { GraphStore } from "./graph-store.js";

// Bundled starter graphs (projects/orchestration-graphs) — the graph designer's
// equivalent of the starter team: ready-to-run templates that show the idiom
// (declared inputs, role nodes, fan-in, a judge-gated loop) and give a fresh
// install something executable on day one. Seeded once per id: a user who edits
// a starter takes ownership (the save strips `builtIn`), and the seeder never
// overwrites an existing file, so edits survive daemon restarts.

const SEED_TIMESTAMP = "2026-07-20T00:00:00.000Z";

export const STARTER_GRAPHS: OrchestrationGraph[] = [
  {
    id: "starter-research-build-verify",
    name: "Research → Plan → Build → Verify",
    description:
      "The classic pipeline: one researcher explores the goal, a planner turns it into steps, a coder builds it, and a judge-gated verify loop keeps the coder iterating until the result passes.",
    inputs: [
      {
        key: "goal",
        label: "Goal",
        description: "What should this orchestration accomplish?",
        multiline: true,
        required: true,
      },
    ],
    nodes: [
      {
        id: "root",
        kind: "orchestrator",
        title: "Orchestrator",
        position: { x: 40, y: 220 },
      },
      {
        id: "research",
        kind: "agent",
        title: "Research",
        role: "researcher",
        prompt:
          "Research everything needed to accomplish this goal. Report findings, constraints, and recommendations — no implementation.\n\nGoal:\n{{inputs.goal}}",
        position: { x: 360, y: 120 },
      },
      {
        id: "plan",
        kind: "agent",
        title: "Plan",
        role: "planner",
        prompt:
          "Turn the research into a concrete, ordered implementation plan for this goal:\n{{inputs.goal}}",
        position: { x: 680, y: 120 },
      },
      {
        id: "build",
        kind: "agent",
        title: "Build",
        role: "coder",
        prompt: "Execute the plan. Deliver working results, and report exactly what you changed.",
        loop: {
          until: {
            criteria: [
              "The stated goal is accomplished.",
              "The reported work is complete and verifiable, with no skipped steps.",
            ],
            max: 3,
          },
        },
        position: { x: 1000, y: 120 },
      },
    ],
    edges: [
      { from: "root", to: "research" },
      { from: "research", to: "plan" },
      // Nothing consumes "build", so its result is the graph's final answer.
      { from: "plan", to: "build" },
    ],
    builtIn: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
  {
    id: "starter-expert-panel",
    name: "Expert Panel",
    description:
      "Three researchers examine the same question from different angles in parallel; a writer synthesizes their findings into one answer.",
    inputs: [
      {
        key: "question",
        label: "Question",
        description: "The question the panel debates.",
        multiline: true,
        required: true,
      },
    ],
    nodes: [
      {
        id: "root",
        kind: "orchestrator",
        title: "Orchestrator",
        position: { x: 40, y: 240 },
      },
      {
        id: "optimist",
        kind: "agent",
        title: "Case For",
        role: "researcher",
        prompt:
          "Make the strongest evidence-based case FOR. Steelman it — cite concrete reasons.\n\nQuestion:\n{{inputs.question}}",
        position: { x: 360, y: 80 },
      },
      {
        id: "skeptic",
        kind: "agent",
        title: "Case Against",
        role: "researcher",
        prompt:
          "Make the strongest evidence-based case AGAINST. Steelman it — cite concrete risks and counterexamples.\n\nQuestion:\n{{inputs.question}}",
        position: { x: 360, y: 240 },
      },
      {
        id: "pragmatist",
        kind: "agent",
        title: "Practical Angle",
        role: "researcher",
        prompt:
          "Ignore the debate — what would actually happen in practice? Assess feasibility, costs, and second-order effects.\n\nQuestion:\n{{inputs.question}}",
        position: { x: 360, y: 400 },
      },
      {
        id: "synthesis",
        kind: "agent",
        title: "Synthesis",
        role: "writer",
        prompt:
          "You received three expert takes on the question below. Weigh them against each other and write one balanced, decisive answer with a clear recommendation.\n\nQuestion:\n{{inputs.question}}",
        position: { x: 720, y: 240 },
      },
    ],
    edges: [
      { from: "root", to: "optimist" },
      { from: "root", to: "skeptic" },
      { from: "root", to: "pragmatist" },
      { from: "optimist", to: "synthesis" },
      { from: "skeptic", to: "synthesis" },
      // Nothing consumes "synthesis", so it is the panel's answer.
      { from: "pragmatist", to: "synthesis" },
    ],
    builtIn: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  },
];

/** Seed missing starter graphs. Never overwrites an existing file (user edits win). */
export async function seedStarterGraphs(store: GraphStore, logger: Logger): Promise<void> {
  for (const graph of STARTER_GRAPHS) {
    try {
      const existing = await store.get(graph.id);
      if (existing === null) {
        await store.save(graph);
      }
    } catch (error) {
      logger.error({ err: error, graphId: graph.id }, "Failed to seed starter graph");
    }
  }
}
