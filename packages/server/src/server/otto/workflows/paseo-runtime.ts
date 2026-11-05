import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { Logger } from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import { validateAgentConfigurationAgainstProvider } from "../../agent/agent-configuration-validator.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { WorkflowHost } from "./host.js";
import type { WorkflowRuntimePorts, WorkflowAgentRequest } from "./runtime-ports.js";
import { WORKFLOW_RUN_LABEL, WORKFLOW_CONDUCTOR_LABEL } from "./labels.js";
import { WORKFLOW_CHAT_ORIGIN_LABEL } from "@getpaseo/plugin/otto/workflows";
import { WorkflowError } from "./files.js";
import { supportsWorkflowAccess, attachWorkflowLaunchOwner } from "./provider-policy.js";
import { workflowTurnOptions } from "./turn-authority.js";
import { consumeWorkflowTurn } from "./turn-output.js";
import { NodeOutputStore } from "./node-output.js";
import { waitForWorkflowChatIdle } from "./wait-turn.js";

export interface PaseoWorkflowRuntimeOptions {
  hostId: string;
  agents: AgentManager;
  storage: AgentStorage;
  providers: ProviderSnapshotManager;
  workspaces: Pick<WorkspaceRegistry, "get">;
  logger: Logger;
  host: () => WorkflowHost | null;
  outputs: NodeOutputStore;
  toolAllowed?(provider: string, name: string): Promise<boolean>;
}
/** Adapt the existing runtime owners. No session, process, catalog probe or subscription is created here. */
export function createPaseoWorkflowRuntime(
  options: PaseoWorkflowRuntimeOptions,
): WorkflowRuntimePorts & { detach(): void } {
  const { agents, providers } = options;
  const family = (provider: string): string | null => {
    const state = providers.getAgentManagerProviderState();
    if (state.clients[provider]?.capabilities.supportsOttoWorkflowReadMode) return "otto-openai";
    const seen = new Set<string>();
    let current = provider;
    while (!seen.has(current)) {
      seen.add(current);
      const definition = state.providerDefinitions[current];
      if (!definition) return null;
      if (!definition.derivedFromProviderId) return current;
      current = definition.derivedFromProviderId;
    }
    return null;
  };
  const detach = attachWorkflowLaunchOwner(agents, {
    binding: (id) => options.host()?.reservation(id) ?? null,
    active: (id) => !!options.host()?.binding(id),
    controlsConductor: (id) => options.host()?.controlsConductor(id) === true,
    family,
  });
  const ports: WorkflowRuntimePorts = {
    validateTools: async (seat, names) => {
      const client = providers.getAgentManagerProviderState().clients[seat.provider];
      if (
        !client ||
        (!client.capabilities.supportsMcpServers && !client.capabilities.supportsNativePaseoTools)
      )
        return [`Provider ${seat.provider} cannot receive the required Workflow control tools.`];
      const issues: string[] = [];
      for (const name of names)
        if (options.toolAllowed && !(await options.toolAllowed(seat.provider, name)))
          issues.push(`Enable ${name} for this host/provider before starting this Workflow.`);
      return issues;
    },
    workspace: async (scope, id) => {
      if (scope.hostId !== options.hostId)
        throw new WorkflowError("invalid", "Select the Workflow's owning daemon.");
      const record = await options.workspaces.get(id);
      if (!record || record.archivedAt || record.projectId !== scope.projectId)
        throw new WorkflowError("invalid", "Choose an active workspace in this project.");
      return { workspaceId: record.workspaceId, projectId: record.projectId, cwd: record.cwd };
    },
    validateSeat: async (seat, workspace, access) => {
      if (!providers.hasProvider(seat.provider))
        return [`Provider ${seat.provider} is not configured.`];
      const provider = await providers.getProvider({
        provider: seat.provider,
        cwd: workspace.cwd,
        wait: true,
      });
      if (!provider.enabled || provider.status !== "ready")
        return [`Provider ${seat.provider} is unavailable on this host.`];
      const issues = validateAgentConfigurationAgainstProvider({ input: seat, provider }).map(
        (issue) => issue.message,
      );
      if (!seat.model)
        issues.push(
          "Choose an explicit model for every Workflow seat so a provider default cannot change during launch.",
        );
      if (!supportsWorkflowAccess(family(seat.provider), access))
        issues.push(
          `Provider ${seat.provider} cannot enforce Workflow access ${access}. Choose a supported access adapter before launch.`,
        );
      return issues;
    },
    createAgent: async (request) => {
      const issues = await ports.validateSeat(request.seat, request.workspace, request.access);
      if (issues.length) throw new WorkflowError("unsupported", issues.join(" "));
      const resolved = await providers.resolveCreateConfig({
        provider: request.seat.provider,
        cwd: request.workspace.cwd,
        requestedMode: request.seat.modeId,
        featureValues: undefined,
        parent: null,
        unattended: false,
      });
      const binding = options.host()?.binding(request.agentId);
      if (!binding) throw new WorkflowError("conflict", "Workflow startup authority was revoked.");
      await agents.createAgent(
        {
          provider: request.seat.provider,
          model: request.seat.model,
          modeId: resolved.modeId,
          thinkingOptionId: request.seat.thinkingOptionId,
          featureValues: resolved.featureValues,
          cwd: request.workspace.cwd,
          title: request.title,
          systemPrompt: roleInstructions(request),
        },
        request.agentId,
        {
          workspaceId: request.workspace.workspaceId,
          initialTitle: request.title,
          persistSession: true,
          labels: {
            [WORKFLOW_CHAT_ORIGIN_LABEL]: JSON.stringify(binding.ref),
            [request.role === "conductor" ? WORKFLOW_CONDUCTOR_LABEL : WORKFLOW_RUN_LABEL]:
              request.runId,
            ...(request.parentAgentId ? { [PARENT_AGENT_ID_LABEL]: request.parentAgentId } : {}),
          },
          owner: {
            kind: "daemon",
            daemonId: options.hostId,
            executionId: `otto-workflow:${request.ownerInstance}:${request.runId}:${request.agentId}:${request.role}`,
          },
        },
      );
    },
    turn: async (id, text, signal) => {
      await waitForWorkflowChatIdle(agents, id, signal);
      const binding = options.host()?.binding(id);
      const denyPermission =
        binding && binding.role !== "conductor"
          ? async (requestId: string) => {
              await agents.respondToPermission(id, requestId, {
                behavior: "deny",
                message:
                  "Workflow workers cannot wait for interactive approval. Use a Workflow gate for a human decision.",
              });
            }
          : undefined;
      return consumeWorkflowTurn(
        agents,
        id,
        text,
        signal,
        workflowTurnOptions(id, () => !!options.host()?.binding(id)),
        options.outputs,
        options.logger,
        denyPermission,
      );
    },
    cancelAgent: async (id) => {
      if (agents.getAgent(id)) await agents.cancelAgentRun(id);
    },
    closeAgent: async (id) => {
      options.outputs.forget(id);
      await agents.closeAgent(id);
    },
    waitUntilIdle: (id, signal) => waitForWorkflowChatIdle(agents, id, signal),
    notice: async (id, text) => {
      await agents.appendTimelineItem(id, { type: "notification", level: "info", message: text });
    },
    ownsAgent: async (id, run, instance) => {
      const record = agents.getAgent(id) ?? (await options.storage.get(id));
      const owner = record?.owner;
      return (
        owner?.kind === "daemon" &&
        owner.daemonId === options.hostId &&
        owner.executionId.startsWith(`otto-workflow:${instance}:${run}:${id}:`)
      );
    },
    observe: (listener) =>
      agents.subscribe(
        (event) => {
          if (event.type === "agent_state" && event.agent.lifecycle === "closed")
            listener(event.agent.id, "archived");
          if (event.type === "agent_stream" && event.event.type === "turn_canceled")
            listener(event.agentId, "canceled");
        },
        { replayState: false },
      ),
    now: () => new Date().toISOString(),
    logger: options.logger,
  };
  return { ...ports, detach };
}
function roleInstructions(request: WorkflowAgentRequest) {
  if (request.role === "conductor")
    return "You conduct this dedicated Otto Workflow. Keep clarifying questions in this chat. For an AI Workflow, declare a bounded plan with start_workflow. For a declared Graph, explain actual node results; never invent nodes or launch a parallel plan. The daemon owns worker creation, caps and gates.";
  return "You are a dedicated Otto Workflow worker. Complete only your assigned task and return its concrete result. Do not change models, permission modes or workspace. Use managed Workflow delegation only when it is offered. Structured output belongs in submit_output when present.";
}
