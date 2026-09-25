import { isOttoToolEnabled } from "../otto-tool-policy.js";
import { z } from "zod";
import type { AgentManager } from "../agent-manager.js";
import { ottoToolGroupForName, type OttoToolGroup } from "@otto-code/protocol/provider-config";
import {
  getOrchestrationPolicyFromLabels,
  getToolGroupsFromLabels,
} from "@otto-code/protocol/agent-labels";
import {
  type WorkspaceAccess,
  isOttoToolAllowedForAccess,
  resolveWorkspaceAccess,
} from "../workspace-access.js";
import { registerBrowserTools } from "../../browser-tools/tools.js";
import { registerPreviewTools } from "../../preview/preview-tools.js";
import type {
  OttoToolCatalog,
  RegisterOttoTool,
  OttoToolDefinition,
  OttoToolExecutionContext,
  OttoToolResult,
} from "./types.js";
import { registerGraphNodeTools } from "./register-graph-node-tools.js";
import type { OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";
import { createOttoToolContext } from "./otto-tool-context.js";
import { registerArchitecturalViewsTools } from "./register-architectural-views-tools.js";
import { registerVoiceTools } from "./register-voice-tools.js";
import { registerChatCreationTools } from "./register-chat-creation-tools.js";
import { registerProfilesTools } from "./register-profiles-tools.js";
import { registerChatMessagingTools } from "./register-chat-messaging-tools.js";
import { registerChatStatusTools } from "./register-chat-status-tools.js";
import { registerWidgetsTools } from "./register-widgets-tools.js";
import { registerTasksTools } from "./register-tasks-tools.js";
import { registerMemoryTools } from "./register-memory-tools.js";
import { registerKnowledgeTools } from "./register-knowledge-tools.js";
import { registerChatMutationsTools } from "./register-chat-mutations-tools.js";
import { registerWorkspaceRenameTools } from "./register-workspace-rename-tools.js";
import { registerArtifactsTools } from "./register-artifacts-tools.js";
import { registerTerminalsTools } from "./register-terminals-tools.js";
import { registerSchedulesTools } from "./register-schedules-tools.js";
import { registerProvidersTools } from "./register-providers-tools.js";
import { registerWorkspacesTools } from "./register-workspaces-tools.js";
import { registerChatActivityTools } from "./register-chat-activity-tools.js";
import { registerPermissionsTools } from "./register-permissions-tools.js";
import { registerOrchestrationTools } from "./register-orchestration-tools.js";

// The caller's workspace-access ceiling (agent/workspace-access.ts), read from
// its stored config the same way the orchestration policy is read from its
// labels. No caller - the daemon/user-level catalog, not an agent session -
// resolves to "write", the pre-feature behaviour.
function resolveCallerWorkspaceAccess(
  agentManager: AgentManager,
  callerAgentId: string | undefined,
): WorkspaceAccess {
  return resolveWorkspaceAccess(
    callerAgentId ? agentManager.getAgent(callerAgentId)?.config.workspaceAccess : undefined,
  );
}

// Read the caller agent's orchestration policy label, if it carries one.
function resolveOrchestrationPolicy(
  agentManager: AgentManager,
  callerAgentId: string | undefined,
): "deterministic" | "autonomous" | null {
  if (!callerAgentId) {
    return null;
  }
  return getOrchestrationPolicyFromLabels(agentManager.getAgent(callerAgentId)?.labels);
}

// The orchestration tool binary (projects/orchestration-graphs). No policy ⇒
// everything allowed. "deterministic" - the daemon does all linking, so the
// node loses every orchestration-shaped tool (the agents + schedules groups)
// plus preview and browser control. "autonomous" - full toolset EXCEPT
// start_workflow: Workflows never nest.
function buildOrchestrationPolicyGate(
  policy: "deterministic" | "autonomous" | null,
): (name: string) => boolean {
  return (name: string): boolean => {
    if (!policy) {
      return true;
    }
    if (name === "start_workflow") {
      return false;
    }
    if (policy === "autonomous") {
      return true;
    }
    // A deterministic node may not start work of its own: no spawning or
    // steering chats, no orchestration, no scheduling, and no dev servers or
    // browser. Listed positively so splitting a group out of the old "agents"
    // catch-all cannot quietly widen what these nodes can reach - the split
    // categories that are pure reads (knowledge, providers) stay available,
    // and the ones that act on their own (orchestration, tasks) do not.
    return !DETERMINISTIC_NODE_DENIED_GROUPS.has(ottoToolGroupForName(name));
  };
}

const DETERMINISTIC_NODE_DENIED_GROUPS: ReadonlySet<OttoToolGroup> = new Set<OttoToolGroup>([
  "agents",
  "orchestration",
  "schedules",
  "tasks",
  "preview",
  "browser",
]);

/**
 * Two independent narrowings of the tool catalog, combined.
 *
 * `enabledGroups` is the daemon-wide allowlist (undefined = every group).
 * `nodeGroups` is one graph node's own declaration, read from its labels
 * (null = the node didn't declare one). They intersect, never union: a node can
 * hand itself less authority than the daemon allows, never more. An empty node
 * list is meaningful - "no Otto tools at all" - which is why it is an empty
 * array rather than null.
 */
// Validate a tool's input against its declared schema before the handler sees
// it. A tool may declare either a raw Zod shape or a whole ZodType; the shape
// form is wrapped as a passthrough object so unknown keys survive.
async function parseToolInput(tool: OttoToolDefinition, input: unknown): Promise<unknown> {
  const inputSchema = tool.inputSchema;
  if (!inputSchema) {
    return input;
  }
  const schema =
    typeof inputSchema === "object" &&
    inputSchema !== null &&
    typeof (inputSchema as { safeParseAsync?: unknown }).safeParseAsync === "function"
      ? (inputSchema as z.ZodType)
      : z.object(inputSchema as z.ZodRawShape).passthrough();
  return schema.parseAsync(input);
}

function buildToolGroupGate(input: {
  enabledGroups: OttoToolGroup[] | undefined;
  agentManager: AgentManager;
  callerAgentId: string | undefined;
}): (name: string) => boolean {
  const { enabledGroups, agentManager, callerAgentId } = input;
  const nodeGroups = getToolGroupsFromLabels(
    callerAgentId ? agentManager.getAgent(callerAgentId)?.labels : undefined,
  );
  return (name: string): boolean => {
    const group = ottoToolGroupForName(name);
    if (enabledGroups !== undefined && !enabledGroups.includes(group)) {
      return false;
    }
    return nodeGroups === null || nodeGroups.includes(group);
  };
}

export type { OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";

export { capWaitForAgentsMessage } from "./register-orchestration-tools.js";

export { resolveCaptureTerminalStart } from "./register-terminals-tools.js";

export function createOttoToolCatalog(options: OttoToolHostDependencies): OttoToolCatalog {
  const toolContext = createOttoToolContext(options);
  const { agentManager, callerAgentId, childLogger, resolveCallerAgent } = toolContext;
  const tools = new Map<string, OttoToolDefinition>();

  // undefined = all groups enabled (mirrors openai-compat per-provider
  // semantics); a defined set gates every tool by its ottoToolGroupForName.
  const enabledGroups = options.enabledOttoToolGroups;

  // A graph node may narrow its own catalog (projects/orchestration-graphs).
  // Intersecting rather than replacing is the whole contract: a node can give
  // itself less than the daemon allows, never more.
  const isToolGroupEnabled = buildToolGroupGate({ enabledGroups, agentManager, callerAgentId });

  // Orchestration tool policy (projects/orchestration-graphs): agents the
  // daemon spawned as graph nodes carry a policy label; the gate below strips
  // the tools that policy forbids. Enforced here at registration so every
  // catalog consumer (MCP and native tool loops alike) inherits the filter.
  const isToolAllowedByOrchestrationPolicy = buildOrchestrationPolicyGate(
    resolveOrchestrationPolicy(agentManager, callerAgentId),
  );

  const callerWorkspaceAccess = resolveCallerWorkspaceAccess(agentManager, callerAgentId);

  const registerTool: RegisterOttoTool = (name, config, handler) => {
    if (!isOttoToolEnabled(options.ottoToolPolicy, name, config.source)) return;
    // Per-group gating: a tool whose group is disabled is never registered, so
    // both the MCP path and any future catalog consumer inherit the filter.
    if (config.source !== "connector" && !isToolGroupEnabled(name)) {
      return;
    }
    if (config.source !== "connector" && !isToolAllowedByOrchestrationPolicy(name)) {
      return;
    }
    // Workspace-access ceiling: enforced here at registration, like the two
    // gates above, so every catalog consumer - the MCP server serving CLI
    // providers and openai-compat's daemon-owned tool loop - withholds the
    // same tools. A tool that was never registered cannot be argued into
    // running (agent/workspace-access.ts).
    if (!isOttoToolAllowedForAccess(name, callerWorkspaceAccess)) {
      return;
    }
    tools.set(name, {
      source: config.source,
      name,
      title: config.title,
      description: config.description ?? name,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      handler: handler as OttoToolDefinition["handler"],
    });
  };

  const toCatalog = (): OttoToolCatalog => {
    // Graph-defined output/query tools intentionally sit outside the built-in enable/group switch.
    // A provider's explicit name deny still applies to those independent registration paths.
    for (const name of options.ottoToolPolicy?.disabledTools ?? []) tools.delete(name);
    return {
      tools,
      getTool(name: string): OttoToolDefinition | undefined {
        return tools.get(name);
      },
      async executeTool(
        name: string,
        input: unknown,
        context: OttoToolExecutionContext = {},
      ): Promise<OttoToolResult> {
        const tool = tools.get(name);
        if (!tool) {
          throw new Error(`Otto tool not found: ${name}`);
        }
        return tool.handler(await parseToolInput(tool, input), context);
      },
    };
  };

  // Domain registrars get the shared policy gate, never direct access to the map.
  // Keep registration order stable for both MCP and native provider catalogs.
  const registration = { ...toolContext, registerTool };
  registerArchitecturalViewsTools(registration);

  registerVoiceTools(registration);

  if (options.voiceOnly) {
    return toCatalog();
  }

  // Both halves of Preview - browser verification (`browser_*`) and dev-server
  // lifecycle (`preview_*`) - are gated behind the browser-tools master, so the
  // "Browser Tools" host setting is a single functional switch for the whole
  // subsystem: master off = neither half is registered for any provider.
  if (options.browserToolsEnabled && options.browserToolsBroker) {
    registerBrowserTools({
      registerTool,
      broker: options.browserToolsBroker,
      callerAgentId,
      resolveCallerAgent,
      previewServers: options.previewDevServers ?? null,
    });
  }

  if (options.browserToolsEnabled && options.previewDevServers) {
    registerPreviewTools({
      registerTool,
      manager: options.previewDevServers,
      broker: options.browserToolsBroker ?? null,
      resolveCallerAgent,
    });
  }

  registerChatCreationTools(registration);

  registerProfilesTools(registration);

  registerChatMessagingTools(registration);

  registerChatStatusTools(registration);

  registerWidgetsTools(registration);

  registerTasksTools(registration);

  registerMemoryTools(registration);

  registerKnowledgeTools(registration);

  registerChatMutationsTools(registration);

  registerWorkspaceRenameTools(registration);

  registerArtifactsTools(registration);

  registerTerminalsTools(registration);

  registerSchedulesTools(registration);

  registerProvidersTools(registration);

  registerWorkspacesTools(registration);

  registerChatActivityTools(registration);

  registerPermissionsTools(registration);

  registerOrchestrationTools(registration);

  registerGraphNodeTools({
    tools,
    agentManager,
    callerAgentId,
    nodeOutputStore: options.nodeOutputStore,
    logger: childLogger,
  });

  for (const tool of options.connectorTools ?? []) {
    registerTool(tool.name, { ...tool, source: "connector" }, tool.handler);
  }

  return toCatalog();
}
