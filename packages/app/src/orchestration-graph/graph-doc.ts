import type {
  GraphEdge,
  GraphNode,
  GraphOutputField,
  GraphQueryTool,
  OrchestrationGraph,
} from "@otto-code/protocol/orchestration";

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

// ── Node/edge properties the canvas doesn't edit ────────────────────────────
// The designer rebuilds every node and edge from its own state on export, so
// anything it can't edit has to be carried across explicitly. Without this,
// opening a graph that uses a newer capability and pressing Save would quietly
// delete it — a designer that can't show a property must still be incapable of
// destroying it.

/** Node properties the canvas owns outright. Keep in step with buildGraphNode. */
const CANVAS_OWNED_NODE_KEYS = new Set([
  "id",
  "kind",
  "title",
  "role",
  "prompt",
  "promptFromInput",
  "autonomous",
  "loop",
  "model",
  "position",
  "access",
  "output",
  "retry",
  "timeoutMs",
  "tools",
  "queryTools",
  "promptTemplate",
]);

export function carryUneditedNodeFields(node: GraphNode): Partial<GraphNode> {
  return Object.fromEntries(
    Object.entries(node).filter(([key]) => !CANVAS_OWNED_NODE_KEYS.has(key)),
  ) as Partial<GraphNode>;
}

/** Edges are keyed from→to, so redrawing a wire keeps whatever it carried. */
export function graphEdgeKey(from: string, to: string): string {
  return `${from} ${to}`;
}

export function carryUneditedEdgeFields(edge: GraphEdge): Partial<GraphEdge> {
  const { from: _from, to: _to, ...rest } = edge;
  return rest;
}

// ── Output fields, as the node card's text form ─────────────────────────────
// One per line: `name : type : description`, with a trailing `?` on the name
// marking it optional. A textarea rather than repeating rows because it matches
// the loop-criteria idiom already in the card and stays usable on a small node.

export function formatOutputFields(fields: readonly GraphOutputField[] | undefined): string {
  return (fields ?? [])
    .map((field) => {
      const name = field.required === false ? `${field.key}?` : field.key;
      return [name, field.type, field.description].filter(Boolean).join(" : ");
    })
    .join("\n");
}

export function parseOutputFields(text: string): GraphOutputField[] {
  const fields: GraphOutputField[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Split on the first two colons only: everything after them is the
    // description, which may itself contain colons and must keep its spacing.
    const firstColon = trimmed.indexOf(":");
    const rawName = (firstColon === -1 ? trimmed : trimmed.slice(0, firstColon)).trim();
    const afterName = firstColon === -1 ? "" : trimmed.slice(firstColon + 1);
    const secondColon = afterName.indexOf(":");
    const rawType = (secondColon === -1 ? afterName : afterName.slice(0, secondColon)).trim();
    const description = secondColon === -1 ? "" : afterName.slice(secondColon + 1).trim();
    const optional = rawName.endsWith("?");
    const key = (optional ? rawName.slice(0, -1) : rawName).trim();
    if (!key) {
      continue;
    }
    fields.push({
      key,
      // A line that names only a field is a string field — the common case
      // shouldn't require remembering the syntax.
      type: rawType || "string",
      ...(description ? { description } : {}),
      ...(optional ? { required: false } : {}),
    });
  }
  return fields;
}

// ── Query tools, as the node card's text form ───────────────────────────────
// One per line: `name | kind | spec | description`, where spec is the argv line
// (command), the URL (http-get) or the workspace-relative path (file-read).
// Pipe rather than colon because a URL carries colons and a graph author should
// not have to escape them.
//
// Parameters are DERIVED from the {{name}} placeholders in the spec rather than
// declared separately: the substitution syntax already names them, and a
// parameter nothing substitutes is a parameter the tool can't use.

const QUERY_TOOL_PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

function querySpecOf(tool: GraphQueryTool): string {
  if (tool.kind === "command") {
    return (tool.command ?? []).join(" ");
  }
  return (tool.kind === "file-read" ? tool.path : tool.url) ?? "";
}

export function formatQueryTools(tools: readonly GraphQueryTool[] | undefined): string {
  return (tools ?? [])
    .map((tool) => [tool.name, tool.kind, querySpecOf(tool), tool.description].join(" | "))
    .join("\n");
}

function parseQueryToolLine(line: string): GraphQueryTool | null {
  const [rawName = "", rawKind = "", rawSpec = "", ...rest] = line.split("|");
  const name = rawName.trim();
  const spec = rawSpec.trim();
  if (!name || !spec) {
    return null;
  }
  // Unknown kinds reach the daemon as-is and are refused there; silently
  // rewriting one to "command" would run something the author never asked for.
  const kind = rawKind.trim() || "command";
  const parameters: GraphOutputField[] = [];
  for (const match of spec.matchAll(QUERY_TOOL_PLACEHOLDER)) {
    const key = match[1];
    if (key && !parameters.some((parameter) => parameter.key === key)) {
      parameters.push({ key, type: "string" });
    }
  }
  const description = rest.join("|").trim();
  return {
    name,
    kind,
    // The protocol requires a description — it is what the model reads to know
    // when to call this. Naming the tool is a poor one, but it beats refusing
    // to save a half-written line.
    description: description || name,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(kind === "command" ? { command: spec.split(/\s+/).filter(Boolean) } : {}),
    ...(kind === "http-get" ? { url: spec } : {}),
    ...(kind === "file-read" ? { path: spec } : {}),
  };
}

/**
 * Read the text form back into query tools.
 *
 * `previous` is what the node already carried: a line that still formats
 * identically to one of them hands back the ORIGINAL object, so hand-authored
 * detail the text form can't express (typed parameters, per-parameter
 * descriptions) survives a save by an author who never touched that line.
 */
export function parseQueryTools(
  text: string,
  previous: readonly GraphQueryTool[] = [],
): GraphQueryTool[] {
  const byLine = new Map(previous.map((tool) => [formatQueryTools([tool]), tool]));
  const tools: GraphQueryTool[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const untouched = byLine.get(trimmed);
    if (untouched) {
      tools.push(untouched);
      continue;
    }
    const parsed = parseQueryToolLine(trimmed);
    if (parsed) {
      tools.push(parsed);
    }
  }
  return tools;
}

// ── Prompt-template variable bindings ───────────────────────────────────────
// One per line: `name = value`. Values are literals, `$inputs.<key>` or
// `$output.<nodeId>.<field>`; the daemon resolves them, the designer only
// carries them.

export function formatTemplateVariables(
  variables: Readonly<Record<string, string>> | undefined,
): string {
  return Object.entries(variables ?? {})
    .map(([key, value]) => `${key} = ${value}`)
    .join("\n");
}

export function parseTemplateVariables(text: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key) {
      variables[key] = line.slice(separator + 1).trim();
    }
  }
  return variables;
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
