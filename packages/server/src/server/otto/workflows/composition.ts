import type { Logger } from "pino";
import type { MutableDaemonConfig } from "../../daemon-config-store.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { OttoProjectMetadata } from "../project-metadata.js";
import { createRetainedToolPolicy } from "../retained-tool-policy.js";
import { resolvePaseoToolPolicy, isPaseoToolEnabled } from "../../agent/paseo-tool-policy.js";
import { WorkflowStores } from "./stores.js";
import { WorkflowLibrary } from "./library.js";
import { WorkflowChanges } from "./changes.js";
import { WorkflowHost } from "./host.js";
import { WorkflowDaemonService } from "./service.js";
import { createPaseoWorkflowRuntime } from "./paseo-runtime.js";
import { NodeOutputStore } from "./node-output.js";
import type { WorkflowToolPorts } from "./tools.js";
import { WorkflowError } from "./files.js";
import { WorkflowScheduleAdapter } from "./schedule-adapter.js";

interface CompositionOptions {
  home: string;
  hostId: string;
  hostLabel: string;
  logger: Logger;
  metadata: Pick<OttoProjectMetadata, "read" | "update">;
  workspaces: Pick<WorkspaceRegistry, "get">;
  agents: AgentManager;
  storage: AgentStorage;
  providers: ProviderSnapshotManager;
  readConfig(): Pick<MutableDaemonConfig, "mcp" | "providers">;
}
/** Compose existing owners once. No constructor starts a session, model, timer, watcher or filesystem scan. */
export function createWorkflowComposition(options: CompositionOptions) {
  const changes = new WorkflowChanges(),
    outputs = new NodeOutputStore();
  const stores = new WorkflowStores({
    home: options.home,
    hostId: options.hostId,
    hostLabel: options.hostLabel,
    metadata: options.metadata,
  });
  const library = new WorkflowLibrary({
    stores,
    changed: (scope) => changes.publish(scope),
    legacyWorkspaceProject: async (id) => (await options.workspaces.get(id))?.projectId ?? null,
  });
  const policy = createRetainedToolPolicy("orchestration", options.home, options.readConfig);
  let host: WorkflowHost | null = null;
  const runtime = createPaseoWorkflowRuntime({
    hostId: options.hostId,
    agents: options.agents,
    storage: options.storage,
    providers: options.providers,
    workspaces: options.workspaces,
    logger: options.logger,
    outputs,
    host: () => host,
    toolAllowed: async (provider, name) => {
      const config = options.readConfig();
      return (
        config.mcp.enabled !== false &&
        config.mcp.injectIntoAgents !== false &&
        isPaseoToolEnabled(resolvePaseoToolPolicy(provider, config.providers), name) &&
        (await policy(name, provider))
      );
    },
  });
  host = new WorkflowHost(library, {
    ...runtime,
    changed: (entry) => changes.publish(entry.ref.scope),
  });
  const service = new WorkflowDaemonService(library, host, changes);
  return {
    service,
    schedules: new WorkflowScheduleAdapter(host),
    invoke: (method: string, input: unknown) => service.invoke(method, input),
    async initialize() {
      try {
        await service.host.initialize();
      } catch (error) {
        service.host.unavailable();
        options.logger.error(
          { err: error },
          "Workflow recovery unavailable; ordinary Paseo runtime remains available",
        );
      }
    },
    tools(callerAgentId?: string): WorkflowToolPorts {
      return {
        service,
        outputs,
        policy,
        caller: () => {
          const agent = callerAgentId ? options.agents.getAgent(callerAgentId) : null;
          const reserved = callerAgentId ? service.host.reservation(callerAgentId) : null;
          return {
            agentId: callerAgentId,
            provider: agent?.provider ?? reserved?.request.seat.provider,
            workspaceId: agent?.workspaceId ?? reserved?.request.workspace.workspaceId,
          };
        },
        scope: async (workspaceId) => {
          const workspace = await options.workspaces.get(workspaceId);
          if (!workspace || workspace.archivedAt)
            throw new WorkflowError("invalid", "Select an active Workflow workspace.");
          return { hostId: options.hostId, projectId: workspace.projectId };
        },
      };
    },
    async close() {
      await service.close();
      runtime.detach();
    },
  };
}
