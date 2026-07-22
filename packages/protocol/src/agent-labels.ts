export const PARENT_AGENT_ID_LABEL = "otto.parent-agent-id";

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

// ── Orchestration node labels (projects/orchestration-graphs) ───────────────
// Stamped by the daemon on agents it spawns as orchestration participants. The
// otto-tool catalog reads the policy label to enforce the tool binary:
// "deterministic" — the daemon does all linking; the node gets NO orchestration
// tools (spawning/steering agents, runs), NO preview/dev-server tools, and NO
// browser tools. "autonomous" — full otto toolset EXCEPT start_run
// (orchestrations never nest orchestrations).
export const ORCHESTRATION_POLICY_LABEL = "otto.orchestration-policy";

export const ORCHESTRATION_POLICIES = ["deterministic", "autonomous"] as const;
export type OrchestrationPolicy = (typeof ORCHESTRATION_POLICIES)[number];

export function getOrchestrationPolicyFromLabels(
  labels: Record<string, unknown> | null | undefined,
): OrchestrationPolicy | null {
  const value = labels?.[ORCHESTRATION_POLICY_LABEL];
  return value === "deterministic" || value === "autonomous" ? value : null;
}

// First-class run attribution for orchestration children (parentage rides
// PARENT_AGENT_ID_LABEL; this ties the child to the run record itself).
export const ORCHESTRATION_RUN_ID_LABEL = "otto.orchestration-run-id";

// The node's declared output fields, JSON-encoded, stamped on the spawned
// agent. The otto-tool catalog reads it to register that agent's submit_output
// tool — which is why this rides a label rather than a spawn option: the
// catalog is built per agent from the agent's own record, so every provider
// (MCP-served and native-loop alike) inherits the tool with no per-provider
// plumbing. Malformed JSON reads as "no declared fields" — a node that can't
// parse its own contract falls back to prose rather than failing to spawn.
export const ORCHESTRATION_OUTPUT_FIELDS_LABEL = "otto.orchestration-output-fields";

export interface OrchestrationOutputField {
  key: string;
  type: string;
  description?: string;
  required?: boolean;
}

export function getOutputFieldsFromLabels(
  labels: Record<string, unknown> | null | undefined,
): OrchestrationOutputField[] | null {
  return parseJsonArrayLabel(labels, ORCHESTRATION_OUTPUT_FIELDS_LABEL, (candidate) => {
    return typeof candidate.key === "string" && typeof candidate.type === "string";
  }) as OrchestrationOutputField[] | null;
}

// The node's per-node Otto tool-group allowlist, JSON-encoded. Read by the tool
// catalog to narrow (never widen) what this one agent may reach.
export const ORCHESTRATION_TOOL_GROUPS_LABEL = "otto.orchestration-tool-groups";

export function getToolGroupsFromLabels(
  labels: Record<string, unknown> | null | undefined,
): string[] | null {
  const raw = labels?.[ORCHESTRATION_TOOL_GROUPS_LABEL];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const groups = parsed.filter((entry): entry is string => typeof entry === "string");
    // An empty allowlist is meaningful ("no Otto tools at all"), so it is
    // returned as an empty array rather than collapsing to null.
    return groups;
  } catch {
    return null;
  }
}

// The node's query tools, JSON-encoded. Read by the tool catalog, which
// registers each one for this agent alone.
export const ORCHESTRATION_QUERY_TOOLS_LABEL = "otto.orchestration-query-tools";

export interface OrchestrationQueryToolLabel {
  name: string;
  description: string;
  kind: string;
  parameters?: OrchestrationOutputField[];
  command?: string[];
  url?: string;
  path?: string;
}

export function getQueryToolsFromLabels(
  labels: Record<string, unknown> | null | undefined,
): OrchestrationQueryToolLabel[] | null {
  return parseJsonArrayLabel(labels, ORCHESTRATION_QUERY_TOOLS_LABEL, (candidate) => {
    return typeof candidate.name === "string" && typeof candidate.kind === "string";
  }) as OrchestrationQueryToolLabel[] | null;
}

// Labels are strings, so structured node config rides as JSON. Malformed JSON
// reads as "nothing declared" everywhere: a node that cannot parse its own
// configuration should lose the capability, never fail to spawn.
function parseJsonArrayLabel(
  labels: Record<string, unknown> | null | undefined,
  key: string,
  isValid: (candidate: Record<string, unknown>) => boolean,
): unknown[] | null {
  const raw = labels?.[key];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const entries = parsed.filter((entry): entry is Record<string, unknown> => {
    return typeof entry === "object" && entry !== null && isValid(entry as Record<string, unknown>);
  });
  return entries.length > 0 ? entries : null;
}
