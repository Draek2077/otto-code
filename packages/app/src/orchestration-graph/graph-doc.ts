import type { GraphNode, OrchestrationGraph } from "@otto-code/protocol/orchestration";

// Pure helpers for orchestration graph documents (projects/orchestration-graphs)
// shared by the New Orchestration dialog and the designer tab.

/** Roles a graph node can dispatch to — the worker subset of PERSONALITY_ROLES
 * (surfaces like chatter/artificer/scheduler don't fill graph seats, and the
 * orchestrator seat is the root node itself). */
export const GRAPH_NODE_ROLES = [
  "researcher",
  "planner",
  "coder",
  "designer",
  "writer",
  "judger",
  "advisor",
] as const;

export function newOrchestrationGraphId(): string {
  return `graph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newGraphNodeId(existing: ReadonlySet<string>): string {
  let index = existing.size + 1;
  let id = `n${index}`;
  while (existing.has(id)) {
    id = `n${++index}`;
  }
  return id;
}

/** The orchestrator root every graph starts from. */
export function buildRootNode(): GraphNode {
  return {
    id: "root",
    kind: "orchestrator",
    title: "Orchestrator",
    position: { x: 40, y: 200 },
  };
}

export function buildEmptyOrchestrationGraph(
  name: string,
  description?: string,
): OrchestrationGraph {
  return {
    id: newOrchestrationGraphId(),
    name,
    ...(description?.trim() ? { description: description.trim() } : {}),
    inputs: [],
    nodes: [buildRootNode()],
    edges: [],
  };
}
