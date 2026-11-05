import type { OrchestrationGraph, GraphNode } from "./model.js";
const reserved = new Set(["__proto__", "constructor", "prototype"]);
export function workflowFieldProblems(
  fields: readonly { key: string; type?: string }[],
  maximum = 64,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (fields.length > maximum) problems.push(`At most ${maximum} fields are supported.`);
  for (const field of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(field.key) || reserved.has(field.key))
      problems.push(`Field key ${field.key} is reserved or invalid.`);
    if (seen.has(field.key)) problems.push(`Duplicate field key ${field.key}.`);
    seen.add(field.key);
    if (field.type && !new Set(["string", "number", "boolean", "array"]).has(field.type))
      problems.push(`Field type ${field.type} requires a newer Workflow capability.`);
  }
  return problems;
}
function nodeProblems(node: GraphNode) {
  const problems = workflowFieldProblems(node.output?.fields ?? []);
  for (const query of node.queryTools ?? [])
    problems.push(...workflowFieldProblems(query.parameters ?? [], 32));
  problems.push(
    ...workflowFieldProblems(
      Object.keys(node.promptTemplate?.variables ?? {}).map((key) => ({ key })),
    ),
  );
  return problems.map((message) => `${node.title}: ${message}`);
}
export function workflowGraphDescriptorProblems(graph: OrchestrationGraph) {
  const problems = workflowFieldProblems(graph.inputs ?? []);
  for (const node of graph.nodes) problems.push(...nodeProblems(node));
  if (graph.requires?.length)
    problems.push(
      `This host cannot satisfy the Graph's explicit capability declarations: ${graph.requires.join(", ")}.`,
    );
  return problems;
}
