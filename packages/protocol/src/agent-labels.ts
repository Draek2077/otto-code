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
