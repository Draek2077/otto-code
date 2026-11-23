import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { KanbanDaemonService } from "./service.js";
import { createKanbanTools, KanbanToolScopeError } from "./tools.js";
import { failure } from "@getpaseo/plugin/otto/kanban";
import type { KanbanToolPolicy } from "./tool-policy.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";

export interface KanbanCaller {
  bound: boolean;
  workspaceId: string | null;
  locked: boolean;
  provider?: string;
}
interface KanbanCatalogPorts {
  host?: Pick<KanbanDaemonService, "invoke" | "hostId">;
  workspaces?: Pick<WorkspaceRegistry, "get">;
  caller(): KanbanCaller;
  policy?: KanbanToolPolicy;
}
function withPolicy(tool: PaseoToolDefinition, ports: KanbanCatalogPorts): PaseoToolDefinition {
  return {
    ...tool,
    async handler(input, context) {
      try {
        if (ports.policy && !(await ports.policy(tool.name, ports.caller().provider)))
          return {
            content: [],
            isError: true,
            structuredContent: failure(
              "access_denied",
              "Kanban agent tools are disabled or their retained host/provider policy cannot be read. Check the owning host settings; no provider operation was attempted.",
            ),
          };
        return await tool.handler(input, context);
      } catch {
        return {
          content: [],
          isError: true,
          structuredContent: failure(
            "unavailable",
            "The host could not validate Kanban tool access. No automatic retry was started.",
          ),
        };
      }
    },
  };
}
/** A configured project is resolved from registry identity, never a path or model-supplied host/project ID. */
export function createKanbanCatalogTools(ports: KanbanCatalogPorts) {
  const host = ports.host;
  const registry = ports.workspaces;
  if (!host || !registry) return [];
  const tools = createKanbanTools(host, async (requested) => {
    const caller = ports.caller();
    if (caller.bound && !caller.workspaceId)
      throw new KanbanToolScopeError("This chat has no active workspace for Kanban.");
    const selected = requested ?? caller.workspaceId;
    if (!selected)
      throw new KanbanToolScopeError("Supply workspaceId when using Kanban outside a chat.");
    const workspace = await registry.get(selected);
    if (!workspace || workspace.archivedAt)
      throw new KanbanToolScopeError("Select an active workspace for Kanban.");
    if (caller.workspaceId) {
      const origin =
        selected === caller.workspaceId ? workspace : await registry.get(caller.workspaceId);
      if (
        !origin ||
        origin.archivedAt ||
        origin.projectId !== workspace.projectId ||
        (caller.locked && selected !== caller.workspaceId)
      )
        throw new KanbanToolScopeError(
          "Kanban tools are bound to this chat's configured project and workspace permissions.",
        );
    }
    return { hostId: host.hostId, projectId: workspace.projectId };
  });
  return tools.map((tool) => withPolicy(tool, ports));
}
