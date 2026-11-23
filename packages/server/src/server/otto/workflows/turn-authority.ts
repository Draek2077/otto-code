import type { AgentRunOptions } from "../../agent/agent-sdk-types.js";
import type { AgentOwner } from "../../agent/agent-owner.js";
import { WORKFLOW_RUN_LABEL, WORKFLOW_CONDUCTOR_LABEL } from "./labels.js";

interface WorkflowAgentIdentity {
  id: string;
  labels: Record<string, string>;
  owner?: AgentOwner;
}
interface Grant {
  agentId: string;
  active: () => boolean;
  admitted: boolean;
}
const grants = new WeakMap<AgentRunOptions, Grant>();

export function isWorkflowWorker(agent: WorkflowAgentIdentity): boolean {
  return (
    !!agent.labels[WORKFLOW_RUN_LABEL] ||
    !!(
      agent.owner?.kind === "daemon" &&
      agent.owner.executionId.startsWith("otto-workflow:") &&
      !agent.owner.executionId.endsWith(":conductor")
    )
  );
}
/** A runtime-only, one-use object capability. It is never serialized in config, RPC, labels or provider options. */
export function workflowTurnOptions(agentId: string, active: () => boolean): AgentRunOptions {
  const options: AgentRunOptions = {};
  grants.set(options, { agentId, active, admitted: false });
  return options;
}
export function assertWorkflowTurn(
  agent: WorkflowAgentIdentity,
  options: AgentRunOptions | undefined,
  stage: "admit" | "execute" = "admit",
  controlledConductor = false,
): void {
  if (!isWorkflowWorker(agent) && !controlledConductor) return;
  const grant = options ? grants.get(options) : undefined;
  if (
    !grant ||
    grant.agentId !== agent.id ||
    !grant.active() ||
    grant.admitted === (stage === "admit")
  )
    throw new Error(
      "Workflow workers are controlled by their owning run. Open an ordinary chat to continue this work independently.",
    );
  if (stage === "admit") grant.admitted = true;
}
export function assertWorkflowInteractiveControl(
  agent: WorkflowAgentIdentity,
  controlledConductor = false,
): void {
  if (isWorkflowWorker(agent) || controlledConductor)
    throw new Error(
      "Workflow-owned worker sessions cannot be steered, replaced or reloaded. Use the Workflow run controls.",
    );
}
export function assertWorkflowConfigurationChange(agent: WorkflowAgentIdentity): void {
  if (
    isWorkflowWorker(agent) ||
    agent.labels[WORKFLOW_CONDUCTOR_LABEL] ||
    agent.owner?.executionId.startsWith("otto-workflow:")
  )
    throw new Error(
      "Workflow model and permission configuration is captured by its run. Review a new Workflow to change it.",
    );
}
