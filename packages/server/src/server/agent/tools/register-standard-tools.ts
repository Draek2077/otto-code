import type { OttoToolContext } from "./otto-tool-context.js";
import type { OttoToolHostDependencies } from "./otto-tool-host-dependencies.js";
import type { RegisterOttoTool } from "./types.js";
import { registerChatCreationTools } from "./register-chat-creation-tools.js";
import { registerProfilesTools } from "./register-profiles-tools.js";
import { registerChatMessagingTools } from "./register-chat-messaging-tools.js";
import { registerChatStatusTools } from "./register-chat-status-tools.js";
import { registerWidgetsTools } from "./register-widgets-tools.js";
import { registerTasksTools } from "./register-tasks-tools.js";
import { registerKanbanCatalogTools } from "./register-kanban-tools.js";
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

/** Registration order is the catalog order for both MCP and native tool loops. */
export function registerStandardTools(
  registration: OttoToolContext & { registerTool: RegisterOttoTool },
  options: OttoToolHostDependencies,
): void {
  registerChatCreationTools(registration);
  registerProfilesTools(registration);
  registerChatMessagingTools(registration);
  registerChatStatusTools(registration);
  registerWidgetsTools(registration);
  registerTasksTools(registration);
  registerKanbanCatalogTools(registration, options);
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
}
