import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { z } from "zod";
import {
  VIEW_AUTHORING_LABEL,
  viewAuthoringContext,
  startViewAuthoring,
} from "@getpaseo/plugin/otto/architectural-views";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { createAgentCommand } from "../../agent/create-agent/create.js";
import { validateAgentConfigurationAgainstProvider } from "../../agent/agent-configuration-validator.js";
import type { RetainedToolPolicy } from "../retained-tool-policy.js";
import type { ArchitecturalViewsService } from "./service.js";
import { ArchitecturalViewError } from "./specification.js";
import { requireDraft } from "./drafts.js";
import { readDraft } from "./records.js";

/** Ordinary Paseo creation/dispatch only. No provider adapter, session loop or queue replacement. */
export function createViewAuthoring(ports: {
  host: ArchitecturalViewsService;
  agents: AgentManager;
  storage: AgentStorage;
  providers: ProviderSnapshotManager;
  workspaces: Pick<WorkspaceRegistry, "get">;
  policy: RetainedToolPolicy;
  logger: Logger;
}) {
  return {
    async start(input: z.infer<typeof startViewAuthoring.input>) {
      const projectId = await ports.host.project(input.scope);
      const workspace = await ports.workspaces.get(input.workspaceId);
      if (!workspace || workspace.archivedAt || workspace.projectId !== projectId)
        throw new ArchitecturalViewError(
          "invalid",
          "Choose an active workspace in this View's project for authoring.",
        );
      const store = await ports.host.library.store(projectId, input.identity);
      const current = requireDraft(
        await readDraft(store, input.identity.viewId, input.draftId),
        input.expectedRevision,
      );
      if (current.value.authoringAgentId) {
        const agent = ports.agents.getAgent(current.value.authoringAgentId);
        const context = viewAuthoringContext(agent?.labels, input.scope.hostId);
        if (
          agent &&
          context?.draftId === input.draftId &&
          context.identity.viewId === input.identity.viewId &&
          agent.workspaceId === input.workspaceId &&
          context.identity.origin.storeKey === input.identity.origin.storeKey
        )
          return {
            agentId: agent.id,
            draft: await ports.host.library.draftSummary(store, current),
          };
        throw new ArchitecturalViewError(
          "conflict",
          "The prior authoring chat is unavailable. Inspect it, then explicitly detach it before starting a new chat.",
        );
      }
      const provider = await ports.providers.getProvider({
        provider: input.selection.provider,
        cwd: workspace.cwd,
        wait: true,
      });
      const issues = validateAgentConfigurationAgainstProvider({
        input: input.selection,
        provider,
      });
      if (!provider.enabled || provider.status !== "ready" || issues.length)
        throw new ArchitecturalViewError(
          "unavailable",
          "The selected authoring provider/model is unavailable. Choose a ready model and valid permissions.",
        );
      if (
        !(await ports.policy("update_architectural_view_draft", input.selection.provider)) ||
        !(await ports.policy("read_architectural_view_draft", input.selection.provider))
      )
        throw new ArchitecturalViewError(
          "unavailable",
          "Enable the Knowledge/View tools for this host/provider before authoring.",
        );
      const client =
        ports.providers.getAgentManagerProviderState().clients[input.selection.provider];
      if (
        !client ||
        (!client.capabilities.supportsMcpServers && !client.capabilities.supportsNativePaseoTools)
      )
        throw new ArchitecturalViewError(
          "unavailable",
          "This provider cannot receive Otto's authoring tools.",
        );
      const agentId = randomUUID();
      const binding = {
        version: 1 as const,
        hostId: input.scope.hostId,
        workspaceId: input.workspaceId,
        identity: input.identity,
        draftId: input.draftId,
      };
      // Durable binding precedes registration/first turn. Creation failure retains
      // this identity for inspection; it never silently creates a second chat.
      const draft = await ports.host.drafts.bindAuthor(
        projectId,
        input.identity,
        input.draftId,
        input.expectedRevision,
        agentId,
        input.workspaceId,
      );
      const prompt = `Author the ${draft.diagramType} Architectural View "${draft.title}". Read your bound draft with read_architectural_view_draft, then its diagram contract. Read the linked Knowledge using the existing Knowledge tools before making factual claims. Update only this draft through update_architectural_view_draft; fix validation diagnostics in this same draft. The human will review and publish or discard. Explain briefly what you changed and any evidence gaps.`;
      await createAgentCommand(
        {
          agentManager: ports.agents,
          agentStorage: ports.storage,
          providerSnapshotManager: ports.providers,
          logger: ports.logger,
        },
        {
          kind: "session",
          agentId,
          config: { ...input.selection, cwd: workspace.cwd, title: draft.title },
          workspaceId: workspace.workspaceId,
          initialPrompt: prompt,
          labels: { [VIEW_AUTHORING_LABEL]: JSON.stringify(binding) },
          provisionalTitle: draft.title,
          firstAgentContext: { prompt, attachments: [] },
          buildSessionConfig: async (config) => ({ sessionConfig: config }),
        },
      );
      return { draft, agentId };
    },
  };
}
