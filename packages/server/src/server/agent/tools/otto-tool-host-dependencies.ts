import type { ProviderOttoToolsPolicy } from "@otto-code/protocol/provider-config";
import type { Logger } from "pino";
import type { AgentManager } from "../agent-manager.js";
import type { AgentWorkspaceTransferResult } from "../agent-workspace-transfer.js";
import type { ProfileMemoryService } from "../profile-memory/profile-memory-service.js";
import type { ProjectKnowledgeService } from "../project-knowledge/project-knowledge-service.js";
import { type AgentTeamsConfigView } from "@otto-code/protocol/agent-teams";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { type OttoToolGroup } from "@otto-code/protocol/provider-config";
import type { FirstAgentContext } from "../../messages.js";
import type { AgentStorage } from "../agent-storage.js";
import { type ArchiveDependencies } from "../../workspace-archive-service.js";
import { type CreateAgentCommandDependencies } from "../create-agent/create.js";
import { type NodeOutputStore } from "../../workflow/node-output.js";
import type { WorkflowService } from "../../workflow/workflow-service.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreateOttoWorktreeWorkflowFn } from "../../worktree-session.js";
import type { ScheduleService } from "../../schedule/service.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { ForgeService } from "../../../services/github-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { BrowserToolsBroker } from "../../browser-tools/broker.js";
import type { DevServerManager } from "../../preview/dev-server-manager.js";
import type { ArtifactService } from "../../artifact/artifact-service.js";
import type { ArchitecturalViewsService } from "../../architectural-views/architectural-views-service.js";
import type { ActivityIncrementFn } from "../../activity-stats/activity-stats-store.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { OttoToolDefinition } from "./types.js";

