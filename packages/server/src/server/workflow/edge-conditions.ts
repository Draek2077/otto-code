import jsonata from "jsonata";

import type { GraphEdge, GraphNode, GraphNodeCheck } from "@otto-code/protocol/workflow";

// Conditional edges (projects/orchestration-graphs, Stage 2).
//
// A condition is a JSONata expression evaluated against the upstream node's
// result. JSONata rather than a bespoke DSL because it is parsed and evaluated
// (never eval'd), covers comparisons, boolean logic, array and string
// functions, and is small - and rather than raw JS because a graph is data a
// user authored in a designer, and data must never become code the daemon
// executes.
//
// Evaluation context: the upstream node's output fields at the top level, so
// `complexity = "simple"` reads naturally, plus `output` carrying its prose so
// a node that declared no fields can still be tested (`$contains(output,
// "ready")`). Nothing else is in scope - a condition cannot reach the
// filesystem, the run, or another node.

export interface EdgeConditionContext {
  fields: Record<string, unknown> | null;
  output: string | null;
}

export interface GraphCheckContext {
  upstream: Record<string, { output: string; fields: Record<string, unknown> | null }>;
}

export type EdgeResolution =
  | { status: "delivers"; edge: GraphEdge }
  | { status: "inactive"; edge: GraphEdge }
  | { status: "error"; edge: GraphEdge; message: string };

/**
 * Evaluate one edge's condition. An edge with no condition always delivers.
 *
 * A malformed or throwing expression is an *error*, never a quiet false: a
 * typo in a condition would otherwise silently prune half the graph, which is
 * exactly the silent-partial-execution failure this engine refuses to have.
 */
export async function resolveEdgeCondition(
  edge: GraphEdge,
  context: EdgeConditionContext,
): Promise<EdgeResolution> {
  if (!edge.when?.expression?.trim()) {
    return { status: "delivers", edge };
  }
  const scope: Record<string, unknown> = { ...context.fields, output: context.output ?? "" };
  try {
    const expression = jsonata(edge.when.expression);
    const value = await expression.evaluate(scope);
    return isTruthy(value) ? { status: "delivers", edge } : { status: "inactive", edge };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      edge,
      message: `Condition "${edge.when.expression}" could not be evaluated: ${message}`,
    };
  }
}

/**
 * Evaluate a Check node's deterministic assertion. Its only scope is
 * `upstream.<nodeId>`, which provides both the source prose (`output`) and
 * carried structured fields (`fields`). A false assertion is an expected
 * workflow failure; only an invalid/throwing expression is an evaluation error.
 */
export async function evaluateGraphCheck(
  expression: string,
  context: GraphCheckContext,
): Promise<{ passed: true } | { passed: false } | { error: string }> {
  try {
    const value = await jsonata(expression).evaluate(context);
    return isTruthy(value) ? { passed: true } : { passed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Check "${expression}" could not be evaluated: ${message}` };
  }
}

// JSONata returns `undefined` for a path that matched nothing, which is the
// most common "no" - treat it, empty sequences, and empty strings as false, so
// a condition on a field the upstream never produced reads as not-taken rather
// than as an error.
function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return true;
}

/**
 * Narrow an upstream node's fields to what an edge carries. Absent selection
 * means everything; a selected key the upstream never produced is simply
 * absent rather than an error, because the upstream's contract may legitimately
 * mark it optional.
 */
export function selectCarriedFields(
  fields: Record<string, unknown> | null,
  selection: readonly string[] | undefined,
): Record<string, unknown> | null {
  if (!fields || !selection || selection.length === 0) {
    return fields;
  }
  const carried: Record<string, unknown> = {};
  for (const key of selection) {
    if (key in fields) {
      carried[key] = fields[key];
    }
  }
  return Object.keys(carried).length > 0 ? carried : null;
}

/**
 * Check every condition in a graph parses, for the designer's live feedback and
 * the save-time validator. Returns one problem per bad expression.
 */
export function validateEdgeConditions(edges: readonly GraphEdge[]): string[] {
  const problems: string[] = [];
  for (const edge of edges) {
    const expression = edge.when?.expression?.trim();
    if (!expression) {
      continue;
    }
    try {
      jsonata(expression);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`The condition on the edge ${edge.from} → ${edge.to} is invalid: ${message}`);
    }
  }
  return problems;
}

/** Check JSONata syntax daemon-side, beside edge-condition syntax. */
export function validateGraphChecks(nodes: readonly GraphNode[]): string[] {
  const problems: string[] = [];
  for (const node of nodes) {
    const check = node.check as GraphNodeCheck | undefined;
    if (node.kind !== "check" || !check?.expression.trim()) {
      continue;
    }
    try {
      jsonata(check.expression);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`The Check "${node.title}" has an invalid expression: ${message}`);
    }
  }
  return problems;
}