export interface OttoToolHostDependencies {
  connectorTools?: readonly OttoToolDefinition[];
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager?: TerminalManager | null;
  getDaemonTcpPort?: () => number | null;
  scheduleService?: ScheduleService | null;
  /**
   * Daemon-owned orchestration runtime. Enables the start_workflow /
   * get_workflow_status / wait_for_chats tools so an orchestrator chat can declare a multi-chat
   * plan the daemon executes. Absent on hosts that don't wire orchestration.
   */
  runService?: WorkflowService | null;
  providerSnapshotManager: ProviderSnapshotManager;
  /**
   * Reads the live Agent Personalities roster from the daemon config. Enables
   * chat creation by agent profile in create_chat and the list_agent_profiles tool. Absent
   * on hosts that don't wire personalities.
   */
  readAgentProfiles?: () => AgentProfile[];
  /**
   * Reads the live Agent Teams section (teams + active team id) from the
   * daemon config. Lets create_chat stamp the frozen team layer onto member
   * spawns. Absent on hosts that don't wire teams - spawns are then teamless,
   * exactly the no-active-team behavior.
   */
  readAgentTeams?: () => AgentTeamsConfigView | undefined;
  /**
   * Per-personality accrued lessons. Enables remember_lesson / review_lessons /
   * revise_lesson. Absent on hosts that don't wire personality memory, in which
   * case the tools are never registered at all - a tool that can only fail is
   * worse than a missing one.
   */
  personalityMemory?: ProfileMemoryService | null;
  /** Repository-scoped durable knowledge, injected for every agent in the repo. */
  projectKnowledge?: ProjectKnowledgeService | null;
  github?: ForgeService;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot" | "invalidateAuxiliaryReads"
  >;
  findWorkspaceIdForCwd?: ArchiveDependencies["findWorkspaceIdForCwd"];
  listActiveWorkspaces?: ArchiveDependencies["listActiveWorkspaces"];
  archiveWorkspaceRecord?: ArchiveDependencies["archiveWorkspaceRecord"];
  emitWorkspaceUpdatesForWorkspaceIds?: ArchiveDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
  /** Shared chat transfer path used by the workspace tool and the app action. */
  moveChatToWorkspace?: (input: {
    agentId: string;
    workspaceId: string;
  }) => Promise<AgentWorkspaceTransferResult>;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "upsert" | "list">;
  /**
   * Creates a workspace on an existing directory, for create_workspace's
   * "local" isolation. Supplied by the workspace provisioning service; the
   * worktree half goes through createOttoWorktree instead.
   */
  createDirectoryWorkspace?: (
    cwd: string,
    title?: string | null,
    projectId?: string,
  ) => Promise<PersistedWorkspaceRecord>;
  /**
   * Resolves a workspace's project grouping key to the project's canonical
   * root path, so create_artifact can stamp artifacts with the same
   * path-shaped projectId the client's create sheet stores.
   */
  projectRegistry?: Pick<ProjectRegistry, "get">;
  markWorkspaceArchiving?: ArchiveDependencies["markWorkspaceArchiving"];
  clearWorkspaceArchiving?: ArchiveDependencies["clearWorkspaceArchiving"];
  createOttoWorktree?: CreateOttoWorktreeWorkflowFn;
  // Mints a fresh directory workspace for a cwd and returns its id.
  ensureWorkspaceForCreate?: (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ) => Promise<string>;
  // Schedules an AI-written short chat title for a spawned chat that had no
  // explicit title. Absent when structured generation isn't wired.
  scheduleAutoTitle?: CreateAgentCommandDependencies["scheduleAutoTitle"];
  browserToolsEnabled?: boolean;
  ottoToolPolicy?: ProviderOttoToolsPolicy;
  browserToolsBroker?: BrowserToolsBroker | null;
  previewDevServers?: DevServerManager | null;
  /**
   * Daemon-wide Otto tool-group allowlist. undefined = every group enabled
   * (mirrors openai-compat's per-provider `ottoToolGroups` semantics); an empty
   * array = no Otto tools. A tool whose group (ottoToolGroupForName) is absent
   * from this set is never registered - so the MCP catalog and any future
   * consumer inherit per-group gating. The browser AND preview groups remain
   * additionally gated by `browserToolsEnabled` (the authoritative browser
   * master over the whole Preview subsystem); the group filter can only further
   * restrict, never re-enable what the master disabled.
   */
  enabledOttoToolGroups?: OttoToolGroup[];
  /**
   * Daemon-global artifact service so agents can create artifacts via the
   * create_artifact tool. Absent on hosts that don't wire artifacts.
   */
  artifactService?: ArtifactService | null;
  /** Knowledge-packaged visual documents, available only through their bound authoring chat. */
  architecturalViews?: ArchitecturalViewsService | null;
  /** Routes an explicit agent request to open a published view in its workspace. */
  openArchitecturalView?: (input: { agentId: string; workspaceId: string; viewId: string }) => void;
  /** Broadcasts artifact.created.notification to every connected client. */
  emitArtifactCreated?: (artifact: ArtifactMetadata) => void;
  /** Broadcasts artifact.updated.notification to every connected client. */
  emitArtifactUpdated?: (artifact: ArtifactMetadata) => void;
  ottoHome?: string;
  worktreesRoot?: string;
  /**
   * ID of the agent that is using this tool catalog.
   * Used for cwd/mode inheritance when agents spawn child agents.
   */
  callerAgentId?: string;
  /**
   * Optional resolver for session-bound speak handlers.
   * Used by hidden voice agents to narrate through daemon-managed TTS.
   */
  resolveSpeakHandler?: (callerAgentId: string) => VoiceSpeakHandler | null;
  resolveCallerContext?: (callerAgentId: string) => VoiceCallerContext | null;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
  /** Fun-stats counters - see packages/server/src/server/activity-stats. */
  onActivity?: ActivityIncrementFn;
  /**
   * Where submit_output writes what a graph node's agent submitted. Present
   * when orchestration is wired; the tool only registers for agents that carry
   * declared output fields on their labels, so hosts without graphs never see
   * it. See packages/server/src/server/workflow/node-output.ts.
   */
  nodeOutputStore?: NodeOutputStore | null;
  logger: Logger;
}
