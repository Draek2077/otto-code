import equal from "fast-deep-equal";
import { v4 as uuidv4 } from "uuid";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join, normalize, resolve, sep } from "path";
import { homedir } from "node:os";
import { CLIENT_CAPS, type ClientCapability } from "@otto-code/protocol/client-capabilities";
import {
  serializeAgentStreamEvent,
  type AgentSnapshotPayload,
  type AgentAttachment,
  type FirstAgentContext,
  type SessionInboundMessage,
  type SessionOutboundMessage,
  type FileRefineRequest,
  type FileRefineResult,
  type GitSetupOptions,
  type StartWorkspaceScriptRequest,
  type WorkspaceScriptListRequest,
  type WorkspaceScriptStartRequest,
  type WorkspaceScriptStopRequest,
  type CloseItemsRequest,
  type DirectorySuggestionsRequest,
  type ProjectPlacementPayload,
  type WorkspaceSetupSnapshot,
  type WorkspaceDescriptorPayload,
} from "./messages.js";
import type {
  TerminalManager,
  TerminalWorkspaceContributionChangedEvent,
} from "../terminal/terminal-manager.js";
import { TerminalSessionController } from "../terminal/terminal-session-controller.js";
import { detectWindowsTerminalShells } from "../terminal/windows-terminal-shells.js";
import type { TerminalActivity } from "@otto-code/protocol/terminal-activity";
import type { BinaryFrame } from "@otto-code/protocol/binary-frames/index";
import { CursorError } from "./pagination/cursor.js";
import { SortablePager, type SortSpec } from "./pagination/sortable-pager.js";
import { describeAgentHistoryMatches, rankAgentHistoryCandidates } from "./agent-history-search.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "./speech/speech-provider.js";
import {
  EMPTY_SPEECH_SETTINGS_OPTIONS,
  type SpeechSettingsOptions,
} from "./speech/speech-settings-options.js";
import type { TurnDetectionProvider } from "./speech/turn-detection-provider.js";
import {
  buildConfigOverrides,
  isStoredAgentProviderAvailable,
  toAgentPersistenceHandle,
} from "./persistence-hooks.js";
import { ensureAgentLoaded, ensureUnarchivedAgentLoaded } from "./agent/agent-loading.js";
import {
  sendPromptToAgent,
  waitForAgentRunStartWithTimeout,
  unarchiveAgentState,
  type StartAgentRunResult,
} from "./agent/agent-prompt.js";
import { steerQueuePromptText } from "./agent/steer-queue-state.js";
import {
  resolveCreateAgentTitles,
  resolveFirstAgentPromptTitle,
} from "./agent/create-agent-title.js";
import { respondToAgentPermission } from "./agent/permission-response.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "./voice-types.js";
import type { ScriptHealthState } from "./script-health-monitor.js";
import { spawnWorkspaceScript } from "./worktree-bootstrap.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import {
  createWorkspaceScriptsService,
  type WorkspaceScriptsService,
} from "./session/workspace-scripts/workspace-scripts-service.js";
import { redactDaemonConfigForClient } from "./daemon-config-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import { listConnectorTools } from "./connectors/connector-tools.js";
import type { ConnectorOAuthBroker } from "./connectors/connector-oauth.js";
import { CommunicationsService } from "./communications/communications-service.js";
import {
  ZoomTeamChatAuthorizationUnavailableError,
  ZoomTeamChatManagedAuthorizationBroker,
} from "./communications/zoom-team-chat-managed-authorization.js";
import { IntegrationAuthorizationCatalog } from "./integration-authorization/integration-authorization-catalog.js";
import { IntegrationBrowserAuthorizationService } from "./integration-authorization/browser-authorization-service.js";
import { IntegrationAuthorizationService } from "./integration-authorization/integration-authorization-service.js";
import { MeetingTranscriptStore } from "./meetings/transcript-store.js";
import type { ConnectorsOauthAuthorizeResponse } from "@otto-code/protocol/messages";
import { getErrorMessage, getErrorMessageOr } from "@otto-code/protocol/error-utils";
import { getAgentStatusPriority } from "@otto-code/protocol/agent-state-bucket";
import { getParentAgentIdFromLabels } from "@otto-code/protocol/agent-labels";
import {
  normalizeGitHostingProviderId,
  ActivityCountersSchema,
} from "@otto-code/protocol/messages";
import { loadPersistedConfig } from "./persisted-config.js";
import { releaseWorkspaceServicePortPlan } from "./workspace-service-port-registry.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "./workspace-git-service.js";
import type { GitHostingService } from "../services/git-hosting/types.js";
import type { HostingOwnerSummary, HostingRepositorySummary } from "../services/github-service.js";
import {
  createProjectScaffoldService,
  getScaffoldOutcome,
  ProjectScaffoldError,
  type ProjectScaffoldErrorCode,
  type ProjectScaffoldOutcome,
} from "./project-scaffold/project-scaffold-service.js";
import type { ProjectUpdate } from "./workspace-reconciliation-service.js";
import {
  CLIENT_SHUTDOWN_RPC_REASON,
  normalizeClientRestartRpcReason,
} from "./lifecycle-reasons.js";

import { AgentManager, AgentRunCancellationError } from "./agent/agent-manager.js";
import {
  ContextManagementService,
  resolveProjectRootForCwd,
} from "./agent/context-management/context-management-service.js";
import { convertEdge } from "./agent/context-management/edge-convert.js";
import { fixFindings } from "./agent/context-management/finding-fix.js";
import type { PersonalityMemoryService } from "./agent/personality-memory/personality-memory-service.js";
import type { ProjectKnowledgeService } from "./agent/project-knowledge/project-knowledge-service.js";
import { composeSystemPromptParts } from "./agent/system-prompt.js";
import { buildTimelinePromptIndex } from "./agent/timeline-prompt-index.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type {
  ActivityIncrementFn,
  ActivityRollups,
} from "./activity-stats/activity-stats-store.js";
import type { UsageLogPage, UsageLogPageQuery } from "./activity-stats/usage-log-store.js";
import type {
  AgentManagerEvent,
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  AgentTimelineFetchResult,
  ManagedAgent,
} from "./agent/agent-manager.js";
import { createAgentCommand, formatProviderModel } from "./agent/create-agent/create.js";
import { resolveCreateAgentIntent, type CreateAgentIntent } from "./agent/create-agent/intent.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  detachAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "./agent/lifecycle-command.js";
import { transferAgentWorkspaceCommand } from "./agent/agent-workspace-transfer.js";
import {
  buildStoredAgentPayload,
  resolveStoredAgentPayloadUpdatedAt,
  toAgentPayload,
} from "./agent/agent-projections.js";
import {
  appendTimelineItemIfAgentKnown,
  emitLiveTimelineItemIfAgentKnown,
} from "./agent/timeline-append.js";
import {
  projectTimelineRows,
  selectProjectedTimelinePage,
  type TimelineProjectionEntry,
  type TimelineProjectionMode,
} from "./agent/timeline-projection.js";
import { buildAgentForkContextAttachment } from "./agent/activity-curator.js";
import { buildAgentPrompt } from "./agent/prompt-attachments.js";
import type { StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";
import {
  getAgentStreamEventTurnId,
  type AgentPersistenceHandle,
  type AgentPermissionResponse,
  type AgentRunOptions,
  type AgentSessionConfig,
} from "./agent/agent-sdk-types.js";
import { resolveProfile, type ResolvedProfileSnapshot } from "./agent/agent-profiles.js";
import {
  composeTeamAndPersonalityPrompt,
  resolveTeamSnapshotForPersonality,
} from "./agent/agent-teams.js";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { selectArchivedForDeletion } from "./agent/history-retention.js";
import {
  clearMaterializedProviderImages,
  readMaterializedImageStats,
} from "./agent/providers/provider-image-output.js";
import {
  ImportSessionsRequestError,
  importProviderSession,
  listImportableProviderSessions,
  normalizeImportAgentRequest,
} from "./agent/import-sessions.js";
import {
  checkoutLiteFromGitSnapshot,
  checkoutFromPersistedWorkspacePlacement,
  deriveWorkspaceDisplayName,
} from "./workspace-registry-model.js";
import { resolveWorkspaceIdForPath } from "./resolve-workspace-id-for-path.js";
import {
  resolveProjectDisplayName,
  resolveWorkspaceDisplayName,
  resolveWorkspaceName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectMutation,
  type ProjectRegistry,
  type WorkspaceMutation,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import { createNoopProjectLinkStore, type ProjectLinkStore } from "./project-links.js";
import { wrapSpokenInput } from "./voice-config.js";
import { isVoicePermissionAllowed } from "./voice-permission-policy.js";
import {
  readProjectIcon,
  removeProjectCustomIcon,
  setProjectCustomIcon,
} from "../utils/project-custom-icon.js";
import { VoiceSession } from "./session/voice/voice-session.js";
import { CheckoutSession, type BusyWorkspaceAgent } from "./session/checkout/checkout-session.js";
import { KanbanSession, type KanbanProjectTarget } from "./kanban/kanban-session.js";
import { normalizeKanbanProjectTarget } from "./kanban/project-target.js";
import { gitOperationLog } from "./git-operation-log.js";
import {
  createWorkspaceGitObserverService,
  type WorkspaceGitObserverService,
} from "./session/workspace-git-observer/workspace-git-observer-service.js";
import {
  createAgentStructuredTextGeneration,
  createGitMetadataGenerator,
} from "./session/checkout/git-metadata-generator.js";
import {
  createVoiceCueGenerator,
  type CueMoment,
  type VoiceCueGenerator,
} from "./agent/voice-cue-generator.js";
import {
  createPersonalityProfileGenerator,
  type PersonalityProfileGenerator,
} from "./agent/personality-profile-generator.js";
import {
  RefineError,
  createRefineGenerator,
  type RefineGenerator,
} from "./session/files/refine-generator.js";
import { ScheduleSession } from "./session/schedule/schedule-session.js";
import { ProviderCatalogSession } from "./session/provider/provider-catalog-session.js";
import { WorkspaceFilesSession } from "./session/files/workspace-files-session.js";
import { AgentConfigSession } from "./session/agent-config/agent-config-session.js";
import { ArtifactSession } from "./session/artifact/artifact-session.js";
import { ArtifactService } from "./artifact/artifact-service.js";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { ProjectConfigSession } from "./session/project-config/project-config-session.js";
import { DaemonSession, type DaemonRuntimeConfig } from "./session/daemon/daemon-session.js";
import type { DaemonWebSocketRuntimeDiagnosticSnapshot } from "./session/daemon/diagnostics.js";
import type { HubRelationshipManagement } from "./hub/relationship-controller.js";
// DISABLED(hub): the only value import of the three; the two type imports
// around it are erased at compile time and cost nothing. See hub-disabled.ts.
import { HubExecutionController } from "./hub-disabled.js";
import type { HubExecutionAgents } from "./hub/daemon-executions.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { DevServerManager } from "./preview/dev-server-manager.js";
import { BrainSession } from "./session/brain/brain-session.js";
import { CommunicationsSession } from "./session/communications/communications-session.js";
import { RunsSession } from "./session/runs/runs-session.js";
import { ProjectKnowledgeSession } from "./session/project-knowledge/project-knowledge-session.js";
import { CodeIntelligenceSession } from "./session/code-intelligence/code-intelligence-session.js";
import type { BrainManager } from "./brain/brain-manager.js";
import type { BrainOpsManager } from "./brain/brain-ops-manager.js";
import { readLaunchConfig, LaunchConfigError } from "./preview/launch-config.js";
import type { PushNotifications } from "./push/index.js";
import {
  archivePersistedWorkspaceRecord,
  archiveWorkspaceContents,
  dropGitOperationLogs,
  stopLanguageServersForArchivedDirectories,
} from "./workspace-archive-service.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import {
  renameCurrentBranch as renameCurrentBranchDefault,
  setCheckoutBaseRef,
} from "../utils/checkout-git.js";
import {
  createGitMutationService,
  type GitMutationService,
} from "./session/git-mutation/git-mutation-service.js";
import {
  createWorkspaceProvisioningService,
  WorkspaceProvisioningError,
  type WorkspaceProvisioningService,
} from "./session/workspace-provisioning/workspace-provisioning-service.js";
import {
  createWorkspaceRecoveryService,
  type WorkspaceRecoveryService,
} from "./session/workspace-recovery/workspace-recovery-service.js";
import {
  createAgentUpdatesService,
  matchesAgentUpdatesFilter,
  type AgentUpdatesService,
} from "./session/agent-updates/agent-updates-service.js";
import { areEquivalentPaths, expandTilde } from "../utils/path.js";
import {
  searchDirectoryEntries,
  WORKSPACE_SEARCH_HIDDEN_DIRECTORIES,
} from "../utils/directory-suggestions.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { Resolvable } from "./speech/provider-resolver.js";
import type { SpeechReadinessSnapshot } from "./speech/speech-runtime.js";
import type pino from "pino";
import type { LspService } from "./lsp/service.js";
import { SolutionService } from "./solution-model/service.js";
import { ScheduleService } from "./schedule/service.js";
import type { RunService } from "./orchestration/run-service.js";
import type { GraphStore } from "./orchestration/graph-store.js";
import type { NodeOutputStore } from "./orchestration/node-output.js";
import type { PromptTemplateStore } from "./orchestration/prompt-template-store.js";

import type { GitHostingResolver } from "../services/git-hosting/resolver.js";
import {
  createGitHubService,
  GitHubAuthenticationError,
  GitHubCliMissingError,
  GitHubCommandError,
  type GitHubService,
} from "../services/github-service.js";
import type { ForgeService } from "../services/forge-service.js";
import type { ProviderUsageService } from "../services/quota-fetcher/service.js";
import {
  summarizeFetchWorkspacesEntries,
  workspaceIdsOnCheckout,
  WorkspaceDirectory,
  type WorkspaceUpdatesFilter,
} from "./workspace-directory.js";
import { shouldEmitPendingBootstrapUpdate } from "./workspace-bootstrap-dedupe.js";
import {
  createOttoWorktree,
  WorkspaceDirectoryOccupiedError,
  type CreateOttoWorktreeInput,
  type CreateOttoWorktreeResult,
} from "./otto-worktree-service.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { AgentAutoTitle } from "./agent/agent-auto-title.js";
import {
  buildAgentSessionConfig as buildWorktreeAgentSessionConfig,
  createOttoWorktreeWorkflow as createWorktreeWorkflow,
  type CreateOttoWorktreeSetupContinuationInput,
  type CreateOttoWorktreeWorkflowResult,
  handleCreateOttoWorktreeRequest as handleCreateWorktreeRequest,
  handleOttoWorktreeArchiveRequest as handleWorktreeArchiveRequest,
  handleOttoWorktreeListRequest as handleWorktreeListRequest,
  handleWorkspaceSetupStatusRequest as handleWorkspaceSetupStatusRequestMessage,
} from "./worktree-session.js";
import { archiveByScope, type ActiveWorkspaceRef } from "./workspace-archive-service.js";
import { detectWorktreeArchiveBranch } from "./workspace-archive-branch.js";
import { buildReattachCandidates } from "./worktree-reattach.js";
import { parseGitHubRemoteUrl, parseGitRemoteLocation } from "@otto-code/protocol/git-remote";
import {
  WorktreeRequestError,
  toWorktreeRequestError,
  toWorktreeWireError,
} from "./worktree-errors.js";
import { type WorktreeConfig, createWorktree, isOttoOwnedWorktreeCwd } from "../utils/worktree.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";

function resolveWorkspaceSetupRuntime(
  runtime: WorkspaceSetupRuntime | undefined,
): WorkspaceSetupRuntime {
  return runtime ?? new WorkspaceSetupRuntime();
}
import {
  createProjectDirectory,
  ProjectDirectoryRequestError,
} from "./project-directory-service.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { CreateAgentLifecycleDispatch } from "./agent/create-agent-lifecycle-dispatch.js";
import { resolveWorktreeSourceCwd } from "./workspace-source.js";
import {
  isAliasableResponseType,
  readRpcRequestId,
  resolveAliasedRequestType,
  resolveAliasedResponseType,
} from "./profile-rpc-alias.js";

type ProviderSubagentManagerEvent = Extract<
  AgentManagerEvent,
  { type: "provider_subagent" }
>["event"];

// TODO: Remove once all app store clients are on >=0.1.45 and understand arbitrary provider strings.
// Clients before 0.1.45 validate providers with z.enum(["claude", "codex", "opencode"]) and reject
// the entire session message if they encounter an unknown provider.
const LEGACY_PROVIDER_IDS = new Set(["claude", "codex", "opencode"]);
const MIN_VERSION_ALL_PROVIDERS = "0.1.45";
const MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY = "0.1.105";
function errorToFriendlyMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/** Normalize an optional (possibly-undefined) dependency to `T | null`. */
function coalesceToNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/**
 * A personality-memory scope arrives as a plain string (forward compat, like
 * roles and effort levels), so an unrecognized value is dropped here rather than
 * coerced - "project" and "global" are different claims, and guessing between
 * them would silently widen or narrow a lesson's reach.
 */
function readPersonalityMemoryScope(value: string | undefined): "project" | "global" | undefined {
  if (value === "project" || value === "global") return value;
  return undefined;
}

function resolveSubscriptionId(
  subscribe: unknown,
  requestedSubscriptionId: string | undefined,
): string | null {
  if (!subscribe) return null;
  if (requestedSubscriptionId && requestedSubscriptionId.length > 0) {
    return requestedSubscriptionId;
  }
  return uuidv4();
}

function isAppVersionAtLeast(appVersion: string | null, minVersion: string): boolean {
  if (!appVersion) return false;
  // Strip prerelease suffix: "0.1.45-beta.4" -> "0.1.45"
  const base = appVersion.replace(/-.*$/, "");
  const parts = base.split(".").map(Number);
  const minParts = minVersion.split(".").map(Number);
  for (let i = 0; i < minParts.length; i++) {
    const a = parts[i] ?? 0;
    const b = minParts[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function clientSupportsAllProviders(appVersion: string | null): boolean {
  return isAppVersionAtLeast(appVersion, MIN_VERSION_ALL_PROVIDERS);
}

function clientUsesLegacyWorkspaceRestore(appVersion: string | null): boolean {
  return (
    appVersion !== null && !isAppVersionAtLeast(appVersion, MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY)
  );
}

type DeleteFencedAgentStorage = AgentStorage & {
  beginDelete(agentId: string): void;
};

function beginAgentDeleteIfSupported(agentStorage: AgentStorage, agentId: string): void {
  if ("beginDelete" in agentStorage && typeof agentStorage.beginDelete === "function") {
    (agentStorage as DeleteFencedAgentStorage).beginDelete(agentId);
  }
}

const FETCH_AGENTS_SORT_KEYS = ["status_priority", "created_at", "updated_at", "title"] as const;

export function resolveWaitForFinishError(options: {
  status: "permission" | "error" | "idle";
  final: AgentSnapshotPayload | null;
}): string | null {
  if (options.status !== "error") {
    return null;
  }
  const message = options.final?.lastError;
  return typeof message === "string" && message.trim().length > 0 ? message : "Agent failed";
}

export interface SessionRuntimeMetrics {
  terminalDirectorySubscriptionCount: number;
  terminalSubscriptionCount: number;
  workspaceGitWatchedDirectoryCount: number;
  workspaceGitWorkspaceRecordCount: number;
  workspaceGitSubscriptionCount: number;
  inflightRequests: number;
  peakInflightRequests: number;
}

type FetchAgentsRequestMessage = Extract<SessionInboundMessage, { type: "fetch_agents_request" }>;
type FetchAgentHistoryRequestMessage = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_history_request" }
>;
type AgentDirectoryRequestMessage = FetchAgentsRequestMessage | FetchAgentHistoryRequestMessage;

/**
 * Only history carries a query. The active-agents directory filters on
 * structure and never ranks, so it always reads as no query at all.
 */
function agentDirectorySearchQuery(request: AgentDirectoryRequestMessage): string {
  if (request.type !== "fetch_agent_history_request") return "";
  return request.search?.trim() ?? "";
}
type FetchAgentsRequestFilter = NonNullable<FetchAgentsRequestMessage["filter"]>;
type FetchAgentsRequestSort = NonNullable<FetchAgentsRequestMessage["sort"]>[number];
type FetchAgentsResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"];
type FetchAgentsResponseEntry = FetchAgentsResponsePayload["entries"][number];
type FetchAgentsResponsePageInfo = FetchAgentsResponsePayload["pageInfo"];
type AgentUpdatesFilter = FetchAgentsRequestFilter;
type CreateAgentRequestMessage = Extract<SessionInboundMessage, { type: "create_agent_request" }>;

interface ResolvedSessionCreateAgentIntent {
  config: AgentSessionConfig;
  intent: CreateAgentIntent;
  createdDirectoryWorkspace: boolean;
}

type FetchWorkspacesRequestMessage = Extract<
  SessionInboundMessage,
  { type: "fetch_workspaces_request" }
>;
type FetchWorkspacesRequestFilter = NonNullable<FetchWorkspacesRequestMessage["filter"]>;
type FetchWorkspacesResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesResponseEntry = FetchWorkspacesResponsePayload["entries"][number];
type FetchWorkspacesResponsePageInfo = FetchWorkspacesResponsePayload["pageInfo"];
type WorkspaceProjectDescriptorPayload = FetchWorkspacesResponsePayload["emptyProjects"][number];
type WorkspaceGithubSearchRepositoriesResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "workspace.github.search_repositories.response" }
>["payload"];
type WorkspaceUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];
interface WorkspaceUpdatesSubscriptionState {
  subscriptionId: string;
  filter?: WorkspaceUpdatesFilter;
  isBootstrapping: boolean;
  pendingUpdatesByWorkspaceId: Map<string, WorkspaceUpdatePayload>;
  lastEmittedByWorkspaceId: Map<string, WorkspaceUpdatePayload>;
  visibleEmptyProjectIds?: Set<string>;
}

class SessionRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionRequestError";
  }
}

export interface SessionFileSystem {
  isDirectory(path: string): Promise<boolean>;
}

const nodeSessionFileSystem: SessionFileSystem = {
  async isDirectory(path) {
    const stats = await stat(path).catch(() => null);
    return stats?.isDirectory() ?? false;
  },
};

// Stub types for features under development (modules not yet available)
type AgentMcpTransportFactory = () => Promise<unknown>;

// Kept out of the constructor so the noop fallback for test harnesses (which
// omit the store) does not add a branch to the already max-complexity ctor.
function resolveProjectLinkStore(store: ProjectLinkStore | undefined): ProjectLinkStore {
  return store ?? createNoopProjectLinkStore();
}

/**
 * Same reason as above. A service with the feature off is the correct fallback for a harness that
 * constructs none: it reports no solutions, which is exactly what a daemon with the switch off
 * does, so nothing downstream has to distinguish the two.
 */
function resolveSolutionService(
  service: SolutionService | undefined,
  logger: pino.Logger,
): SolutionService {
  return service ?? new SolutionService({ logger });
}

export interface SessionOptions {
  clientId: string;
  scopes: readonly string[];
  appVersion?: string | null;
  clientCapabilities?: Record<string, unknown> | null;
  onMessage: (msg: SessionOutboundMessage) => void;
  // Fans one message out to every connected session, this one included. Used for
  // daemon-global state (project metadata) whose change must reach every client,
  // not just the one that asked for it. Optional so the test harnesses need not
  // wire a server; falls back to emitting on this session only.
  broadcastToAllSessions?: (msg: SessionOutboundMessage) => void;
  onMessageToSource?: (source: object, msg: SessionOutboundMessage) => void;
  onBinaryMessage?: (frame: Uint8Array) => void;
  onBinaryMessageToSource?: (source: object, frame: Uint8Array) => Promise<void>;
  getTransportBufferedAmount?: () => number | null;
  onLifecycleIntent?: (intent: SessionLifecycleIntent) => void;
  onWorkspaceRecovered?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  logger: pino.Logger;
  downloadTokenStore: DownloadTokenStore;
  /** Daemon-scoped: one language-server pool shared by every client session. */
  lspService: LspService;
  /**
   * Daemon-scoped: one solution-sidecar pool and model cache shared by every client session.
   * Optional so the many test harnesses need not construct one; production always supplies it and
   * the fallback is a service with the feature off, which is the correct default anyway.
   */
  solutionService?: SolutionService;
  pushNotifications: PushNotifications;
  ottoHome: string;
  worktreesRoot?: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  // Optional so the many test harnesses need not construct one; production
  // (websocket-server) always supplies the real store. Falls back to a noop.
  projectLinkStore?: ProjectLinkStore;
  filesystem?: SessionFileSystem;
  scheduleService: ScheduleService;
  runService?: RunService | null;
  // Orchestration graph templates (projects/orchestration-graphs). Optional for
  // the same test-harness reason as runService; features.orchestrationGraphs
  // rides on both being present.
  graphStore?: GraphStore | null;
  // Where graph nodes' submit_output calls land before the engine harvests
  // them (orchestration/node-output.ts). Optional for the same reason.
  nodeOutputStore?: NodeOutputStore | null;
  // Host-level reusable prompts and snippets. Optional for the same reason.
  promptTemplateStore?: PromptTemplateStore | null;
  checkoutDiffManager: CheckoutDiffManager;
  github?: ForgeService;
  gitHostingResolver?: GitHostingResolver;
  createAgentMcpTransport?: AgentMcpTransportFactory;
  // Injected so tests can substitute the git branch rename without module mocks;
  // defaults to the real checkout-git implementation.
  renameCurrentBranch?: typeof renameCurrentBranchDefault;
  workspaceGitService: WorkspaceGitService;
  workspaceAutoName: WorkspaceAutoName;
  // The daemon-wide AgentAutoTitle instance (bootstrap-owned). Optional so the
  // many test harnesses need not construct one; production (websocket-server)
  // always supplies the shared instance so per-instance state (dedupe, rate
  // limiting) is never split across sessions. Falls back to a local instance.
  agentAutoTitle?: AgentAutoTitle;
  daemonConfigStore: DaemonConfigStore;
  // Optional so the many test harnesses need not build one; when absent the
  // connector OAuth RPCs answer with a clear "not available on this host".
  connectorOAuthBroker?: ConnectorOAuthBroker | null;
  /** Daemon-global provider registry, shared by every connected frontend. */
  communicationsService?: CommunicationsService;
  /** Daemon-owned connection metadata and secure credential-vault boundary. */
  integrationAuthorization?: IntegrationAuthorizationService | null;
  /** Daemon-owned, nonsecret authorization methods available to settings. */
  integrationAuthorizationCatalog?: IntegrationAuthorizationCatalog;
  /** Daemon-owned provider-neutral browser sign-in drivers. */
  integrationBrowserAuthorization?: IntegrationBrowserAuthorizationService | null;
  /** Managed Zoom PKCE flow, configured only on daemon hosts with HTTPS callback support. */
  zoomTeamChatAuthorization?: ZoomTeamChatManagedAuthorizationBroker | null;
  mcpBaseUrl?: string | null;
  stt: Resolvable<SpeechToTextProvider | null>;
  sttLanguage?: string;
  tts: Resolvable<TextToSpeechProvider | null>;
  terminalManager: TerminalManager | null;
  previewDevServers?: DevServerManager | null;
  // Daemon-managed local AI host (otto-brain). Optional so the many test
  // harnesses need not construct one; production (websocket-server) supplies the
  // shared instance. Absent = the brain.* RPCs report "disabled on this daemon".
  brainManager?: BrainManager | null;
  brainOpsManager?: BrainOpsManager | null;
  providerSnapshotManager: ProviderSnapshotManager;
  providerUsageService: ProviderUsageService;
  onActivity?: ActivityIncrementFn;
  getActivityRollups?: () => Promise<ActivityRollups>;
  getUsageLogPage?: (query: UsageLogPageQuery) => Promise<UsageLogPage>;
  resetActivityStats?: () => Promise<void>;
  hubExecutionAgents?: HubExecutionAgents;
  hubRelationships?: HubRelationshipManagement;
  serviceProxy?: ServiceProxySubsystem;
  scriptRuntimeStore?: WorkspaceScriptRuntimeStore;
  workspaceSetupSnapshots?: Map<string, WorkspaceSetupSnapshot>;
  workspaceSetupRuntime?: WorkspaceSetupRuntime;
  onBranchChanged?: (
    workspaceId: string,
    oldBranch: string | null,
    newBranch: string | null,
  ) => void;
  getDaemonTcpPort?: () => number | null;
  getDaemonTcpHost?: () => string | null;
  serviceProxyPublicBaseUrl?: string | null;
  resolveScriptHealth?: (hostname: string) => ScriptHealthState | null;
  voice?: {
    turnDetection?: Resolvable<TurnDetectionProvider | null>;
  };
  voiceBridge?: {
    registerVoiceSpeakHandler?: (agentId: string, handler: VoiceSpeakHandler) => void;
    unregisterVoiceSpeakHandler?: (agentId: string) => void;
    registerVoiceCallerContext?: (agentId: string, context: VoiceCallerContext) => void;
    unregisterVoiceCallerContext?: (agentId: string) => void;
  };
  dictation?: {
    finalTimeoutMs?: number;
    stt?: Resolvable<SpeechToTextProvider | null>;
    sttLanguage?: string;
    getSpeechReadiness?: () => SpeechReadinessSnapshot;
  };
  getSpeechSettingsOptions?: () => SpeechSettingsOptions;
  previewTts?: (params: {
    text: string;
    voice?: { name: string; model?: string };
  }) => Promise<{ audio: string; format: string } | null>;
  getPersonalityStats?: () => Record<string, number> | Promise<Record<string, number>>;
  /**
   * Per-personality accrued lessons. Absent on hosts that don't wire it, in
   * which case the daemon doesn't advertise `features.personalityMemory` and the
   * memory RPCs answer with a plain "not available on this host".
   */
  personalityMemory?: PersonalityMemoryService | null;
  /** Repo-owned knowledge, used to make its recurring prompt cost inspectable. */
  projectKnowledge?: ProjectKnowledgeService | null;
  serverId?: string;
  daemonVersion?: string;
  daemonRuntimeConfig?: DaemonRuntimeConfig;
  getWebSocketRuntimeMetrics?: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
}

export type SessionLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
      reason: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason: string;
    };

function parseClientCapabilities(
  capabilities: Record<string, unknown> | null | undefined,
): ReadonlySet<ClientCapability> {
  if (!capabilities) {
    return new Set();
  }
  const known = new Set<ClientCapability>(Object.values(CLIENT_CAPS));
  const result: ClientCapability[] = [];
  for (const [key, value] of Object.entries(capabilities)) {
    if (value === true && known.has(key as ClientCapability)) {
      result.push(key as ClientCapability);
    }
  }
  return new Set(result);
}

export function isSessionRpcAllowed(scopes: readonly string[], rpcName: string): boolean {
  return scopes.some((scope) => {
    if (scope === "*" || scope === rpcName) {
      return true;
    }
    if (!scope.endsWith(".*")) {
      return false;
    }
    return rpcName.startsWith(scope.slice(0, -1));
  });
}

function sessionRequestId(message: SessionInboundMessage): string | null {
  if ("requestId" in message && typeof message.requestId === "string") {
    return message.requestId;
  }
  if (
    "payload" in message &&
    typeof message.payload === "object" &&
    message.payload !== null &&
    "requestId" in message.payload &&
    typeof message.payload.requestId === "string"
  ) {
    return message.payload.requestId;
  }
  return null;
}

interface AgentTimelineProjectionSelection {
  timeline: AgentTimelineFetchResult;
  entries: TimelineProjectionEntry[];
  startSeq: number | null;
  endSeq: number | null;
  hasOlder: boolean;
  hasNewer: boolean;
}

type RegistryTransition = "created" | "unarchived" | "existing";

interface ArchivedRecordSnapshot {
  archivedAt?: string | null;
}

interface WorkspaceUpdateOptions {
  dedupeGitState?: boolean;
  removedProjectId?: string;
  optimisticStatus?: WorkspaceDescriptorPayload["status"];
}

function describeRegistryTransition(record: ArchivedRecordSnapshot | null): RegistryTransition {
  if (!record) {
    return "created";
  }
  return record.archivedAt ? "unarchived" : "existing";
}

/**
 * Session represents a single connected client session.
 * It owns all state management, orchestration logic, and message processing.
 * Session has no knowledge of WebSockets - it only emits and receives messages.
 */
/**
 * Fills in the optional transport/reporting callbacks a Session may be built
 * without. Kept out of the constructor so the constructor is assignment only -
 * the fields are readonly, so the assignments themselves cannot move.
 */
function resolveSessionOptionDefaults(options: SessionOptions) {
  return {
    appVersion: options.appVersion ?? null,
    getSpeechSettingsOptions: options.getSpeechSettingsOptions ?? null,
    getPersonalityStats: options.getPersonalityStats ?? null,
    onMessageToSource: options.onMessageToSource ?? null,
    onBinaryMessage: options.onBinaryMessage ?? null,
    onBinaryMessageToSource: options.onBinaryMessageToSource ?? null,
    getTransportBufferedAmount: options.getTransportBufferedAmount ?? (() => 0),
    onLifecycleIntent: options.onLifecycleIntent ?? null,
    onWorkspaceRecovered: options.onWorkspaceRecovered ?? null,
  };
}

export class Session {
  private readonly clientId: string;
  private scopes: readonly string[];
  private appVersion: string | null;
  private clientCapabilities: ReadonlySet<ClientCapability>;
  private readonly sessionId: string;
  private readonly onMessage: (msg: SessionOutboundMessage) => void;
  private readonly onBroadcastMessage: ((msg: SessionOutboundMessage) => void) | undefined;
  private readonly onMessageToSource:
    | ((source: object, msg: SessionOutboundMessage) => void)
    | null;
  private readonly onBinaryMessage: ((frame: Uint8Array) => void) | null;
  private readonly onBinaryMessageToSource:
    | ((source: object, frame: Uint8Array) => Promise<void>)
    | null;
  private readonly getTransportBufferedAmount: () => number | null;
  private readonly onLifecycleIntent: ((intent: SessionLifecycleIntent) => void) | null;
  private readonly onWorkspaceRecovered:
    | ((workspace: PersistedWorkspaceRecord) => Promise<void>)
    | null;
  private readonly sessionLogger: pino.Logger;
  private readonly ottoHome: string;
  private readonly worktreesRoot: string | undefined;
  /** Daemon-scoped, shared with every other session. Held here for archive teardown. */
  private readonly lspService: LspService;
  /** Same, for the solution sidecars - a directory nobody points at any more must not keep one. */
  private readonly solutionService: SolutionService;

  private agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly projectRegistry: ProjectRegistry;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly contextManagement: ContextManagementService;
  private readonly projectLinkStore: ProjectLinkStore;
  private readonly filesystem: SessionFileSystem;
  private readonly github: ForgeService;
  private readonly gitHostingResolver: GitHostingResolver | null;
  // COMPAT(fsFileWatch): landed with the Paseo v0.2.5 merge on 2026-08-01;
  // remove after 2027-02-02. subscriptionId -> {cwd, path} for Paseo's
  // namespaced watch RPCs, which unsubscribe by id where Otto's handler wants
  // the pair. The cleanup is to key Otto's own watch handler by subscription id
  // and delete this map, not to keep translating between the two shapes.
  private readonly fsFileWatchTargets = new Map<string, { cwd: string; path: string }>();
  private readonly renameCurrentBranch: typeof renameCurrentBranchDefault;
  private readonly workspaceGitService: WorkspaceGitService;
  private readonly workspaceAutoName: WorkspaceAutoName;
  private readonly agentAutoTitle: AgentAutoTitle;
  private readonly gitMutation: GitMutationService;
  private readonly workspaceProvisioning: WorkspaceProvisioningService;
  private readonly workspaceRecovery: WorkspaceRecoveryService;
  private readonly daemonConfigStore: DaemonConfigStore;
  private readonly connectorOAuthBroker: ConnectorOAuthBroker | null;
  private readonly communicationsService: CommunicationsService;
  private readonly integrationAuthorization: IntegrationAuthorizationService | null;
  private readonly integrationAuthorizationCatalog: IntegrationAuthorizationCatalog;
  private readonly integrationBrowserAuthorization: IntegrationBrowserAuthorizationService | null;
  private readonly zoomTeamChatAuthorization: ZoomTeamChatManagedAuthorizationBroker | null;
  private readonly meetingTranscripts: MeetingTranscriptStore;
  private readonly getSpeechSettingsOptions: (() => SpeechSettingsOptions) | null;
  private readonly previewTts:
    | ((params: {
        text: string;
        voice?: { name: string; model?: string };
      }) => Promise<{ audio: string; format: string } | null>)
    | undefined;
  private readonly getPersonalityStats:
    | (() => Record<string, number> | Promise<Record<string, number>>)
    | null;
  // Left as the option's own `| null | undefined` rather than coalesced to null:
  // every read is a truthiness check, and normalizing would add a branch to a
  // constructor already at the complexity ceiling.
  private readonly personalityMemory: PersonalityMemoryService | null | undefined;
  private readonly projectKnowledge: ProjectKnowledgeService | null | undefined;
  // Generates the Visualizer's short spoken cue lines for a personality (join /
  // thinking / done), via the Writer mini-task chain. Cached per personality.
  private readonly voiceCueGenerator: VoiceCueGenerator;
  private readonly personalityProfileGenerator: PersonalityProfileGenerator;
  // Refine's one-shot document rewriter. It lives on the session rather than on
  // WorkspaceFilesSession because that class is deliberately file I/O only -
  // it reaches no agent, and this is a model call that touches no file.
  private readonly refineGenerator: RefineGenerator;
  private readonly pushNotifications: PushNotifications;
  private unsubscribeAgentEvents: (() => void) | null = null;
  private unsubscribeCommunicationsPresenceChanges: (() => void) | null = null;
  private unsubscribeProjectMutations: (() => void) | null = null;
  private unsubscribeWorkspaceMutations: (() => void) | null = null;
  private registryMutationQueue: Promise<void> = Promise.resolve();
  private isCleanedUp = false;
  private viewedTimelineAgentIds = new Set<string>();
  private readonly viewedTimelineAgentIdsBySource = new Map<object, Set<string>>();
  private readonly clientCapabilitiesBySource = new Map<object, ReadonlySet<ClientCapability>>();
  private readonly defaultTimelineSubscriptionSource = {};
  /**
   * Sockets that asked for live Brain log lines, by source.
   *
   * Empty is the resting state, and it means "send nothing" only for clients
   * that advertise `brainLogWatch` - see `emitBrainLogLine`, where a client
   * without the capability still gets the legacy unconditional feed.
   */
  private readonly brainLogWatcherSources = new Set<object>();
  private unsubscribeTerminalWorkspaceContributionEvents: (() => void) | null = null;
  private unsubscribeGitOperationLog: (() => void) | null = null;
  private readonly agentUpdates: AgentUpdatesService;
  private workspaceUpdatesSubscription: WorkspaceUpdatesSubscriptionState | null = null;
  private readonly workspaceUpdateTails = new Map<string, Promise<void>>();
  private clientActivity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt: Date;
  } | null = null;
  private registeredPushToken: string | null = null;
  private readonly terminalManager: TerminalManager | null;
  private readonly previewDevServers: DevServerManager | null;
  private readonly brainSession: BrainSession;
  private readonly communicationsSession: CommunicationsSession;
  private readonly runsSession: RunsSession;
  private readonly projectKnowledgeSession: ProjectKnowledgeSession;
  private readonly codeIntelligenceSession: CodeIntelligenceSession;
  private readonly brainManager: BrainManager | null;
  private readonly brainOpsManager: BrainOpsManager | null;
  private readonly providerSnapshotManager: ProviderSnapshotManager;
  private readonly getActivityRollups: (() => Promise<ActivityRollups>) | undefined;
  private readonly getUsageLogPage:
    | ((query: UsageLogPageQuery) => Promise<UsageLogPage>)
    | undefined;
  private readonly resetActivityStats: (() => Promise<void>) | undefined;
  private readonly serviceProxy: ServiceProxySubsystem | null;
  private readonly scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  private readonly getDaemonTcpPort: (() => number | null) | null;
  private readonly getDaemonTcpHost: (() => string | null) | null;
  private readonly serviceProxyPublicBaseUrl: string | null;
  private readonly resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
  private readonly terminalController: TerminalSessionController;
  private inflightRequests = 0;
  // COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
  // Request ids that arrived under a profile-named alias and are still awaiting
  // a response. Entries are removed as their response goes out, so this only
  // ever holds in-flight requests and stays empty for legacy-name clients.
  private readonly aliasedProfileRpcRequestIds = new Set<string>();
  private peakInflightRequests = 0;
  private readonly workspaceSetupSnapshots: Map<string, WorkspaceSetupSnapshot>;
  private readonly workspaceSetupRuntime: WorkspaceSetupRuntime;
  private readonly workspaceGitObserver: WorkspaceGitObserverService;
  private readonly workspaceDirectory: WorkspaceDirectory;
  private readonly voiceSession: VoiceSession;
  private readonly checkoutSession: CheckoutSession;
  private readonly kanbanSession: KanbanSession;
  private readonly scheduleSession: ScheduleSession;
  private readonly providerCatalogSession: ProviderCatalogSession;
  private readonly workspaceFilesSession: WorkspaceFilesSession;
  private readonly agentConfigSession: AgentConfigSession;
  private readonly projectConfigSession: ProjectConfigSession;
  private readonly daemonSession: DaemonSession;
  private readonly artifactSession: ArtifactSession;
  private readonly hubExecutionController: HubExecutionController | null;
  private readonly workspaceScripts: WorkspaceScriptsService;
  private readonly createAgentLifecycleDispatch: CreateAgentLifecycleDispatch;

  constructor(options: SessionOptions) {
    const defaults = resolveSessionOptionDefaults(options);
    const {
      clientId,
      scopes,
      clientCapabilities,
      onMessage,
      broadcastToAllSessions,
      logger,
      downloadTokenStore,
      lspService,
      solutionService,
      pushNotifications,
      ottoHome,
      worktreesRoot,
      agentManager,
      agentStorage,
      projectRegistry,
      workspaceRegistry,
      projectLinkStore,
      filesystem,
      scheduleService,
      runService,
      graphStore,
      nodeOutputStore,
      promptTemplateStore,
      checkoutDiffManager,
      github,
      gitHostingResolver,
      renameCurrentBranch,
      workspaceGitService,
      workspaceAutoName,
      agentAutoTitle,
      daemonConfigStore,
      connectorOAuthBroker,
      communicationsService,
      integrationAuthorization,
      integrationAuthorizationCatalog,
      integrationBrowserAuthorization,
      zoomTeamChatAuthorization,
      stt,
      sttLanguage,
      tts,
      terminalManager,
      previewDevServers,
      brainManager,
      brainOpsManager,
      providerSnapshotManager,
      providerUsageService,
      onActivity,
      getActivityRollups,
      getUsageLogPage,
      resetActivityStats,
      serviceProxy,
      scriptRuntimeStore,
      workspaceSetupSnapshots,
      workspaceSetupRuntime,
      onBranchChanged,
      getDaemonTcpPort,
      getDaemonTcpHost,
      serviceProxyPublicBaseUrl,
      resolveScriptHealth,
      voice,
      voiceBridge,
      dictation,
      previewTts,
      personalityMemory,
      projectKnowledge,
      serverId,
      daemonVersion,
      daemonRuntimeConfig,
      getWebSocketRuntimeMetrics,
    } = options;
    this.clientId = clientId;
    this.getSpeechSettingsOptions = defaults.getSpeechSettingsOptions;
    this.previewTts = previewTts;
    this.getPersonalityStats = defaults.getPersonalityStats;
    this.personalityMemory = personalityMemory;
    this.projectKnowledge = projectKnowledge;
    this.communicationsService = communicationsService ?? new CommunicationsService();
    this.communicationsSession = new CommunicationsSession({
      host: { emit: (msg) => this.emit(msg) },
      communicationsService: this.communicationsService,
    });
    this.integrationAuthorization = integrationAuthorization ?? null;
    this.integrationAuthorizationCatalog =
      integrationAuthorizationCatalog ?? new IntegrationAuthorizationCatalog();
    this.integrationBrowserAuthorization = coalesceToNull(integrationBrowserAuthorization);
    this.zoomTeamChatAuthorization = coalesceToNull(zoomTeamChatAuthorization);
    this.meetingTranscripts = new MeetingTranscriptStore(ottoHome);
    this.scopes = [...scopes];
    this.appVersion = defaults.appVersion;
    this.clientCapabilities = parseClientCapabilities(clientCapabilities);
    this.sessionId = uuidv4();
    this.onMessage = onMessage;
    this.onBroadcastMessage = broadcastToAllSessions;
    this.onMessageToSource = defaults.onMessageToSource;
    this.onBinaryMessage = defaults.onBinaryMessage;
    this.onBinaryMessageToSource = defaults.onBinaryMessageToSource;
    this.unsubscribeCommunicationsPresenceChanges =
      this.communicationsService.subscribePresenceChanges((presence) => {
        if (this.isCleanedUp || !this.supports(CLIENT_CAPS.communicationsPresenceUpdates)) {
          return;
        }
        this.emit({
          type: "communications.inbox.presence.changed.notification",
          payload: { presence },
        });
      });
    this.getTransportBufferedAmount = defaults.getTransportBufferedAmount;
    this.onLifecycleIntent = defaults.onLifecycleIntent;
    this.onWorkspaceRecovered = defaults.onWorkspaceRecovered;
    this.pushNotifications = pushNotifications;
    this.ottoHome = ottoHome;
    this.worktreesRoot = worktreesRoot;
    this.lspService = lspService;
    this.sessionLogger = logger.child({
      module: "session",
      clientId: this.clientId,
      sessionId: this.sessionId,
    });
    this.solutionService = resolveSolutionService(solutionService, this.sessionLogger);
    this.workspaceFilesSession = new WorkspaceFilesSession({
      host: {
        emit: (msg, source) => this.emitForSource(msg, source),
        emitBinary: (frame, source) => this.emitBinaryForFileTransfer(frame, source),
        hasBinaryChannel: () => this.onBinaryMessage !== null,
      },
      downloadTokenStore,
      // For the watcher's solution-cache invalidation only; the Solution RPCs live
      // in the CodeIntelligenceSession below.
      solutionService: this.solutionService,
      ottoHome,
      logger: this.sessionLogger,
      // Cross-workspace file access is bounded to the distinct paths of every
      // known Otto workspace (and its project root) - the client may open files
      // from any of them, not just the active one, but nothing outside them.
      resolveAllowedRoots: async () => {
        const [workspaces, projects] = await Promise.all([
          workspaceRegistry.list(),
          projectRegistry.list(),
        ]);
        return [
          ...workspaces.map((workspace) => workspace.cwd),
          ...projects.map((project) => project.rootPath),
        ];
      },
    });
    this.codeIntelligenceSession = new CodeIntelligenceSession({
      host: { emit: (msg) => this.emit(msg) },
      lspService,
      // A service with the feature off is the correct fallback: a harness that constructs no
      // solution service gets a Solution view that reports no solutions, which is exactly what a
      // daemon with the switch off does.
      solutionService: this.solutionService,
      symbolIndex: this.workspaceFilesSession.symbolIndex,
      // The files session owns the workspace boundary; both domains refuse identically.
      assertCwdWithinKnownWorkspace: (cwd) =>
        this.workspaceFilesSession.assertCwdWithinKnownWorkspace(cwd),
      logger: this.sessionLogger,
    });
    this.agentManager = agentManager;
    this.agentStorage = agentStorage;
    this.projectRegistry = projectRegistry;
    this.workspaceRegistry = workspaceRegistry;
    this.projectLinkStore = resolveProjectLinkStore(projectLinkStore);
    this.filesystem = filesystem ?? nodeSessionFileSystem;
    this.github = github ?? createGitHubService();
    this.gitHostingResolver = gitHostingResolver ?? null;
    this.renameCurrentBranch = renameCurrentBranch ?? renameCurrentBranchDefault;
    this.workspaceGitService = workspaceGitService;
    this.gitMutation = createGitMutationService({
      workspaceGitService: this.workspaceGitService,
      logger: this.sessionLogger,
    });
    this.workspaceAutoName = workspaceAutoName;
    this.workspaceProvisioning = createWorkspaceProvisioningService({
      serverId,
      workspaceRegistry: this.workspaceRegistry,
      projectRegistry: this.projectRegistry,
      workspaceGitService: this.workspaceGitService,
      logger: this.sessionLogger,
    });
    this.workspaceRecovery = createWorkspaceRecoveryService({
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      getWorkspace: (workspaceId) => this.workspaceRegistry.get(workspaceId),
      getProject: (projectId) => this.projectRegistry.get(projectId),
      isDirectory: (path) => this.filesystem.isDirectory(path),
      unarchiveWorkspace: async (workspace) => {
        await this.workspaceProvisioning.ensureWorkspaceRecordUnarchived(workspace);
      },
    });
    this.checkoutSession = new CheckoutSession({
      host: {
        emit: (msg) => this.emit(msg),
        emitWorkspaceUpdateForCwd: (cwd) => this.emitWorkspaceUpdateForCwd(cwd),
        handleWorkspaceGitBranchSnapshot: (cwd, branchName) =>
          this.workspaceGitObserver.handleBranchSnapshot(cwd, branchName),
        renameCurrentBranch: (cwd, branch) => this.renameCurrentBranch(cwd, branch),
      },
      gitMutation: this.gitMutation,
      listBusyAgentsForCwd: (cwd) => this.listBusyAgentsForCwd(cwd),
      gitOperationLog,
      workspaceGitService: this.workspaceGitService,
      github: this.github,
      ...(this.gitHostingResolver ? { gitHostingResolver: this.gitHostingResolver } : {}),
      checkoutDiffManager,
      gitMetadataGenerator: createGitMetadataGenerator({
        workspaceGitService: this.workspaceGitService,
        generation: createAgentStructuredTextGeneration({
          agentManager: this.agentManager,
          providerSnapshotManager,
          readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
          getFocusedSelection: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
        }),
      }),
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.sessionLogger,
    });
    this.kanbanSession = new KanbanSession({
      emit: (msg) => this.emit(msg),
      readConfig: () => this.daemonConfigStore.get(),
      resolveProjectTarget: (input) => this.resolveKanbanProjectTarget(input),
      log: {
        info: (message) => this.sessionLogger.info(message),
        error: (message, error) => this.sessionLogger.error({ err: error }, message),
      },
    });
    this.voiceCueGenerator = createVoiceCueGenerator({
      generation: createAgentStructuredTextGeneration({
        agentManager: this.agentManager,
        providerSnapshotManager,
        readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
        getFocusedSelection: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
      }),
      // Provider resolution needs a cwd; the editor passes none, so a live
      // agent's cwd is a sane fallback (global providers resolve regardless).
      fallbackCwd: () => this.agentManager.listAgents()[0]?.cwd ?? process.cwd(),
    });
    this.personalityProfileGenerator = createPersonalityProfileGenerator({
      generation: createAgentStructuredTextGeneration({
        agentManager: this.agentManager,
        providerSnapshotManager,
        readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
        getFocusedSelection: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
      }),
      fallbackCwd: () => this.agentManager.listAgents()[0]?.cwd ?? process.cwd(),
    });
    this.refineGenerator = createRefineGenerator({
      generation: createAgentStructuredTextGeneration({
        agentManager: this.agentManager,
        providerSnapshotManager,
        readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
        getFocusedSelection: (cwd) => this.getFocusedAgentSelectionForCwd(cwd),
      }),
    });
    this.workspaceGitObserver = createWorkspaceGitObserverService({
      workspaceGitService: this.workspaceGitService,
      describeWorkspaceRecordWithGitData: (workspace) =>
        this.describeWorkspaceRecordWithGitData(workspace),
      emitWorkspaceUpdateForCwd: (cwd) => this.emitWorkspaceUpdateForCwd(cwd),
      emitWorkspaceUpdateForWorkspaceId: (workspaceId) =>
        this.emitWorkspaceUpdateForWorkspaceId(workspaceId),
      emitStatusUpdate: (cwd, snapshot, meta) =>
        this.checkoutSession.emitStatusUpdate(cwd, snapshot, meta),
      onBranchChanged,
      logger: this.sessionLogger,
    });
    this.scheduleSession = new ScheduleSession({
      host: { emit: (msg) => this.emit(msg) },
      scheduleService,
      logger: this.sessionLogger,
    });
    this.providerCatalogSession = new ProviderCatalogSession({
      host: {
        emit: (msg) => this.emit(msg),
        isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
        supportsCustomModeIcons: () => this.supports(CLIENT_CAPS.customModeIcons),
        supportsCompactProviderSnapshots: () => this.supports(CLIENT_CAPS.compactProviderSnapshots),
        listProviderAvailability: () => this.agentManager.listProviderAvailability(),
        listDraftFeatures: (config) => this.agentManager.listDraftFeatures(config),
      },
      providerSnapshotManager,
      providerUsageService,
      logger: this.sessionLogger,
    });
    this.agentConfigSession = new AgentConfigSession({
      host: {
        emit: (msg) => this.emit(msg),
      },
      operations: {
        ensureLoaded: async (agentId) => {
          await ensureUnarchivedAgentLoaded(agentId, {
            agentManager,
            agentStorage,
            logger: this.sessionLogger,
          });
        },
        setMode: async (agentId, modeId) =>
          (await setAgentModeCommand({ agentManager }, { agentId, modeId })).notice,
        setModel: (agentId, modelId) => agentManager.setAgentModel(agentId, modelId),
        setFeature: (agentId, featureId, value) =>
          agentManager.setAgentFeature(agentId, featureId, value),
        setThinking: (agentId, thinkingOptionId) =>
          agentManager.setAgentThinkingOption(agentId, thinkingOptionId),
        setPersonality: async (agentId, personalityId) => {
          const snapshot =
            personalityId === null
              ? null
              : await this.resolvePersonalitySnapshotForAgent(agentId, personalityId);
          return agentManager.setAgentPersonality(agentId, snapshot);
        },
      },
      logger: this.sessionLogger,
    });
    this.projectConfigSession = new ProjectConfigSession({
      host: {
        emit: (msg) => this.emit(msg),
      },
      projectRegistry: this.projectRegistry,
      logger: this.sessionLogger,
    });
    this.daemonSession = new DaemonSession({
      host: {
        emit: (msg) => this.emit(msg),
        emitLifecycleIntent: (intent) => this.emitLifecycleIntent(intent),
      },
      clientId: this.clientId,
      ottoHome: this.ottoHome,
      serverId,
      daemonVersion,
      daemonRuntimeConfig,
      getWebSocketRuntimeMetrics,
      listProviderAvailability: () => this.agentManager.listProviderAvailability(),
      listAgents: () => this.agentManager.listAgents(),
      listProjects: () => this.projectRegistry.list(),
      listWorkspaces: () => this.workspaceRegistry.list(),
      logger: this.sessionLogger,
      hubRelationships: options.hubRelationships,
    });
    const artifactService = new ArtifactService({
      projectCwd: this.ottoHome,
      logger: this.sessionLogger,
      agentManager: this.agentManager,
      providerSnapshotManager,
      broadcastArtifactUpdate: (metadata: ArtifactMetadata) => {
        this.emit({
          type: "artifact.updated.notification",
          payload: { artifact: metadata },
        });
      },
      onActivity,
    });
    this.artifactSession = new ArtifactSession({
      host: {
        emit: (msg) => this.emit(msg),
      },
      artifactService,
      logger: this.sessionLogger,
    });
    this.hubExecutionController = options.hubExecutionAgents
      ? new HubExecutionController({
          agents: options.hubExecutionAgents,
          validateAgentConfiguration: (input) =>
            providerSnapshotManager.validateAgentConfiguration(input),
          send: (message) => this.emit(message),
        })
      : null;
    this.daemonConfigStore = daemonConfigStore;
    this.connectorOAuthBroker = connectorOAuthBroker ?? null;
    this.terminalManager = terminalManager;
    this.previewDevServers = previewDevServers ?? null;
    // Coalesced via a helper so this already-at-limit constructor gains no
    // cyclomatic-complexity branch for the optional dependency.
    this.brainManager = coalesceToNull(brainManager);
    this.brainOpsManager = coalesceToNull(brainOpsManager);
    this.brainSession = new BrainSession({
      host: { emit: (msg) => this.emit(msg) },
      brainManager: this.brainManager,
      brainOpsManager: this.brainOpsManager,
      providerSnapshotManager,
      logger,
    });
    this.terminalController = new TerminalSessionController({
      terminalManager,
      emit: (msg) => this.emit(msg),
      emitBinary: (frame) => this.emitBinary(frame),
      hasBinaryChannel: () => this.onBinaryMessage !== null,
      isPathWithinRoot: (rootPath, candidatePath) => this.isPathWithinRoot(rootPath, candidatePath),
      sessionLogger: this.sessionLogger,
      listTerminalWorkspaceRefs: () => this.listActiveWorkspaceRefs(),
      clientSupportsWrapReflow: () =>
        this.clientCapabilities.has(CLIENT_CAPS.terminalReflowableSnapshot),
      getClientBufferedAmount: () => this.getTransportBufferedAmount(),
      getDefaultTerminalCommand: () => {
        if (process.platform !== "win32") {
          return undefined;
        }
        const selectedShell = this.daemonConfigStore.get().defaultTerminalShell;
        if (
          !selectedShell ||
          !detectWindowsTerminalShells().some((shell) => shell.id === selectedShell)
        ) {
          return undefined;
        }
        switch (selectedShell) {
          case "command-prompt":
            return {
              command:
                process.env.ComSpec || process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe",
            };
          case "windows-powershell":
            return { command: "powershell.exe" };
          case "powershell-7":
            return { command: "pwsh.exe" };
          default:
            return undefined;
        }
      },
      getTerminalTitleSettings: () => {
        const config = this.daemonConfigStore.get();
        return {
          mode: config.terminalTitleMode ?? "auto",
          includePaths: config.terminalTitleIncludePaths ?? false,
        };
      },
    });
    this.agentUpdates = createAgentUpdatesService({
      emit: (message) => this.emit(message),
      enrichAgentPayload: (payload) => this.enrichAgentPayload(payload),
      buildStoredAgentPayload: (record) => this.buildStoredAgentPayload(record),
      isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
      buildProjectPlacementForWorkspaceId: (workspaceId) =>
        this.buildProjectPlacementForWorkspaceId(workspaceId),
      emitWorkspaceUpdateForWorkspaceId: (workspaceId) =>
        this.emitWorkspaceUpdateForWorkspaceId(workspaceId),
      logger: this.sessionLogger,
    });
    this.createAgentLifecycleDispatch = new CreateAgentLifecycleDispatch({
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      github: this.github,
      workspaceGitService: this.workspaceGitService,
      createOttoWorktreeWorkflow: (input, workflowOptions) =>
        this.createOttoWorktreeWorkflow(input, workflowOptions),
      archiveAgentForClose: (agentId) => this.archiveAgentForClose(agentId),
      findWorkspaceIdForCwd: (cwd) => this.findWorkspaceIdForCwd(cwd),
      listActiveWorkspaces: () => this.listActiveWorkspaceRefs(),
      archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
      emit: (message) => this.emit(message),
      emitAgentRemove: (agentId) => this.agentUpdates.removeAgent(agentId),
      emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds) =>
        this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds),
      markWorkspaceArchiving: (workspaceIds, archivingAt) =>
        this.markWorkspaceArchiving(workspaceIds, archivingAt),
      clearWorkspaceArchiving: (workspaceIds) => this.clearWorkspaceArchiving(workspaceIds),
      killTerminalsForWorkspace: (workspaceId) =>
        this.terminalController.killTerminalsForWorkspace(workspaceId),
      logger: this.sessionLogger,
    });
    this.providerSnapshotManager = providerSnapshotManager;
    this.agentAutoTitle = this.resolveAgentAutoTitle(agentAutoTitle);
    this.runsSession = new RunsSession({
      host: {
        emit: (msg) => this.emit(msg),
        createOttoWorktree: (input, worktreeOptions) =>
          this.createOttoWorktreeWorkflow(input, worktreeOptions),
        scheduleAutoTitle: (request) =>
          this.agentAutoTitle.schedule({
            ...request,
            currentSelection: this.getFocusedAgentSelectionForCwd(request.cwd),
          }),
      },
      runService,
      graphStore,
      nodeOutputStore,
      promptTemplateStore,
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      terminalManager: this.terminalManager,
      providerSnapshotManager: this.providerSnapshotManager,
      daemonConfigStore: this.daemonConfigStore,
      agentUpdates: this.agentUpdates,
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
      logger: this.sessionLogger,
    });
    this.getActivityRollups = getActivityRollups;
    this.getUsageLogPage = getUsageLogPage;
    this.resetActivityStats = resetActivityStats;
    this.serviceProxy = serviceProxy ?? null;
    this.scriptRuntimeStore = scriptRuntimeStore ?? null;
    this.workspaceSetupSnapshots = workspaceSetupSnapshots ?? new Map();
    this.workspaceSetupRuntime = resolveWorkspaceSetupRuntime(workspaceSetupRuntime);
    this.getDaemonTcpPort = getDaemonTcpPort ?? null;
    this.getDaemonTcpHost = getDaemonTcpHost ?? null;
    this.serviceProxyPublicBaseUrl = serviceProxyPublicBaseUrl ?? null;
    this.resolveScriptHealth = resolveScriptHealth ?? null;
    this.workspaceScripts = createWorkspaceScriptsService({
      serviceProxy: this.serviceProxy,
      scriptRuntimeStore: this.scriptRuntimeStore,
      terminalManager: this.terminalManager,
      workspaceRegistry: this.workspaceRegistry,
      projectRegistry: this.projectRegistry,
      workspaceGitService: this.workspaceGitService,
      getDaemonTcpPort: this.getDaemonTcpPort,
      getDaemonTcpHost: this.getDaemonTcpHost,
      serviceProxyPublicBaseUrl: this.serviceProxyPublicBaseUrl,
      resolveScriptHealth: this.resolveScriptHealth,
      logger: this.sessionLogger,
      emit: (message) => this.emit(message),
      spawnWorkspaceScript,
      globalServicePorts: loadPersistedConfig(this.ottoHome).worktrees?.servicePorts,
    });
    this.subscribeToOptionalManagers();
    this.workspaceDirectory = new WorkspaceDirectory({
      logger: this.sessionLogger,
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      listAgentPayloads: (scope) => this.listAgentPayloads(scope),
      listProviderSubagentActivity: async () => this.agentManager.listProviderSubagentActivity(),
      listTerminalActivityContributions: () => this.listTerminalActivityContributions(),
      isProviderVisibleToClient: (provider) => this.isProviderVisibleToClient(provider),
      buildWorkspaceDescriptor: (input) => this.buildWorkspaceDescriptor(input),
    });

    // Context Management: what the active provider sends before the user types.
    // Roots come from the workspace/project registries; the provider and the
    // prompt Otto composes itself come from the workspace's newest agent, since
    // the same workspace can host agents on different providers.
    this.contextManagement = new ContextManagementService({
      logger: this.sessionLogger,
      // A personality's injected lessons are fixed weight like any other prompt
      // text, so the report has to count them or its percentages understate what
      // a personality-backed chat actually carries.
      resolvePersonalityMemoryBrief: async ({ personalityId, projectRoot }) => {
        if (!this.personalityMemory) return { text: "", estTokens: 0 };
        const view = await this.personalityMemory.view({ personalityId, projectRoot });
        return { text: view.brief.text, estTokens: view.brief.estTokens };
      },
      resolveProjectKnowledgeBrief: async ({ projectRoot }) => {
        if (!this.projectKnowledge) return { text: "", estTokens: 0 };
        const brief = await this.projectKnowledge.briefForCwd(projectRoot);
        return { text: brief.text, estTokens: brief.estTokens };
      },
      resolveLocation: async (workspaceId) => {
        const workspace = await this.workspaceRegistry.get(workspaceId);
        if (!workspace) return null;
        const project = await this.projectRegistry.get(workspace.projectId);
        const projectRoot =
          project?.rootPath ??
          (await resolveProjectRootForCwd(workspace.cwd, (cwd) =>
            this.workspaceGitService.resolveRepoRoot(cwd),
          ));
        return { cwd: workspace.cwd, projectRoot };
      },
      resolveRuntime: async (workspaceId) => {
        const agent = this.agentManager
          .listAgents()
          .filter((candidate) => candidate.workspaceId === workspaceId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        if (agent) {
          const injectedPromptText = composeSystemPromptParts(
            agent.config.systemPrompt,
            agent.config.daemonAppendSystemPrompt,
          );
          // Only meaningful where Otto builds the request: a CLI-backed
          // provider composes its preset in its own process and never hands it
          // back, which is exactly what the `not_visible` rows disclose.
          const ownsContextPayload = agent.capabilities.ownsContextPayload === true;
          // The live session's real preset and tool schemas. Read per report
          // rather than cached: the tool payload narrows with the session's
          // mode and workspace-access ceiling, so a snapshot taken at spawn
          // would misreport a chat that has since switched to plan mode.
          const payload = ownsContextPayload
            ? this.agentManager.describeAgentContextPayload(agent.id)
            : null;
          return {
            provider: agent.provider,
            ownsContextPayload,
            ...(injectedPromptText ? { injectedPromptText } : {}),
            ...(payload?.systemPromptText ? { systemPromptText: payload.systemPromptText } : {}),
            ...(payload?.mcpToolsText ? { mcpToolsText: payload.mcpToolsText } : {}),
          };
        }

        // `listAgents()` only sees agents loaded into memory, so a freshly
        // restarted daemon has none until a chat is opened - and without a
        // provider the whole report is null and the tab reads as broken. The
        // workspace's persisted agents answer the same question from disk.
        // Only `systemPrompt` survives there (the daemon append is composed at
        // run time), so the injected figure is a floor, never an overstatement.
        const persisted = (await this.agentStorage.list()).filter(
          (candidate) => !candidate.internal,
        );
        const byRecency = (a: { updatedAt: string }, b: { updatedAt: string }): number =>
          b.updatedAt.localeCompare(a.updatedAt);
        const inWorkspace = persisted.filter((candidate) => candidate.workspaceId === workspaceId);
        const stored =
          inWorkspace.filter((candidate) => !candidate.archivedAt).sort(byRecency)[0] ??
          // An archived chat still names the provider this workspace uses, and
          // that is all the scan needs to know which filenames to look for.
          inWorkspace.sort(byRecency)[0];
        if (stored) {
          const injectedPromptText = composeSystemPromptParts(stored.config?.systemPrompt);
          return {
            provider: stored.provider,
            ownsContextPayload:
              this.agentManager.getProviderCapabilities(stored.provider)?.ownsContextPayload ===
              true,
            ...(injectedPromptText ? { injectedPromptText } : {}),
          };
        }

        // A workspace nobody has chatted in yet is the common case for this tab
        // - you open it precisely to see what a *first* chat would carry. The
        // provider only selects which filenames the scan looks for, so refusing
        // to answer without an agent meant a project full of context files
        // reported nothing at all, instantly and with no way to recover.
        // The daemon's most recent chat anywhere is the best available answer to
        // "which agent does this user run"; no prompt text is claimed, because
        // none of it belongs to this workspace.
        const anywhere = persisted.sort(byRecency)[0];
        if (anywhere) {
          return {
            provider: anywhere.provider,
            ownsContextPayload:
              this.agentManager.getProviderCapabilities(anywhere.provider)?.ownsContextPayload ===
              true,
          };
        }
        return null;
      },
    });
    this.projectKnowledgeSession = new ProjectKnowledgeSession({
      host: {
        emit: (msg) => this.emit(msg),
        pushContextReport: (workspaceId) => this.pushContextReport(workspaceId),
      },
      projectKnowledge: this.projectKnowledge,
      contextManagement: this.contextManagement,
      workspaceRegistry: this.workspaceRegistry,
      projectRegistry: this.projectRegistry,
      workspaceGitService: this.workspaceGitService,
    });

    this.voiceSession = new VoiceSession({
      host: {
        emit: (msg) => this.emit(msg),
        loadAgent: (agentId) =>
          ensureAgentLoaded(agentId, {
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            logger: this.sessionLogger,
          }),
        reloadAgentSession: (agentId, overrides) =>
          this.agentManager.reloadAgentSession(agentId, overrides),
        sendSpokenInput: async (agentId, text) => {
          await this.handleSendAgentMessage(
            agentId,
            text,
            undefined,
            undefined,
            undefined,
            undefined,
            { spokenInput: true },
          );
        },
        interruptAgentIfRunning: (agentId) => this.interruptAgentIfRunning(agentId),
        hasActiveAgentRun: (agentId) => this.hasActiveAgentRun(agentId),
      },
      logger: this.sessionLogger,
      sessionId: this.sessionId,
      sttLanguage,
      tts,
      stt,
      voice,
      voiceBridge,
      dictation,
    });

    this.subscribeToAgentEvents();
    this.subscribeToRegistryMutations();

    this.sessionLogger.trace({}, "agent.session.lifecycle.created");
  }

  /**
   * Prefer the daemon-wide shared instance (see SessionOptions.agentAutoTitle);
   * the local construction exists only for test harnesses that omit it.
   */
  private resolveAgentAutoTitle(shared: AgentAutoTitle | undefined): AgentAutoTitle {
    return (
      shared ??
      new AgentAutoTitle({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        providerSnapshotManager: this.providerSnapshotManager,
        readDaemonConfig: () => this.readStructuredGenerationDaemonConfig(),
        workspaceGitService: this.workspaceGitService,
        logger: this.sessionLogger,
      })
    );
  }

  updateAppVersion(appVersion: string | null): void {
    if (appVersion && appVersion !== this.appVersion) {
      this.appVersion = appVersion;
    }
  }

  updateClientCapabilities(capabilities: Record<string, unknown> | null, source?: object): void {
    this.clientCapabilities = parseClientCapabilities(capabilities);
    if (source) {
      this.clientCapabilitiesBySource.set(source, this.clientCapabilities);
    }
    if (!source && !this.supports(CLIENT_CAPS.selectiveAgentTimeline)) {
      this.viewedTimelineAgentIdsBySource.clear();
      this.viewedTimelineAgentIds.clear();
    }
  }

  clearAgentTimelineSubscription(source: object): void {
    this.clientCapabilitiesBySource.delete(source);
    this.brainLogWatcherSources.delete(source);
    if (this.viewedTimelineAgentIdsBySource.delete(source)) {
      this.rebuildViewedTimelineAgentIds();
    }
  }

  /**
   * Deliver one Brain log line to the sockets that asked for it.
   *
   * Mirrors `forwardAgentStream`: per-source when the connection has per-source
   * routing, whole-session otherwise. A source that has not advertised
   * `brainLogWatch` cannot ask for the feed and cannot be expected to live
   * without it, so it keeps receiving every line.
   */
  emitBrainLogLine(line: string): void {
    const message: SessionOutboundMessage = {
      type: "status",
      payload: { status: "brain_log_line_added", line },
    };
    if (this.clientCapabilitiesBySource.size === 0 || !this.onMessageToSource) {
      if (!this.supports(CLIENT_CAPS.brainLogWatch) || this.brainLogWatcherSources.size > 0) {
        this.emit(message);
      }
      return;
    }
    for (const [source, capabilities] of this.clientCapabilitiesBySource) {
      if (capabilities.has(CLIENT_CAPS.brainLogWatch) && !this.brainLogWatcherSources.has(source)) {
        continue;
      }
      this.onMessageToSource(source, message);
    }
  }

  private setBrainLogWatching(source: object | undefined, watching: boolean): void {
    const watchSource = source ?? this.defaultTimelineSubscriptionSource;
    if (watching) this.brainLogWatcherSources.add(watchSource);
    else this.brainLogWatcherSources.delete(watchSource);
  }

  private replaceAgentTimelineSubscription(source: object | undefined, agentIds: string[]): void {
    const subscriptionSource = source ?? this.defaultTimelineSubscriptionSource;
    if (agentIds.length === 0) this.viewedTimelineAgentIdsBySource.delete(subscriptionSource);
    else this.viewedTimelineAgentIdsBySource.set(subscriptionSource, new Set(agentIds));
    this.rebuildViewedTimelineAgentIds();
  }

  private rebuildViewedTimelineAgentIds(): void {
    const viewedAgentIds = new Set<string>();
    for (const agentIds of this.viewedTimelineAgentIdsBySource.values()) {
      for (const agentId of agentIds) viewedAgentIds.add(agentId);
    }
    this.viewedTimelineAgentIds = viewedAgentIds;
  }

  private usesSelectiveTimelineDelivery(): boolean {
    if (this.clientCapabilitiesBySource.size === 0) {
      return this.supports(CLIENT_CAPS.selectiveAgentTimeline);
    }
    for (const capabilities of this.clientCapabilitiesBySource.values()) {
      if (!capabilities.has(CLIENT_CAPS.selectiveAgentTimeline)) return false;
    }
    return true;
  }

  private forwardAgentStream(
    event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
    serializedEvent: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"]["event"],
  ): void {
    if (this.clientCapabilitiesBySource.size === 0 || !this.onMessageToSource) {
      if (this.usesSelectiveTimelineDelivery() && serializedEvent.type === "attention_required") {
        this.emit({
          type: "agent_attention_required",
          payload: {
            agentId: event.agentId,
            reason: serializedEvent.reason,
            timestamp: serializedEvent.timestamp,
            shouldNotify: serializedEvent.shouldNotify,
            ...(serializedEvent.notification ? { notification: serializedEvent.notification } : {}),
          },
        });
      } else if (
        !this.usesSelectiveTimelineDelivery() ||
        this.viewedTimelineAgentIds.has(event.agentId)
      ) {
        this.emit({
          type: "agent_stream",
          payload: this.buildAgentStreamPayload(event, serializedEvent),
        });
      }
      return;
    }

    for (const [source, capabilities] of this.clientCapabilitiesBySource) {
      const supportsSelectiveDelivery = capabilities.has(CLIENT_CAPS.selectiveAgentTimeline);
      if (supportsSelectiveDelivery && serializedEvent.type === "attention_required") {
        this.onMessageToSource(source, {
          type: "agent_attention_required",
          payload: {
            agentId: event.agentId,
            reason: serializedEvent.reason,
            timestamp: serializedEvent.timestamp,
            shouldNotify: serializedEvent.shouldNotify,
            ...(serializedEvent.notification ? { notification: serializedEvent.notification } : {}),
          },
        });
        continue;
      }
      if (
        supportsSelectiveDelivery &&
        !this.viewedTimelineAgentIdsBySource.get(source)?.has(event.agentId)
      ) {
        continue;
      }
      this.onMessageToSource(source, {
        type: "agent_stream",
        payload: this.buildAgentStreamPayload(event, serializedEvent),
      });
    }
  }

  supports(capability: ClientCapability): boolean {
    return this.clientCapabilities.has(capability);
  }

  supportsForSource(capability: ClientCapability, source: object): boolean {
    return (
      this.clientCapabilitiesBySource.get(source)?.has(capability) ?? this.supports(capability)
    );
  }

  emitProjectUpdate(update: ProjectUpdate): void {
    const message: SessionOutboundMessage = {
      type: "project.update",
      payload:
        update.kind === "upsert"
          ? { kind: "upsert", project: this.buildProjectDescriptor(update.project) }
          : update,
    };
    if (this.clientCapabilitiesBySource.size === 0 || !this.onMessageToSource) {
      if (this.supports(CLIENT_CAPS.projectUpdates)) this.emit(message);
      return;
    }
    for (const [source, capabilities] of this.clientCapabilitiesBySource) {
      if (capabilities.has(CLIENT_CAPS.projectUpdates)) {
        this.onMessageToSource(source, message);
      }
    }
  }

  async syncWorkspaceGitObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    await this.workspaceGitObserver.syncObserverForWorkspace(workspace);
  }

  async emitWorkspaceUpdateForWorkspaceId(workspaceId: string): Promise<void> {
    await this.emitWorkspaceUpdatesForWorkspaceIds([workspaceId]);
  }

  private async emitCreatedWorkspaceUpdate(
    workspace: WorkspaceDescriptorPayload,
    optimisticStatus?: WorkspaceDescriptorPayload["status"],
  ): Promise<void> {
    if (this.workspaceUpdatesSubscription) {
      await this.emitWorkspaceUpdatesForWorkspaceIds(
        [workspace.id],
        optimisticStatus ? { optimisticStatus } : undefined,
      );
      return;
    }
    // COMPAT(workspaceCreateCausalUpdate): added in v0.1.106, remove after 2027-01-12.
    // Older clients create before subscribing and require the causal update beside the response.
    this.emit({
      type: "workspace_update",
      payload: {
        kind: "upsert",
        workspace: optimisticStatus ? { ...workspace, status: optimisticStatus } : workspace,
      },
    });
  }

  markWorkspaceArchivingForExternalMutation(
    workspaceIds: Iterable<string>,
    archivingAt: string,
  ): void {
    this.markWorkspaceArchiving(workspaceIds, archivingAt);
  }

  clearWorkspaceArchivingForExternalMutation(workspaceIds: Iterable<string>): void {
    this.clearWorkspaceArchiving(workspaceIds);
  }

  async emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void> {
    await this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds);
  }

  async syncWorkspaceGitObserversForExternalWorkspaceIds(
    workspaceIds: Iterable<string>,
  ): Promise<void> {
    await Promise.all(
      Array.from(new Set(workspaceIds)).map(async (workspaceId) => {
        const workspace = await this.workspaceRegistry.get(workspaceId);
        if (workspace && !workspace.archivedAt) {
          await this.workspaceGitObserver.syncObserverForWorkspace(workspace);
        }
      }),
    );
  }

  async warmWorkspaceGitDataForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    await this.workspaceGitObserver.warmGitData(workspace);
  }

  async refreshRecoveredWorkspaceForExternalMutation(
    workspace: PersistedWorkspaceRecord,
  ): Promise<void> {
    try {
      await this.workspaceGitObserver.warmGitData(workspace);
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, workspaceId: workspace.workspaceId },
        "Failed to warm git observer after workspace recovery",
      );
      try {
        await this.emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
      } catch (emitError) {
        this.sessionLogger.warn(
          { err: emitError, workspaceId: workspace.workspaceId },
          "Failed to emit workspace update after recovery",
        );
      }
    }
  }

  /**
   * Get the client's current activity state
   */
  public getClientActivity(): {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt: Date;
  } | null {
    return this.clientActivity;
  }

  private getFocusedAgentSelectionForCwd(cwd: string):
    | {
        provider?: string | null;
        model?: string | null;
        thinkingOptionId?: string | null;
      }
    | undefined {
    const focusedAgentId = this.clientActivity?.focusedAgentId;
    if (!focusedAgentId) {
      return undefined;
    }

    const agent = this.agentManager.getAgent(focusedAgentId);
    if (!agent || agent.cwd !== cwd) {
      return undefined;
    }

    return {
      provider: agent.provider,
      model: agent.runtimeInfo?.model ?? agent.config.model ?? null,
      thinkingOptionId:
        agent.runtimeInfo?.thinkingOptionId ?? agent.config.thinkingOptionId ?? null,
    };
  }

  private readStructuredGenerationDaemonConfig(): StructuredGenerationDaemonConfig {
    const config = this.daemonConfigStore.get();
    return {
      metadataGeneration: config.metadataGeneration,
      agentProfiles: config.agentProfiles,
      agentTeams: config.agentTeams,
    };
  }

  public getRuntimeMetrics(): SessionRuntimeMetrics {
    const terminalMetrics = this.terminalController.getMetrics();
    const workspaceGitMetrics = this.workspaceGitObserver.getMetrics();
    return {
      terminalDirectorySubscriptionCount: terminalMetrics.directorySubscriptionCount,
      terminalSubscriptionCount: terminalMetrics.streamSubscriptionCount,
      workspaceGitWatchedDirectoryCount: workspaceGitMetrics.watchedDirectoryCount,
      workspaceGitWorkspaceRecordCount: workspaceGitMetrics.workspaceRecordCount,
      workspaceGitSubscriptionCount: workspaceGitMetrics.subscriptionCount,
      inflightRequests: this.inflightRequests,
      peakInflightRequests: this.peakInflightRequests,
    };
  }

  public emitServerMessage(message: SessionOutboundMessage): void {
    this.emit(message);
  }

  private broadcastToAllSessions(message: SessionOutboundMessage): void {
    if (this.onBroadcastMessage) {
      this.onBroadcastMessage(message);
      return;
    }
    this.emit(message);
  }

  /**
   * Send initial state to client after connection
   */
  public async sendInitialState(): Promise<void> {
    // No unsolicited agent list hydration. Callers must use fetch_agents_request.
  }

  /**
   * Interrupt the agent's active run so the next prompt starts a fresh turn.
   * Returns once the manager confirms the stream has been cancelled.
   */
  private async interruptAgentIfRunning(agentId: string): Promise<void> {
    const snapshot = this.agentManager.getAgent(agentId);
    if (!snapshot) {
      this.sessionLogger.trace({ agentId }, "agent.session.interrupt.not_found");
      throw new Error(`Agent ${agentId} not found`);
    }

    const hasInFlightRun = this.agentManager.hasInFlightRun(agentId);
    if (!hasInFlightRun) {
      this.sessionLogger.trace(
        {
          agentId,
          provider: snapshot.provider,
          lifecycle: snapshot.lifecycle,
          hasInFlightRun,
        },
        "agent.session.interrupt.skip_not_running",
      );
      return;
    }

    this.sessionLogger.debug(
      { agentId, lifecycle: snapshot.lifecycle, hasInFlightRun },
      "interruptAgentIfRunning: interrupting",
    );

    const t0 = Date.now();
    const cancellation = await this.agentManager.cancelAgentRun(agentId);
    this.sessionLogger.debug(
      { agentId, cancellation: cancellation.status, durationMs: Date.now() - t0 },
      "interruptAgentIfRunning: cancelAgentRun completed",
    );
    if (cancellation.status === "refused") {
      this.sessionLogger.warn(
        { agentId },
        "interruptAgentIfRunning: reported running but no active run was cancelled",
      );
      throw new AgentRunCancellationError(agentId, "stop");
    }
  }

  private hasActiveAgentRun(agentId: string | null): boolean {
    if (!agentId) {
      return false;
    }
    return this.agentManager.hasInFlightRun(agentId);
  }

  private handleAgentRunError(agentId: string, error: unknown, context: string): void {
    const message = errorToFriendlyMessage(error);
    this.sessionLogger.error({ err: error, agentId, context }, `${context} for agent ${agentId}`);
    this.emit({
      type: "activity_log",
      payload: {
        id: uuidv4(),
        timestamp: new Date(),
        type: "error",
        content: `${context}: ${message}`,
      },
    });
  }

  /**
   * Subscribe to AgentManager events and forward them to the client
   */
  private subscribeToOptionalManagers(): void {
    this.terminalController.start();
    // Git operations are low-volume and user-initiated, so every session gets
    // the append stream; clients ignore cwds they aren't watching.
    this.unsubscribeGitOperationLog = gitOperationLog.subscribe((append) => {
      this.emit({ type: "checkout.git.log_appended.notification", payload: append });
    });
    if (this.terminalManager) {
      this.unsubscribeTerminalWorkspaceContributionEvents =
        this.terminalManager.subscribeTerminalWorkspaceContributionChanged((event) => {
          void this.emitWorkspaceUpdateForTerminalContribution(event).catch((error) => {
            this.sessionLogger.warn(
              { err: error, terminalId: event.terminalId },
              "Failed to emit workspace update after terminal contribution changed",
            );
          });
        });
    }
    this.providerCatalogSession.start();
  }

  private subscribeToRegistryMutations(): void {
    this.unsubscribeProjectMutations?.();
    this.unsubscribeProjectMutations =
      this.projectRegistry.subscribeToMutations?.((mutation) =>
        this.enqueueRegistryMutation(() => this.handleProjectMutation(mutation)),
      ) ?? null;
    this.unsubscribeWorkspaceMutations?.();
    this.unsubscribeWorkspaceMutations =
      this.workspaceRegistry.subscribeToMutations?.((mutation) =>
        this.enqueueRegistryMutation(() => this.handleWorkspaceMutation(mutation)),
      ) ?? null;
  }

  private enqueueRegistryMutation(handleMutation: () => Promise<void>): Promise<void> {
    const next = this.registryMutationQueue.then(handleMutation);
    this.registryMutationQueue = next.catch(() => {});
    return next;
  }

  private async handleWorkspaceMutation(mutation: WorkspaceMutation): Promise<void> {
    try {
      if (this.isCleanedUp) {
        return;
      }
      if (
        mutation.kind === "archive" ||
        mutation.kind === "remove" ||
        mutation.workspace?.archivedAt
      ) {
        this.workspaceGitObserver.removeForWorkspaceId(mutation.workspaceId);
      } else {
        await this.syncWorkspaceMutationObserver(mutation);
      }
      if (this.isCleanedUp) {
        return;
      }
      await this.emitWorkspaceUpdatesForWorkspaceIds(
        [mutation.workspaceId],
        mutation.expectsInitialAgent ? { optimisticStatus: "running" } : undefined,
      );
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, workspaceId: mutation.workspaceId, mutationKind: mutation.kind },
        "Failed to apply workspace mutation to session",
      );
    }
  }

  private async syncWorkspaceMutationObserver(mutation: WorkspaceMutation): Promise<void> {
    const subscription = this.workspaceUpdatesSubscription;
    if (!mutation.workspace || !subscription) {
      return;
    }
    const descriptorsByWorkspaceId = await this.buildWorkspaceDescriptorMap({
      workspaceIds: [mutation.workspaceId],
      includeGitData: false,
    });
    const descriptor = descriptorsByWorkspaceId.get(mutation.workspaceId);
    if (
      !descriptor ||
      !this.matchesWorkspaceFilter({ workspace: descriptor, filter: subscription.filter })
    ) {
      this.workspaceGitObserver.removeForWorkspaceId(mutation.workspaceId);
      return;
    }
    const currentWorkspace = await this.workspaceRegistry.get(mutation.workspaceId);
    if (!currentWorkspace || currentWorkspace.archivedAt) {
      this.workspaceGitObserver.removeForWorkspaceId(mutation.workspaceId);
      return;
    }
    await this.workspaceGitObserver.syncObserverForWorkspace(currentWorkspace);
    if (this.isCleanedUp) {
      this.workspaceGitObserver.removeForWorkspaceId(mutation.workspaceId);
    }
  }

  private async handleProjectMutation(mutation: ProjectMutation): Promise<void> {
    try {
      const subscription = this.workspaceUpdatesSubscription;
      if (this.isCleanedUp || !subscription) {
        return;
      }
      const projectWorkspaceIds = (await this.workspaceRegistry.list())
        .filter((workspace) => workspace.projectId === mutation.projectId)
        .map((workspace) => workspace.workspaceId);

      if (mutation.kind === "remove") {
        const visibleWorkspaceIds = projectWorkspaceIds.filter((workspaceId) => {
          const lastEmitted = subscription.lastEmittedByWorkspaceId.get(workspaceId);
          return (
            lastEmitted?.kind === "upsert" ||
            (lastEmitted?.kind === "remove" &&
              lastEmitted.emptyProject?.projectId === mutation.projectId)
          );
        });
        let updateIds = visibleWorkspaceIds;
        if (
          updateIds.length === 0 &&
          subscription.visibleEmptyProjectIds?.has(mutation.projectId)
        ) {
          updateIds = [mutation.projectId];
        }
        if (updateIds.length === 0) {
          return;
        }
        for (const workspaceId of projectWorkspaceIds) {
          this.workspaceGitObserver.removeForWorkspaceId(workspaceId);
        }
        await this.emitWorkspaceUpdatesForWorkspaceIds(updateIds, {
          removedProjectId: mutation.projectId,
        });
        return;
      }

      if (mutation.kind === "archive" || mutation.project?.archivedAt) {
        for (const workspaceId of projectWorkspaceIds) {
          this.workspaceGitObserver.removeForWorkspaceId(workspaceId);
        }
      }
      await this.emitWorkspaceUpdatesForWorkspaceIds(projectWorkspaceIds);
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, projectId: mutation.projectId, mutationKind: mutation.kind },
        "Failed to apply project mutation to session",
      );
    }
  }

  private subscribeToAgentEvents(): void {
    if (this.unsubscribeAgentEvents) {
      this.unsubscribeAgentEvents();
    }

    this.unsubscribeAgentEvents = this.agentManager.subscribe(
      (event) => {
        if (event.type === "agent_state") {
          this.sessionLogger.trace(
            {
              agentId: event.agent.id,
              provider: event.agent.provider,
              providerSessionId: event.agent.persistence?.sessionId ?? undefined,
              turnId: event.agent.activeForegroundTurnId ?? undefined,
              lifecycle: event.agent.lifecycle,
            },
            "agent.session.forward_update",
          );
          void this.agentUpdates.forwardLiveAgent(event.agent);
          return;
        }

        if (event.type === "observed_agent_state") {
          // Synthetic snapshot for an observed subagent (no ManagedAgent
          // runtime). Forward through the same filter/placement path as live
          // agents. See projects/observed-subagents/observed-subagents.md.
          void this.agentUpdates.forwardLiveAgentPayload(event.payload);
          return;
        }

        if (event.type === "background_shell_task_state") {
          // Not Agent-shaped (no ManagedAgent, no tab/pane) - push the full
          // current list for this parent directly instead of routing through
          // the live-agent forwarding path.
          this.emit({
            type: "background_shell_tasks_changed",
            payload: { parentAgentId: event.parentAgentId, tasks: event.tasks },
          });
          return;
        }

        if (event.type === "suggested_task_state") {
          // Suggested-task chips (spawn_task) - push the full current pending
          // list for this parent, same direct path as background shell tasks.
          this.emit({
            type: "suggested_tasks_changed",
            payload: { parentAgentId: event.parentAgentId, tasks: event.tasks },
          });
          return;
        }

        if (event.type === "provider_subagent") {
          this.emitProviderSubagentWorkspaceUpdate(event.event);
          if (!this.supports(CLIENT_CAPS.providerSubagents)) {
            return;
          }
          const update = event.event;
          if (update.type === "upsert") {
            this.emit({
              type: "agent.provider_subagents.update",
              payload: { kind: "upsert", subagent: update.subagent },
            });
          } else if (update.type === "timeline") {
            this.emit({
              type: "agent.provider_subagents.update",
              payload: {
                kind: "timeline",
                parentAgentId: update.parentAgentId,
                subagentId: update.subagentId,
                provider: update.provider,
                item: update.row.item,
                timestamp: update.row.timestamp,
                seq: update.row.seq,
                epoch: update.epoch,
              },
            });
          } else {
            this.emit({
              type: "agent.provider_subagents.update",
              payload: {
                kind: "remove",
                parentAgentId: update.parentAgentId,
                subagentId: update.subagentId,
              },
            });
          }
          return;
        }

        if (
          this.voiceSession.isActiveForAgent(event.agentId) &&
          event.event.type === "permission_requested" &&
          isVoicePermissionAllowed(event.event.request)
        ) {
          const requestId = event.event.request.id;
          void this.agentManager
            .respondToPermission(event.agentId, requestId, {
              behavior: "allow",
            })
            .catch((error) => {
              this.sessionLogger.warn(
                {
                  err: error,
                  agentId: event.agentId,
                  requestId,
                },
                "Failed to auto-allow speak tool permission in voice mode",
              );
            });
        }

        const serializedEvent = serializeAgentStreamEvent(event.event);
        if (!serializedEvent) {
          return;
        }
        this.sessionLogger.trace(
          {
            agentId: event.agentId,
            provider: event.event.provider,
            turnId: getAgentStreamEventTurnId(event.event),
            seq: event.seq,
            epoch: event.epoch,
            event: event.event,
          },
          "agent.session.forward_stream",
        );

        this.forwardAgentStream(event, serializedEvent);

        if (event.event.type === "permission_requested") {
          this.emit({
            type: "agent_permission_request",
            payload: {
              agentId: event.agentId,
              request: event.event.request,
            },
          });
        } else if (event.event.type === "permission_resolved") {
          this.emit({
            type: "agent_permission_resolved",
            payload: {
              agentId: event.agentId,
              requestId: event.event.requestId,
              resolution: event.event.resolution,
            },
          });
        }

        // Title updates may be applied asynchronously after agent creation.
      },
      { replayState: false },
    );
  }

  private emitProviderSubagentWorkspaceUpdate(event: ProviderSubagentManagerEvent): void {
    if (event.type === "timeline") {
      return;
    }
    const parentAgentId =
      event.type === "upsert" ? event.subagent.parentAgentId : event.parentAgentId;
    const parent = this.agentManager.getAgent(parentAgentId);
    if (!parent?.workspaceId) {
      return;
    }
    void this.emitWorkspaceUpdateForWorkspaceId(parent.workspaceId).catch((error) => {
      this.sessionLogger.error(
        { err: error, parentAgentId, workspaceId: parent.workspaceId },
        "Failed to emit provider subagent workspace update",
      );
    });
  }

  private buildAgentStreamPayload(
    event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
    serializedEvent: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"]["event"],
  ): Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"] {
    return {
      agentId: event.agentId,
      event: serializedEvent,
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...(typeof event.seq === "number" ? { seq: event.seq } : {}),
      ...(typeof event.epoch === "string" ? { epoch: event.epoch } : {}),
    };
  }

  private async enrichAgentPayload(payload: AgentSnapshotPayload): Promise<AgentSnapshotPayload> {
    const storedRecord = await this.agentStorage.get(payload.id);
    payload.title = storedRecord?.title ?? null;
    payload.archivedAt = storedRecord?.archivedAt ?? null;
    return payload;
  }

  private buildAgentPayload(agent: ManagedAgent): Promise<AgentSnapshotPayload> {
    return this.enrichAgentPayload(toAgentPayload(agent));
  }

  private buildStoredAgentPayload(
    record: StoredAgentRecord,
    registeredProviderIds = new Set(this.providerSnapshotManager.listRegisteredProviderIds()),
  ): AgentSnapshotPayload {
    return buildStoredAgentPayload(record, registeredProviderIds);
  }

  private isProviderVisibleToClient(provider: string): boolean {
    if (clientSupportsAllProviders(this.appVersion)) {
      return true;
    }
    return LEGACY_PROVIDER_IDS.has(provider);
  }

  private async buildProjectPlacementForWorkspace(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<ProjectPlacementPayload> {
    const project = projectRecord ?? (await this.projectRegistry.get(workspace.projectId));
    if (!project) {
      throw new Error(`Project not found for workspace ${workspace.workspaceId}`);
    }
    const snapshot = this.workspaceGitService.peekSnapshot(workspace.cwd);
    const checkout = checkoutFromPersistedWorkspacePlacement({
      workspace,
      // COMPAT(workspacePlacementBackfill): added in v0.1.107, remove after 2027-01-15.
      // Legacy records can lack branch and worktreeRoot because persisted registries
      // are not migrated in place.
      fallbackBranch: snapshot?.git.currentBranch ?? null,
      fallbackWorktreeRoot: snapshot?.git.repoRoot,
    });
    return {
      projectKey: project.projectId,
      projectName: resolveProjectDisplayName(project),
      workspaceName: resolveWorkspaceDisplayName(workspace),
      checkout,
    };
  }

  private async buildProjectPlacementForWorkspaceId(
    workspaceId: string,
  ): Promise<ProjectPlacementPayload | null> {
    const workspace = await this.workspaceRegistry.get(workspaceId);
    if (!workspace) return null;

    const project = await this.projectRegistry.get(workspace.projectId);
    if (!project) return null;
    return this.buildProjectPlacementForWorkspace(workspace, project);
  }

  /**
   * Main entry point for processing session messages
   */
  public async handleMessage(rawMsg: SessionInboundMessage, source?: object): Promise<void> {
    // COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
    // A profile-named request is handled by its legacy twin's handler; emit()
    // rewrites the response back. See profile-rpc-alias.ts.
    const msg = this.adoptProfileRpcAlias(rawMsg);
    this.inflightRequests++;
    if (this.inflightRequests > this.peakInflightRequests) {
      this.peakInflightRequests = this.inflightRequests;
    }
    try {
      // Guarded like emit(): JSON.stringify(msg) would otherwise run for every
      // inbound message (a 2 MB file save stringifies 2 MB) with trace disabled.
      // Optional-chained because test logger stubs don't implement isLevelEnabled.
      if (this.sessionLogger.isLevelEnabled?.("trace")) {
        this.sessionLogger.trace(
          {
            messageType: msg.type,
            payloadBytes: JSON.stringify(msg).length,
          },
          "agent.session.inbound",
        );
      }
      if (!isSessionRpcAllowed(this.scopes, msg.type)) {
        const requestId = sessionRequestId(msg);
        if (requestId) {
          this.emit({
            type: "rpc_error",
            payload: {
              requestId,
              requestType: msg.type,
              error: `Session is not authorized for ${msg.type}`,
              code: "access_denied",
            },
          });
        }
        return;
      }
      try {
        await this.dispatchInboundMessage(msg, source);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sessionLogger.error({ err }, "Error handling message");

        const requestId =
          "requestId" in msg && typeof msg.requestId === "string" ? msg.requestId : undefined;
        if (typeof requestId === "string") {
          try {
            this.emit({
              type: "rpc_error",
              payload: {
                requestId,
                requestType: msg.type,
                error: `Request failed: ${err.message}`,
                code: "handler_error",
              },
            });
          } catch (emitError) {
            this.sessionLogger.error({ err: emitError }, "Failed to emit rpc_error");
          }
        }

        this.emit({
          type: "activity_log",
          payload: {
            id: uuidv4(),
            timestamp: new Date(),
            type: "error",
            content: `Error: ${err.message}`,
          },
        });
      }
    } finally {
      this.inflightRequests--;
    }
  }

  public setScopes(scopes: readonly string[]): void {
    this.scopes = [...scopes];
  }

  private dispatchAgentDomainMessage(
    msg: SessionInboundMessage,
    source?: object,
  ): Promise<void> | undefined {
    return (
      this.dispatchVoiceAndControlMessage(msg) ??
      this.dispatchAgentRewindMessage(msg) ??
      this.dispatchAgentPersonalityMessage(msg) ??
      this.dispatchAgentRelationshipMessage(msg) ??
      this.dispatchAgentTimelineMessage(msg, source) ??
      this.dispatchHubExecutionMessage(msg) ??
      this.dispatchAgentLifecycleMessage(msg) ??
      this.dispatchAgentConfigMessage(msg) ??
      this.dispatchMeetingsMessage(msg) ??
      this.communicationsSession.dispatch(msg) ??
      this.dispatchIntegrationAuthorizationMessage(msg) ??
      this.dispatchSpeechMessage(msg) ??
      this.dispatchVisualizerMessage(msg)
    );
  }

  private dispatchHostDomainMessage(
    msg: SessionInboundMessage,
    source?: object,
  ): Promise<void> | undefined {
    return (
      this.dispatchCheckoutMessage(msg) ??
      this.dispatchPreviewMessage(msg) ??
      this.dispatchWorkspaceRecoveryMessage(msg) ??
      this.dispatchWorkspaceAndProjectMessage(msg) ??
      this.dispatchWorktreeReattachMessage(msg) ??
      this.dispatchWorkspaceFilesMessage(msg) ??
      this.dispatchWorkspaceFileMessage(msg, source) ??
      this.dispatchProviderMessage(msg) ??
      this.dispatchTerminalMessage(msg) ??
      this.dispatchScheduleMessage(msg) ??
      this.dispatchArtifactMessage(msg) ??
      this.runsSession.dispatch(msg) ??
      this.dispatchMiscMessage(msg)
    );
  }

  private async dispatchInboundMessage(msg: SessionInboundMessage, source?: object): Promise<void> {
    const promise =
      this.dispatchAgentDomainMessage(msg, source) ?? this.dispatchHostDomainMessage(msg, source);
    if (promise) await promise;
  }

  private dispatchVoiceAndControlMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "voice_audio_chunk":
        return this.voiceSession.handleAudioChunk(msg);
      case "abort_request":
        return this.voiceSession.handleAbort();
      case "audio_played":
        this.voiceSession.handleAudioPlayed(msg.id);
        return undefined;
      case "set_voice_mode":
        return this.voiceSession.handleSetVoiceMode(msg.enabled, msg.agentId, msg.requestId);
      case "dictation_stream_start":
        return this.voiceSession.handleDictationStreamStart(msg);
      case "dictation_stream_chunk":
        return this.voiceSession.handleDictationChunk({
          dictationId: msg.dictationId,
          seq: msg.seq,
          audioBase64: msg.audio,
          format: msg.format,
        });
      case "dictation_stream_finish":
        return this.voiceSession.handleDictationFinish(msg.dictationId, msg.finalSeq);
      case "dictation_stream_cancel":
        this.voiceSession.handleDictationCancel(msg.dictationId);
        return undefined;
      case "restart_server_request":
        return this.handleRestartServerRequest(msg.requestId, msg.reason);
      case "shutdown_server_request":
        return this.handleShutdownServerRequest(msg.requestId);
      case "client_heartbeat":
        this.handleClientHeartbeat(msg);
        return undefined;
      case "ping": {
        const now = Date.now();
        this.emit({
          type: "pong",
          payload: {
            requestId: msg.requestId,
            clientSentAt: msg.clientSentAt,
            serverReceivedAt: now,
            serverSentAt: now,
          },
        });
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private dispatchAgentRewindMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "agent.rewind.request":
        return this.handleAgentRewindRequest(msg);
      default:
        return undefined;
    }
  }

  // Kept out of dispatchAgentConfigMessage only because that switch sits at the
  // complexity ceiling; the handler itself lives with its config siblings.
  private dispatchAgentPersonalityMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "agent.personality.set.request":
        return this.agentConfigSession.handleAgentPersonalitySetRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchAgentRelationshipMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "agent.detach.request":
        return this.handleDetachAgentRequest(msg.agentId, msg.requestId);
      case "agent.workspace.transfer.request":
        return this.handleAgentWorkspaceTransferRequest(
          msg.agentId,
          msg.workspaceId,
          msg.requestId,
        );
      case "agent.subagent.stop.request":
        return this.handleStopObservedSubagentRequest(msg.agentId, msg.requestId);
      case "agent.background_task.stop.request":
        return this.handleStopBackgroundShellTaskRequest(
          msg.parentAgentId,
          msg.taskId,
          msg.requestId,
        );
      case "agent.background_task.clear.request":
        return this.handleClearBackgroundShellTasksRequest(
          msg.parentAgentId,
          msg.taskIds,
          msg.requestId,
        );
      case "tasks.suggested.start.request":
        return this.handleStartSuggestedTaskRequest(msg);
      case "tasks.suggested.dismiss.request":
        return this.handleDismissSuggestedTaskRequest(msg);
      default:
        return undefined;
    }
  }

  private async handleStopObservedSubagentRequest(
    agentId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.agentManager.stopObservedSubagent(agentId);
      this.emit({
        type: "agent.subagent.stop.response",
        payload: {
          requestId,
          agentId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to stop observed subagent");
      this.sessionLogger.error(
        { err: error, agentId, requestId },
        "Failed to stop observed subagent",
      );
      this.emit({
        type: "agent.subagent.stop.response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: message,
        },
      });
    }
  }

  private async handleStopBackgroundShellTaskRequest(
    parentAgentId: string,
    taskId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.agentManager.stopBackgroundShellTask(taskId);
      this.emit({
        type: "agent.background_task.stop.response",
        payload: { requestId, agentId: taskId, accepted: true, error: null },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to stop background shell task");
      this.sessionLogger.error(
        { err: error, parentAgentId, taskId, requestId },
        "Failed to stop background shell task",
      );
      this.emit({
        type: "agent.background_task.stop.response",
        payload: { requestId, agentId: taskId, accepted: false, error: message },
      });
    }
  }

  private async handleClearBackgroundShellTasksRequest(
    parentAgentId: string,
    taskIds: readonly string[],
    requestId: string,
  ): Promise<void> {
    try {
      await this.agentManager.clearBackgroundShellTasks(taskIds);
      this.emit({
        type: "agent.background_task.clear.response",
        payload: { requestId, agentId: parentAgentId, accepted: true, error: null },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to clear background shell tasks");
      this.sessionLogger.error(
        { err: error, parentAgentId, taskIds, requestId },
        "Failed to clear background shell tasks",
      );
      this.emit({
        type: "agent.background_task.clear.response",
        payload: { requestId, agentId: parentAgentId, accepted: false, error: message },
      });
    }
  }

  private async handleStartSuggestedTaskRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.suggested.start.request" }>,
  ): Promise<void> {
    const { parentAgentId, taskIds, mode, requestId } = msg;
    const parent = this.agentManager.getAgent(parentAgentId);
    if (!parent) {
      this.emit({
        type: "tasks.suggested.start.response",
        payload: {
          requestId,
          parentAgentId,
          accepted: false,
          succeeded: 0,
          failed: taskIds.length,
          error: "Parent agent not found",
        },
      });
      return;
    }

    // Apply the same mode to each task independently - one agent/chat each, no
    // combining. Failures are collected so a partial success still starts the
    // rest; each failed task's chip stays pending.
    let succeeded = 0;
    const errors: string[] = [];
    for (const taskId of taskIds) {
      const task = this.agentManager.getSuggestedTaskEntry(taskId);
      // Never act on a task that belongs to a different parent - treat a
      // mismatched (or missing) id as not found rather than starting it.
      if (!task || task.parentAgentId !== parentAgentId) {
        errors.push(`${taskId}: suggested task not found`);
        continue;
      }
      // Atomically claim the start. A second concurrent request for the same id
      // (double-click during slow worktree provisioning) fails this gate
      // immediately instead of also passing the pending check and double-spawning.
      if (!this.agentManager.beginSuggestedTaskStart(taskId)) {
        errors.push(`${task.title}: already ${task.state}`);
        continue;
      }
      try {
        let startedAgentId: string | undefined;
        if (mode === "in_session") {
          await sendPromptToAgent({
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            agentId: parentAgentId,
            prompt: buildAgentPrompt(task.prompt),
            logger: this.sessionLogger,
          });
        } else {
          startedAgentId = await this.createAgentForSuggestedTask({
            parent,
            mode,
            title: task.title,
            prompt: task.prompt,
            ...(task.cwd ? { cwd: task.cwd } : {}),
          });
        }
        this.agentManager.markSuggestedTaskStarted({
          taskId,
          mode,
          ...(startedAgentId ? { startedAgentId } : {}),
        });
        succeeded += 1;
      } catch (error) {
        const message = getErrorMessageOr(error, "failed to start");
        this.sessionLogger.error(
          { err: error, parentAgentId, taskId, mode },
          "Failed to start suggested task",
        );
        errors.push(`${task.title}: ${message}`);
      } finally {
        this.agentManager.endSuggestedTaskStart(taskId);
      }
    }

    this.emit({
      type: "tasks.suggested.start.response",
      payload: {
        requestId,
        parentAgentId,
        accepted: succeeded > 0 || taskIds.length === 0,
        succeeded,
        failed: errors.length,
        error: errors.length > 0 ? errors.join("; ") : null,
      },
    });
  }

  /**
   * Create a new agent for a started suggested task, reusing the MCP branch of
   * createAgentCommand (worktree provisioning + workspace resolution baked in).
   * The new agent inherits the parent agent's brain - provider/model plus its
   * full config (personality snapshot, mode, features) minus the parent's
   * title - so a started task reads as a continuation of the suggesting agent.
   *
   * Only `subagent` links the new agent to the parent (bound child in the
   * Subagents track, archive-cascades). `new_chat` and `worktree` are `detached`
   * - independent top-level agents that outlive the parent's cancel/archive. We
   * keep `callerAgentId` set even when detached so the new agent still inherits
   * the parent's cwd/workspace/config; only the parent-id label is dropped.
   */
  private async createAgentForSuggestedTask(params: {
    parent: ManagedAgent;
    mode: "worktree" | "subagent" | "new_chat";
    title: string;
    prompt: string;
    cwd?: string;
  }): Promise<string> {
    const { parent, mode } = params;
    const detached = mode !== "subagent";
    const passthroughConfig: Partial<AgentSessionConfig> = { ...parent.config };
    // The parent's title would win over the task title in buildMcpSessionConfig.
    delete passthroughConfig.title;
    const result = await createAgentCommand(
      {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
        terminalManager: this.terminalManager,
        providerSnapshotManager: this.providerSnapshotManager,
        createOttoWorktree: (input, worktreeOptions) =>
          this.createOttoWorktreeWorkflow(input, worktreeOptions),
        // No-op today: the explicit `title` below makes createAgentCommand skip
        // auto-titling (explicitTitle guard). Wired so a future caller that
        // omits the title still gets an AI-written chat name.
        scheduleAutoTitle: (request) =>
          this.agentAutoTitle.schedule({
            ...request,
            currentSelection: this.getFocusedAgentSelectionForCwd(request.cwd),
          }),
      },
      {
        kind: "mcp",
        provider: formatProviderModel(parent.provider, parent.config.model),
        config: passthroughConfig,
        title: params.title,
        initialPrompt: params.prompt,
        cwd: params.cwd ?? parent.cwd,
        callerAgentId: parent.id,
        // Bound subagent → child row in the parent's track. Detached → its own
        // top-level tab, no parent link (mergeLabels strips the parent-id label).
        detached,
        background: true,
        // A detached chat isn't watchable via the parent's Subagents track, so
        // notify on finish; a bound subagent surfaces there already.
        notifyOnFinish: detached,
        ...(mode === "worktree" ? { worktree: { action: "branch-off" as const } } : {}),
      },
    );
    await this.agentUpdates.forwardLiveAgent(result.snapshot);
    return result.snapshot.id;
  }

  private async handleDismissSuggestedTaskRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.suggested.dismiss.request" }>,
  ): Promise<void> {
    const { parentAgentId, taskIds, requestId } = msg;
    // Idempotent for the user: chips already gone are a no-op. Individual and
    // "Dismiss all" both flow through here - one id or the whole queue.
    let succeeded = 0;
    for (const taskId of taskIds) {
      // Only dismiss tasks that belong to this parent. A mismatched (or unknown)
      // id is a silent no-op counted as not-succeeded, matching the idempotent
      // "chip already gone" behaviour.
      const entry = this.agentManager.getSuggestedTaskEntry(taskId);
      if (!entry || entry.parentAgentId !== parentAgentId) {
        continue;
      }
      const result = this.agentManager.dismissSuggestedTask(taskId);
      if (result.dismissed) {
        succeeded += 1;
      }
    }
    this.emit({
      type: "tasks.suggested.dismiss.response",
      payload: {
        requestId,
        parentAgentId,
        accepted: true,
        succeeded,
        failed: taskIds.length - succeeded,
        error: null,
      },
    });
  }

  private dispatchAgentTimelineMessage(
    msg: SessionInboundMessage,
    source?: object,
  ): Promise<void> | undefined {
    switch (msg.type) {
      case "fetch_agent_timeline_request":
        return this.handleFetchAgentTimelineRequest(msg, source);
      case "agent.timeline.list_prompts.request":
        return this.handleAgentTimelineListPromptsRequest(msg, source);
      case "agent.provider_subagents.list.request":
        return this.handleProviderSubagentListRequest(msg);
      case "agent.provider_subagents.timeline.get.request":
        return this.handleProviderSubagentTimelineRequest(msg);
      case "agent.timeline.set_subscription.request": {
        const agentIds = [...new Set(msg.agentIds)].sort();
        if (
          source
            ? this.supportsForSource(CLIENT_CAPS.selectiveAgentTimeline, source)
            : this.supports(CLIENT_CAPS.selectiveAgentTimeline)
        ) {
          this.replaceAgentTimelineSubscription(source, agentIds);
        }
        const response: SessionOutboundMessage = {
          type: "agent.timeline.set_subscription.response",
          payload: { agentIds, requestId: msg.requestId },
        };
        if (source && this.onMessageToSource) this.onMessageToSource(source, response);
        else this.emit(response);
        return undefined;
      }
      case "brain.logs.watch.request": {
        this.setBrainLogWatching(source, msg.watching);
        const response: SessionOutboundMessage = {
          type: "brain.logs.watch.response",
          payload: { watching: msg.watching, requestId: msg.requestId },
        };
        if (source && this.onMessageToSource) this.onMessageToSource(source, response);
        else this.emit(response);
        return undefined;
      }
      case "agent.fork_context.request":
        return this.handleAgentForkContextRequest(msg);
      case "agent.queue.remove.request":
        return this.handleAgentQueueRemoveRequest(msg);
      case "agent.queue.reorder.request":
        return this.handleAgentQueueReorderRequest(msg);
      case "agent.queue.clear.request":
        return this.handleAgentQueueClearRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchHubExecutionMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    if (msg.type === "hub.execution.agent.create.request") {
      return this.hubExecutionController?.createAgent(msg);
    }
    if (msg.type === "hub.execution.agent.validate.request") {
      return this.hubExecutionController?.validateAgent(msg);
    }
    if (msg.type === "hub.execution.control.request") {
      return this.hubExecutionController?.controlExecution(msg);
    }
    return undefined;
  }

  // This switch is the single routing table for the agent lifecycle message family.
  // eslint-disable-next-line complexity
  private dispatchAgentLifecycleMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "fetch_agents_request":
        return this.handleFetchAgents(msg);
      case "fetch_agent_history_request":
        return this.handleFetchAgentHistory(msg);
      case "fetch_recent_provider_sessions_request":
        return this.handleFetchRecentProviderSessions(msg);
      case "fetch_agent_request":
        return this.handleFetchAgent(msg.agentId, msg.requestId);
      case "delete_agent_request":
        return this.handleDeleteAgentRequest(msg.agentId, msg.requestId);
      case "archive_agent_request":
        return this.handleArchiveAgentRequest(msg.agentId, msg.requestId);
      case "close_items_request":
        return this.handleCloseItemsRequest(msg);
      case "history.agents.clear_archived.request":
        return this.handleHistoryAgentsClearArchivedRequest(msg);
      case "update_agent_request":
        return this.handleUpdateAgentRequest(msg.agentId, msg.name, msg.labels, msg.requestId);
      case "project.rename.request":
        return this.handleProjectRenameRequest(msg.projectId, msg.customName, msg.requestId);
      case "project.icon.set.request":
        return this.handleProjectIconSetRequest(msg);
      case "send_agent_message_request":
        return this.handleSendAgentMessageRequest(msg);
      case "wait_for_finish_request":
        return this.handleWaitForFinish(msg.agentId, msg.requestId, msg.timeoutMs);
      case "create_agent_request":
        return this.handleCreateAgentRequest(msg);
      case "resume_agent_request":
        return this.handleResumeAgentRequest(msg);
      case "import_agent_request":
        return this.handleImportAgentRequest(msg);
      case "refresh_agent_request":
        return this.handleRefreshAgentRequest(msg);
      case "cancel_agent_request":
        return this.handleCancelAgentRequest(msg.agentId, msg.requestId);
      case "agent_permission_response":
        return this.handleAgentPermissionResponse(msg.agentId, msg.requestId, msg.response);
      case "clear_agent_attention":
        return this.handleClearAgentAttention(msg.agentId, msg.requestId);
      default:
        return undefined;
    }
  }

  private dispatchDaemonConfigMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "get_daemon_config_request":
        this.emit({
          type: "get_daemon_config_response",
          payload: {
            requestId: msg.requestId,
            config: redactDaemonConfigForClient(this.daemonConfigStore.get()),
          },
        });
        return undefined;
      case "daemon.get_status.request":
        return this.daemonSession.handleGetStatusRequest(msg);
      case "daemon.get_pairing_offer.request":
        return this.daemonSession.handleGetPairingOfferRequest(msg);
      case "hub.management.daemon.connect.request":
      case "hub.management.daemon.get_status.request":
      case "hub.management.daemon.disconnect.request":
        return this.daemonSession.handleHubRelationshipRequest(msg);
      case "diagnostics.request":
        return this.daemonSession.handleDiagnosticsRequest(msg);
      case "daemon.update.request":
        return this.daemonSession.handleUpdateRequest(msg);
      case "set_daemon_config_request":
        this.emit({
          type: "set_daemon_config_response",
          payload: {
            requestId: msg.requestId,
            config: redactDaemonConfigForClient(this.daemonConfigStore.patch(msg.config)),
          },
        });
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Start a connector's OAuth login and answer with the URL to open.
   *
   * Two timescales, which is why this is not a plain request/response: the
   * response says "here is where to sign in", and the outcome lands minutes
   * later on the pushed status channel once the user is back from the browser.
   */
  private handleConnectorOauthAuthorize(
    requestId: string,
    connectorId: string,
    scope: string | undefined,
  ): void {
    const respond = (
      payload: Omit<ConnectorsOauthAuthorizeResponse["payload"], "connectorId" | "requestId">,
    ): void => {
      this.emit({
        type: "connectors.oauth.authorize.response",
        payload: { connectorId, requestId, ...payload },
      });
    };
    const broker = this.connectorOAuthBroker;
    if (!broker) {
      respond({
        authorizationUrl: null,
        status: "error",
        error: "This host cannot sign connectors in. Update the host to use this.",
      });
      return;
    }
    const connector = (this.daemonConfigStore.get().connectors ?? []).find(
      (entry) => entry.id === connectorId,
    );
    if (!connector) {
      respond({
        authorizationUrl: null,
        status: "error",
        error: `No connector with id '${connectorId}'.`,
      });
      return;
    }
    const watchCompletion = (): void => {
      void broker
        .waitForCompletion(connectorId)
        .then(() => this.emitConnectorOauthStatus(connectorId, { ok: true }))
        .catch((err: unknown) => {
          this.emitConnectorOauthStatus(connectorId, { ok: false, error: getErrorMessage(err) });
        });
    };
    void broker
      .beginAuthorization({ connector, ...(scope ? { scope } : {}) })
      .then((result) => {
        if (result.status === "authorized") {
          respond({ authorizationUrl: null, status: "authorized", error: null });
          this.emitConnectorOauthStatus(connectorId, { ok: true });
          return undefined;
        }
        respond({ authorizationUrl: result.authorizationUrl, status: "redirect", error: null });
        watchCompletion();
        return undefined;
      })
      .catch((err: unknown) => {
        respond({ authorizationUrl: null, status: "error", error: getErrorMessage(err) });
      });
  }

  /**
   * Push the settled outcome of a connector login. Reads the account label back
   * from config rather than taking it from the flow: the broker writes it there,
   * and config is the copy every client will reconcile against anyway.
   */
  private emitConnectorOauthStatus(
    connectorId: string,
    result: { ok: true } | { ok: false; error: string },
  ): void {
    const connector = (this.daemonConfigStore.get().connectors ?? []).find(
      (entry) => entry.id === connectorId,
    );
    this.emit({
      type: "connectors.oauth.status",
      payload: {
        connectorId,
        status: result.ok ? "connected" : "failed",
        account: connector?.auth?.account ?? null,
        error: result.ok ? null : result.error,
      },
    });
  }

  private dispatchAgentConfigMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "set_agent_mode_request":
        return this.agentConfigSession.handleSetAgentModeRequest(msg);
      case "set_agent_model_request":
        return this.agentConfigSession.handleSetAgentModelRequest(msg);
      case "set_agent_feature_request":
        return this.agentConfigSession.handleSetAgentFeatureRequest(msg);
      case "set_agent_thinking_request":
        return this.agentConfigSession.handleSetAgentThinkingRequest(msg);
      case "agent.config.apply.request":
        return this.agentConfigSession.handleAgentConfigApplyRequest(msg);
      case "connectors.list_tools.request": {
        const listRequestId = msg.requestId;
        const connectorId = msg.connectorId;
        const connector = (this.daemonConfigStore.get().connectors ?? []).find(
          (entry) => entry.id === connectorId,
        );
        if (!connector) {
          this.emit({
            type: "connectors.list_tools.response",
            payload: {
              connectorId,
              tools: [],
              error: `No connector with id '${connectorId}'.`,
              requestId: listRequestId,
            },
          });
          return undefined;
        }
        void listConnectorTools(connector, {
          cwd: process.cwd(),
          logger: this.sessionLogger,
        })
          .then((result) => {
            this.emit({
              type: "connectors.list_tools.response",
              payload: {
                connectorId,
                tools: result.tools,
                error: result.error,
                requestId: listRequestId,
              },
            });
            return undefined;
          })
          .catch((err: unknown) => {
            // listConnectorTools guards internally, but its finally awaits
            // manager.close(); a close rejection must still emit a response so the
            // client's correlated request never hangs.
            this.emit({
              type: "connectors.list_tools.response",
              payload: {
                connectorId,
                tools: [],
                error: getErrorMessage(err),
                requestId: listRequestId,
              },
            });
          });
        return undefined;
      }
      case "connectors.oauth.authorize.request":
        this.handleConnectorOauthAuthorize(msg.requestId, msg.connectorId, msg.scope);
        return undefined;
      case "connectors.oauth.disconnect.request": {
        const disconnectRequestId = msg.requestId;
        const disconnectId = msg.connectorId;
        this.connectorOAuthBroker?.disconnect(disconnectId);
        this.emit({
          type: "connectors.oauth.disconnect.response",
          payload: { connectorId: disconnectId, requestId: disconnectRequestId },
        });
        return undefined;
      }
      case "agentPersonalities.get_stats.request": {
        const statsRequestId = msg.requestId;
        // The stats store is async (file-backed); resolve then emit.
        void Promise.resolve(this.getPersonalityStats?.() ?? {}).then((stats) => {
          this.emit({
            type: "agentPersonalities.get_stats.response",
            payload: { requestId: statsRequestId, stats },
          });
          return undefined;
        });
        return undefined;
      }
      case "agentPersonalities.generate_profile.request": {
        this.handlePersonalityProfileRequest(msg);
        return undefined;
      }
      case "read_project_config_request":
        return this.projectConfigSession.handleReadProjectConfigRequest(msg);
      case "write_project_config_request":
        return this.projectConfigSession.handleWriteProjectConfigRequest(msg);
      default:
        return this.dispatchDaemonConfigMessage(msg);
    }
  }

  private dispatchMeetingsMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "meetings.transcripts.list.request":
        return this.handleMeetingsTranscriptsList(msg.requestId);
      case "meetings.transcripts.create.request":
        return this.handleMeetingsTranscriptsCreate(msg);
      case "meetings.transcripts.update.request":
        return this.handleMeetingsTranscriptsUpdate(msg);
      case "meetings.transcripts.delete.request":
        return this.handleMeetingsTranscriptsDelete(msg.requestId, msg.id);
      default:
        return undefined;
    }
  }

  private async handleMeetingsTranscriptsList(requestId: string): Promise<void> {
    this.emit({
      type: "meetings.transcripts.list.response",
      payload: { requestId, records: await this.meetingTranscripts.list() },
    });
  }

  private async handleMeetingsTranscriptsCreate(
    msg: Extract<SessionInboundMessage, { type: "meetings.transcripts.create.request" }>,
  ): Promise<void> {
    const record = await this.meetingTranscripts.create(msg);
    this.emit({
      type: "meetings.transcripts.create.response",
      payload: { requestId: msg.requestId, record },
    });
  }

  private async handleMeetingsTranscriptsUpdate(
    msg: Extract<SessionInboundMessage, { type: "meetings.transcripts.update.request" }>,
  ): Promise<void> {
    const record = await this.meetingTranscripts.update(msg.id, {
      ...(msg.title === undefined ? {} : { title: msg.title }),
      ...(msg.content === undefined ? {} : { content: msg.content }),
    });
    this.emit({
      type: "meetings.transcripts.update.response",
      payload: { requestId: msg.requestId, record },
    });
  }

  private async handleMeetingsTranscriptsDelete(requestId: string, id: string): Promise<void> {
    this.emit({
      type: "meetings.transcripts.delete.response",
      payload: { requestId, deleted: await this.meetingTranscripts.delete(id) },
    });
  }

  private dispatchIntegrationAuthorizationMessage(
    msg: SessionInboundMessage,
  ): Promise<void> | undefined {
    switch (msg.type) {
      case "integrations.authorization.get_overview.request":
        return this.handleIntegrationAuthorizationGetOverviewRequest(msg.requestId);
      case "integrations.authorization.get_methods.request":
        return this.handleIntegrationAuthorizationGetMethodsRequest(
          msg.requestId,
          msg.integrationId,
        );
      case "integrations.authorization.start_browser.request":
        return this.handleIntegrationAuthorizationStartBrowserRequest(
          msg.requestId,
          msg.integrationId,
          msg.connectionId,
        );
      case "integrations.zoom.start_authorization.request":
        return this.handleZoomTeamChatStartAuthorizationRequest(msg.requestId);
      default:
        return undefined;
    }
  }

  private async handleIntegrationAuthorizationGetOverviewRequest(requestId: string): Promise<void> {
    if (!this.integrationAuthorization) return;
    const overview = await this.integrationAuthorization.getOverview();
    this.emit({
      type: "integrations.authorization.get_overview.response",
      payload: { overview, requestId },
    });
  }

  private async handleIntegrationAuthorizationGetMethodsRequest(
    requestId: string,
    integrationId?: string,
  ): Promise<void> {
    if (!this.integrationAuthorization) return;
    this.emit({
      type: "integrations.authorization.get_methods.response",
      payload: {
        methods: this.integrationAuthorizationCatalog.listMethods(integrationId),
        requestId,
      },
    });
  }

  private async handleIntegrationAuthorizationStartBrowserRequest(
    requestId: string,
    integrationId: string,
    connectionId: string,
  ): Promise<void> {
    if (!this.integrationBrowserAuthorization) {
      this.emit({
        type: "integrations.authorization.start_browser.response",
        payload: {
          authorizationUrl: null,
          error: "Browser sign-in is not configured on this host.",
          requestId,
        },
      });
      return;
    }
    try {
      const { authorizationUrl } = await this.integrationBrowserAuthorization.start({
        integrationId,
        connectionId,
      });
      this.emit({
        type: "integrations.authorization.start_browser.response",
        payload: { authorizationUrl, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "integrations.authorization.start_browser.response",
        payload: {
          authorizationUrl: null,
          error: error instanceof Error ? error.message : "Unable to start browser sign-in.",
          requestId,
        },
      });
    }
  }

  private async handleZoomTeamChatStartAuthorizationRequest(requestId: string): Promise<void> {
    if (!this.zoomTeamChatAuthorization) {
      this.emit({
        type: "integrations.zoom.start_authorization.response",
        payload: {
          authorizationUrl: null,
          error: "Zoom Team Chat sign-in is not configured on this host.",
          requestId,
        },
      });
      return;
    }
    try {
      const { authorizationUrl } = await this.zoomTeamChatAuthorization.start();
      this.emit({
        type: "integrations.zoom.start_authorization.response",
        payload: { authorizationUrl, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "integrations.zoom.start_authorization.response",
        payload: {
          authorizationUrl: null,
          error:
            error instanceof ZoomTeamChatAuthorizationUnavailableError
              ? error.message
              : "Unable to start Zoom Team Chat sign-in.",
          requestId,
        },
      });
    }
  }

  private dispatchSpeechMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "speech.settings.get_options.request":
        this.emit({
          type: "speech.settings.get_options.response",
          payload: {
            requestId: msg.requestId,
            options: this.getSpeechSettingsOptions?.() ?? EMPTY_SPEECH_SETTINGS_OPTIONS,
          },
        });
        return undefined;
      case "speech.tts.preview.request":
        this.handleTtsPreviewRequest(msg.requestId, msg.text, msg.voice);
        return undefined;
      case "speech.tts.speak.request":
        this.handleTtsSpeakRequest(msg.requestId, msg.text, msg.voice);
        return undefined;
      case "speech.tts.speak.cancel.request":
        this.voiceSession.cancelMessagePlayback();
        this.emit({
          type: "speech.tts.speak.cancel.response",
          payload: { requestId: msg.requestId },
        });
        return undefined;
      default:
        return undefined;
    }
  }

  // Synthesize a short preview sample and reply once (or with an error). Async
  // work is fire-and-forget: the correlated response is emitted from the
  // promise, mirroring how the get_stats request replies.
  private handleTtsPreviewRequest(
    requestId: string,
    text: string,
    voice: { name: string; model?: string } | undefined,
  ): void {
    const preview = this.previewTts;
    if (!preview) {
      this.emit({
        type: "speech.tts.preview.response",
        payload: { requestId, error: "TTS is not configured on this host." },
      });
      return;
    }
    void preview({ text, voice })
      .then((result) => {
        this.emit({
          type: "speech.tts.preview.response",
          payload: result
            ? { requestId, audio: result.audio, format: result.format }
            : { requestId, error: "No audio was produced for this voice." },
        });
        return undefined;
      })
      .catch((error: unknown) => {
        this.emit({
          type: "speech.tts.preview.response",
          payload: {
            requestId,
            error: error instanceof Error ? error.message : "Voice preview failed.",
          },
        });
      });
  }

  // Stream a full message aloud on demand (per-message playback button). Async
  // work is fire-and-forget; the correlated response is emitted from the promise
  // once playback finishes, is canceled, or errors - mirroring the preview path.
  private handleTtsSpeakRequest(
    requestId: string,
    text: string,
    voice?: { name: string; model?: string },
  ): void {
    void this.voiceSession
      .speakMessage(text, voice)
      .then((result) => {
        this.emit({
          type: "speech.tts.speak.response",
          payload: { requestId, ok: !result.canceled, canceled: result.canceled },
        });
        return undefined;
      })
      .catch((error: unknown) => {
        this.emit({
          type: "speech.tts.speak.response",
          payload: {
            requestId,
            error: error instanceof Error ? error.message : "Message playback failed.",
          },
        });
      });
  }

  private dispatchVisualizerMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    if (msg.type === "visualizer.voiceCues.generate.request") {
      this.handleVisualizerVoiceCuesRequest(
        msg.requestId,
        msg.name,
        msg.prompt,
        msg.cwd,
        msg.roles,
        msg.moment,
      );
    }
    return undefined;
  }

  private handleVisualizerVoiceCuesRequest(
    requestId: string,
    name: string,
    prompt: string | undefined,
    cwd: string | undefined,
    roles: string[] | undefined,
    moment: CueMoment | undefined,
  ): void {
    void this.voiceCueGenerator
      .generate({
        name,
        ...(prompt ? { prompt } : {}),
        ...(cwd ? { cwd } : {}),
        ...(roles && roles.length > 0 ? { roles } : {}),
        ...(moment ? { moment } : {}),
      })
      .then((cues) => {
        this.emit({
          type: "visualizer.voiceCues.generate.response",
          payload: cues
            ? { requestId, cues }
            : { requestId, error: "No voice cues could be generated for this personality." },
        });
        return undefined;
      })
      .catch((error: unknown) => {
        this.emit({
          type: "visualizer.voiceCues.generate.response",
          payload: {
            requestId,
            error: error instanceof Error ? error.message : "Voice cue generation failed.",
          },
        });
      });
  }

  private handlePersonalityProfileRequest(msg: {
    requestId: string;
    name: string;
    roles?: string[];
    glowA?: string;
    glowB?: string;
    cwd?: string;
  }): void {
    const { requestId } = msg;
    void this.personalityProfileGenerator
      .generate({
        name: msg.name,
        ...(msg.roles && msg.roles.length > 0 ? { roles: msg.roles } : {}),
        ...(msg.glowA ? { glowA: msg.glowA } : {}),
        ...(msg.glowB ? { glowB: msg.glowB } : {}),
        ...(msg.cwd ? { cwd: msg.cwd } : {}),
      })
      .then((profile) => {
        this.emit({
          type: "agentPersonalities.generate_profile.response",
          payload: profile
            ? { requestId, profile }
            : { requestId, error: "No personality profile could be generated on this host." },
        });
        return undefined;
      })
      .catch((error: unknown) => {
        this.emit({
          type: "agentPersonalities.generate_profile.response",
          payload: {
            requestId,
            error: error instanceof Error ? error.message : "Personality generation failed.",
          },
        });
      });
  }

  // Agents actively producing work in this cwd. Matching is by cwd, not
  // workspaceId, because a commit sweeps whatever those agents have written to
  // the shared working tree regardless of which workspace owns them.
  private listBusyAgentsForCwd(cwd: string): BusyWorkspaceAgent[] {
    return this.agentManager
      .listAgents()
      .filter(
        (agent) =>
          (agent.lifecycle === "running" || agent.lifecycle === "initializing") &&
          areEquivalentPaths(agent.cwd, cwd),
      )
      .map((agent) => ({ id: agent.id, title: agent.config.title ?? null }));
  }

  // eslint-disable-next-line complexity
  private dispatchCheckoutMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "checkout_status_request":
        return this.checkoutSession.handleStatusRequest(msg);
      case "checkout.commits.list.request":
        return this.checkoutSession.handleCommitsListRequest(msg);
      case "checkout.commits.file_diff.request":
        return this.checkoutSession.handleCommitFileDiffRequest(msg);
      case "validate_branch_request":
        return this.checkoutSession.handleValidateBranchRequest(msg);
      case "branch_suggestions_request":
        return this.checkoutSession.handleBranchSuggestionsRequest(msg);
      case "directory_suggestions_request":
        return this.handleDirectorySuggestionsRequest(msg);
      case "subscribe_checkout_diff_request":
        return this.checkoutSession.handleSubscribeDiffRequest(msg);
      case "unsubscribe_checkout_diff_request":
        this.checkoutSession.handleUnsubscribeDiffRequest(msg);
        return undefined;
      case "checkout_switch_branch_request":
        return this.checkoutSession.handleCheckoutSwitchBranchRequest(msg);
      case "checkout.rename_branch.request":
        return this.checkoutSession.handleCheckoutRenameBranchRequest(msg);
      case "checkout.discard_changes.request":
        return this.checkoutSession.handleCheckoutDiscardChangesRequest(msg);
      case "checkout_commit_request":
        return this.checkoutSession.handleCheckoutCommitRequest(msg);
      case "checkout.git.commit.request":
        return this.checkoutSession.handleCheckoutGitCommitRequest(msg);
      case "checkout.git.commit_agent.request":
        return this.checkoutSession.handleCheckoutGitCommitAgentRequest(msg);
      case "checkout.git.rollback.request":
        return this.checkoutSession.handleCheckoutGitRollbackRequest(msg);
      case "checkout.git.get_operation_log.request":
        return this.checkoutSession.handleCheckoutGitGetOperationLogRequest(msg);
      case "checkout.git.get_file_history.request":
        return this.checkoutSession.handleCheckoutGitFileHistoryRequest(msg);
      case "checkout.git.get_file_commit_diff.request":
        return this.checkoutSession.handleCheckoutGitFileCommitDiffRequest(msg);
      case "checkout.git.get_file_blame.request":
        return this.checkoutSession.handleCheckoutGitFileBlameRequest(msg);
      case "checkout.git.get_file_origin.request":
        return this.checkoutSession.handleCheckoutGitFileOriginRequest(msg);
      case "kanban.boards.list.request":
        return this.kanbanSession.handleBoardsListRequest(msg);
      case "kanban.board.get.request":
        return this.kanbanSession.handleBoardGetRequest(msg);
      case "kanban.card.move.request":
        return this.kanbanSession.handleCardMoveRequest(msg);
      case "kanban.card.create.request":
        return this.kanbanSession.handleCardCreateRequest(msg);
      case "kanban.task.link.request":
        return this.kanbanSession.handleTaskLinkRequest(msg);
      case "checkout_merge_request":
        return this.checkoutSession.handleCheckoutMergeRequest(msg);
      case "checkout_merge_from_base_request":
        return this.checkoutSession.handleCheckoutMergeFromBaseRequest(msg);
      case "checkout_pull_request":
        return this.checkoutSession.handleCheckoutPullRequest(msg);
      case "checkout_push_request":
        return this.checkoutSession.handleCheckoutPushRequest(msg);
      case "checkout.refresh.request":
        return this.checkoutSession.handleRefreshRequest(msg);
      case "checkout.git.fetch.request":
        return this.checkoutSession.handleFetchRequest(msg);
      case "checkout_pr_create_request":
        return this.checkoutSession.handleCheckoutPrCreateRequest(msg);
      case "checkout_pr_merge_request":
        return this.checkoutSession.handleCheckoutPrMergeRequest(msg);
      case "checkout.forge.set_auto_merge.request":
      case "checkout.github.set_auto_merge.request":
        return this.checkoutSession.handleCheckoutForgeSetAutoMergeRequest(msg);
      case "checkout.forge.get_check_details.request":
      case "checkout.github.get_check_details.request":
        return this.checkoutSession.handleCheckoutForgeGetCheckDetailsRequest(msg);
      case "checkout_pr_status_request":
        return this.checkoutSession.handleCheckoutPrStatusRequest(msg);
      case "pull_request_timeline_request":
        return this.checkoutSession.handlePullRequestTimelineRequest(msg);
      case "forge.search.request":
      case "github_search_request":
        return this.checkoutSession.handleForgeSearchRequest(msg);
      case "stash_save_request":
        return this.checkoutSession.handleStashSaveRequest(msg);
      case "stash_pop_request":
        return this.checkoutSession.handleStashPopRequest(msg);
      case "stash_list_request":
        return this.checkoutSession.handleStashListRequest(msg);
      default:
        return undefined;
    }
  }

  // Connection check for the host Git providers settings section: resolves a
  // provider's host-level credentials and performs a single forced auth probe.
  // User-initiated only - never called from polling or reconciliation paths.
  private async handleHostingAuthStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "hosting.auth_status.request" }>,
  ): Promise<void> {
    const { provider, requestId } = msg;
    const emitResult = (payload: { authenticated: boolean; error: string | null }) => {
      this.emit({
        type: "hosting.auth_status.response",
        payload: { provider, requestId, ...payload },
      });
    };

    if (!this.gitHostingResolver) {
      emitResult({ authenticated: false, error: "Hosting is unavailable" });
      return;
    }

    // The wire provider id is an open string; a request naming a provider this
    // build doesn't support resolves to no service rather than throwing.
    const providerId = normalizeGitHostingProviderId(provider);
    if (!providerId) {
      emitResult({ authenticated: false, error: null });
      return;
    }

    try {
      const resolved = this.gitHostingResolver.resolveForProvider(providerId);
      if (!resolved.service) {
        emitResult({ authenticated: false, error: null });
        return;
      }
      // gh reads global config; Bitbucket ignores cwd. ottoHome is a stable
      // directory for a provider-level (non-workspace) auth check.
      const authenticated = await resolved.service.isAuthenticated({
        cwd: this.ottoHome,
        force: true,
        reason: "hosting-auth-status",
      });
      emitResult({ authenticated, error: null });
    } catch (error) {
      emitResult({
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Host-level provider lookup shared by the repository/owner listing RPCs and
  // the scaffold service. Returns null for "not configured on this daemon" and
  // for a provider id this build doesn't know, which callers report as an empty
  // list rather than an error.
  private resolveHostingProviderService(provider: string): GitHostingService | null {
    if (!this.gitHostingResolver) {
      return null;
    }
    const providerId = normalizeGitHostingProviderId(provider);
    if (!providerId) {
      return null;
    }
    return this.gitHostingResolver.resolveForProvider(providerId).service ?? null;
  }

  private async handleHostingListRepositoriesRequest(
    msg: Extract<SessionInboundMessage, { type: "hosting.list_repositories.request" }>,
  ): Promise<void> {
    const { provider, requestId } = msg;
    const emitResult = (payload: {
      repositories: HostingRepositorySummary[];
      error: string | null;
    }) => {
      this.emit({
        type: "hosting.list_repositories.response",
        payload: { provider, requestId, ...payload },
      });
    };

    const service = this.resolveHostingProviderService(provider);
    if (!service?.listRepositories) {
      emitResult({ repositories: [], error: null });
      return;
    }

    try {
      const repositories = await service.listRepositories({
        query: msg.query,
        limit: msg.limit,
      });
      emitResult({ repositories, error: null });
    } catch (error) {
      this.sessionLogger.info({ err: error, provider }, "Hosting repository listing failed");
      emitResult({
        repositories: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleHostingListOwnersRequest(
    msg: Extract<SessionInboundMessage, { type: "hosting.list_owners.request" }>,
  ): Promise<void> {
    const { provider, requestId } = msg;
    const emitResult = (payload: { owners: HostingOwnerSummary[]; error: string | null }) => {
      this.emit({
        type: "hosting.list_owners.response",
        payload: { provider, requestId, ...payload },
      });
    };

    const service = this.resolveHostingProviderService(provider);
    if (!service?.listOwners) {
      emitResult({ owners: [], error: null });
      return;
    }

    try {
      emitResult({ owners: await service.listOwners(), error: null });
    } catch (error) {
      this.sessionLogger.info({ err: error, provider }, "Hosting owner listing failed");
      emitResult({ owners: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async handleProjectScaffoldRequest(
    request: Extract<SessionInboundMessage, { type: "project.scaffold.request" }>,
  ): Promise<void> {
    const { requestId } = request;
    const emitFailure = (input: {
      error: string;
      errorCode: ProjectScaffoldErrorCode | null;
      outcome: ProjectScaffoldOutcome | null;
    }) => {
      this.emit({
        type: "project.scaffold.response",
        payload: {
          requestId,
          project: null,
          path: input.outcome?.path ?? null,
          remoteUrl: input.outcome?.remoteUrl ?? null,
          error: input.error,
          errorCode: input.errorCode,
          steps: input.outcome?.steps ?? [],
        },
      });
    };

    const scaffold = createProjectScaffoldService({
      logger: this.sessionLogger,
      resolveHostingProvider: async (providerId) => this.resolveHostingProviderService(providerId),
      onProgress: (step) => {
        this.emit({
          type: "project.scaffold.progress",
          payload: {
            requestId,
            step: step.id,
            status: step.status,
            detail: step.detail,
          },
        });
      },
    });

    let outcome: ProjectScaffoldOutcome;
    try {
      outcome = await scaffold.scaffold({
        parentDirectory: expandTilde(request.parentDirectory),
        folderName: request.folderName,
        git: request.git,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project";
      this.sessionLogger.error(
        { err: error, parentDirectory: request.parentDirectory, gitKind: request.git.kind },
        "Project scaffold failed",
      );
      emitFailure({
        error: message,
        errorCode: error instanceof ProjectScaffoldError ? error.code : null,
        outcome: getScaffoldOutcome(error),
      });
      return;
    }

    // The directory exists and is what the user asked for; registering it is
    // the same find-or-create path `project.add` uses.
    const createdPath = outcome.path;
    if (!createdPath) {
      emitFailure({
        error: "Project directory was not created",
        errorCode: "register_failed",
        outcome,
      });
      return;
    }

    try {
      const project = await this.workspaceProvisioning.findOrCreateProjectForDirectory(createdPath);
      this.sessionLogger.info(
        { path: createdPath, projectId: project.projectId, gitKind: request.git.kind },
        "Project scaffolded",
      );
      this.emit({
        type: "project.scaffold.response",
        payload: {
          requestId,
          project: this.buildProjectDescriptor(project),
          path: createdPath,
          remoteUrl: outcome.remoteUrl,
          error: null,
          errorCode: null,
          // The service can't run this step (it owns no registry), so its
          // snapshot carries register_project as "skipped". Replace it rather
          // than appending, or the client sees the id twice.
          steps: [
            ...outcome.steps.filter((step) => step.id !== "register_project"),
            { id: "register_project", status: "done", detail: null },
          ],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register project";
      this.sessionLogger.error({ err: error, path: createdPath }, "Project registration failed");
      emitFailure({ error: message, errorCode: "register_failed", outcome });
    }
  }

  private dispatchPreviewMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "preview.list_config.request":
        return this.handlePreviewListConfigRequest(msg.cwd, msg.requestId);
      case "preview.start.request":
        return this.handlePreviewStartRequest(msg.cwd, msg.name, msg.requestId);
      case "preview.bind_tab.request":
        return this.handlePreviewBindTabRequest(msg.serverId, msg.browserId, msg.requestId);
      case "preview.stop.request":
        return this.handlePreviewStopRequest(msg.serverId, msg.requestId);
      default:
        return undefined;
    }
  }

  private dispatchWorktreeReattachMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "worktree.reattach.list.request":
        return this.handleWorktreeReattachListRequest(msg);
      case "worktree.reattach.request":
        return this.handleWorktreeReattachRequest(msg);
      default:
        return undefined;
    }
  }

  // Creating a project from nothing: the scaffold itself plus the host-level
  // hosting reads it needs (which owners you can create under, what you could
  // clone). Separate from dispatchWorkspaceAndProjectMessage, which handles
  // projects and workspaces that already exist on disk.
  private dispatchProjectRecordMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "project.add.request":
        return this.handleProjectAddRequest(msg);
      case "project.resolveWorkspaceForPath.request":
        return this.handleProjectResolveWorkspaceForPathRequest(msg);
      case "project.create_directory.request":
        return this.handleProjectCreateDirectoryRequest(msg);
      case "project.remove.request":
        return this.handleProjectRemoveRequest(msg);
      case "kanban.project.target.set.request":
        return this.handleKanbanProjectTargetSetRequest(msg);
      case "project.links.list.request":
        return this.handleProjectLinksListRequest(msg);
      case "project.links.set.request":
        return this.handleProjectLinksSetRequest(msg);
      case "project.links.unset.request":
        return this.handleProjectLinksUnsetRequest(msg);
      default:
        return this.dispatchProjectScaffoldMessage(msg);
    }
  }

  private dispatchProjectScaffoldMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "project.scaffold.request":
        return this.handleProjectScaffoldRequest(msg);
      case "hosting.list_repositories.request":
        return this.handleHostingListRepositoriesRequest(msg);
      case "hosting.list_owners.request":
        return this.handleHostingListOwnersRequest(msg);
      case "hosting.auth_status.request":
        return this.handleHostingAuthStatusRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchWorkspaceAndProjectMessage(
    msg: SessionInboundMessage,
  ): Promise<void> | undefined {
    switch (msg.type) {
      case "fetch_workspaces_request":
        return this.handleFetchWorkspacesRequest(msg);
      case "otto_worktree_list_request":
        return this.handleOttoWorktreeListRequest(msg);
      case "otto_worktree_archive_request":
        return this.handleOttoWorktreeArchiveRequest(msg);
      case "create_otto_worktree_request":
        return this.handleCreateOttoWorktreeRequest(msg);
      case "project.list.request":
        return this.handleProjectListRequest(msg.requestId);
      case "workspace_setup_status_request":
        return this.handleWorkspaceSetupStatusRequest(msg);
      // COMPAT(desktopEditorBridge): added in v0.1.88, remove after 2026-12-03 once old clients no longer call daemon editor RPCs.
      case "list_available_editors_request":
        return this.handleLegacyListAvailableEditorsRequest(msg);
      case "open_in_editor_request":
        return this.handleLegacyOpenInEditorRequest(msg);
      case "open_project_request":
        return this.handleOpenProjectRequest(msg);
      case "workspace.github.search_repositories.request":
        return this.handleWorkspaceGithubSearchRepositoriesRequest(msg);
      case "project.github.clone.request":
        return this.handleProjectGithubCloneRequest(msg);
      case "archive_workspace_request":
        return this.handleArchiveWorkspaceRequest(msg);
      case "workspace.archive.preflight.request":
        return this.handleWorkspaceArchivePreflightRequest(msg);
      case "worktree.baseRef.set.request":
        return this.handleWorktreeBaseRefSetRequest(msg);
      case "workspace.create.request":
        return this.handleWorkspaceCreateRequest(msg);
      case "workspace.clear_attention.request":
        return this.handleWorkspaceClearAttentionRequest(msg);
      case "workspace.title.set.request":
        return this.handleWorkspaceTitleSetRequest(msg.workspaceId, msg.title, msg.requestId);
      default:
        // Chained here rather than in dispatchInboundMessage: scaffolding and
        // project-record RPCs are the same domain, and the top-level chain is
        // already at its complexity ceiling.
        return this.dispatchProjectRecordMessage(msg);
    }
  }

  private dispatchWorkspaceFilesMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "workspace.pin.set.request":
        return this.handleWorkspacePinSetRequest(msg.workspaceId, msg.pinned, msg.requestId);
      default:
        return undefined;
    }
  }

  // This switch is the single routing table for legacy and namespaced file RPCs.
  // eslint-disable-next-line complexity
  private dispatchWorkspaceFileMessage(
    msg: SessionInboundMessage,
    source?: object,
  ): Promise<void> | undefined {
    switch (msg.type) {
      case "file_explorer_request":
        // `source` is load-bearing: file_explorer_request answers with binary
        // file-transfer frames, and those must reach only the socket that asked.
        // Two sockets can share one clientId, so broadcasting leaks another
        // tab's file bytes onto this one.
        return this.workspaceFilesSession.handleFileExplorerRequest(msg, source);
      // COMPAT(fsFileWatch): Paseo's namespaced watch RPCs map onto Otto's
      // file.watch.* handlers; same subscription, different wire name.
      case "fs.file.subscribe.request":
        this.fsFileWatchTargets.set(msg.subscriptionId, { cwd: msg.cwd, path: msg.path });
        return this.workspaceFilesSession.handleFileWatchSubscribeRequest({
          type: "file.watch.subscribe.request",
          cwd: msg.cwd,
          path: msg.path,
          requestId: msg.requestId,
        });
      case "fs.file.unsubscribe.request": {
        const target = this.fsFileWatchTargets.get(msg.subscriptionId);
        if (target) {
          this.fsFileWatchTargets.delete(msg.subscriptionId);
          this.workspaceFilesSession.handleFileWatchUnsubscribeRequest({
            type: "file.watch.unsubscribe.request",
            cwd: target.cwd,
            path: target.path,
            requestId: msg.requestId,
          });
        }
        return undefined;
      }
      // COMPAT(fsFileWrite): Paseo's namespaced write RPC carries `expectedRevision`
      // where Otto's `file.write.request` carries `expectedHash`; they name the same
      // optimistic-concurrency token, so map it onto the one handler rather than
      // forking the write path. Drop when the client floor no longer sends either.
      case "fs.file.write.request":
        return this.workspaceFilesSession.handleFileWriteRequest({
          type: "file.write.request",
          cwd: msg.cwd,
          path: msg.path,
          content: msg.content,
          expectedModifiedAt: msg.expectedModifiedAt,
          requestId: msg.requestId,
          ...(msg.expectedRevision ? { expectedHash: msg.expectedRevision } : {}),
        });
      case "project_icon_request":
        return this.workspaceFilesSession.handleProjectIconRequest(msg);
      case "file_download_token_request":
        return this.workspaceFilesSession.handleFileDownloadTokenRequest(msg);
      case "file.upload.request":
        this.workspaceFilesSession.handleFileUploadRequest(msg);
        return undefined;
      case "file.write.request":
        return this.workspaceFilesSession.handleFileWriteRequest(msg);
      case "fs.file.write_binary.request":
        return this.workspaceFilesSession.handleFsFileWriteBinaryRequest(msg);
      case "file.create.request":
        return this.workspaceFilesSession.handleFileCreateRequest(msg);
      case "file.delete.request":
        return this.workspaceFilesSession.handleFileDeleteRequest(msg);
      case "file.rename.request":
        return this.workspaceFilesSession.handleFileRenameRequest(msg);
      case "file.refine.request":
        return this.handleFileRefineRequest(msg);
      case "file.watch.subscribe.request":
        return this.workspaceFilesSession.handleFileWatchSubscribeRequest(msg);
      case "file.watch.unsubscribe.request":
        this.workspaceFilesSession.handleFileWatchUnsubscribeRequest(msg);
        return undefined;
      case "file.search.request":
        return this.workspaceFilesSession.handleFileSearchRequest(msg);
      case "file.replace.request":
        return this.workspaceFilesSession.handleFileReplaceRequest(msg);
      case "fs.entry.create.request":
        return this.workspaceFilesSession.handleFileEntryCreateRequest(msg);
      case "fs.entry.rename.request":
        return this.workspaceFilesSession.handleFileEntryRenameRequest(msg);
      case "fs.entry.duplicate.request":
        return this.workspaceFilesSession.handleFileEntryDuplicateRequest(msg);
      case "fs.entry.delete.request":
        return this.workspaceFilesSession.handleFileEntryDeleteRequest(msg);
      case "project.icon.get.request":
        return this.handleProjectIconGetRequest(msg.projectId, msg.requestId);
      default:
        return this.codeIntelligenceSession.dispatch(msg);
    }
  }

  private dispatchWorkspaceRecoveryMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "workspace.recovery.inspect.request":
        return this.handleWorkspaceRecoveryInspectRequest(msg);
      case "workspace.recovery.restore.request":
        return this.handleWorkspaceRecoveryRestoreRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchProviderMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    const projectKnowledgeMessage = this.projectKnowledgeSession.dispatch(msg);
    if (projectKnowledgeMessage) return projectKnowledgeMessage;
    const personalityMemoryMessage = this.dispatchPersonalityMemoryMessage(msg);
    if (personalityMemoryMessage) return personalityMemoryMessage;
    switch (msg.type) {
      case "list_provider_models_request":
        return this.providerCatalogSession.handleListProviderModelsRequest(msg);
      case "list_provider_modes_request":
        return this.providerCatalogSession.handleListProviderModesRequest(msg);
      case "list_provider_features_request":
        return this.providerCatalogSession.handleListProviderFeaturesRequest(msg);
      case "list_available_providers_request":
        return this.providerCatalogSession.handleListAvailableProvidersRequest(msg);
      case "get_providers_snapshot_request":
        return this.providerCatalogSession.handleGetProvidersSnapshotRequest(msg);
      case "refresh_providers_snapshot_request":
        return this.providerCatalogSession.handleRefreshProvidersSnapshotRequest(msg);
      case "provider_diagnostic_request":
        return this.providerCatalogSession.handleProviderDiagnosticRequest(msg);
      case "provider.usage.list.request":
        return this.providerCatalogSession.handleProviderUsageListRequest(msg);
      case "stats.activity.get.request":
        return this.handleStatsActivityGetRequest(msg);
      case "stats.activity.reset.request":
        return this.handleStatsActivityResetRequest(msg);
      case "usage.log.get.request":
        return this.handleUsageLogGetRequest(msg);
      case "context.report.get.request":
        return this.handleContextReportGetRequest(msg);
      case "context.prompt.preview.get.request":
        return this.handleContextPromptPreviewGetRequest(msg);
      case "context.edge.convert.request":
        return this.handleContextEdgeConvertRequest(msg);
      case "context.findings.fix.request":
        return this.handleContextFindingsFixRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchPersonalityMemoryMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "personality.memory.list.request":
        return this.handlePersonalityMemoryListRequest(msg);
      case "personality.memory.update.request":
        return this.handlePersonalityMemoryUpdateRequest(msg);
      case "personality.memory.transfer.request":
        return this.handlePersonalityMemoryTransferRequest(msg);
      case "personality.memory.stats.request":
        return this.handlePersonalityMemoryStatsRequest(msg);
      default:
        return undefined;
    }
  }

  private async handlePersonalityMemoryListRequest(
    msg: Extract<SessionInboundMessage, { type: "personality.memory.list.request" }>,
  ): Promise<void> {
    const emitEmpty = (): void => {
      this.emit({
        type: "personality.memory.list.response",
        payload: {
          requestId: msg.requestId,
          personalityId: msg.personalityId,
          personalityName: msg.personalityId,
          enabled: false,
          entries: [],
          brief: "",
          briefTokens: 0,
        },
      });
    };
    if (!this.personalityMemory) {
      emitEmpty();
      return;
    }
    try {
      // The daemon owns root resolution: a client computing it would disagree
      // the moment the workspace is a worktree, and then the brief shown here
      // would not be the brief that gets injected.
      const resolvedRoot = await this.resolveMemoryRequestRoot(msg);
      const view = await this.personalityMemory.view({
        personalityId: msg.personalityId,
        ...(resolvedRoot ? { projectRoot: resolvedRoot } : {}),
      });
      this.emit({
        type: "personality.memory.list.response",
        payload: {
          requestId: msg.requestId,
          personalityId: view.personalityId,
          personalityName: view.personalityName,
          enabled: view.enabled,
          // Mapped field-by-field rather than spread: the wire schema is
          // `.passthrough()`, so its inferred type carries an index signature the
          // domain type does not, and a spread would also leak any future
          // internal field onto the wire by accident.
          entries: view.entries.map((entry) => ({
            id: entry.id,
            text: entry.text,
            scope: entry.scope,
            ...(entry.projectRoot ? { projectRoot: entry.projectRoot } : {}),
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            source: entry.source,
            ...(entry.reinforcedCount !== undefined
              ? { reinforcedCount: entry.reinforcedCount }
              : {}),
            ...(entry.transferredFrom ? { transferredFrom: entry.transferredFrom } : {}),
          })),
          // The exact injected text, never a reconstruction - the whole point of
          // the visibility requirement is that these two cannot differ.
          brief: view.brief.text,
          briefTokens: view.brief.estTokens,
          briefOmittedCount: view.brief.omittedCount,
          // The root the entries above were filtered against, so the UI can say
          // which project-scoped rows actually apply here.
          ...(resolvedRoot ? { projectRoot: resolvedRoot } : {}),
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to list personality memory");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to read personality memory: ${err.message}`,
          code: "personality_memory_list_failed",
        },
      });
    }
  }

  /**
   * The project a memory request is about. Shared by the read and the write
   * paths on purpose: the brief filters project entries by comparing roots, so
   * if a write bound a different root than the read resolves, the entry would be
   * listed and never injected. One resolver means they cannot disagree.
   */
  private async resolveMemoryRequestRoot(request: {
    workspaceId?: string;
    projectRoot?: string;
  }): Promise<string | undefined> {
    const cwd =
      (request.workspaceId
        ? (await this.workspaceRegistry.get(request.workspaceId))?.cwd
        : undefined) ?? request.projectRoot;
    return cwd ? await this.resolveMemoryProjectRoot(cwd) : undefined;
  }

  /**
   * The repo root a cwd belongs to, so a worktree and its main checkout share
   * one project's lessons - the same resolution the spawn path uses.
   */
  private async resolveMemoryProjectRoot(cwd: string): Promise<string> {
    try {
      return await this.workspaceGitService.resolveRepoRoot(cwd);
    } catch {
      // A non-git directory is ordinary, not an error: the cwd IS the project.
      return cwd;
    }
  }

  private async handlePersonalityMemoryUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "personality.memory.update.request" }>,
  ): Promise<void> {
    const respond = (ok: boolean, error?: string): void => {
      this.emit({
        type: "personality.memory.update.response",
        payload: { requestId: msg.requestId, ok, ...(error ? { error } : {}) },
      });
    };
    if (!this.personalityMemory) {
      respond(false, "This host does not support personality memory.");
      return;
    }
    // Scope rides the wire as a plain string for forward compat, so an
    // unrecognized value is dropped here rather than trusted downstream.
    const scope = readPersonalityMemoryScope(msg.scope);
    try {
      const resolvedRoot = await this.resolveMemoryRequestRoot(msg);
      // A project-scoped lesson with no root belongs to no project, so it can
      // never appear in any brief. Storing it would be the worst outcome: the
      // Memory tab would list it while the injection quietly ignored it.
      if (scope === "project" && !resolvedRoot && !msg.drop) {
        respond(false, "Otto could not tell which project this lesson belongs to.");
        return;
      }
      if (!msg.entryId) {
        const text = msg.text?.trim();
        if (!text) {
          respond(false, "A lesson needs some text.");
          return;
        }
        await this.personalityMemory.addUserEntry({
          personalityId: msg.personalityId,
          text,
          scope: scope ?? "global",
          ...(resolvedRoot ? { projectRoot: resolvedRoot } : {}),
        });
        respond(true);
        return;
      }
      const applied = await this.personalityMemory.revise({
        personalityId: msg.personalityId,
        entryId: msg.entryId,
        ...(msg.text !== undefined ? { text: msg.text } : {}),
        ...(scope ? { scope } : {}),
        ...(resolvedRoot ? { projectRoot: resolvedRoot } : {}),
        ...(msg.drop ? { drop: true } : {}),
      });
      respond(applied, applied ? undefined : "That lesson no longer exists.");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to update personality memory");
      respond(false, err.message);
    }
  }

  private async handlePersonalityMemoryTransferRequest(
    msg: Extract<SessionInboundMessage, { type: "personality.memory.transfer.request" }>,
  ): Promise<void> {
    const respond = (payload: {
      ok: boolean;
      transferred?: number;
      merged?: number;
      error?: string;
    }): void => {
      this.emit({
        type: "personality.memory.transfer.response",
        payload: { requestId: msg.requestId, ...payload },
      });
    };
    if (!this.personalityMemory) {
      respond({ ok: false, error: "This host does not support personality memory." });
      return;
    }
    try {
      if (msg.mode === "delete") {
        await this.personalityMemory.clear(msg.fromPersonalityId);
        respond({ ok: true, transferred: 0, merged: 0 });
        return;
      }
      if (msg.mode !== "transfer") {
        respond({ ok: false, error: `Unknown transfer mode "${msg.mode}".` });
        return;
      }
      if (!msg.toPersonalityId) {
        respond({ ok: false, error: "A transfer needs a destination personality." });
        return;
      }
      if (msg.toPersonalityId === msg.fromPersonalityId) {
        respond({ ok: false, error: "A personality cannot receive its own lessons." });
        return;
      }
      const result = await this.personalityMemory.transfer({
        fromPersonalityId: msg.fromPersonalityId,
        toPersonalityId: msg.toPersonalityId,
      });
      respond({ ok: true, ...result });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to transfer personality memory");
      respond({ ok: false, error: err.message });
    }
  }

  private async handlePersonalityMemoryStatsRequest(
    msg: Extract<SessionInboundMessage, { type: "personality.memory.stats.request" }>,
  ): Promise<void> {
    const counts = this.personalityMemory ? await this.personalityMemory.counts() : {};
    this.emit({
      type: "personality.memory.stats.response",
      payload: { requestId: msg.requestId, counts },
    });
  }

  private async handleContextReportGetRequest(
    msg: Extract<SessionInboundMessage, { type: "context.report.get.request" }>,
  ): Promise<void> {
    try {
      const report = await this.contextManagement.getReport({
        workspaceId: msg.workspaceId,
        ...(msg.provider ? { provider: msg.provider } : {}),
        ...(typeof msg.windowTokens === "number" ? { windowTokens: msg.windowTokens } : {}),
        ...(msg.personalityId ? { personalityId: msg.personalityId } : {}),
      });
      this.emit({
        type: "context.report.get.response",
        payload: { requestId: msg.requestId, report },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to build context report");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to build context report: ${err.message}`,
          code: "context_report_get_failed",
        },
      });
    }
  }

  /**
   * The assembled prompt, for reading. Shares the report's what-if inputs so the
   * preview always shows the same provider, window and personality the numbers
   * on screen were computed for.
   */
  private async handleContextPromptPreviewGetRequest(
    msg: Extract<SessionInboundMessage, { type: "context.prompt.preview.get.request" }>,
  ): Promise<void> {
    try {
      const preview = await this.contextManagement.getPromptPreview({
        workspaceId: msg.workspaceId,
        ...(msg.provider ? { provider: msg.provider } : {}),
        ...(typeof msg.windowTokens === "number" ? { windowTokens: msg.windowTokens } : {}),
        ...(msg.personalityId ? { personalityId: msg.personalityId } : {}),
        ...(msg.category ? { category: msg.category } : {}),
      });
      this.emit({
        type: "context.prompt.preview.get.response",
        payload: { requestId: msg.requestId, preview },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to assemble context prompt preview");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to assemble prompt preview: ${err.message}`,
          code: "context_prompt_preview_get_failed",
        },
      });
    }
  }

  private async handleContextEdgeConvertRequest(
    msg: Extract<SessionInboundMessage, { type: "context.edge.convert.request" }>,
  ): Promise<void> {
    const respond = (ok: boolean, error?: string): void => {
      this.emit({
        type: "context.edge.convert.response",
        payload: { requestId: msg.requestId, ok, ...(error ? { error } : {}) },
      });
    };
    try {
      const result = await convertEdge({
        filePath: msg.filePath,
        rawTarget: msg.rawTarget,
        range: msg.range,
        target: msg.target,
      });
      if (result.ok) {
        // The graph changed under every cached window/provider combination.
        this.contextManagement.invalidate(msg.workspaceId);
        await this.pushContextReport(msg.workspaceId);
        respond(true);
        return;
      }
      respond(false, result.error);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to convert context edge");
      respond(false, err.message);
    }
  }

  private async handleContextFindingsFixRequest(
    msg: Extract<SessionInboundMessage, { type: "context.findings.fix.request" }>,
  ): Promise<void> {
    try {
      const result = await fixFindings(msg.findings);
      if (result.fixedCount > 0) {
        // Every fixed finding rewrote a file the graph was built from.
        this.contextManagement.invalidate(msg.workspaceId);
        await this.pushContextReport(msg.workspaceId);
      }
      this.emit({
        type: "context.findings.fix.response",
        payload: {
          requestId: msg.requestId,
          fixedCount: result.fixedCount,
          failedCount: result.failedCount,
          errors: result.errors,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to fix context findings");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to fix context findings: ${err.message}`,
          code: "context_findings_fix_failed",
        },
      });
    }
  }

  /** Pushes the freshly-scanned report so open clients reconcile immediately. */
  private async pushContextReport(workspaceId: string): Promise<void> {
    try {
      const report = await this.contextManagement.getReport({ workspaceId });
      this.emit({ type: "context_report_changed", payload: { workspaceId, report } });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.warn({ err, workspaceId }, "Failed to push context report");
    }
  }

  private async handleUsageLogGetRequest(
    msg: Extract<SessionInboundMessage, { type: "usage.log.get.request" }>,
  ): Promise<void> {
    try {
      const page = (await this.getUsageLogPage?.({
        ...(typeof msg.limit === "number" ? { limit: msg.limit } : {}),
        ...(typeof msg.before === "number" ? { before: msg.before } : {}),
      })) ?? { events: [], hasMore: false };
      this.emit({
        type: "usage.log.get.response",
        payload: {
          requestId: msg.requestId,
          events: page.events,
          hasMore: page.hasMore,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to get usage log");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to get usage log: ${err.message}`,
          code: "usage_log_get_failed",
        },
      });
    }
  }

  private async handleStatsActivityGetRequest(
    msg: Extract<SessionInboundMessage, { type: "stats.activity.get.request" }>,
  ): Promise<void> {
    const zero = ActivityCountersSchema.parse({});
    try {
      const rollups = (await this.getActivityRollups?.()) ?? {
        today: zero,
        yesterday: zero,
        last7Days: zero,
        last30Days: zero,
        allTime: zero,
      };
      this.emit({
        type: "stats.activity.get.response",
        payload: {
          requestId: msg.requestId,
          ...rollups,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to get activity stats");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to get activity stats: ${err.message}`,
          code: "stats_activity_get_failed",
        },
      });
    }
  }

  private async handleStatsActivityResetRequest(
    msg: Extract<SessionInboundMessage, { type: "stats.activity.reset.request" }>,
  ): Promise<void> {
    try {
      await this.resetActivityStats?.();
      this.emit({
        type: "stats.activity.reset.response",
        payload: { requestId: msg.requestId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err }, "Failed to reset activity stats");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to reset activity stats: ${err.message}`,
          code: "stats_activity_reset_failed",
        },
      });
    }
  }

  private dispatchTerminalMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "start_workspace_script_request":
        return this.handleStartWorkspaceScriptRequest(msg);
      case "workspace.script.list.request":
        return this.handleWorkspaceScriptListRequest(msg);
      case "workspace.script.start.request":
        return this.handleWorkspaceScriptStartRequest(msg);
      case "workspace.script.stop.request":
        return this.handleWorkspaceScriptStopRequest(msg);
      default:
        return this.terminalController.dispatch(msg);
    }
  }

  private dispatchScheduleMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "schedule/create":
        return this.scheduleSession.handleScheduleCreateRequest(msg);
      case "schedule/list":
        return this.scheduleSession.handleScheduleListRequest(msg);
      case "schedule/inspect":
        return this.scheduleSession.handleScheduleInspectRequest(msg);
      case "schedule/logs":
        return this.scheduleSession.handleScheduleLogsRequest(msg);
      case "schedule/pause":
        return this.scheduleSession.handleSchedulePauseRequest(msg);
      case "schedule/resume":
        return this.scheduleSession.handleScheduleResumeRequest(msg);
      case "schedule/delete":
        return this.scheduleSession.handleScheduleDeleteRequest(msg);
      case "schedule/run-once":
        return this.scheduleSession.handleScheduleRunOnceRequest(msg);
      case "schedule/update":
        return this.scheduleSession.handleScheduleUpdateRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchArtifactMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "artifact.list.request":
        return this.artifactSession.handleArtifactListRequest(msg);
      case "artifact.create.request":
        return this.artifactSession.handleArtifactCreateRequest(msg);
      case "artifact.update.request":
        return this.artifactSession.handleArtifactUpdateRequest(msg);
      case "artifact.regenerate.request":
        return this.artifactSession.handleArtifactRegenerateRequest(msg);
      case "artifact.cancel.request":
        return this.artifactSession.handleArtifactCancelRequest(msg);
      case "artifact.delete.request":
        return this.artifactSession.handleArtifactDeleteRequest(msg);
      case "artifact.star.request":
        return this.artifactSession.handleArtifactStarRequest(msg);
      case "artifact.get-content.request":
        return this.artifactSession.handleArtifactGetContentRequest(msg);
      default:
        return undefined;
    }
  }

  // Host-level messages without a dedicated session remain centralized here.
  // eslint-disable-next-line complexity
  private async dispatchMiscMessage(msg: SessionInboundMessage): Promise<void> {
    // Brain model/runtime management is a self-contained family; handle it in a
    // dedicated dispatcher so this method stays under the complexity ceiling.
    if (await this.dispatchBrainManageMessage(msg)) {
      return;
    }
    if (await this.dispatchBrainConsoleMessage(msg)) {
      return;
    }
    switch (msg.type) {
      case "list_commands_request":
        await this.handleListCommandsRequest(msg);
        return;
      case "agent.context.get_usage.request":
        await this.handleAgentContextGetUsageRequest(msg);
        return;
      case "register_push_token":
        this.handleRegisterPushToken(msg.token);
        return;
      case "push.unregister.request":
        this.pushNotifications.revoke(msg.token);
        if (this.registeredPushToken?.trim() === msg.token.trim()) {
          this.registeredPushToken = null;
        }
        this.emit({
          type: "push.unregister.response",
          payload: { requestId: msg.requestId },
        });
        return;
      // Host-level disk the agents filled - no per-agent or per-workspace
      // family to belong to, so it lands here rather than growing the dispatch
      // chain. Both are synchronous: a directory listing, not IO worth awaiting.
      case "attachments.images.get_stats.request":
        this.handleAttachmentsImagesStatsRequest(msg);
        return;
      case "history.agents.get_storage_stats.request":
        await this.handleHistoryAgentsStorageStatsRequest(msg);
        return;
      case "attachments.images.clear.request":
        this.handleAttachmentsImagesClearRequest(msg);
        return;
      // Local AI host (otto-brain) lifecycle. Daemon-level, with no per-agent or
      // per-workspace family to belong to, so it lands here rather than growing
      // the dispatch chain.
      case "brain.host.status.request":
        await this.brainSession.handleBrainHostStatusRequest(msg.requestId, msg.resources);
        return;
      case "brain.host.start.request":
        await this.brainSession.handleBrainHostStartRequest(msg.model, msg.requestId);
        return;
      case "brain.host.stop.request":
        await this.brainSession.handleBrainHostStopRequest(msg.requestId);
        return;
      case "brain.host.restart.request":
        await this.brainSession.handleBrainHostRestartRequest(msg.model, msg.requestId);
        return;
      case "brain.evals.get.request":
        await this.brainSession.handleBrainEvalsGetRequest(msg.requestId);
        return;
      case "brain.network.discover.request":
        await this.brainSession.handleBrainNetworkDiscoverRequest(msg.requestId);
        return;
      case "brain.models.list.request":
        await this.brainSession.handleBrainModelsListRequest(msg.requestId);
        return;
      case "brain.remote.config.get.request":
        await this.brainSession.handleBrainRemoteConfigGetRequest(msg.requestId);
        return;
      case "brain.remote.config.patch.request":
        await this.brainSession.handleBrainRemoteConfigPatchRequest(msg.patch, msg.requestId);
        return;
    }
  }

  // Brain model/runtime management dispatch. Returns true when it handled `msg`,
  // false to let dispatchMiscMessage try the rest.
  private async dispatchBrainManageMessage(msg: SessionInboundMessage): Promise<boolean> {
    switch (msg.type) {
      case "brain.models.scan.request":
        await this.brainSession.handleBrainModelsScanRequest(msg.requestId);
        return true;
      case "brain.catalog.list.request":
        await this.brainSession.handleBrainCatalogListRequest(msg.requestId);
        return true;
      case "brain.runtime.list.request":
        await this.brainSession.handleBrainRuntimeListRequest(msg.requestId);
        return true;
      case "brain.models.pull.request":
        this.brainSession.handleBrainModelsPullRequest(
          msg.model,
          msg.components,
          msg.quant,
          msg.expectedBytes,
          msg.requestId,
        );
        return true;
      case "brain.hf.search.request":
        await this.brainSession.handleBrainHfSearchRequest(msg.query, msg.limit, msg.requestId);
        return true;
      case "brain.hf.quants.request":
        await this.brainSession.handleBrainHfQuantsRequest(msg.repo, msg.requestId);
        return true;
      case "brain.models.add.request":
        this.brainSession.handleBrainModelsAddRequest(
          msg.repo,
          msg.quant,
          msg.components,
          msg.expectedBytes,
          msg.requestId,
        );
        return true;
      case "brain.runtime.install.request":
        this.brainSession.handleBrainRuntimeInstallRequest(msg.build, msg.requestId);
        return true;
      case "brain.runtime.remove.request":
        this.brainSession.handleBrainRuntimeRemoveRequest(msg.name, msg.requestId);
        return true;
      case "brain.calibrate.request":
        this.brainSession.handleBrainCalibrateRequest(msg.model, msg.requestId);
        return true;
      case "brain.sweep.request":
        this.brainSession.handleBrainSweepRequest(msg.model, msg.requestId);
        return true;
      case "brain.bench.request":
        this.brainSession.handleBrainBenchRequest(msg.model, msg.requestId);
        return true;
      case "brain.jobs.list.request":
        await this.brainSession.handleBrainJobsListRequest(msg.requestId);
        return true;
      case "brain.jobs.cancel.request":
        await this.brainSession.handleBrainJobsCancelRequest(msg.jobId, msg.requestId);
        return true;
      default:
        return false;
    }
  }

  // Brain Console dispatch: the RPCs that proxy the brain's own /__host/*
  // management API. Kept separate from the manage/job family above because they
  // reach the brain a different way (HTTP proxy, not a CLI shell-out) and so
  // work against a remote brain, and because one switch over both families
  // exceeds the complexity ceiling.
  private async dispatchBrainConsoleMessage(msg: SessionInboundMessage): Promise<boolean> {
    switch (msg.type) {
      case "brain.models.inventory.request":
        await this.brainSession.handleBrainModelsInventoryRequest(msg.requestId);
        return true;
      case "brain.model.profile.get.request":
        await this.brainSession.handleBrainModelProfileGetRequest(msg.modelId, msg.requestId);
        return true;
      case "brain.model.profile.set.request":
        await this.brainSession.handleBrainModelProfileSetRequest(
          msg.modelId,
          msg.patch,
          msg.requestId,
        );
        return true;
      case "brain.model.budget.get.request":
        await this.brainSession.handleBrainModelBudgetGetRequest(
          msg.modelId,
          msg.overrides,
          msg.requestId,
        );
        return true;
      case "brain.model.load.request":
        await this.brainSession.handleBrainModelLoadRequest(msg.modelId, msg.requestId);
        return true;
      case "brain.model.unload.request":
        await this.brainSession.handleBrainModelUnloadRequest(msg.requestId);
        return true;
      case "brain.model.delete.request":
        await this.brainSession.handleBrainModelDeleteRequest(msg.modelId, msg.requestId);
        return true;
      case "brain.model.component.delete.request":
        await this.brainSession.handleBrainModelComponentDeleteRequest(
          msg.modelId,
          msg.componentId,
          msg.requestId,
        );
        return true;
      case "brain.model.rename.request":
        await this.brainSession.handleBrainModelRenameRequest(
          msg.modelId,
          msg.displayName,
          msg.requestId,
        );
        return true;
      case "brain.model.rename.reset.request":
        await this.brainSession.handleBrainModelRenameResetRequest(msg.modelId, msg.requestId);
        return true;
      case "brain.logs.tail.request":
        await this.brainSession.handleBrainLogsTailRequest(msg.limit, msg.requestId);
        return true;
      default:
        return false;
    }
  }

  public resetPeakInflight(): void {
    this.peakInflightRequests = this.inflightRequests;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public async handleBinaryFrame(binaryFrame: BinaryFrame): Promise<void> {
    if (binaryFrame.kind === "file_transfer") {
      await this.workspaceFilesSession.handleFileTransferFrame(binaryFrame.frame);
      return;
    }
    this.terminalController.handleBinaryFrame(binaryFrame.frame);
  }

  private async handleRestartServerRequest(requestId: string, reason?: string): Promise<void> {
    const lifecycleReason = normalizeClientRestartRpcReason(reason);
    const payload: { status: string } & Record<string, unknown> = {
      status: "restart_requested",
      clientId: this.clientId,
    };
    if (reason && reason.trim().length > 0) {
      payload.reason = reason;
    }
    payload.requestId = requestId;

    this.sessionLogger.warn({ reason: lifecycleReason }, "Restart requested via websocket");
    this.emit({
      type: "status",
      payload,
    });

    this.emitLifecycleIntent({
      type: "restart",
      clientId: this.clientId,
      requestId,
      reason: lifecycleReason,
    });
  }

  private async handleShutdownServerRequest(requestId: string): Promise<void> {
    const reason = CLIENT_SHUTDOWN_RPC_REASON;
    this.sessionLogger.warn({ reason }, "Shutdown requested via websocket");
    this.emit({
      type: "status",
      payload: {
        status: "shutdown_requested",
        clientId: this.clientId,
        requestId,
      },
    });

    this.emitLifecycleIntent({
      type: "shutdown",
      clientId: this.clientId,
      requestId,
      reason,
    });
  }

  private emitLifecycleIntent(intent: SessionLifecycleIntent): void {
    if (!this.onLifecycleIntent) {
      return;
    }
    try {
      this.onLifecycleIntent(intent);
    } catch (error) {
      this.sessionLogger.error({ err: error, intent }, "Lifecycle intent handler failed");
    }
  }

  /**
   * Hard-delete one chat's Otto record: fence, close the runtime, drain queued
   * persistence, unlink the JSON, drop the committed timeline. Shared by the
   * single-row `delete_agent_request` and the bulk archived sweep, so the two can
   * never diverge on what "delete" means.
   *
   * It deletes **Otto's record only.** The provider's own transcript on disk
   * (Claude's `<projects>/<sessionId>.jsonl` and its sibling subagent tree, Codex
   * threads, OpenCode sessions) is left in place by design - Otto never created
   * it, `claude --resume` still reads it, and deleting another tool's state is
   * not ours to do. The UI discloses that rather than staying silent about it.
   * See docs/chat-lifecycle.md - Delete.
   *
   * Returns the workspace id the record belonged to, so the caller can refresh
   * workspace counts once per affected workspace instead of once per chat.
   */
  private async deleteAgentRecord(agentId: string): Promise<string | null> {
    const knownWorkspaceId =
      this.agentManager.getAgent(agentId)?.workspaceId ??
      (await this.agentStorage.get(agentId))?.workspaceId ??
      null;

    // File-backed storage still needs an early delete fence before closeAgent().
    beginAgentDeleteIfSupported(this.agentStorage, agentId);

    try {
      await closeAgentCommand({ agentManager: this.agentManager }, agentId);
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, agentId },
        `Failed to close agent ${agentId} during delete`,
      );
    }

    // Drain queued persistence from the just-closed agent before removing its
    // durable snapshot, otherwise an in-flight background write can recreate it.
    await this.agentManager.flush();

    await this.agentStorage.remove(agentId);
    await this.agentManager.deleteCommittedTimeline(agentId);

    await this.agentUpdates.removeAgent(agentId);

    return knownWorkspaceId;
  }

  private async handleDeleteAgentRequest(agentId: string, requestId: string): Promise<void> {
    this.sessionLogger.info({ agentId }, `Deleting agent ${agentId} from registry`);

    let knownWorkspaceId: string | null = null;
    try {
      knownWorkspaceId = await this.deleteAgentRecord(agentId);
      await this.agentManager.deleteAgentState(agentId);
    } catch (error) {
      this.sessionLogger.error({ err: error, agentId }, `Failed to fully delete agent ${agentId}`);
    }

    this.emit({
      type: "agent_deleted",
      payload: {
        agentId,
        requestId,
      },
    });

    if (knownWorkspaceId) {
      await this.emitWorkspaceUpdateForWorkspaceId(knownWorkspaceId);
    }
  }

  /**
   * Bulk clear of archived chats. Server-side because the client's history list
   * is cursor-paginated across hosts and never holds the whole archived set, so
   * a client-side loop would silently clear only the pages it happened to have.
   *
   * `dryRun` exists so the confirm dialog can quote a real number back to the
   * user before anything is destroyed. Same rule as the single delete: Otto's
   * records only, never a provider's transcript - clearing in bulk is not a back
   * door around that.
   */
  private async handleHistoryAgentsClearArchivedRequest(
    msg: Extract<SessionInboundMessage, { type: "history.agents.clear_archived.request" }>,
  ): Promise<void> {
    const emitResult = (payload: {
      matched: number;
      deleted: number;
      failed: number;
      agentIds: string[];
      error: string | null;
      ottoBytes?: number;
      reclaimedBytes?: number;
    }) => {
      this.emit({
        type: "history.agents.clear_archived.response",
        payload: { ...payload, dryRun: msg.dryRun, requestId: msg.requestId },
      });
    };

    let agentIds: string[];
    let records: StoredAgentRecord[];
    try {
      records = await this.agentStorage.list();
      agentIds = selectArchivedForDeletion({
        records,
        olderThanDays: msg.olderThanDays,
        now: Date.now(),
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to list archived chats");
      this.sessionLogger.error({ err: error, requestId: msg.requestId }, message);
      emitResult({ matched: 0, deleted: 0, failed: 0, agentIds: [], error: message });
      return;
    }

    const ottoBytes = await Promise.all(
      records
        .filter((record) => agentIds.includes(record.id))
        .map(async (record) => record.archiveBytes ?? this.agentStorage.getRecordBytes(record.id)),
    ).then((values) => values.reduce((sum, value) => sum + value, 0));

    if (msg.dryRun) {
      emitResult({
        matched: agentIds.length,
        deleted: 0,
        failed: 0,
        agentIds: [],
        error: null,
        ottoBytes,
        reclaimedBytes: ottoBytes,
      });
      return;
    }

    this.sessionLogger.info(
      { count: agentIds.length, olderThanDays: msg.olderThanDays, requestId: msg.requestId },
      "Clearing archived chat records",
    );

    // Sequential on purpose: each delete closes a runtime, flushes the agent
    // manager, and unlinks files. Hundreds of those in parallel would thrash the
    // shared write queue for no wall-clock gain on a rare, explicit action.
    const deleted: string[] = [];
    const affectedWorkspaceIds = new Set<string>();
    let failed = 0;
    for (const agentId of agentIds) {
      try {
        const record = await this.agentStorage.get(agentId);
        if (!record) throw new Error("Archived chat record disappeared before cleanup");
        const workspaceId = await this.deleteAgentRecord(agentId);
        deleted.push(agentId);
        if (workspaceId) {
          affectedWorkspaceIds.add(workspaceId);
        }
      } catch (error) {
        failed += 1;
        this.sessionLogger.warn(
          { err: error, agentId, requestId: msg.requestId },
          "Failed to delete archived chat during clear",
        );
      }
    }

    emitResult({
      matched: agentIds.length,
      deleted: deleted.length,
      failed,
      agentIds: deleted,
      error: null,
      ottoBytes,
      reclaimedBytes: ottoBytes,
    });

    await this.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds);
  }

  private async handleArchiveAgentRequest(agentId: string, requestId: string): Promise<void> {
    this.sessionLogger.info({ agentId }, `Archiving agent ${agentId}`);

    const { archivedAt } = await this.archiveAgentForClose(agentId);

    this.emit({
      type: "agent_archived",
      payload: {
        agentId,
        archivedAt,
        requestId,
      },
    });
  }

  /**
   * The Storage readout: how much disk the images agents produced occupy, and
   * the policy currently ageing them out. Synchronous fs work on a directory of
   * a few thousand entries, so it runs inline rather than through a worker.
   * See docs/attachment-lifecycle.md.
   */
  private handleAttachmentsImagesStatsRequest(
    msg: Extract<SessionInboundMessage, { type: "attachments.images.get_stats.request" }>,
  ): void {
    const config = this.daemonConfigStore.get();
    try {
      const stats = readMaterializedImageStats(this.ottoHome);
      this.emit({
        type: "attachments.images.get_stats.response",
        payload: {
          fileCount: stats.fileCount,
          totalBytes: stats.totalBytes,
          oldestAt: stats.oldestAtMs === null ? null : new Date(stats.oldestAtMs).toISOString(),
          maxAgeDays: config.attachmentImageMaxAgeDays,
          maxTotalMb: config.attachmentImageMaxTotalMb,
          error: null,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to read attachment image storage");
      this.sessionLogger.error({ err: error, requestId: msg.requestId }, message);
      this.emit({
        type: "attachments.images.get_stats.response",
        payload: {
          fileCount: 0,
          totalBytes: 0,
          oldestAt: null,
          maxAgeDays: config.attachmentImageMaxAgeDays,
          maxTotalMb: config.attachmentImageMaxTotalMb,
          error: message,
          requestId: msg.requestId,
        },
      });
    }
  }

  private async handleHistoryAgentsStorageStatsRequest(
    msg: Extract<SessionInboundMessage, { type: "history.agents.get_storage_stats.request" }>,
  ): Promise<void> {
    try {
      const baseDir = join(this.ottoHome, "agents");
      const entries = await readdir(baseDir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          files.push(join(baseDir, entry.name));
        } else if (entry.isDirectory()) {
          const children = await readdir(join(baseDir, entry.name), { withFileTypes: true });
          files.push(
            ...children
              .filter((child) => child.isFile() && child.name.endsWith(".json"))
              .map((child) => join(baseDir, entry.name, child.name)),
          );
        }
      }
      let archivedCount = 0;
      let totalBytes = 0;
      await Promise.all(
        files.map(async (filePath) => {
          try {
            const record = JSON.parse(await readFile(filePath, "utf8")) as {
              archivedAt?: string | null;
            };
            if (record.archivedAt) {
              archivedCount += 1;
              totalBytes += (await stat(filePath)).size;
            }
          } catch {
            // Match AgentStorage's best-effort handling of invalid records.
          }
        }),
      );
      this.emit({
        type: "history.agents.get_storage_stats.response",
        payload: { archivedCount, totalBytes, error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.emit({
        type: "history.agents.get_storage_stats.response",
        payload: {
          archivedCount: 0,
          totalBytes: 0,
          error: getErrorMessageOr(error, "Failed to read history storage"),
          requestId: msg.requestId,
        },
      });
    }
  }

  /**
   * Reclaim, dry-run by default. A cleared image is not recoverable and the
   * message that referenced it falls back to alt text, so the client previews
   * first and quotes the real count and size back before committing - the same
   * contract as `history.agents.clear_archived`.
   */
  private handleAttachmentsImagesClearRequest(
    msg: Extract<SessionInboundMessage, { type: "attachments.images.clear.request" }>,
  ): void {
    try {
      const result = clearMaterializedProviderImages({
        ottoHome: this.ottoHome,
        olderThanDays: msg.olderThanDays,
        dryRun: msg.dryRun,
      });

      if (!msg.dryRun) {
        this.sessionLogger.info(
          {
            deleted: result.deleted,
            freedBytes: result.freedBytes,
            olderThanDays: msg.olderThanDays,
            requestId: msg.requestId,
          },
          "Cleared materialized attachment images",
        );
      }

      this.emit({
        type: "attachments.images.clear.response",
        payload: { ...result, dryRun: msg.dryRun, error: null, requestId: msg.requestId },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to clear attachment image storage");
      this.sessionLogger.error({ err: error, requestId: msg.requestId }, message);
      this.emit({
        type: "attachments.images.clear.response",
        payload: {
          matched: 0,
          deleted: 0,
          freedBytes: 0,
          dryRun: msg.dryRun,
          error: message,
          requestId: msg.requestId,
        },
      });
    }
  }

  private async archiveAgentForClose(
    agentId: string,
  ): Promise<{ agentId: string; archivedAt: string }> {
    // Observed subagents (Claude Task / ultracode fan-out) have no ManagedAgent
    // and no stored record, so `archiveAgentCommand` would 404 them - the same
    // root cause the fetch path special-cases above. Archive them through the
    // registry instead (best-effort stop + retire the projection).
    // See docs/agent-lifecycle.md (Items 2 + 6).
    if (this.agentManager.getObservedSubagentPayload(agentId)) {
      const { archivedAt } = await this.agentManager.archiveObservedSubagent(agentId);
      return { agentId, archivedAt };
    }

    const { archivedAt, record: archivedRecord } = await archiveAgentCommand(
      {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      },
      agentId,
    );

    if (this.agentUpdates.hasSubscription()) {
      const payload = await this.agentUpdates.emitStoredRecord(
        (await this.agentStorage.get(agentId)) ?? archivedRecord,
      );
      if (payload.workspaceId) {
        await this.emitWorkspaceUpdateForWorkspaceId(payload.workspaceId);
      }
    }

    return { agentId, archivedAt };
  }

  private async handleDetachAgentRequest(agentId: string, requestId: string): Promise<void> {
    this.sessionLogger.info({ agentId, requestId }, "Detaching agent from parent");

    try {
      const result = await detachAgentCommand({ agentManager: this.agentManager }, agentId);
      const affectedWorkspaceIds = new Set<string>();

      if (!result.live) {
        const payload = await this.agentUpdates.emitStoredRecord(result.record);
        if (payload.workspaceId) {
          affectedWorkspaceIds.add(payload.workspaceId);
        }
      } else if (result.record.workspaceId) {
        affectedWorkspaceIds.add(result.record.workspaceId);
      }

      if (result.previousParentAgentId) {
        const rootWorkspaceId = await this.resolveDelegationRootWorkspaceId(
          result.previousParentAgentId,
        );
        if (rootWorkspaceId) {
          affectedWorkspaceIds.add(rootWorkspaceId);
        }
      }

      await this.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds);

      this.emit({
        type: "agent.detach.response",
        payload: {
          requestId,
          agentId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to detach agent");
      this.sessionLogger.error({ err: error, agentId, requestId }, "Failed to detach agent");
      this.emit({
        type: "agent.detach.response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: message,
        },
      });
    }
  }

  private async handleAgentWorkspaceTransferRequest(
    agentId: string,
    workspaceId: string,
    requestId: string,
  ): Promise<void> {
    this.sessionLogger.info(
      { agentId, workspaceId, requestId },
      "session: agent.workspace.transfer.request",
    );

    try {
      const result = await transferAgentWorkspaceCommand(
        {
          getAgentWorkspaceId: async (id) => {
            const live = this.agentManager.getAgent(id);
            if (live) {
              return { workspaceId: live.workspaceId };
            }
            const stored = await this.agentStorage.get(id);
            return stored ? { workspaceId: stored.workspaceId } : null;
          },
          getWorkspace: async (id) => {
            const record = await this.workspaceRegistry.get(id);
            return record
              ? {
                  workspaceId: record.workspaceId,
                  archivedAt: record.archivedAt,
                  hidden: record.hidden,
                }
              : null;
          },
          transfer: (id, target) => this.agentManager.transferAgentWorkspace(id, target),
        },
        { agentId, workspaceId },
      );

      if (result.status === "refused") {
        this.emit({
          type: "agent.workspace.transfer.response",
          payload: { requestId, agentId, workspaceId: null, accepted: false, error: result.error },
        });
        return;
      }

      if (result.status === "transferred") {
        // A closed chat has no live session to broadcast from, so its updated
        // record has to be pushed explicitly.
        if (!result.live) {
          await this.agentUpdates.emitStoredRecord(result.record);
        }
        // Both sides, always. The source workspace loses a chat and the target
        // gains one, and a client showing either needs its counts and tab list
        // refreshed. Emitting only the target is the bug that leaves a ghost tab
        // behind in the workspace the chat came from.
        const affectedWorkspaceIds = new Set<string>([result.workspaceId]);
        if (result.previousWorkspaceId) {
          affectedWorkspaceIds.add(result.previousWorkspaceId);
        }
        await this.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds, {});
      }

      this.emit({
        type: "agent.workspace.transfer.response",
        payload: {
          requestId,
          agentId,
          workspaceId: result.workspaceId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to move chat");
      this.sessionLogger.error(
        { err: error, agentId, workspaceId, requestId },
        "session: agent.workspace.transfer.request error",
      );
      this.emit({
        type: "agent.workspace.transfer.response",
        payload: { requestId, agentId, workspaceId: null, accepted: false, error: message },
      });
    }
  }

  private async handleCloseItemsRequest(msg: CloseItemsRequest): Promise<void> {
    const archiveResults = await Promise.allSettled(
      msg.agentIds.map((agentId) => this.archiveAgentForClose(agentId)),
    );
    const agents = [];
    for (let i = 0; i < archiveResults.length; i += 1) {
      const result = archiveResults[i];
      if (result.status === "fulfilled") {
        agents.push(result.value);
      } else {
        this.sessionLogger.warn(
          { err: result.reason, agentId: msg.agentIds[i], requestId: msg.requestId },
          "Failed to archive agent during close_items batch",
        );
      }
    }

    const terminals = [];
    for (const terminalId of msg.terminalIds) {
      try {
        terminals.push(this.terminalController.killTerminalForClose(terminalId));
      } catch (error) {
        this.sessionLogger.warn(
          { err: error, terminalId, requestId: msg.requestId },
          "Failed to kill terminal during close_items batch",
        );
        terminals.push({
          terminalId,
          success: false,
        });
      }
    }

    this.emit({
      type: "close_items_response",
      payload: {
        agents,
        terminals,
        requestId: msg.requestId,
      },
    });
  }

  private async unarchiveAgentByHandle(handle: AgentPersistenceHandle): Promise<{
    record: StoredAgentRecord;
    didUnarchive: boolean;
    originalArchivedAt: string | null;
  } | null> {
    const records = await this.agentStorage.listByProviderSession(
      handle.provider,
      handle.sessionId,
    );
    const matched = records.reduce<StoredAgentRecord | null>((latest, candidate) => {
      if (!latest) {
        return candidate;
      }
      const updatedDelta =
        Date.parse(resolveStoredAgentPayloadUpdatedAt(candidate)) -
        Date.parse(resolveStoredAgentPayloadUpdatedAt(latest));
      if (updatedDelta !== 0) {
        return updatedDelta > 0 ? candidate : latest;
      }
      return Date.parse(candidate.createdAt) > Date.parse(latest.createdAt) ? candidate : latest;
    }, null);
    if (!matched) {
      return null;
    }
    const didUnarchive = await unarchiveAgentState(
      this.agentStorage,
      this.agentManager,
      matched.id,
    );
    return {
      record: matched,
      didUnarchive,
      originalArchivedAt: matched.archivedAt ?? null,
    };
  }

  private async handleUpdateAgentRequest(
    agentId: string,
    name: string | undefined,
    labels: Record<string, string> | undefined,
    requestId: string,
  ): Promise<void> {
    this.sessionLogger.info(
      {
        agentId,
        requestId,
        hasName: typeof name === "string",
        labelCount: labels ? Object.keys(labels).length : 0,
      },
      "session: update_agent_request",
    );

    try {
      const result = await updateAgentCommand(
        { agentManager: this.agentManager },
        { agentId, name, labels },
      );

      if (!result.accepted) {
        this.emit({
          type: "update_agent_response",
          payload: {
            requestId,
            agentId,
            accepted: false,
            error: result.error,
          },
        });
        return;
      }

      this.emit({
        type: "update_agent_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.sessionLogger.error(
        { err: error, agentId, requestId },
        "session: update_agent_request error",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to update agent: ${getErrorMessage(error)}`,
        },
      });
      this.emit({
        type: "update_agent_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to update agent"),
        },
      });
    }
  }

  private async handleProjectRenameRequest(
    projectId: string,
    customName: string | null,
    requestId: string,
  ): Promise<void> {
    this.sessionLogger.info(
      { projectId, requestId, hasCustomName: typeof customName === "string" },
      "session: project.rename.request",
    );

    try {
      const existing = await this.projectRegistry.get(projectId);
      if (!existing) {
        this.emit({
          type: "project.rename.response",
          payload: {
            requestId,
            projectId,
            accepted: false,
            customName: null,
            error: "Project not found",
          },
        });
        return;
      }

      const trimmed = customName?.trim() ?? "";
      const nextCustomName = trimmed.length === 0 ? null : trimmed;

      const updated = {
        ...existing,
        customName: nextCustomName,
        updatedAt: new Date().toISOString(),
      };
      await this.projectRegistry.upsert(updated);

      this.emit({
        type: "project.rename.response",
        payload: {
          requestId,
          projectId,
          accepted: true,
          customName: nextCustomName,
          error: null,
        },
      });

      // Only workspaces the client can actually see. Archived and hidden ones
      // resolve to no descriptor, so listing them here would make the emission
      // chokepoint fire a spurious `remove` per archived workspace on every
      // rename.
      this.emitProjectUpdate({ kind: "upsert", project: updated });
      const workspaces = await this.workspaceRegistry.list();
      const affectedWorkspaceIds = workspaces
        .filter(
          (workspace) =>
            workspace.projectId === projectId && !workspace.archivedAt && !workspace.hidden,
        )
        .map((workspace) => workspace.workspaceId);

      // The project's name is host-global state, and a project with no active
      // workspaces has no workspace descriptor to carry it. Announce the project
      // itself on the project channel, to every session - that is what makes the
      // rename land instantly regardless of workspace count or which client asked.
      this.broadcastToAllSessions({
        type: "project.updated.notification",
        payload: {
          project: this.buildProjectDescriptor(updated),
          hasActiveWorkspaces: affectedWorkspaceIds.length > 0,
        },
      });

      // Re-emit descriptors for every visible workspace under this project so the
      // new resolved name lands on the workspace rows too.
      if (affectedWorkspaceIds.length > 0) {
        await this.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds);
      }
    } catch (error) {
      this.sessionLogger.error(
        { err: error, projectId, requestId },
        "session: project.rename.request error",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to rename project: ${getErrorMessage(error)}`,
        },
      });
      this.emit({
        type: "project.rename.response",
        payload: {
          requestId,
          projectId,
          accepted: false,
          customName: null,
          error: getErrorMessageOr(error, "Failed to rename project"),
        },
      });
    }
  }

  /**
   * Sets which tracking board a project shows on the Kanban screen.
   *
   * The stored value is a pointer, never a credential, which is why it can live
   * unmasked in the project record - `normalizeKanbanProjectTarget` is what
   * keeps that true, so a rejected value must not be persisted.
   */
  private async handleKanbanProjectTargetSetRequest(
    request: Extract<SessionInboundMessage, { type: "kanban.project.target.set.request" }>,
  ): Promise<void> {
    const { projectId, target, requestId } = request;
    this.sessionLogger.info(
      { projectId, requestId, adapter: target?.adapter ?? null },
      "session: kanban.project.target.set.request",
    );

    const reject = (error: string): void => {
      this.emit({
        type: "kanban.project.target.set.response",
        payload: { requestId, projectId, accepted: false, target: null, error },
      });
    };

    try {
      const existing = await this.projectRegistry.get(projectId);
      if (!existing) {
        reject("Project not found");
        return;
      }

      let normalized: { adapter: "github" | "jira"; boardId: string | null } | null = null;
      if (target) {
        const result = normalizeKanbanProjectTarget({
          adapter: target.adapter,
          boardId: target.boardId ?? null,
        });
        if (!result.ok) {
          reject(result.error);
          return;
        }
        normalized = result.target;
      }

      const updated = {
        ...existing,
        kanban: normalized,
        updatedAt: new Date().toISOString(),
      };
      await this.projectRegistry.upsert(updated);

      this.emit({
        type: "kanban.project.target.set.response",
        payload: { requestId, projectId, accepted: true, target: normalized, error: null },
      });

      // The target is host-global project metadata, same as the name: announce
      // it on the project channel so every session's Kanban picker sees the
      // project flip between configured and unconfigured immediately.
      this.emitProjectUpdate({ kind: "upsert", project: updated });
      const workspaces = await this.workspaceRegistry.list();
      const hasActiveWorkspaces = workspaces.some(
        (workspace) =>
          workspace.projectId === projectId && !workspace.archivedAt && !workspace.hidden,
      );
      this.broadcastToAllSessions({
        type: "project.updated.notification",
        payload: { project: this.buildProjectDescriptor(updated), hasActiveWorkspaces },
      });
    } catch (error) {
      this.sessionLogger.error(
        { err: error, projectId, requestId },
        "session: kanban.project.target.set.request error",
      );
      reject(getErrorMessageOr(error, "Failed to save the Kanban board target"));
    }
  }

  private async handleProjectIconSetRequest(
    request: Extract<SessionInboundMessage, { type: "project.icon.set.request" }>,
  ): Promise<void> {
    const { projectId, requestId } = request;
    try {
      const updated = await setProjectCustomIcon({
        ottoHome: this.ottoHome,
        projectId,
        source: request.source,
        projects: this.projectRegistry,
      });

      this.emit({
        type: "project.icon.set.response",
        payload: { requestId, projectId, accepted: true, error: null },
      });
      this.emitProjectUpdate({ kind: "upsert", project: updated });

      const affectedWorkspaceIds = (await this.workspaceRegistry.list())
        .filter((workspace) => workspace.projectId === projectId)
        .map((workspace) => workspace.workspaceId);
      if (affectedWorkspaceIds.length > 0) {
        await this.emitWorkspaceUpdatesForWorkspaceIds(affectedWorkspaceIds);
      }
    } catch (error) {
      this.emit({
        type: "project.icon.set.response",
        payload: {
          requestId,
          projectId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to update project icon"),
        },
      });
    }
  }

  private async handleProjectIconGetRequest(projectId: string, requestId: string): Promise<void> {
    try {
      const project = await this.projectRegistry.get(projectId);
      if (!project) throw new Error("Project not found");

      const icon = await readProjectIcon({ ottoHome: this.ottoHome, project });
      this.emit({
        type: "project.icon.get.response",
        payload: { projectId, icon, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "project.icon.get.response",
        payload: { projectId, icon: null, error: getErrorMessage(error), requestId },
      });
    }
  }

  private async handleProjectRemoveRequest(
    request: Extract<SessionInboundMessage, { type: "project.remove.request" }>,
  ): Promise<void> {
    const { projectId, requestId } = request;
    this.sessionLogger.info({ projectId, requestId }, "session: project.remove.request");

    try {
      const project = await this.projectRegistry.get(projectId);
      const resolvedProjectId = project?.projectId ?? projectId;
      const projectWorkspaces = (await this.workspaceRegistry.list()).filter(
        (workspace) => workspace.projectId === resolvedProjectId,
      );
      const activeWorkspaceIds = projectWorkspaces
        .filter((workspace) => !workspace.archivedAt)
        .map((workspace) => workspace.workspaceId);

      if (activeWorkspaceIds.length > 0) {
        this.markWorkspaceArchiving(activeWorkspaceIds, new Date().toISOString());
        await this.emitWorkspaceUpdatesForWorkspaceIds(activeWorkspaceIds);
      }

      const removedWorkspaceIds: string[] = [];
      try {
        for (const workspaceId of activeWorkspaceIds) {
          await archiveWorkspaceContents(
            {
              agentManager: this.agentManager,
              agentStorage: this.agentStorage,
              killTerminalsForWorkspace: (id) =>
                this.terminalController.killTerminalsForWorkspace(id),
              sessionLogger: this.sessionLogger,
            },
            workspaceId,
          );
          await this.archiveWorkspaceRecord(workspaceId);
          removedWorkspaceIds.push(workspaceId);
        }

        await this.projectRegistry.remove(resolvedProjectId);
        // Cascade: a removed project's links disappear (gated-multi-root).
        await this.projectLinkStore.removeAllForProject(projectId);
        // Same teardown archiveByScope does for a single workspace: the git
        // operation log buffers and the language servers rooted at these
        // directories have nothing left to serve.
        dropGitOperationLogs(
          {},
          projectWorkspaces
            .filter((workspace) => removedWorkspaceIds.includes(workspace.workspaceId))
            .map((workspace) => workspace.cwd),
        );
        await stopLanguageServersForArchivedDirectories(
          {
            // Same roots archiveByScope resolves ownership against, so the
            // last-reference check sees the same backing directories.
            ottoHome: this.ottoHome,
            ottoWorktreesBaseRoot: this.worktreesRoot,
            listActiveWorkspaces: () => this.listActiveWorkspaceRefs(),
            stopLanguageServers: (rootPath) => this.stopWorkspaceProcesses(rootPath),
            sessionLogger: this.sessionLogger,
          },
          {
            directories: projectWorkspaces
              .filter((workspace) => removedWorkspaceIds.includes(workspace.workspaceId))
              .map((workspace) => workspace.cwd),
            archivedWorkspaceIds: removedWorkspaceIds,
          },
        );
        await removeProjectCustomIcon({
          ottoHome: this.ottoHome,
          projectId: resolvedProjectId,
        }).catch((error) => {
          this.sessionLogger.warn(
            { err: error, projectId: resolvedProjectId },
            "Failed to clean up removed project icon",
          );
        });
      } finally {
        if (activeWorkspaceIds.length > 0) {
          this.clearWorkspaceArchiving(activeWorkspaceIds);
        }
      }

      const updateIds =
        removedWorkspaceIds.length > 0
          ? removedWorkspaceIds
          : [projectWorkspaces[0]?.workspaceId ?? projectId];
      await this.emitWorkspaceUpdatesForWorkspaceIds(updateIds, {
        removedProjectId: projectId,
      });

      this.emit({
        type: "project.remove.response",
        payload: {
          requestId,
          projectId,
          accepted: true,
          removedWorkspaceIds,
          error: null,
        },
      });

      // The dropped links may have been visible to this client; refresh.
      await this.emitProjectLinksChanged();
    } catch (error) {
      this.sessionLogger.error(
        { err: error, projectId, requestId },
        "session: project.remove.request error",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to remove project: ${getErrorMessage(error)}`,
        },
      });
      this.emit({
        type: "project.remove.response",
        payload: {
          requestId,
          projectId,
          accepted: false,
          removedWorkspaceIds: [],
          error: getErrorMessageOr(error, "Failed to remove project"),
        },
      });
    }
  }

  /**
   * The link set, filtered to pairs whose both endpoints are still live
   * projects - so a link "disappears" the moment either project is removed or
   * archived, without needing the cascade to have run yet (gated-multi-root).
   */
  private async buildLiveProjectLinks(): Promise<{ projectAId: string; projectBId: string }[]> {
    const [links, projects] = await Promise.all([
      this.projectLinkStore.list(),
      this.projectRegistry.list(),
    ]);
    const liveIds = new Set(
      projects.filter((project) => !project.archivedAt).map((project) => project.projectId),
    );
    return links
      .filter((link) => liveIds.has(link.projectAId) && liveIds.has(link.projectBId))
      .map((link) => ({ projectAId: link.projectAId, projectBId: link.projectBId }));
  }

  private async emitProjectLinksChanged(): Promise<void> {
    this.emit({
      type: "project.links.changed",
      payload: { links: await this.buildLiveProjectLinks() },
    });
  }

  private async handleProjectLinksListRequest(
    request: Extract<SessionInboundMessage, { type: "project.links.list.request" }>,
  ): Promise<void> {
    try {
      this.emit({
        type: "project.links.list.response",
        payload: {
          requestId: request.requestId,
          links: await this.buildLiveProjectLinks(),
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "project.links.list.response",
        payload: {
          requestId: request.requestId,
          links: [],
          error: getErrorMessageOr(error, "Failed to list project links"),
        },
      });
    }
  }

  private async handleProjectLinksSetRequest(
    request: Extract<SessionInboundMessage, { type: "project.links.set.request" }>,
  ): Promise<void> {
    const { projectId, otherProjectId, requestId } = request;
    const respondError = (error: string): void => {
      this.emit({
        type: "project.links.set.response",
        payload: { requestId, accepted: false, links: [], error },
      });
    };
    try {
      if (projectId === otherProjectId) {
        respondError("A project cannot be linked to itself");
        return;
      }
      const [a, b] = await Promise.all([
        this.projectRegistry.get(projectId),
        this.projectRegistry.get(otherProjectId),
      ]);
      if (!a || a.archivedAt || !b || b.archivedAt) {
        respondError("One or both projects no longer exist");
        return;
      }
      await this.projectLinkStore.link(projectId, otherProjectId, new Date().toISOString());
      this.emit({
        type: "project.links.set.response",
        payload: {
          requestId,
          accepted: true,
          links: await this.buildLiveProjectLinks(),
          error: null,
        },
      });
      await this.emitProjectLinksChanged();
    } catch (error) {
      this.sessionLogger.error(
        { err: error, projectId, otherProjectId, requestId },
        "session: project.links.set.request error",
      );
      respondError(getErrorMessageOr(error, "Failed to link projects"));
    }
  }

  private async handleProjectLinksUnsetRequest(
    request: Extract<SessionInboundMessage, { type: "project.links.unset.request" }>,
  ): Promise<void> {
    const { projectId, otherProjectId, requestId } = request;
    try {
      await this.projectLinkStore.unlink(projectId, otherProjectId);
      this.emit({
        type: "project.links.unset.response",
        payload: {
          requestId,
          accepted: true,
          links: await this.buildLiveProjectLinks(),
          error: null,
        },
      });
      await this.emitProjectLinksChanged();
    } catch (error) {
      this.sessionLogger.error(
        { err: error, projectId, otherProjectId, requestId },
        "session: project.links.unset.request error",
      );
      this.emit({
        type: "project.links.unset.response",
        payload: {
          requestId,
          accepted: false,
          links: [],
          error: getErrorMessageOr(error, "Failed to unlink projects"),
        },
      });
    }
  }

  /**
   * Refine - propose rewrites of the documents the client pinned.
   *
   * Nothing here reads or writes the filesystem: every document arrives on the
   * wire and every proposal goes back on it. Accepted results come back later
   * as ordinary `file.write.request`s, one per file, so the conditional-write
   * precondition - not this handler - is what protects them.
   */
  private async handleFileRefineRequest(msg: FileRefineRequest): Promise<void> {
    const respond = (result: FileRefineResult): void => {
      this.emit({
        type: "file.refine.response",
        payload: { cwd: msg.cwd, result, requestId: msg.requestId },
      });
    };
    const cwd = msg.cwd.trim();
    if (!cwd) {
      respond({ status: "error", message: "cwd is required" });
      return;
    }
    try {
      const files = await this.refineGenerator.refine({
        cwd,
        documents: msg.documents,
        ...(msg.references ? { references: msg.references } : {}),
        instruction: msg.instruction,
      });
      respond({ status: "ok", files });
    } catch (error) {
      this.sessionLogger.error(
        { err: error, cwd, documents: msg.documents.length },
        "session: file.refine.request failed",
      );
      respond({
        status: "error",
        message:
          error instanceof RefineError
            ? error.message
            : getErrorMessageOr(error, "Failed to refine this file"),
      });
    }
  }

  private async handleWorkspaceTitleSetRequest(
    workspaceId: string,
    title: string | null,
    requestId: string,
  ): Promise<void> {
    this.sessionLogger.info(
      { workspaceId, requestId, hasTitle: typeof title === "string" },
      "session: workspace.title.set.request",
    );

    try {
      const trimmed = title?.trim() ?? "";
      const nextTitle = trimmed.length === 0 ? null : trimmed;
      const updatedAt = new Date().toISOString();
      const updated = await this.workspaceRegistry.update(workspaceId, (existing) => ({
        ...existing,
        title: nextTitle,
        updatedAt,
      }));
      if (!updated) {
        this.emit({
          type: "workspace.title.set.response",
          payload: {
            requestId,
            workspaceId,
            accepted: false,
            title: null,
            error: "Workspace not found",
          },
        });
        return;
      }

      this.emit({
        type: "workspace.title.set.response",
        payload: {
          requestId,
          workspaceId,
          accepted: true,
          title: nextTitle,
          error: null,
        },
      });

      await this.emitWorkspaceUpdatesForWorkspaceIds([workspaceId]);
    } catch (error) {
      this.sessionLogger.error(
        { err: error, workspaceId, requestId },
        "session: workspace.title.set.request error",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set workspace title: ${getErrorMessage(error)}`,
        },
      });
      this.emit({
        type: "workspace.title.set.response",
        payload: {
          requestId,
          workspaceId,
          accepted: false,
          title: null,
          error: getErrorMessageOr(error, "Failed to set workspace title"),
        },
      });
    }
  }

  private async handleWorkspacePinSetRequest(
    workspaceId: string,
    pinned: boolean,
    requestId: string,
  ): Promise<void> {
    const logContext = { workspaceId, pinned, requestId };
    this.sessionLogger.info(logContext, "session: workspace.pin.set.request");
    const emitResponse = (accepted: boolean, pinnedAt: string | null, error: string | null) => {
      this.emit({
        type: "workspace.pin.set.response",
        payload: { requestId, workspaceId, accepted, pinnedAt, error },
      });
    };

    try {
      const nextPinnedAt = pinned ? new Date().toISOString() : null;
      const updatedAt = new Date().toISOString();
      const updated = await this.workspaceRegistry.update(workspaceId, (existing) => ({
        ...existing,
        pinnedAt: nextPinnedAt,
        updatedAt,
      }));
      if (!updated) {
        emitResponse(false, null, "Workspace not found");
        return;
      }
      emitResponse(true, nextPinnedAt, null);
      await this.emitWorkspaceUpdatesForWorkspaceIds([workspaceId]);
    } catch (error) {
      this.sessionLogger.error(
        { ...logContext, err: error },
        "session: workspace.pin.set.request error",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to pin workspace: ${getErrorMessage(error)}`,
        },
      });
      emitResponse(false, null, getErrorMessageOr(error, "Failed to pin workspace"));
    }
  }

  private async handleWorkspaceRecoveryInspectRequest(
    request: Extract<SessionInboundMessage, { type: "workspace.recovery.inspect.request" }>,
  ): Promise<void> {
    const state = await this.workspaceRecovery.inspect(request.workspaceId);
    this.emit({
      type: "workspace.recovery.inspect.response",
      payload: {
        requestId: request.requestId,
        state,
      },
    });
  }

  private async handleWorkspaceRecoveryRestoreRequest(
    request: Extract<SessionInboundMessage, { type: "workspace.recovery.restore.request" }>,
  ): Promise<void> {
    try {
      await this.restoreWorkspaceAndEmit(request.workspaceId);
      this.emit({
        type: "workspace.recovery.restore.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to recover workspace");
      this.sessionLogger.warn(
        { err: error, workspaceId: request.workspaceId, requestId: request.requestId },
        "session: workspace.recovery.restore.request rejected",
      );
      this.emit({
        type: "workspace.recovery.restore.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          accepted: false,
          error: message,
        },
      });
    }
  }

  /**
   * UI-initiated preview RPCs behind the Preview toolbar button. Mirrors what
   * the agent-facing preview_* tools do (packages/server/src/server/preview/preview-tools.ts)
   * but is driven by the app directly instead of an agent tool call - the
   * caller creates and places the browser tab itself, then reports the
   * binding back via preview.bind_tab so a later agent preview_start call
   * finds the same designated tab.
   */
  private async handlePreviewListConfigRequest(cwd: string, requestId: string): Promise<void> {
    try {
      const config = await readLaunchConfig(cwd);

      // Collect running servers from DevServerManager
      let runningServers: Array<{
        serverId: string;
        name: string;
        url: string;
        port: number;
        status: "starting" | "running" | "exited";
      }> = [];

      if (this.previewDevServers) {
        // Reconcile against reality (port probes), not just the in-memory map:
        // the map is wiped on daemon restart while the detached dev-server child
        // keeps serving, so a plain list() would report a live preview as "not
        // started" after every tsx-watch restart in dev. See reconcileRunning.
        const reconciled = await this.previewDevServers.reconcileRunning({
          cwd,
          configured:
            config?.configurations.map((entry) => ({
              name: entry.name,
              port: entry.port,
            })) ?? [],
        });
        runningServers = reconciled.map((s) => ({
          serverId: s.serverId,
          name: s.name,
          url: s.url,
          port: s.port,
          status: s.status,
        }));
      }

      this.emit({
        type: "preview.list_config.response",
        payload: {
          requestId,
          cwd,
          configured: config !== null,
          servers:
            config?.configurations.map((entry) => ({ name: entry.name, port: entry.port })) ?? [],
          runningServers,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "preview.list_config.response",
        payload: {
          requestId,
          cwd,
          configured: false,
          servers: [],
          error: error instanceof LaunchConfigError ? error.message : getErrorMessage(error),
        },
      });
    }
  }

  private async handlePreviewStartRequest(
    cwd: string,
    name: string,
    requestId: string,
  ): Promise<void> {
    if (!this.previewDevServers) {
      this.emit({
        type: "preview.start.response",
        payload: {
          requestId,
          cwd,
          success: false,
          server: null,
          reused: false,
          error: "Preview servers are disabled on this daemon.",
        },
      });
      return;
    }

    try {
      const started = await this.previewDevServers.start({ cwd, name });
      this.emit({
        type: "preview.start.response",
        payload: {
          requestId,
          cwd,
          success: true,
          reused: started.reused,
          server: {
            serverId: started.server.serverId,
            name: started.server.name,
            url: started.server.url,
            port: started.server.port,
            status: started.server.status,
            boundBrowserId: started.server.boundBrowserId,
          },
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "preview.start.response",
        payload: {
          requestId,
          cwd,
          success: false,
          server: null,
          reused: false,
          error: getErrorMessage(error),
        },
      });
    }
  }

  private async handlePreviewBindTabRequest(
    serverId: string,
    browserId: string,
    requestId: string,
  ): Promise<void> {
    if (!this.previewDevServers) {
      this.emit({
        type: "preview.bind_tab.response",
        payload: {
          requestId,
          success: false,
          error: "Preview servers are disabled on this daemon.",
        },
      });
      return;
    }
    try {
      this.previewDevServers.bindTab(serverId, browserId);
      this.emit({
        type: "preview.bind_tab.response",
        payload: { requestId, success: true, error: null },
      });
    } catch (error) {
      this.emit({
        type: "preview.bind_tab.response",
        payload: { requestId, success: false, error: getErrorMessage(error) },
      });
    }
  }

  private async handlePreviewStopRequest(serverId: string, requestId: string): Promise<void> {
    if (!this.previewDevServers) {
      this.emit({
        type: "preview.stop.response",
        payload: {
          requestId,
          success: false,
          error: "Preview servers are disabled on this daemon.",
        },
      });
      return;
    }
    try {
      await this.previewDevServers.stop(serverId);
      this.emit({
        type: "preview.stop.response",
        payload: { requestId, success: true, error: null },
      });
    } catch (error) {
      this.emit({
        type: "preview.stop.response",
        payload: { requestId, success: false, error: getErrorMessage(error) },
      });
    }
  }

  /**
   * Handle text message to agent (with optional image attachments)
   */
  private async handleSendAgentMessage(
    agentId: string,
    text: string,
    messageId?: string,
    images?: Array<{ data: string; mimeType: string }>,
    attachments?: AgentAttachment[],
    runOptions?: AgentRunOptions,
    options?: { spokenInput?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    this.sessionLogger.info(
      {
        agentId,
        textPreview: text.substring(0, 50),
        imageCount: images?.length ?? 0,
        attachmentCount: attachments?.length ?? 0,
      },
      `Sending text to agent ${agentId}${
        images && images.length > 0 ? ` with ${images.length} image attachment(s)` : ""
      }${
        attachments && attachments.length > 0
          ? ` and ${attachments.length} structured attachment(s)`
          : ""
      }`,
    );

    const promptText = options?.spokenInput ? wrapSpokenInput(text) : text;
    const prompt = buildAgentPrompt(promptText, images, attachments);

    try {
      await sendPromptToAgent({
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        agentId,
        prompt,
        messageId,
        runOptions,
        logger: this.sessionLogger,
      });
      return { ok: true };
    } catch (error) {
      this.handleAgentRunError(agentId, error, "Failed to send agent message");
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle create agent request
   */
  /**
   * Resolve an optional personality id against the roster + this cwd's provider
   * snapshot and fold its identity onto the create config. Availability is
   * re-checked here (the cwd may differ from where the picker resolved it); an
   * unavailable or unknown personality is skipped with a warning rather than
   * failing the create - the agent still runs with the chosen brain, just
   * without personality identity. The brain fields are never overridden; only
   * `personalitySnapshot` and (when the caller set none) `systemPrompt` are added.
   */
  private async applyPersonalityIdentityToConfig(
    config: AgentSessionConfig,
    personalityId: string | undefined,
  ): Promise<AgentSessionConfig> {
    if (!personalityId) {
      return config;
    }
    const roster = this.daemonConfigStore.get().agentProfiles ?? [];
    const personality = roster.find((entry) => entry.id === personalityId);
    if (!personality) {
      this.sessionLogger.warn(
        { personalityId },
        "create_agent: personality id not found in roster; spawning without personality identity",
      );
      return config;
    }
    const entries = await this.providerSnapshotManager.listProviders({
      cwd: config.cwd,
      wait: true,
    });
    const resolution = resolveProfile(personality, entries);
    if (resolution.status === "unavailable") {
      this.sessionLogger.warn(
        { personalityId, reason: resolution.reason },
        "create_agent: personality unavailable for cwd; spawning without personality identity",
      );
      return config;
    }
    const snapshot: ResolvedProfileSnapshot = resolution.snapshot;
    // The one team rule: a member of the active team at spawn time carries the
    // frozen team layer, and the team prompt stacks directly ahead of the
    // personality prompt. Caller-authored prompts still win - nothing composes.
    const teamSnapshot = resolveTeamSnapshotForPersonality(
      this.daemonConfigStore.get().agentTeams,
      snapshot.personalityId,
    );
    const composedPrompt = composeTeamAndPersonalityPrompt(
      teamSnapshot,
      snapshot.systemPrompt,
      snapshot.roles,
    );
    return {
      ...config,
      personalitySnapshot: snapshot,
      ...(teamSnapshot ? { teamSnapshot } : {}),
      ...(config.systemPrompt === undefined && composedPrompt !== undefined
        ? { systemPrompt: composedPrompt }
        : {}),
    };
  }

  /**
   * Resolve a roster personality against a *running* agent's cwd for a live
   * switch (agent.personality.set). Unlike the spawn-time soft-skip above, an
   * unknown or unavailable personality throws - the RPC rejects with the reason
   * instead of half-applying.
   */
  private async resolvePersonalitySnapshotForAgent(
    agentId: string,
    personalityId: string,
  ): Promise<ResolvedProfileSnapshot> {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const roster = this.daemonConfigStore.get().agentProfiles ?? [];
    const personality = roster.find((entry) => entry.id === personalityId);
    if (!personality) {
      throw new Error(`Personality not found: ${personalityId}`);
    }
    // Warm only the personality's own provider - a cold workspace snapshot
    // would otherwise fan out to every registered provider (network probes)
    // and stall the switch for seconds.
    const entries = await this.providerSnapshotManager.listProviders({
      cwd: agent.config.cwd,
      providers: [personality.provider],
      wait: true,
    });
    const resolution = resolveProfile(personality, entries);
    if (resolution.status === "unavailable") {
      throw new Error(resolution.reason);
    }
    return resolution.snapshot;
  }

  private async handleCreateAgentRequest(msg: CreateAgentRequestMessage): Promise<void> {
    const {
      config,
      personality,
      worktreeName,
      requestId,
      initialPrompt,
      clientMessageId,
      outputSchema,
      git,
      worktree,
      autoArchive,
      images,
      attachments,
      env,
    } = msg;
    this.sessionLogger.info(
      { cwd: config.cwd, provider: config.provider, worktreeName },
      `Creating agent in ${config.cwd} (${config.provider})${
        worktreeName ? ` with worktree ${worktreeName}` : ""
      }`,
    );

    let createdWorktreeForCleanup: CreateOttoWorktreeWorkflowResult | null = null;
    let createdAgentId: string | null = null;
    try {
      const requestedCwd = resolve(config.cwd);
      const needsRequestedDirectory =
        Boolean(worktreeName || git || worktree) || (!msg.workspaceId && !msg.callerAgentId);
      if (needsRequestedDirectory && !(await this.filesystem.isDirectory(requestedCwd))) {
        throw new Error(`Working directory does not exist or is not a directory: ${requestedCwd}`);
      }
      const trimmedPrompt = initialPrompt?.trim();
      const { provisionalTitle } = resolveCreateAgentTitles({
        configTitle: config.title,
        initialPrompt: trimmedPrompt,
      });

      const firstAgentContext: FirstAgentContext = {
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
      const workspacePromptTitle = resolveFirstAgentPromptTitle(firstAgentContext);
      const createdWorktree = await this.createAgentLifecycleDispatch.createWorktreeForRequest({
        cwd: config.cwd,
        target: worktree,
        firstAgentContext,
        hasLegacyGitOptions: Boolean(git),
      });
      createdWorktreeForCleanup = createdWorktree;
      const resolvedIntent = await this.resolveSessionCreateAgentIntent({
        request: msg,
        createdWorktree,
        workspacePromptTitle,
      });
      const resolvedCwd = resolve(resolvedIntent.config.cwd);
      if (!(await this.filesystem.isDirectory(resolvedCwd))) {
        throw new Error(`Working directory does not exist or is not a directory: ${resolvedCwd}`);
      }
      // Otto: a composer-selected personality arrives by id. Fold its identity onto
      // the resolved config so the live spinner, voice and prompt read as that
      // personality. The brain in `config` (provider/model/mode/effort) stays
      // authoritative: hand-deviations in the picker keep the identity but override
      // the settings.
      resolvedIntent.config = await this.applyPersonalityIdentityToConfig(
        resolvedIntent.config,
        personality,
      );

      const { snapshot, liveSnapshot } = await createAgentCommand(
        {
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          logger: this.sessionLogger,
          ottoHome: this.ottoHome,
          worktreesRoot: this.worktreesRoot,
          providerSnapshotManager: this.providerSnapshotManager,
          scheduleAutoTitle: (request) =>
            this.agentAutoTitle.schedule({
              ...request,
              currentSelection: this.getFocusedAgentSelectionForCwd(request.cwd),
            }),
        },
        {
          kind: "session",
          config: resolvedIntent.config,
          workspaceId: resolvedIntent.intent.workspaceId,
          worktreeName,
          initialPrompt,
          clientMessageId,
          outputSchema,
          images,
          attachments,
          git,
          labels: resolvedIntent.intent.labels,
          env,
          provisionalTitle,
          firstAgentContext,
          buildSessionConfig: (sessionConfig, gitOptions, legacyWorktreeName, ctx) =>
            this.buildAgentSessionConfig(sessionConfig, gitOptions, legacyWorktreeName, ctx),
        },
      );
      createdAgentId = snapshot.id;
      await this.agentUpdates.forwardLiveAgent(snapshot);
      if (resolvedIntent.createdDirectoryWorkspace && trimmedPrompt) {
        this.workspaceAutoName.scheduleForDirectory(
          {
            workspaceId: resolvedIntent.intent.workspaceId,
            cwd: resolvedIntent.config.cwd,
            firstAgentContext,
          },
          { currentSelection: this.getFocusedAgentSelectionForCwd(resolvedIntent.config.cwd) },
        );
      }
      this.createAgentLifecycleDispatch.registerAutoArchiveIfRequested({
        autoArchive,
        agentId: snapshot.id,
        createdWorktree,
      });
      if (requestId) {
        const agentPayload = await this.buildAgentPayload(liveSnapshot);
        this.emit({
          type: "status",
          payload: {
            status: "agent_created",
            agentId: liveSnapshot.id,
            requestId,
            agent: agentPayload,
          },
        });
      }

      this.sessionLogger.info(
        { agentId: snapshot.id, provider: snapshot.provider },
        `Created agent ${snapshot.id} (${snapshot.provider})`,
      );
    } catch (error) {
      await this.createAgentLifecycleDispatch.cleanupCreatedWorktreeAfterFailedAgentCreate({
        createdWorktree: createdWorktreeForCleanup,
        createdAgentId,
      });
      const wireError = toWorktreeWireError(error);
      this.sessionLogger.error({ err: error }, "Failed to create agent");
      if (requestId) {
        this.emit({
          type: "status",
          payload: {
            status: "agent_create_failed",
            requestId,
            error: wireError.message,
            errorCode: wireError.code,
          },
        });
      }
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to create agent: ${wireError.message}`,
        },
      });
    }
  }

  private async resolveSessionCreateAgentIntent(input: {
    request: CreateAgentRequestMessage;
    createdWorktree: CreateOttoWorktreeWorkflowResult | null;
    workspacePromptTitle: string | null;
  }): Promise<ResolvedSessionCreateAgentIntent> {
    const { request, createdWorktree } = input;
    const callerAgent = request.callerAgentId
      ? this.agentManager.getAgent(request.callerAgentId)
      : null;
    if (request.callerAgentId && !callerAgent) {
      throw new Error(`Caller agent ${request.callerAgentId} not found`);
    }

    let config = request.config;

    const intent = await resolveCreateAgentIntent({
      explicitWorkspaceId: createdWorktree?.workspace.workspaceId ?? request.workspaceId,
      caller: callerAgent
        ? { id: callerAgent.id, cwd: callerAgent.cwd, workspaceId: callerAgent.workspaceId }
        : null,
      labels: request.labels,
      resolveWorkspace: async (workspaceId) => {
        if (createdWorktree?.workspace.workspaceId === workspaceId) {
          return { workspaceId, cwd: createdWorktree.workspace.cwd };
        }
        const workspace = await this.workspaceRegistry.get(workspaceId);
        if (!workspace || workspace.archivedAt) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }
        return { workspaceId, cwd: workspace.cwd };
      },
      createWorkspace: async () => ({
        workspaceId: await this.workspaceProvisioning.resolveOrCreateWorkspaceIdForCreateAgent({
          createdWorktree: null,
          cwd: config.cwd,
          initialTitle: input.workspacePromptTitle,
        }),
        cwd: config.cwd,
      }),
    });
    config = { ...config, cwd: intent.cwd };

    return {
      config,
      intent,
      createdDirectoryWorkspace: !createdWorktree && !request.workspaceId && !callerAgent,
    };
  }

  private async handleResumeAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "resume_agent_request" }>,
  ): Promise<void> {
    const { handle, overrides, requestId } = msg;
    if (!handle) {
      this.sessionLogger.warn("Resume request missing persistence handle");
      if (requestId) {
        this.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: "Unable to resume agent: missing persistence handle",
            code: "agent_resume_failed",
          },
        });
      }
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: "Unable to resume agent: missing persistence handle",
        },
      });
      return;
    }
    this.sessionLogger.info(
      { sessionId: handle.sessionId, provider: handle.provider },
      `Resuming agent ${handle.sessionId} (${handle.provider})`,
    );
    try {
      const matched = await this.unarchiveAgentByHandle(handle);
      const effectiveOverrides = matched
        ? { ...buildConfigOverrides(matched.record), ...overrides }
        : overrides;
      let snapshot: ManagedAgent;
      try {
        snapshot = await this.agentManager.resumeAgentFromPersistence(handle, effectiveOverrides);
      } catch (error) {
        if (matched?.didUnarchive && matched.originalArchivedAt) {
          await this.agentManager.archiveSnapshot(matched.record.id, matched.originalArchivedAt);
        }
        throw error;
      }
      await unarchiveAgentState(this.agentStorage, this.agentManager, snapshot.id);
      await this.agentManager.hydrateTimelineFromProvider(snapshot.id);
      await this.agentUpdates.forwardLiveAgent(snapshot);
      const timelineSize = this.agentManager.getTimeline(snapshot.id).length;
      if (requestId) {
        const agentPayload = await this.buildAgentPayload(snapshot);
        this.emit({
          type: "status",
          payload: {
            status: "agent_resumed",
            agentId: snapshot.id,
            requestId,
            timelineSize,
            agent: agentPayload,
          },
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.sessionLogger.error({ err: error }, "Failed to resume agent");
      if (requestId) {
        this.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: message,
            code: "agent_resume_failed",
          },
        });
      }
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to resume agent: ${message}`,
        },
      });
    }
  }

  private async handleImportAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "import_agent_request" }>,
  ): Promise<void> {
    const normalized = normalizeImportAgentRequest(msg);
    if ("error" in normalized) {
      this.emit({
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId: msg.requestId,
          error: normalized.error,
        },
      });
      return;
    }
    const { provider, providerHandleId, requestId } = normalized;
    this.sessionLogger.info(
      { providerHandleId, provider },
      `Importing agent ${providerHandleId} (${provider})`,
    );

    try {
      if (!normalized.cwd) {
        throw new Error("Import requires cwd from the selected provider session");
      }
      // Otto keeps import-into-an-archived-workspace working. Upstream's
      // runInImportWorkspace throws on an archived workspace, so unarchive it
      // first and then let their helper do its project/cwd validation.
      if (normalized.workspaceId) {
        const requestedWorkspace = await this.workspaceRegistry.get(normalized.workspaceId);
        if (requestedWorkspace?.archivedAt) {
          await this.workspaceProvisioning.ensureWorkspaceRecordUnarchived(requestedWorkspace);
        }
      }
      const { snapshot, timelineSize, createdWorkspace } = await importProviderSession({
        request: normalized,
        workspaceProvisioning: this.workspaceProvisioning,
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      });
      if (createdWorkspace) {
        await this.registerWorkspaceForImportedAgent(createdWorkspace);
      }
      const agentPayload = await this.buildAgentPayload(snapshot);
      this.emit({
        type: "status",
        payload: {
          status: "agent_resumed",
          agentId: snapshot.id,
          requestId,
          timelineSize,
          agent: agentPayload,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sessionLogger.error({ err: error }, "Failed to import agent");
      this.emit({
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId,
          error: message,
        },
      });
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to import agent: ${message}`,
        },
      });
    }
  }

  private async handleRefreshAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "refresh_agent_request" }>,
  ): Promise<void> {
    const { agentId, requestId } = msg;
    this.sessionLogger.info({ agentId }, `Refreshing agent ${agentId} from persistence`);

    try {
      await this.restoreOwningWorkspaceForLegacyAgentRefresh(agentId);
      await unarchiveAgentState(this.agentStorage, this.agentManager, agentId);
      let snapshot: ManagedAgent;
      const existing = this.agentManager.getAgent(agentId);
      if (existing) {
        await this.interruptAgentIfRunning(agentId);
        snapshot = await this.agentManager.reloadAgentSession(agentId, undefined, {
          rehydrateFromDisk: true,
        });
      } else {
        const record = await this.agentStorage.get(agentId);
        if (!record) {
          throw new Error(`Agent not found: ${agentId}`);
        }
        const registeredProviderIds = this.providerSnapshotManager.listRegisteredProviderIds();
        if (!isStoredAgentProviderAvailable(record, registeredProviderIds)) {
          throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
        }
        if (!toAgentPersistenceHandle(registeredProviderIds, record.persistence)) {
          throw new Error(`Agent ${agentId} cannot be refreshed because it lacks persistence`);
        }
        // Share the loader's per-agent in-flight operation with timeline fetches.
        // Unarchiving publishes the record before provider resume finishes, so
        // the agent pane can otherwise race this request and resume it twice.
        snapshot = await ensureAgentLoaded(agentId, {
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          broadcastTimeline: true,
          logger: this.sessionLogger,
        });
      }
      await this.agentManager.hydrateTimelineFromProvider(agentId, { broadcast: true });
      await this.agentUpdates.forwardLiveAgent(snapshot);
      const timelineSize = this.agentManager.getTimeline(agentId).length;
      if (requestId) {
        this.emit({
          type: "status",
          payload: {
            status: "agent_refreshed",
            agentId,
            requestId,
            timelineSize,
          },
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.sessionLogger.error({ err: error, agentId }, `Failed to refresh agent ${agentId}`);
      if (requestId) {
        this.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: message,
            code: error instanceof WorktreeRequestError ? error.code : "agent_refresh_failed",
          },
        });
      }
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to refresh agent: ${message}`,
        },
      });
    }
  }

  private async handleCancelAgentRequest(agentId: string, requestId?: string): Promise<void> {
    this.sessionLogger.info({ agentId }, `Cancel request received for agent ${agentId}`);

    try {
      const { cancelled } = await cancelAgentRunCommand(
        { agentManager: this.agentManager, logger: this.sessionLogger },
        agentId,
      );
      if (requestId) {
        const agent = this.agentManager.getAgent(agentId);
        const payload = agent ? await this.buildAgentPayload(agent) : null;
        this.emit({
          type: "cancel_agent_response",
          payload: {
            requestId,
            agentId,
            agent: payload,
            cancelled,
            error: null,
          },
        });
      }
    } catch (error) {
      if (requestId) {
        this.sessionLogger.error(
          { err: error, agentId },
          `Failed to cancel running agent on request for agent ${agentId}`,
        );
        const agent = this.agentManager.getAgent(agentId);
        const payload = agent ? await this.buildAgentPayload(agent) : null;
        this.emit({
          type: "cancel_agent_response",
          payload: {
            requestId,
            agentId,
            agent: payload,
            error: errorToFriendlyMessage(error),
          },
        });
      } else {
        this.handleAgentRunError(agentId, error, "Failed to cancel running agent on request");
      }
    }
  }

  private async handleAgentRewindRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.rewind.request" }>,
  ): Promise<void> {
    try {
      await this.agentManager.rewind(msg.agentId, msg.messageId, msg.mode);
      this.emit({
        type: "agent.rewind.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          ok: true,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "agent.rewind.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          ok: false,
          error: error instanceof Error ? error.message : "Failed to rewind agent",
        },
      });
    }
  }

  private async buildAgentSessionConfig(
    config: AgentSessionConfig,
    gitOptions?: GitSetupOptions,
    legacyWorktreeName?: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<{
    sessionConfig: AgentSessionConfig;
    setupContinuation?: CreateOttoWorktreeWorkflowResult["setupContinuation"];
    createdWorkspaceId?: string;
  }> {
    return buildWorktreeAgentSessionConfig(
      {
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
        sessionLogger: this.sessionLogger,
        workspaceGitService: this.workspaceGitService,
        createOttoWorktree: (input, serviceOptions) =>
          this.createOttoWorktreeWorkflow(input, {
            ...serviceOptions,
            setupContinuation: {
              kind: "agent",
              terminalManager: this.terminalManager,
              appendTimelineItem: ({ agentId, item }) =>
                appendTimelineItemIfAgentKnown({
                  agentManager: this.agentManager,
                  agentId,
                  item,
                }),
              emitLiveTimelineItem: ({ agentId, item }) =>
                emitLiveTimelineItemIfAgentKnown({
                  agentManager: this.agentManager,
                  agentId,
                  item,
                }),
              logger: this.sessionLogger,
            },
          }),
        checkoutExistingBranch: (cwd, branch) =>
          this.gitMutation.checkoutExistingBranch(cwd, branch),
        createBranchFromBase: (params) => this.gitMutation.createBranchFromBase(params),
      },
      config,
      gitOptions,
      legacyWorktreeName,
      firstAgentContext,
    );
  }

  private isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
    const resolvedRoot = resolve(rootPath);
    const resolvedCandidate = resolve(candidatePath);
    if (resolvedCandidate === resolvedRoot) {
      return true;
    }
    return resolvedCandidate.startsWith(resolvedRoot + sep);
  }

  /**
   * Handle clearing agent attention flag
   */
  private async handleClearAgentAttention(
    agentId: string | string[],
    requestId?: string,
  ): Promise<void> {
    const agentIds = Array.isArray(agentId) ? agentId : [agentId];

    try {
      await Promise.all(
        agentIds.map((id) =>
          ensureAgentLoaded(id, {
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            logger: this.sessionLogger,
          }),
        ),
      );
      await Promise.all(agentIds.map((id) => this.agentManager.clearAgentAttention(id)));
      if (requestId) {
        const agents = (
          await Promise.all(
            agentIds.map(async (id) => {
              const agent = this.agentManager.getAgent(id);
              return agent ? this.buildAgentPayload(agent) : null;
            }),
          )
        ).filter((payload): payload is NonNullable<typeof payload> => payload !== null);
        this.emit({
          type: "clear_agent_attention_response",
          payload: {
            requestId,
            agentId,
            agents,
          },
        });
      }
    } catch (error) {
      this.sessionLogger.error({ err: error, agentIds }, "Failed to clear agent attention");
      // Don't throw - this is not critical
    }
  }

  /**
   * Handle client heartbeat for activity tracking
   */
  private handleClientHeartbeat(msg: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId?: string | null;
    lastActivityAt: string;
    appVisible: boolean;
    appVisibilityChangedAt?: string;
  }): void {
    const focusedTerminalId = msg.focusedTerminalId?.trim() || null;
    const appVisibilityChangedAt = msg.appVisibilityChangedAt
      ? new Date(msg.appVisibilityChangedAt)
      : new Date(msg.lastActivityAt);
    this.clientActivity = {
      deviceType: msg.deviceType,
      focusedAgentId: msg.focusedAgentId,
      focusedTerminalId,
      lastActivityAt: new Date(msg.lastActivityAt),
      appVisible: msg.appVisible,
      appVisibilityChangedAt,
    };
    if (msg.appVisible && focusedTerminalId) {
      void this.clearFocusedTerminalAttention(focusedTerminalId);
    }
    if (this.registeredPushToken) {
      this.pushNotifications.renew(this.registeredPushToken);
    }
    this.syncActiveWorkspaceFromActivity();
  }

  /**
   * Tell the workspace-scoped subsystems which workspace the client is actually in, so their
   * periodic work follows the user instead of the whole catalogue.
   *
   * Derived from the focused agent's cwd rather than sent explicitly, which keeps this off
   * the wire entirely. Deliberately **sticky**: focus goes null whenever the user moves to a
   * tab that is not a chat (files, terminal, browser), and treating that as "no active
   * workspace" would stop observing the very workspace they are sitting in. Only focusing an
   * agent in a *different* workspace moves it.
   */
  private syncActiveWorkspaceFromActivity(): void {
    const focusedAgentId = this.clientActivity?.focusedAgentId;
    if (!focusedAgentId) {
      return;
    }
    const cwd = this.agentManager.getAgent(focusedAgentId)?.cwd;
    if (!cwd) {
      return;
    }
    this.workspaceGitService.setActiveWorkspace(cwd);
    this.lspService.setActiveWorkspace(cwd);
  }

  private async clearFocusedTerminalAttention(terminalId: string): Promise<void> {
    const terminalManager = this.terminalManager;
    if (!terminalManager) {
      return;
    }
    try {
      await terminalManager.clearTerminalAttention(terminalId);
    } catch (error) {
      this.sessionLogger.warn({ err: error, terminalId }, "Failed to clear terminal attention");
    }
  }

  /**
   * Handle push token registration
   */
  /**
   * Per-category context window breakdown for the client's context popup.
   * `usage: null` (not an error) when the agent is gone, its provider doesn't
   * implement the read, or the provider has no live handle to report from.
   */
  private async handleAgentContextGetUsageRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.context.get_usage.request" }>,
  ): Promise<void> {
    const { agentId, requestId } = msg;
    try {
      const agent = this.agentManager.listAgents().find((a) => a.id === agentId);
      const usage = agent?.session?.getContextUsage ? await agent.session.getContextUsage() : null;
      this.emit({
        type: "agent.context.get_usage.response",
        payload: { requestId, agentId, usage },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sessionLogger.error({ err, agentId }, "Failed to get agent context usage");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId,
          requestType: msg.type,
          error: `Failed to get agent context usage: ${err.message}`,
          code: "agent_context_get_usage_failed",
        },
      });
    }
  }

  private handleRegisterPushToken(token: string): void {
    this.registeredPushToken = token;
    this.pushNotifications.renew(token);
    this.sessionLogger.info("Registered push token");
  }

  /**
   * Handle list commands request for an agent
   */
  private async handleListCommandsRequest(
    msg: Extract<SessionInboundMessage, { type: "list_commands_request" }>,
  ): Promise<void> {
    const { agentId, requestId, draftConfig } = msg;
    this.sessionLogger.debug(
      { agentId, draftConfig },
      `Handling list commands request for agent ${agentId}`,
    );

    try {
      const existing = this.agentManager.getAgent(agentId);
      const stored = existing ? null : await this.agentStorage.get(agentId);
      const agent =
        existing || (stored && !stored.archivedAt)
          ? await ensureAgentLoaded(agentId, {
              agentManager: this.agentManager,
              agentStorage: this.agentStorage,
              logger: this.sessionLogger,
            })
          : null;

      if (agent?.session?.listCommands) {
        const commands = await agent.session.listCommands();
        this.emit({
          type: "list_commands_response",
          payload: {
            agentId,
            commands,
            error: null,
            requestId,
          },
        });
        return;
      }

      if (!agent && draftConfig) {
        const sessionConfig: AgentSessionConfig = {
          provider: draftConfig.provider,
          cwd: expandTilde(draftConfig.cwd),
          ...(draftConfig.modeId ? { modeId: draftConfig.modeId } : {}),
          ...(draftConfig.model ? { model: draftConfig.model } : {}),
          ...(draftConfig.thinkingOptionId
            ? { thinkingOptionId: draftConfig.thinkingOptionId }
            : {}),
        };

        const commands = await this.agentManager.listDraftCommands(sessionConfig);
        this.emit({
          type: "list_commands_response",
          payload: {
            agentId,
            commands,
            error: null,
            requestId,
          },
        });
        return;
      }

      this.emit({
        type: "list_commands_response",
        payload: {
          agentId,
          commands: [],
          error: agent ? `Agent does not support listing commands` : `Agent not found: ${agentId}`,
          requestId,
        },
      });
    } catch (error) {
      this.sessionLogger.error({ err: error, agentId, draftConfig }, "Failed to list commands");
      this.emit({
        type: "list_commands_response",
        payload: {
          agentId,
          commands: [],
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  /**
   * Handle agent permission response from user
   */
  private async handleAgentPermissionResponse(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    try {
      await respondToAgentPermission({
        agentManager: this.agentManager,
        agentId,
        requestId,
        response,
        logger: this.sessionLogger,
      });
    } catch (error) {
      this.sessionLogger.error(
        { err: error, agentId, requestId },
        "Failed to respond to permission",
      );
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to respond to permission: ${getErrorMessage(error)}`,
        },
      });
      throw error;
    }
  }

  private async handleDirectorySuggestionsRequest(msg: DirectorySuggestionsRequest): Promise<void> {
    const { query, limit, requestId, cwd, includeFiles, includeDirectories, matchMode } = msg;

    try {
      const workspaceCwd = cwd?.trim();
      const searchesWorkspace = Boolean(workspaceCwd);
      const entries = await searchDirectoryEntries({
        root: workspaceCwd ? expandTilde(workspaceCwd) : (process.env.HOME ?? homedir()),
        query,
        pathFormat: searchesWorkspace ? "relative" : "absolute",
        pathQueryPolicy: searchesWorkspace ? "slashes" : "rooted",
        blankQueryBehavior: searchesWorkspace ? "children" : "none",
        rootAliases: searchesWorkspace ? [] : ["~"],
        traversableHiddenDirectoryNames: searchesWorkspace
          ? WORKSPACE_SEARCH_HIDDEN_DIRECTORIES
          : [],
        confidentResultScanThreshold: searchesWorkspace ? undefined : 5_000,
        respectGitIgnore: searchesWorkspace,
        includeFiles,
        includeDirectories,
        matchMode,
        limit,
      });
      const directories = entries
        .filter((entry) => entry.kind === "directory")
        .map((entry) => entry.path);
      this.emit({
        type: "directory_suggestions_response",
        payload: {
          directories,
          entries,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.emit({
        type: "directory_suggestions_response",
        payload: {
          directories: [],
          entries: [],
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  private async handleOttoWorktreeListRequest(
    msg: Extract<SessionInboundMessage, { type: "otto_worktree_list_request" }>,
  ): Promise<void> {
    return handleWorktreeListRequest(
      {
        emit: (message) => this.emit(message),
        ottoHome: this.ottoHome,
        workspaceGitService: this.workspaceGitService,
      },
      msg,
    );
  }

  private async handleOttoWorktreeArchiveRequest(
    msg: Extract<SessionInboundMessage, { type: "otto_worktree_archive_request" }>,
  ): Promise<void> {
    return handleWorktreeArchiveRequest(
      {
        ottoHome: this.ottoHome,
        ottoWorktreesBaseRoot: this.worktreesRoot,
        github: this.github,
        workspaceGitService: this.workspaceGitService,
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        findWorkspaceIdForCwd: (cwd) => this.findWorkspaceIdForCwd(cwd),
        listActiveWorkspaces: () => this.listActiveWorkspaceRefs(),
        archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
        emit: (message) => this.emit(message),
        emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds) =>
          this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds),
        markWorkspaceArchiving: (workspaceIds, archivingAt) =>
          this.markWorkspaceArchiving(workspaceIds, archivingAt),
        clearWorkspaceArchiving: (workspaceIds) => this.clearWorkspaceArchiving(workspaceIds),
        killTerminalsForWorkspace: (workspaceId) =>
          this.terminalController.killTerminalsForWorkspace(workspaceId),
        stopLanguageServers: (rootPath) => this.stopWorkspaceProcesses(rootPath),
        sessionLogger: this.sessionLogger,
      },
      msg,
    );
  }

  private async listTerminalActivityContributions(): Promise<
    Array<{ cwd: string; workspaceId?: string; activity: TerminalActivity | null }>
  > {
    const terminalManager = this.terminalManager;
    if (!terminalManager) {
      return [];
    }
    const directories = terminalManager.listDirectories();
    const terminalsByDirectory = await Promise.all(
      directories.map((cwd) => terminalManager.getTerminals(cwd)),
    );
    return terminalsByDirectory.flat().map((session) => {
      const contribution: { cwd: string; workspaceId?: string; activity: TerminalActivity | null } =
        {
          cwd: session.cwd,
          activity: session.getActivity(),
        };
      if (session.workspaceId) {
        contribution.workspaceId = session.workspaceId;
      }
      return contribution;
    });
  }

  /**
   * Build the current agent list payload (live + persisted), optionally filtered by labels.
   *
   * `workspaceIds`/`agentIds` narrow which agents get PROJECTED, not which
   * exist: the live-id set below is still built from every live agent, so a
   * record whose live counterpart sits outside the scope is still recognised as
   * live rather than resurfacing as a stale stored projection. Scoping exists
   * because the per-workspace descriptor rebuild runs on every agent lifecycle
   * event and would otherwise clone every live agent and project every persisted
   * record in the home. See WorkspaceDirectory.listAgentPayloadsForScope.
   */
  private async listAgentPayloads(filter?: {
    labels?: Record<string, string>;
    includeArchived?: boolean;
    includeUnavailablePersisted?: boolean;
    workspaceIds?: ReadonlySet<string>;
    agentIds?: ReadonlySet<string>;
  }): Promise<AgentSnapshotPayload[]> {
    const includeArchived = filter?.includeArchived === true;
    const labelEntries = filter?.labels ? Object.entries(filter.labels) : [];
    const scope =
      filter?.workspaceIds || filter?.agentIds
        ? {
            workspaceIds: filter.workspaceIds ?? new Set<string>(),
            agentIds: filter.agentIds ?? new Set<string>(),
          }
        : null;
    const isInScope = (candidate: { id: string; workspaceId?: string }): boolean =>
      !scope ||
      scope.agentIds.has(candidate.id) ||
      (candidate.workspaceId !== undefined && scope.workspaceIds.has(candidate.workspaceId));

    // Get live agents with session modes
    const liveManagedAgents = this.agentManager.listAgents();
    const liveIds = new Set(liveManagedAgents.map((a) => a.id));
    const agentSnapshots = scope ? liveManagedAgents.filter(isInScope) : liveManagedAgents;
    const liveAgents = await Promise.all(
      agentSnapshots.map((agent) => this.buildAgentPayload(agent)),
    );

    // Add persisted agents that have not been lazily initialized yet
    // (excluding internal agents which are for ephemeral system tasks)
    const registryRecords = await this.agentStorage.list(scope ?? undefined);
    const registeredProviderIds = new Set(this.providerSnapshotManager.listRegisteredProviderIds());
    const persistedAgents = registryRecords
      .filter((record) => !liveIds.has(record.id) && !record.internal)
      // Keep raw-record filters ahead of projection; seeded homes can carry thousands of archived agents.
      .filter((record) => includeArchived || !record.archivedAt)
      .filter((record) => labelEntries.every(([key, value]) => record.labels?.[key] === value))
      .filter(
        (record) =>
          filter?.includeUnavailablePersisted === true ||
          isStoredAgentProviderAvailable(record, registeredProviderIds),
      )
      .map((record) => this.buildStoredAgentPayload(record, registeredProviderIds));

    // Observed subagents are ephemeral registry projections (no ManagedAgent,
    // no stored record) that otherwise reach clients only as live pushes -
    // include them so a client that fetches mid-run (page refresh, reconnect)
    // learns about in-flight children instead of waiting for the provider's
    // next task event. The shared archived/label filters below apply to them
    // like any other agent.
    const allObservedAgents = this.agentManager.listObservedSubagentPayloads();
    const observedAgents = scope ? allObservedAgents.filter(isInScope) : allObservedAgents;

    let agents = [...liveAgents, ...persistedAgents, ...observedAgents];

    agents = agents.filter((agent) => this.isProviderVisibleToClient(agent.provider));
    if (!includeArchived) {
      agents = agents.filter((agent) => !agent.archivedAt);
    }

    // Filter by labels if filter provided
    if (labelEntries.length > 0) {
      agents = agents.filter((agent) =>
        labelEntries.every(([key, value]) => agent.labels[key] === value),
      );
    }

    return agents;
  }

  private async resolveAgentIdentifier(
    identifier: string,
  ): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      return { ok: false, error: "Agent identifier cannot be empty" };
    }

    // Exact live-agent lookup bypasses the internal-agent exclusion below.
    // Internal agents (e.g. artifact generation) are deliberately hidden from
    // the fuzzy prefix/title resolution and general listings further down,
    // but a caller that already has the literal agentId (not a prefix or
    // title guess) should still be able to resolve it while it's alive.
    if (this.agentManager.getAgent(trimmed)) {
      return { ok: true, agentId: trimmed };
    }

    // Observed subagents (Claude Task / ultracode fan-out) are ephemeral
    // projections with no ManagedAgent record and are never written to
    // storage. A track row can still reference one after the client store
    // dropped it (placement remove, reconnect), so resolve the synthetic id
    // straight from the registry - otherwise fetch_agent 404s a run that is
    // fine. See docs/agent-lifecycle.md (Item 1).
    if (this.agentManager.getObservedSubagentPayload(trimmed)) {
      return { ok: true, agentId: trimmed };
    }

    const stored = await this.agentStorage.list();
    const storedRecords = stored.filter((record) => !record.internal);
    const knownIds = new Set<string>();
    for (const record of storedRecords) {
      knownIds.add(record.id);
    }
    for (const agent of this.agentManager.listAgents()) {
      knownIds.add(agent.id);
    }

    if (knownIds.has(trimmed)) {
      return { ok: true, agentId: trimmed };
    }

    const prefixMatches = Array.from(knownIds).filter((id) => id.startsWith(trimmed));
    if (prefixMatches.length === 1) {
      return { ok: true, agentId: prefixMatches[0] };
    }
    if (prefixMatches.length > 1) {
      return {
        ok: false,
        error: `Agent identifier "${trimmed}" is ambiguous (${prefixMatches
          .slice(0, 5)
          .map((id) => id.slice(0, 8))
          .join(", ")}${prefixMatches.length > 5 ? ", …" : ""})`,
      };
    }

    const titleMatches = storedRecords.filter((record) => record.title === trimmed);
    if (titleMatches.length === 1) {
      return { ok: true, agentId: titleMatches[0].id };
    }
    if (titleMatches.length > 1) {
      return {
        ok: false,
        error: `Agent title "${trimmed}" is ambiguous (${titleMatches
          .slice(0, 5)
          .map((r) => r.id.slice(0, 8))
          .join(", ")}${titleMatches.length > 5 ? ", …" : ""})`,
      };
    }

    return { ok: false, error: `Agent not found: ${trimmed}` };
  }

  private async getAgentPayloadById(agentId: string): Promise<AgentSnapshotPayload | null> {
    const live = this.agentManager.getAgent(agentId);
    if (live) {
      const payload = await this.buildAgentPayload(live);
      return this.isProviderVisibleToClient(payload.provider) ? payload : null;
    }

    const record = await this.agentStorage.get(agentId);
    if (record && !record.internal) {
      const payload = this.buildStoredAgentPayload(record);
      return this.isProviderVisibleToClient(payload.provider) ? payload : null;
    }

    // Observed subagents have no live ManagedAgent and no stored record; serve
    // the registry projection so the pane hydrates instead of dead-ending on a
    // 404. See docs/agent-lifecycle.md (Item 1).
    const observed = this.agentManager.getObservedSubagentPayload(agentId);
    if (observed && this.isProviderVisibleToClient(observed.provider)) {
      return observed;
    }

    // Retained generation transcripts (schedule / artifact) are internal agents
    // that were closed after their run - no live agent, no stored record - but
    // we snapshotted their final payload so the read-only viewer can open them.
    // See docs/safe-unattended.md.
    const retained = await this.agentManager.getRetainedTranscriptPayload(agentId);
    if (retained && this.isProviderVisibleToClient(retained.provider)) {
      return retained;
    }

    return null;
  }

  private async resolveDelegationRootWorkspaceId(agentId: string): Promise<string | null> {
    const seen = new Set<string>();
    let currentAgentId = agentId;

    while (true) {
      if (seen.has(currentAgentId)) {
        return null;
      }
      seen.add(currentAgentId);

      const live = this.agentManager.getAgent(currentAgentId);
      const source = live ?? (await this.agentStorage.get(currentAgentId));
      if (!source) {
        return null;
      }
      if ("archivedAt" in source && source.archivedAt) {
        return null;
      }

      const parentAgentId = getParentAgentIdFromLabels(source.labels);
      if (!parentAgentId) {
        return source.workspaceId ?? null;
      }
      currentAgentId = parentAgentId;
    }
  }

  private async buildActiveProjectPlacementsByWorkspaceId(): Promise<
    Map<string, ProjectPlacementPayload>
  > {
    const [persistedWorkspaces, persistedProjects] = await Promise.all([
      this.workspaceRegistry.list(),
      this.projectRegistry.list(),
    ]);
    const activeProjects = new Map(
      persistedProjects
        .filter((project) => !project.archivedAt)
        .map((project) => [project.projectId, project] as const),
    );
    const placementsByWorkspaceId = new Map<string, ProjectPlacementPayload>();

    const pairs = persistedWorkspaces.flatMap((workspace) => {
      if (workspace.archivedAt) return [];
      const project = activeProjects.get(workspace.projectId);
      if (!project) return [];
      return [{ workspace, project }];
    });
    const placements = await Promise.all(
      pairs.map(({ workspace, project }) =>
        this.buildProjectPlacementForWorkspace(workspace, project),
      ),
    );
    for (let i = 0; i < pairs.length; i += 1) {
      placementsByWorkspaceId.set(pairs[i].workspace.workspaceId, placements[i]);
    }

    return placementsByWorkspaceId;
  }

  private async collectFetchAgentsEntries(params: {
    candidates: AgentSnapshotPayload[];
    limit: number;
    getPlacement: (workspaceId: string | undefined) => Promise<ProjectPlacementPayload | null>;
    filter: AgentUpdatesFilter | undefined;
  }): Promise<FetchAgentsResponseEntry[]> {
    const { candidates, limit, getPlacement, filter } = params;
    const matchedEntries: FetchAgentsResponseEntry[] = [];
    const batchSize = 25;
    for (
      let start = 0;
      start < candidates.length && matchedEntries.length <= limit;
      start += batchSize
    ) {
      const batch = candidates.slice(start, start + batchSize);
      const batchEntries = await Promise.all(
        batch.map(async (agent) => {
          const project = await getPlacement(agent.workspaceId);
          return project ? { agent, project } : null;
        }),
      );
      for (const entry of batchEntries) {
        if (!entry) {
          continue;
        }
        if (
          !matchesAgentUpdatesFilter({
            agent: entry.agent,
            project: entry.project,
            filter,
          })
        ) {
          continue;
        }
        matchedEntries.push(entry);
        if (matchedEntries.length > limit) {
          break;
        }
      }
    }
    return matchedEntries;
  }

  private async listFetchAgentsEntries(request: AgentDirectoryRequestMessage): Promise<{
    entries: FetchAgentsResponseEntry[];
    pageInfo: FetchAgentsResponsePageInfo;
    searchTruncated?: boolean;
  }> {
    const filter =
      request.type === "fetch_agent_history_request" &&
      request.filter?.includeArchived === undefined
        ? { ...request.filter, includeArchived: true }
        : request.filter;
    const scope = request.type === "fetch_agents_request" ? request.scope : undefined;
    const sort = this.agentsPager.normalizeSort(request.sort);

    let agents = await this.listAgentPayloads({
      labels: filter?.labels,
      includeArchived: filter?.includeArchived,
      includeUnavailablePersisted: request.type === "fetch_agent_history_request",
    });
    const activePlacementsByWorkspaceId =
      scope === "active" ? await this.buildActiveProjectPlacementsByWorkspaceId() : null;
    if (activePlacementsByWorkspaceId) {
      agents = agents.filter(
        (agent) =>
          !agent.archivedAt &&
          agent.workspaceId != null &&
          activePlacementsByWorkspaceId.has(agent.workspaceId),
      );
    }

    const placementByWorkspaceId = new Map<string, Promise<ProjectPlacementPayload | null>>();
    const getPlacement = (
      workspaceId: string | undefined,
    ): Promise<ProjectPlacementPayload | null> => {
      if (!workspaceId) {
        return Promise.resolve(null);
      }
      if (activePlacementsByWorkspaceId) {
        return Promise.resolve(activePlacementsByWorkspaceId.get(workspaceId) ?? null);
      }
      const existing = placementByWorkspaceId.get(workspaceId);
      if (existing) {
        return existing;
      }
      const placementPromise = this.buildProjectPlacementForWorkspaceId(workspaceId);
      placementByWorkspaceId.set(workspaceId, placementPromise);
      return placementPromise;
    };

    const search = agentDirectorySearchQuery(request);
    if (search) {
      return this.listRankedAgentHistoryEntries({
        search,
        agents,
        sort,
        filter,
        getPlacement,
        page: request.page,
      });
    }

    let candidates = [...agents];
    candidates.sort((left, right) => this.agentsPager.compare(left, right, sort));
    const cursorToken = request.page?.cursor;
    if (cursorToken) {
      const cursor = this.decodeAgentCursor(cursorToken, sort);
      candidates = candidates.filter(
        (agent) => this.agentsPager.compareWithCursor(agent, cursor, sort) > 0,
      );
    }

    const limit = request.page?.limit ?? 200;

    const matchedEntries = await this.collectFetchAgentsEntries({
      candidates,
      limit,
      getPlacement,
      filter,
    });

    const pagedEntries = matchedEntries.slice(0, limit);
    const hasMore = matchedEntries.length > limit;
    const nextCursor =
      hasMore && pagedEntries.length > 0
        ? this.agentsPager.encode(pagedEntries[pagedEntries.length - 1].agent, sort)
        : null;

    return {
      entries: pagedEntries,
      pageInfo: {
        nextCursor,
        prevCursor: request.page?.cursor ?? null,
        hasMore,
      },
    };
  }

  /**
   * The searched history page. Ranking has to see every candidate before it can
   * name the best one, so this path resolves placements for the whole set
   * instead of stopping at the page limit — that is what makes a query answer
   * from all persisted sessions rather than from the first page of them.
   */
  private async listRankedAgentHistoryEntries(params: {
    search: string;
    agents: AgentSnapshotPayload[];
    sort: FetchAgentsRequestSort[];
    filter: AgentUpdatesFilter | undefined;
    getPlacement: (workspaceId: string | undefined) => Promise<ProjectPlacementPayload | null>;
    page: AgentDirectoryRequestMessage["page"];
  }): Promise<{
    entries: FetchAgentsResponseEntry[];
    pageInfo: FetchAgentsResponsePageInfo;
    searchTruncated: boolean;
  }> {
    const { search, agents, sort, filter, getPlacement, page } = params;
    if (page?.cursor) {
      // A ranked result set has no pages to walk, so a cursor here is caller
      // misuse. Returning the ranked head instead would hide it.
      throw new SessionRequestError(
        "invalid_cursor",
        "A history search returns one ranked page; it cannot be paged with a cursor.",
      );
    }

    const allEntries = await this.collectFetchAgentsEntries({
      candidates: agents,
      limit: Number.MAX_SAFE_INTEGER,
      getPlacement,
      filter,
    });

    const ranked = rankAgentHistoryCandidates(search, allEntries, (left, right) =>
      this.agentsPager.compare(left.agent, right.agent, sort),
    );

    const limit = page?.limit ?? 200;
    // Ranges are derived only for the rows that will be rendered; ranking
    // itself never needs them.
    const entries = ranked.slice(0, limit).map((result) =>
      Object.assign({}, result.candidate, {
        searchScore: result.searchScore,
        searchMatches: describeAgentHistoryMatches(search, result.candidate),
      }),
    );

    return {
      entries,
      // No next page exists, so `hasMore` is false and truncation is reported
      // on its own field. See the note on rankAgentHistoryCandidates.
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      searchTruncated: ranked.length > limit,
    };
  }

  private readonly agentsPager = new SortablePager<
    AgentSnapshotPayload,
    FetchAgentsRequestSort["key"]
  >({
    validKeys: FETCH_AGENTS_SORT_KEYS,
    defaultSort: [{ key: "updated_at", direction: "desc" }],
    label: "fetch_agents",
    getId: (agent) => agent.id,
    getSortValue: (agent, key): number | string => {
      switch (key) {
        case "status_priority":
          return getAgentStatusPriority({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
            requiresAttention: agent.requiresAttention,
            attentionReason: agent.attentionReason ?? null,
          });
        case "created_at":
          return Date.parse(agent.createdAt);
        case "updated_at":
          return Date.parse(agent.updatedAt);
        case "title":
          return agent.title?.toLocaleLowerCase() ?? "";
      }
    },
  });

  private decodeAgentCursor(token: string, sort: SortSpec<FetchAgentsRequestSort["key"]>[]) {
    try {
      return this.agentsPager.decode(token, sort);
    } catch (error) {
      if (error instanceof CursorError) {
        throw new SessionRequestError("invalid_cursor", error.message);
      }
      throw error;
    }
  }

  private async describeWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    const resolvedProjectRecord =
      projectRecord ?? (await this.projectRegistry.get(workspace.projectId));

    let diffStat: { additions: number; deletions: number } | null = null;
    const snapshot = this.workspaceGitService.peekSnapshot(workspace.cwd);
    if (snapshot?.git.diffStat) {
      diffStat = snapshot.git.diffStat;
    }

    const worktreeSlug =
      workspace.isOttoOwnedWorktree && workspace.worktreeRoot
        ? basename(workspace.worktreeRoot)
        : undefined;

    return {
      id: workspace.workspaceId,
      projectId: workspace.projectId,
      projectDisplayName: resolvedProjectRecord
        ? resolveProjectDisplayName(resolvedProjectRecord)
        : workspace.projectId,
      projectCustomName: resolvedProjectRecord?.customName ?? null,
      projectCustomIconRevision: resolvedProjectRecord?.customIconRevision ?? null,
      projectRootPath: resolvedProjectRecord?.rootPath ?? workspace.cwd,
      workspaceDirectory: workspace.cwd,
      worktreeSlug,
      projectKind: (resolvedProjectRecord?.kind ?? "directory") === "git" ? "git" : "non_git",
      workspaceKind: workspace.kind,
      name: resolveWorkspaceDisplayName(workspace),
      title: workspace.title,
      pinnedAt: workspace.pinnedAt,
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat,
      workingTreeDiffStat: snapshot?.git.workingTreeDiffStat ?? null,
      scripts: this.buildWorkspaceScriptPayloadSnapshot(workspace, resolvedProjectRecord),
      ...(resolvedProjectRecord
        ? {
            project: await this.buildProjectPlacementForWorkspace(workspace, resolvedProjectRecord),
          }
        : {}),
    };
  }

  private buildWorkspaceGitRuntimePayload(
    snapshot: WorkspaceGitRuntimeSnapshot,
  ): NonNullable<WorkspaceDescriptorPayload["gitRuntime"]> | null {
    if (!snapshot.git.isGit) {
      return null;
    }

    return {
      currentBranch: snapshot.git.currentBranch,
      remoteUrl: snapshot.git.remoteUrl,
      isOttoOwnedWorktree: snapshot.git.isOttoOwnedWorktree,
      isDirty: snapshot.git.isDirty,
      baseRef: snapshot.git.baseRef,
      aheadBehind: snapshot.git.aheadBehind,
      aheadOfOrigin: snapshot.git.aheadOfOrigin,
      behindOfOrigin: snapshot.git.behindOfOrigin,
    };
  }

  /**
   * Resolves "which board does this project show?" for the Kanban screen.
   *
   * The app names a project; everything else is decided here, so the picker
   * stays dumb and the wire stays provider-agnostic. A project with no kanban
   * target returns null, which the screen renders as the unconfigured
   * watermark rather than an error.
   */
  private async resolveKanbanProjectTarget(input: {
    projectId?: string;
    projectKey?: string;
  }): Promise<KanbanProjectTarget | null> {
    const project = input.projectId
      ? await this.projectRegistry.get(input.projectId)
      : ((await this.projectRegistry.list()).find(
          (candidate) => candidate.projectKey === input.projectKey,
        ) ?? null);
    const target = project?.kanban;
    if (!project || !target) {
      return null;
    }
    if (target.adapter === "jira") {
      // Jira boards are site-scoped, not repo-scoped: the board id is the whole
      // address, and an unset one is a misconfiguration the settings form
      // prevents.
      return { adapter: "jira", boardId: target.boardId };
    }
    // GitHub with no explicit board derives the project's boards from its git
    // remote, so a repo-scoped board needs no configuration at all.
    const remote = target.boardId ? null : await this.readProjectGitHubRemote(project.rootPath);
    return {
      adapter: "github",
      boardId: target.boardId,
      ...(remote ? { owner: remote.owner, repo: remote.repo } : {}),
    };
  }

  private async readProjectGitHubRemote(
    rootPath: string,
  ): Promise<{ owner: string; repo: string } | null> {
    try {
      const { stdout } = await runGitCommand(["remote", "get-url", "origin"], {
        cwd: rootPath,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
      });
      const parsed = parseGitHubRemoteUrl(stdout.trim());
      return parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
    } catch {
      // A project without a readable origin simply has no repo scoping; the
      // provider falls back to the account's own boards.
      return null;
    }
  }

  private buildWorkspaceGitHubRuntimePayload(
    snapshot: WorkspaceGitRuntimeSnapshot,
  ): NonNullable<WorkspaceDescriptorPayload["githubRuntime"]> {
    return {
      featuresEnabled: snapshot.forge.featuresEnabled,
      pullRequest: snapshot.forge.pullRequest,
      error: snapshot.forge.error,
    };
  }

  private async describeWorkspaceRecordWithGitData(
    workspace: PersistedWorkspaceRecord,
    projectRecord?: PersistedProjectRecord | null,
  ): Promise<WorkspaceDescriptorPayload> {
    const base = await this.describeWorkspaceRecord(workspace, projectRecord);
    const snapshot = this.workspaceGitService.peekSnapshot(workspace.cwd);
    if (!snapshot) {
      return base;
    }

    const checkout = checkoutLiteFromGitSnapshot(workspace.cwd, snapshot.git);
    const displayName = deriveWorkspaceDisplayName({ cwd: workspace.cwd, checkout });

    return {
      ...base,
      name: resolveWorkspaceName({ title: workspace.title, derivedDisplayName: displayName }),
      diffStat: snapshot.git.diffStat ?? null,
      workingTreeDiffStat: snapshot.git.workingTreeDiffStat ?? null,
      gitRuntime: this.buildWorkspaceGitRuntimePayload(snapshot) ?? undefined,
      githubRuntime: this.buildWorkspaceGitHubRuntimePayload(snapshot),
      // Reuse the forge already resolved on the snapshot (probe-aware; GitHub-only
      // resolves to "github") so the sidebar/hover-card brand mark matches the
      // status projection without a second resolve.
      forge: snapshot.forge.forge,
    };
  }

  private async describeCreatedWorktreeWorkspace(
    result: CreateOttoWorktreeResult,
  ): Promise<WorkspaceDescriptorPayload> {
    const projectRecord = await this.projectRegistry.get(result.workspace.projectId);
    return {
      id: result.workspace.workspaceId,
      projectId: result.workspace.projectId,
      projectDisplayName: projectRecord
        ? resolveProjectDisplayName(projectRecord)
        : result.workspace.projectId,
      projectCustomName: projectRecord?.customName ?? null,
      projectCustomIconRevision: projectRecord?.customIconRevision ?? null,
      projectRootPath: projectRecord?.rootPath ?? result.repoRoot,
      workspaceDirectory: result.workspace.cwd,
      worktreeSlug: basename(result.worktree.worktreePath),
      projectKind: projectRecord?.kind ?? "git",
      workspaceKind: result.workspace.kind,
      name: resolveWorkspaceName({
        title: result.workspace.title,
        derivedDisplayName: result.worktree.branchName || result.workspace.displayName,
      }),
      title: result.workspace.title,
      pinnedAt: result.workspace.pinnedAt,
      archivingAt: null,
      status: "done",
      statusEnteredAt: result.workspace.createdAt,
      activityAt: null,
      diffStat: { additions: 0, deletions: 0 },
      workingTreeDiffStat: null,
      scripts: [],
      gitRuntime: {
        currentBranch: result.worktree.branchName || null,
        remoteUrl: null,
        isOttoOwnedWorktree: true,
        isDirty: false,
        baseRef: null,
        aheadBehind: null,
        aheadOfOrigin: null,
        behindOfOrigin: null,
      },
      githubRuntime: null,
    };
  }

  private async buildWorkspaceDescriptor(input: {
    workspace: PersistedWorkspaceRecord;
    projectRecord?: PersistedProjectRecord | null;
    includeGitData: boolean;
  }): Promise<WorkspaceDescriptorPayload> {
    if (input.includeGitData && input.workspace.kind !== "directory") {
      return this.describeWorkspaceRecordWithGitData(input.workspace, input.projectRecord);
    }
    return this.describeWorkspaceRecord(input.workspace, input.projectRecord);
  }

  markWorkspaceArchiving(workspaceIds: Iterable<string>, archivingAt: string): void {
    this.workspaceDirectory.markArchiving(workspaceIds, archivingAt);
  }

  clearWorkspaceArchiving(workspaceIds: Iterable<string>): void {
    this.workspaceDirectory.clearArchiving(workspaceIds);
  }

  private async buildWorkspaceDescriptorMap(options: {
    includeGitData: boolean;
    workspaceIds?: Iterable<string>;
  }): Promise<Map<string, WorkspaceDescriptorPayload>> {
    return this.workspaceDirectory.buildDescriptorMap(options);
  }

  // external path→workspace adapter, not ownership. Used by archive-by-path flows
  // where the request carries a worktree path (unique to one workspace) rather
  // than a workspaceId. This is a directory lookup for an archive target, not a
  // status/ownership attribution.
  private async findWorkspaceIdForCwd(cwd: string): Promise<string | null> {
    const workspaces = await this.workspaceRegistry.list();
    return resolveWorkspaceIdForPath(cwd, workspaces);
  }

  private matchesWorkspaceFilter(input: {
    workspace: WorkspaceDescriptorPayload;
    filter: FetchWorkspacesRequestFilter | undefined;
  }): boolean {
    return this.workspaceDirectory.matchesFilter(input);
  }

  private async listFetchWorkspacesEntries(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<{
    entries: FetchWorkspacesResponseEntry[];
    emptyProjects: WorkspaceProjectDescriptorPayload[];
    pageInfo: FetchWorkspacesResponsePageInfo;
  }> {
    try {
      return await this.workspaceDirectory.listFetchEntries(request);
    } catch (error) {
      if (error instanceof CursorError) {
        throw new SessionRequestError("invalid_cursor", error.message);
      }
      throw error;
    }
  }

  private bufferOrEmitWorkspaceUpdate(
    subscription: WorkspaceUpdatesSubscriptionState,
    payload: WorkspaceUpdatePayload,
  ): void {
    if (payload.kind === "upsert") {
      subscription.visibleEmptyProjectIds?.delete(payload.workspace.projectId);
    } else {
      if (payload.emptyProject) {
        subscription.visibleEmptyProjectIds?.add(payload.emptyProject.projectId);
      }
      if (payload.removedProjectId) {
        subscription.visibleEmptyProjectIds?.delete(payload.removedProjectId);
      }
    }
    if (subscription.isBootstrapping) {
      const workspaceId = payload.kind === "upsert" ? payload.workspace.id : payload.id;
      subscription.pendingUpdatesByWorkspaceId.set(workspaceId, payload);
      return;
    }
    const workspaceId = payload.kind === "upsert" ? payload.workspace.id : payload.id;
    subscription.lastEmittedByWorkspaceId.set(workspaceId, payload);
    this.emit({
      type: "workspace_update",
      payload,
    });
  }

  private flushBootstrappedWorkspaceUpdates(options?: {
    snapshotByWorkspaceId?: Map<
      string,
      { status: string; statusEnteredAt: string | null; activityAtMs: number | null }
    >;
  }): void {
    const subscription = this.workspaceUpdatesSubscription;
    if (!subscription || !subscription.isBootstrapping) {
      return;
    }

    subscription.isBootstrapping = false;
    const pending = Array.from(subscription.pendingUpdatesByWorkspaceId.values());
    subscription.pendingUpdatesByWorkspaceId.clear();

    for (const payload of pending) {
      if (payload.kind === "upsert") {
        const snapshot = options?.snapshotByWorkspaceId?.get(payload.workspace.id);
        const updateActivityAtMs = payload.workspace.activityAt
          ? Date.parse(payload.workspace.activityAt)
          : null;
        const shouldEmit = shouldEmitPendingBootstrapUpdate({
          snapshot: snapshot
            ? {
                status: snapshot.status,
                statusEnteredAt: snapshot.statusEnteredAt,
                activityAtMs: snapshot.activityAtMs,
              }
            : null,
          update: {
            status: payload.workspace.status,
            statusEnteredAt: payload.workspace.statusEnteredAt ?? null,
            activityAtMs: Number.isNaN(updateActivityAtMs) ? null : updateActivityAtMs,
          },
        });
        if (!shouldEmit) {
          continue;
        }
      }
      const workspaceId = payload.kind === "upsert" ? payload.workspace.id : payload.id;
      subscription.lastEmittedByWorkspaceId.set(workspaceId, payload);
      this.emit({
        type: "workspace_update",
        payload,
      });
    }
  }

  private buildProjectDescriptor(
    project: PersistedProjectRecord,
  ): WorkspaceProjectDescriptorPayload {
    return {
      projectId: project.projectId,
      ...(project.projectKey ? { projectKey: project.projectKey } : {}),
      projectDisplayName: resolveProjectDisplayName(project),
      projectCustomName: project.customName ?? null,
      projectKanban: project.kanban ?? null,
      projectCustomIconRevision: project.customIconRevision ?? null,
      projectRootPath: project.rootPath,
      projectKind: project.kind,
    };
  }

  private async restoreWorkspaceAndEmit(workspaceId: string): Promise<void> {
    await this.workspaceRecovery.restore(workspaceId);
    const workspace = await this.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      throw new Error(`Recovered workspace record not found: ${workspaceId}`);
    }
    if (this.onWorkspaceRecovered) {
      try {
        await this.onWorkspaceRecovered(workspace);
        return;
      } catch (error) {
        this.sessionLogger.warn(
          { err: error, workspaceId },
          "Failed to publish workspace recovery to active sessions",
        );
      }
    }
    await this.refreshRecoveredWorkspaceForExternalMutation(workspace);
  }

  private async restoreOwningWorkspaceForLegacyAgentRefresh(agentId: string): Promise<void> {
    // COMPAT(worktreeRestore): clients older than v0.1.105 used refresh_agent_request
    // as their explicit recovery RPC. Remove after 2027-01-11.
    if (!clientUsesLegacyWorkspaceRestore(this.appVersion)) {
      return;
    }
    const record = await this.agentStorage.get(agentId);
    if (!record?.workspaceId) {
      return;
    }
    const recovery = await this.workspaceRecovery.inspect(record.workspaceId);
    if (recovery.kind !== "recoverable") {
      return;
    }
    await this.restoreWorkspaceAndEmit(record.workspaceId);
  }

  // Bring an archived worktree/local workspace back to life: recreate its backing
  // worktree directory from the kept branch when the directory is gone, then clear
  // archivedAt. Returns the unarchived record, or null when a worktree record has
  // no branch to recreate its directory from (nothing to restore). Shared by the
  // agent-triggered unarchive and the explicit worktree.reattach flow.
  private async restoreArchivedWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord | null> {
    const directoryExists = await this.filesystem.isDirectory(workspace.cwd).catch(() => false);
    if (!directoryExists) {
      if (workspace.kind !== "worktree" || !workspace.branch) {
        return null;
      }
      // Recreate the worktree directory from its kept branch BEFORE clearing
      // archivedAt - the reconciler re-archives workspaces whose directory is
      // missing, so the record must point at a real directory first.
      await this.recreateOwningWorktreeForRestore(workspace, workspace.branch);
    }

    return this.workspaceProvisioning.ensureWorkspaceRecordUnarchived(workspace);
  }

  private async recreateOwningWorktreeForRestore(
    workspace: PersistedWorkspaceRecord,
    branch: string,
  ): Promise<void> {
    const project = await this.projectRegistry.get(workspace.projectId);
    if (!project) {
      throw new WorktreeRequestError({
        code: "unknown",
        message: `Project ${workspace.projectId} not found for workspace ${workspace.workspaceId}`,
      });
    }
    const projectRootExists = await this.filesystem
      .isDirectory(project.rootPath)
      .catch(() => false);
    if (!projectRootExists) {
      throw new WorktreeRequestError({
        code: "unknown",
        message: `Project root is missing for ${workspace.projectId}: ${project.rootPath}`,
      });
    }

    // Archiving through the default path (scope "workspace", worktreePath only)
    // resolves repoRoot=null, so deleteOttoWorktree's `git worktree remove`/
    // `prune` is skipped and the admin registration survives - pinning the
    // branch as "already checked out". Prune here frees any stale registration
    // whose working dir is missing (a no-op for live worktrees) so the recreate
    // below succeeds regardless of how the worktree was archived.
    try {
      await runGitCommand(["worktree", "prune"], { cwd: project.rootPath, timeout: 30_000 });
    } catch {
      // not critical; git will prune lazily
    }

    let result: WorktreeConfig;
    try {
      result = await createWorktree({
        cwd: project.rootPath,
        worktreeSlug: basename(workspace.cwd),
        source: { kind: "checkout-branch", branchName: branch },
        runSetup: false,
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
      });
    } catch (error) {
      throw toWorktreeRequestError(error);
    }

    if (normalize(result.worktreePath) !== normalize(workspace.cwd)) {
      throw new WorktreeRequestError({
        code: "unknown",
        message: `Recreated worktree diverged from ${workspace.cwd}: ${result.worktreePath}`,
      });
    }
  }

  private async createOttoWorktree(
    input: CreateOttoWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
    },
  ): Promise<CreateOttoWorktreeResult> {
    const result = await createOttoWorktree(input, {
      github: this.github,
      ...(options?.resolveDefaultBranch
        ? { resolveDefaultBranch: options.resolveDefaultBranch }
        : {}),
      projectRegistry: this.projectRegistry,
      workspaceRegistry: this.workspaceRegistry,
      workspaceGitService: this.workspaceGitService,
      workspaceProvisioning: this.workspaceProvisioning,
    });
    void Promise.all([
      this.gitMutation.notifyGitMutation(input.cwd, "create-worktree"),
      this.gitMutation.notifyGitMutation(result.worktree.worktreePath, "create-worktree"),
    ]).catch((error) => {
      this.sessionLogger.warn(
        { err: error, cwd: input.cwd, worktreePath: result.worktree.worktreePath },
        "Failed to warm git snapshots after creating worktree",
      );
    });
    return result;
  }

  /**
   * Every long-lived process this daemon keeps per workspace directory, released together.
   *
   * Named for what it does rather than for the language servers it started as: the archive
   * teardown's last-reference rule is the same for both subsystems, and a second parallel hook
   * would be a second thing to forget when a third subsystem starts a process. Never throws - a
   * child that refuses to die must not fail an archive that has already happened.
   */
  private async stopWorkspaceProcesses(rootPath: string): Promise<void> {
    await this.lspService.stopWorkspace(rootPath);
    await this.solutionService.stopWorkspace(rootPath);
  }

  private async listActiveWorkspaceRefs(): Promise<ActiveWorkspaceRef[]> {
    const workspaces = await this.workspaceRegistry.list();
    return workspaces
      .filter((workspace) => !workspace.archivedAt)
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        kind: workspace.kind,
        worktreeRoot: workspace.worktreeRoot,
        isOttoOwnedWorktree: workspace.isOttoOwnedWorktree,
        mainRepoRoot: workspace.mainRepoRoot,
      }));
  }

  private async archiveWorkspaceRecord(workspaceId: string, archivedAt?: string): Promise<void> {
    const archiveTimestamp = archivedAt ?? new Date().toISOString();
    const existingWorkspace = await archivePersistedWorkspaceRecord({
      workspaceId,
      archivedAt: archiveTimestamp,
      workspaceRegistry: this.workspaceRegistry,
    });
    if (!existingWorkspace) {
      this.workspaceGitObserver.removeForWorkspaceId(workspaceId);
      return;
    }

    if (!existingWorkspace.archivedAt) {
      const activeSiblings = (await this.workspaceRegistry.list()).filter(
        (workspace) => workspace.projectId === existingWorkspace.projectId && !workspace.archivedAt,
      );
      this.sessionLogger.info(
        {
          workspaceId,
          workspaceCwd: existingWorkspace.cwd,
          projectId: existingWorkspace.projectId,
          projectArchived: activeSiblings.length === 0,
          archivedAt: archiveTimestamp,
        },
        "Workspace archived",
      );
    }

    await this.teardownArchivedWorkspace(existingWorkspace.workspaceId);
  }

  private async teardownArchivedWorkspace(workspaceId: string): Promise<void> {
    this.workspaceGitObserver.removeForWorkspaceId(workspaceId);
    this.scriptRuntimeStore?.removeForWorkspace(workspaceId);
    releaseWorkspaceServicePortPlan(workspaceId);
  }

  private async emitWorkspaceUpdatesForWorkspaceIds(
    workspaceIds: Iterable<string>,
    options?: WorkspaceUpdateOptions,
  ): Promise<void> {
    const subscription = this.workspaceUpdatesSubscription;
    if (!subscription) {
      return;
    }

    const uniqueWorkspaceIds = new Set(Array.from(workspaceIds));
    if (uniqueWorkspaceIds.size === 0) {
      return;
    }

    await this.enqueueWorkspaceUpdates(uniqueWorkspaceIds, subscription, options);
  }

  private enqueueWorkspaceUpdates(
    workspaceIds: ReadonlySet<string>,
    subscription: WorkspaceUpdatesSubscriptionState,
    options: WorkspaceUpdateOptions | undefined,
  ): Promise<void> {
    const previous = Array.from(workspaceIds, (workspaceId) =>
      (this.workspaceUpdateTails.get(workspaceId) ?? Promise.resolve()).catch(() => undefined),
    );
    const next = Promise.all(previous).then(() =>
      this.emitWorkspaceUpdateBatch(workspaceIds, subscription, options),
    );
    for (const workspaceId of workspaceIds) {
      this.workspaceUpdateTails.set(workspaceId, next);
    }

    const clearTail = () => {
      for (const workspaceId of workspaceIds) {
        if (this.workspaceUpdateTails.get(workspaceId) === next) {
          this.workspaceUpdateTails.delete(workspaceId);
        }
      }
    };
    void next.then(clearTail, clearTail);
    return next;
  }

  private async emitWorkspaceUpdateBatch(
    workspaceIds: ReadonlySet<string>,
    subscription: WorkspaceUpdatesSubscriptionState,
    options: WorkspaceUpdateOptions | undefined,
  ): Promise<void> {
    if (this.workspaceUpdatesSubscription !== subscription) {
      return;
    }

    const descriptorsByWorkspaceId = await this.buildWorkspaceDescriptorMap({
      workspaceIds,
      includeGitData: true,
    });

    for (const workspaceId of workspaceIds) {
      if (this.workspaceUpdatesSubscription !== subscription) {
        return;
      }
      const workspace = descriptorsByWorkspaceId.get(workspaceId);
      const filteredWorkspace =
        workspace && this.matchesWorkspaceFilter({ workspace, filter: subscription.filter })
          ? workspace
          : null;
      const nextWorkspace = this.applyOptimisticWorkspaceStatus(
        filteredWorkspace,
        options?.optimisticStatus,
      );
      const lastEmitted = subscription.lastEmittedByWorkspaceId.get(workspaceId);
      if (
        options?.dedupeGitState &&
        this.workspaceGitObserver.shouldSkipUpdate(workspaceId, nextWorkspace)
      ) {
        continue;
      }
      this.workspaceGitObserver.recordDescriptorState(workspaceId, nextWorkspace);

      if (!nextWorkspace) {
        if (this.shouldSkipWorkspaceRemoval(lastEmitted, options?.removedProjectId)) {
          continue;
        }
        if (this.workspaceUpdatesSubscription !== subscription) {
          return;
        }
        subscription.lastEmittedByWorkspaceId.delete(workspaceId);
        this.bufferOrEmitWorkspaceUpdate(
          subscription,
          await this.buildWorkspaceRemoveUpdatePayload(
            workspaceId,
            options?.removedProjectId,
            lastEmitted?.kind === "upsert" ? lastEmitted.workspace.projectId : undefined,
          ),
        );
        continue;
      }

      const nextPayload: WorkspaceUpdatePayload = {
        kind: "upsert",
        workspace: nextWorkspace,
      };

      if (
        lastEmitted &&
        lastEmitted.kind === "upsert" &&
        equal(lastEmitted.workspace, nextWorkspace)
      ) {
        continue;
      }

      this.bufferOrEmitWorkspaceUpdate(subscription, nextPayload);
    }
  }

  private applyOptimisticWorkspaceStatus(
    workspace: WorkspaceDescriptorPayload | null,
    optimisticStatus: WorkspaceDescriptorPayload["status"] | undefined,
  ): WorkspaceDescriptorPayload | null {
    if (!workspace || !optimisticStatus) {
      return workspace;
    }
    return { ...workspace, status: optimisticStatus };
  }

  private shouldSkipWorkspaceRemoval(
    lastEmitted: WorkspaceUpdatePayload | undefined,
    removedProjectId: string | undefined,
  ): boolean {
    if (lastEmitted?.kind === "remove") {
      return !removedProjectId || lastEmitted.removedProjectId === removedProjectId;
    }
    return !lastEmitted && !removedProjectId;
  }

  private async buildWorkspaceRemoveUpdatePayload(
    workspaceId: string,
    removedProjectId?: string,
    projectId?: string,
  ): Promise<WorkspaceUpdatePayload> {
    if (removedProjectId) {
      return { kind: "remove", id: workspaceId, removedProjectId };
    }
    return {
      kind: "remove",
      id: workspaceId,
      ...(await this.resolveProjectWithoutActiveWorkspacesForArchivedWorkspace(
        workspaceId,
        projectId,
      )),
    };
  }

  // When a workspace is archived its project may have no active workspaces left.
  // Resolve that project parent so the `remove` update can carry it, keeping the
  // sidebar in sync without a full re-hydration.
  private async resolveProjectWithoutActiveWorkspacesForArchivedWorkspace(
    workspaceId: string,
    knownProjectId?: string,
  ): Promise<{ emptyProject: WorkspaceProjectDescriptorPayload } | null> {
    const archivedWorkspace = await this.workspaceRegistry.get(workspaceId);
    const projectId = archivedWorkspace?.projectId ?? knownProjectId;
    if (!projectId) {
      return null;
    }
    const projectWithoutActiveWorkspaces = (await this.workspaceDirectory.listEmptyProjects()).find(
      (project) => project.projectId === projectId,
    );
    return projectWithoutActiveWorkspaces ? { emptyProject: projectWithoutActiveWorkspaces } : null;
  }

  private async emitWorkspaceUpdateForTerminalContribution(
    event: TerminalWorkspaceContributionChangedEvent,
  ): Promise<void> {
    // A terminal's activity contributes only to the workspace it carries. A
    // terminal with no workspaceId attributes to nothing - status is per-id.
    if (!event.workspaceId) {
      return;
    }
    await this.emitWorkspaceUpdatesForWorkspaceIds([event.workspaceId]);
  }

  // A git fact (branch, diff, dirty, PR) changed at `cwd`. Every workspace whose
  // OWN cwd is this folder re-derives its git facts from that folder (id → cwd)
  // and emits its own per-id descriptor. This is a deliberate same-folder fan,
  // not a cwd → id ownership lookup: git never resolves which workspace owns a
  // path. See `workspaceIdsOnCheckout`.
  private async emitWorkspaceUpdateForCwd(
    cwd: string,
    options?: {
      dedupeGitState?: boolean;
    },
  ): Promise<void> {
    const workspaceIds = workspaceIdsOnCheckout(await this.workspaceRegistry.list(), cwd);
    if (workspaceIds.length === 0) {
      return;
    }
    await this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds, options);
  }

  private async handleFetchAgents(
    request: Extract<SessionInboundMessage, { type: "fetch_agents_request" }>,
  ): Promise<void> {
    const requestedSubscriptionId = request.subscribe?.subscriptionId?.trim();
    const subscriptionId = resolveSubscriptionId(request.subscribe, requestedSubscriptionId);

    try {
      if (subscriptionId) {
        this.agentUpdates.beginSubscription({
          subscriptionId,
          filter: request.filter,
        });
      }

      const payload = await this.listFetchAgentsEntries(request);
      const snapshotUpdatedAtByAgentId = new Map<string, number>();
      for (const entry of payload.entries) {
        const parsedUpdatedAt = Date.parse(entry.agent.updatedAt);
        if (!Number.isNaN(parsedUpdatedAt)) {
          snapshotUpdatedAtByAgentId.set(entry.agent.id, parsedUpdatedAt);
        }
      }

      this.emit({
        type: "fetch_agents_response",
        payload: {
          requestId: request.requestId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...payload,
        },
      });

      if (subscriptionId) {
        this.agentUpdates.flushBootstrapped(subscriptionId, { snapshotUpdatedAtByAgentId });
      }
    } catch (error) {
      if (subscriptionId) {
        this.agentUpdates.clearSubscription(subscriptionId);
      }
      const code = error instanceof SessionRequestError ? error.code : "fetch_agents_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch agents";
      this.sessionLogger.error({ err: error }, "Failed to handle fetch_agents_request");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchAgentHistory(
    request: Extract<SessionInboundMessage, { type: "fetch_agent_history_request" }>,
  ): Promise<void> {
    try {
      const payload = await this.listFetchAgentsEntries(request);
      this.emit({
        type: "fetch_agent_history_response",
        payload: {
          requestId: request.requestId,
          ...payload,
        },
      });
    } catch (error) {
      const code = error instanceof SessionRequestError ? error.code : "fetch_agent_history_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch agent history";
      this.sessionLogger.error({ err: error }, "Failed to handle fetch_agent_history_request");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchRecentProviderSessions(
    request: Extract<SessionInboundMessage, { type: "fetch_recent_provider_sessions_request" }>,
  ): Promise<void> {
    try {
      const result = await listImportableProviderSessions({
        request,
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        providerSnapshotManager: this.providerSnapshotManager,
      });
      this.emit({
        type: "fetch_recent_provider_sessions_response",
        payload: {
          requestId: request.requestId,
          entries: result.entries,
          ...(result.filteredAlreadyImportedCount > 0
            ? { filteredAlreadyImportedCount: result.filteredAlreadyImportedCount }
            : {}),
        },
      });
    } catch (error) {
      const code =
        error instanceof ImportSessionsRequestError
          ? error.code
          : "fetch_recent_provider_sessions_failed";
      const message =
        error instanceof Error ? error.message : "Failed to fetch recent provider sessions";
      this.sessionLogger.error(
        { err: error },
        "Failed to handle fetch_recent_provider_sessions_request",
      );
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleFetchWorkspacesRequest(
    request: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ): Promise<void> {
    const requestedSubscriptionId = request.subscribe?.subscriptionId?.trim();
    const subscriptionId = resolveSubscriptionId(request.subscribe, requestedSubscriptionId);

    try {
      this.sessionLogger.debug(
        {
          requestId: request.requestId,
          subscribeRequested: Boolean(request.subscribe),
          filter: request.filter ?? null,
          sort: request.sort ?? null,
          page: request.page ?? null,
        },
        "fetch_workspaces_request_received",
      );
      if (subscriptionId) {
        this.workspaceUpdatesSubscription = {
          subscriptionId,
          filter: request.filter,
          isBootstrapping: true,
          pendingUpdatesByWorkspaceId: new Map(),
          lastEmittedByWorkspaceId: new Map(),
          visibleEmptyProjectIds: new Set(),
        };
      }

      const payload = await this.listFetchWorkspacesEntries(request);
      this.workspaceGitObserver.syncObservers(payload.entries);
      this.sessionLogger.debug(
        {
          requestId: request.requestId,
          subscriptionId,
          pageInfo: payload.pageInfo,
          payload: summarizeFetchWorkspacesEntries(payload.entries),
        },
        "fetch_workspaces_response_ready",
      );
      const snapshot = this.buildBootstrapSnapshot(payload.entries);
      this.seedWorkspaceSubscriptionSnapshot(
        subscriptionId,
        request.filter,
        payload.entries,
        payload.emptyProjects,
      );

      this.emit({
        type: "fetch_workspaces_response",
        payload: {
          requestId: request.requestId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...payload,
        },
      });

      if (subscriptionId && this.workspaceUpdatesSubscription?.subscriptionId === subscriptionId) {
        this.flushBootstrappedWorkspaceUpdates(snapshot);
      }
    } catch (error) {
      if (subscriptionId && this.workspaceUpdatesSubscription?.subscriptionId === subscriptionId) {
        this.workspaceUpdatesSubscription = null;
      }
      const code = error instanceof SessionRequestError ? error.code : "fetch_workspaces_failed";
      const message = error instanceof Error ? error.message : "Failed to fetch workspaces";
      this.sessionLogger.error({ err: error }, "Failed to handle fetch_workspaces_request");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code,
        },
      });
    }
  }

  private async handleProjectListRequest(requestId: string): Promise<void> {
    try {
      const projects = (await this.projectRegistry.list())
        .filter((project) => !project.archivedAt)
        .map((project) => this.buildProjectDescriptor(project));
      this.emit({
        type: "project.list.response",
        payload: { requestId, projects },
      });
    } catch (error) {
      this.sessionLogger.error({ err: error }, "Failed to handle project.list.request");
      this.emit({
        type: "rpc_error",
        payload: {
          requestId,
          requestType: "project.list.request",
          error: error instanceof Error ? error.message : "Failed to list projects",
          code: "project_list_failed",
        },
      });
    }
  }

  // Build the bootstrap snapshot used by `flushBootstrappedWorkspaceUpdates`
  // to decide which pending updates to drop. Captures the status,
  // statusEnteredAt, and activityAt (parsed to ms) for each workspace entry
  // so a status-only change (e.g. the unmask case), a statusEnteredAt-only
  // change (e.g. a fresh unmask time), AND a fresher activity all still
  // ship to the client.
  private buildBootstrapSnapshot(entries: FetchWorkspacesResponseEntry[]): {
    snapshotByWorkspaceId: Map<
      string,
      { status: string; statusEnteredAt: string | null; activityAtMs: number | null }
    >;
  } {
    const snapshotByWorkspaceId = new Map<
      string,
      { status: string; statusEnteredAt: string | null; activityAtMs: number | null }
    >();
    for (const entry of entries) {
      const parsedActivity = entry.activityAt ? Date.parse(entry.activityAt) : null;
      snapshotByWorkspaceId.set(entry.id, {
        status: entry.status,
        statusEnteredAt: entry.statusEnteredAt ?? null,
        activityAtMs: Number.isNaN(parsedActivity) ? null : parsedActivity,
      });
    }
    return { snapshotByWorkspaceId };
  }

  /**
   * An import lands in the workspace it was requested from. A chat tab already
   * has one, and minting a sibling workspace for the same folder is what used to
   * leave a duplicate in the sidebar with the imported chat orphaned onto it.
   * Requests with no workspace context (the home screen) resolve by directory,
   * which reuses an existing workspace for that folder instead of adding one.
   */
  private seedWorkspaceSubscriptionSnapshot(
    subscriptionId: string | null,
    filter: FetchWorkspacesRequestFilter | undefined,
    entries: FetchWorkspacesResponseEntry[],
    emptyProjects: WorkspaceProjectDescriptorPayload[],
  ): void {
    const subscription = this.workspaceUpdatesSubscription;
    if (!subscription) return;
    if (subscriptionId && subscription.subscriptionId !== subscriptionId) return;
    if (!subscriptionId && !equal(subscription.filter, filter)) return;
    for (const entry of entries) {
      subscription.lastEmittedByWorkspaceId.set(entry.id, {
        kind: "upsert",
        workspace: entry,
      });
    }
    for (const project of emptyProjects) {
      subscription.visibleEmptyProjectIds?.add(project.projectId);
    }
  }

  private async registerWorkspaceForImportedAgent(
    workspace: PersistedWorkspaceRecord,
  ): Promise<void> {
    try {
      await this.syncWorkspaceGitObserverForWorkspace(workspace);
      await this.describeWorkspaceRecord(workspace);
      await this.emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
    } catch (error) {
      this.sessionLogger.warn(
        { err: error, workspaceId: workspace.workspaceId, cwd: workspace.cwd },
        "Failed to register workspace for imported agent",
      );
    }
  }

  private async handleWorkspaceCreateRequest(
    request: Extract<SessionInboundMessage, { type: "workspace.create.request" }>,
  ): Promise<void> {
    try {
      if (request.source.kind === "directory") {
        await this.handleWorkspaceCreateLocal(request);
        return;
      }
      await this.handleWorkspaceCreateWorktree(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create workspace";
      this.sessionLogger.error(
        { err: error, sourceKind: request.source.kind, requestId: request.requestId },
        "Failed to create workspace",
      );
      // One code, resolved once: the occupied-directory branch used to be spread
      // ahead of a bare `errorCode`, so the provisioning code (undefined here)
      // overwrote it and clients never saw workspace_directory_occupied.
      let errorCode: string | undefined;
      if (error instanceof WorkspaceDirectoryOccupiedError) {
        errorCode = "workspace_directory_occupied";
      } else if (error instanceof WorkspaceProvisioningError) {
        errorCode = error.code;
      }
      this.emit({
        type: "workspace.create.response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          setupTerminalId: null,
          error: message,
          errorCode,
        },
      });
    }
  }

  private async handleWorkspaceCreateLocal(
    request: Extract<SessionInboundMessage, { type: "workspace.create.request" }>,
  ): Promise<void> {
    if (request.source.kind !== "directory") {
      return;
    }

    const cwd = expandTilde(request.source.path);
    const directoryExists = await this.filesystem.isDirectory(cwd).catch(() => false);
    if (!directoryExists) {
      this.emit({
        type: "workspace.create.response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          setupTerminalId: null,
          error: `Directory not found: ${cwd}`,
          errorCode: "directory_not_found",
        },
      });
      return;
    }

    const explicitTitle = request.title?.trim() || null;
    const promptTitle = resolveFirstAgentPromptTitle(request.firstAgentContext);
    const workspace = await this.workspaceProvisioning.createWorkspaceForDirectory(
      cwd,
      explicitTitle ?? promptTitle,
      request.source.projectId,
      { expectsInitialAgent: Boolean(request.firstAgentContext), rejectIfOccupied: true },
    );
    await this.syncWorkspaceGitObserverForWorkspace(workspace);
    const descriptor = await this.describeWorkspaceRecord(workspace);
    this.emit({
      type: "workspace.create.response",
      payload: {
        requestId: request.requestId,
        workspace: descriptor,
        setupTerminalId: null,
        error: null,
      },
    });
    await this.emitCreatedWorkspaceUpdate(
      descriptor,
      request.firstAgentContext ? "running" : undefined,
    );
    void this.workspaceGitService
      .getSnapshot(workspace.cwd, { force: true, includeForge: true, reason: "open_project" })
      .catch((error) => {
        this.sessionLogger.warn(
          { err: error, cwd: workspace.cwd },
          "Background snapshot refresh failed after workspace.create",
        );
      });
    if (request.firstAgentContext) {
      const firstAgentContext = request.firstAgentContext;
      this.workspaceAutoName.scheduleForDirectory(
        {
          workspaceId: workspace.workspaceId,
          cwd: workspace.cwd,
          firstAgentContext,
        },
        { currentSelection: this.getFocusedAgentSelectionForCwd(workspace.cwd) },
      );
    }
  }

  private async handleWorkspaceCreateWorktree(
    request: Extract<SessionInboundMessage, { type: "workspace.create.request" }>,
  ): Promise<void> {
    if (request.source.kind !== "worktree") {
      return;
    }

    const source = request.source;

    if (!source.cwd && !source.projectId) {
      this.emit({
        type: "workspace.create.response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          setupTerminalId: null,
          error: "cwd or projectId is required for a worktree-backed workspace",
          errorCode: "source_required",
        },
      });
      return;
    }

    const sourceCwd = await resolveWorktreeSourceCwd(source, this.projectRegistry);

    const result = await this.createOttoWorktreeWorkflow(
      {
        cwd: sourceCwd,
        projectId: source.projectId,
        worktreeSlug: source.worktreeSlug,
        action: source.action,
        refName: source.refName,
        branchName: source.branchName,
        checkoutSource: source.checkoutSource,
        githubPrNumber: source.githubPrNumber,
        firstAgentContext: request.firstAgentContext,
        title: request.title,
      },
      source.baseBranch
        ? { resolveDefaultBranch: async () => source.baseBranch as string }
        : undefined,
    );

    const descriptor = await this.describeCreatedWorktreeWorkspace(result);
    this.emit({
      type: "workspace.create.response",
      payload: {
        requestId: request.requestId,
        workspace: descriptor,
        setupTerminalId: null,
        error: null,
      },
    });
    await this.emitCreatedWorkspaceUpdate(
      descriptor,
      request.firstAgentContext ? "running" : undefined,
    );
  }

  private async handleOpenProjectRequest(
    request: Extract<SessionInboundMessage, { type: "open_project_request" }>,
  ): Promise<void> {
    const requestedCwd = request.cwd;
    const cwd = expandTilde(requestedCwd);
    const directoryExists = await this.filesystem.isDirectory(cwd).catch(() => false);
    if (!directoryExists) {
      this.sessionLogger.info(
        { requestedCwd, resolvedCwd: cwd, reason: "directory_not_found" },
        "Open project rejected",
      );
      this.emit({
        type: "open_project_response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          error: `Directory not found: ${cwd}`,
          errorCode: "directory_not_found",
        },
      });
      return;
    }

    try {
      const projectsBefore = new Map<string, PersistedProjectRecord>();
      for (const project of await this.projectRegistry.list()) {
        projectsBefore.set(project.projectId, project);
      }
      const workspacesBefore = new Map<string, PersistedWorkspaceRecord>();
      for (const workspaceRecord of await this.workspaceRegistry.list()) {
        workspacesBefore.set(workspaceRecord.workspaceId, workspaceRecord);
      }
      const workspace = await this.workspaceProvisioning.findOrCreateWorkspaceForDirectory(cwd);
      const project = await this.projectRegistry.get(workspace.projectId);
      await this.syncWorkspaceGitObserverForWorkspace(workspace);
      const descriptor = await this.describeWorkspaceRecord(workspace);
      await this.emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
      this.sessionLogger.info(
        {
          requestedCwd,
          resolvedCwd: cwd,
          workspaceCwd: workspace.cwd,
          workspaceId: workspace.workspaceId,
          workspaceKind: workspace.kind,
          workspaceTransition: describeRegistryTransition(
            workspacesBefore.get(workspace.workspaceId) ?? null,
          ),
          projectId: workspace.projectId,
          projectKind: project?.kind ?? null,
          projectTransition: describeRegistryTransition(
            projectsBefore.get(workspace.projectId) ?? null,
          ),
        },
        "Project opened",
      );
      this.emit({
        type: "open_project_response",
        payload: {
          requestId: request.requestId,
          workspace: descriptor,
          error: null,
        },
      });
      void this.workspaceGitService
        .getSnapshot(workspace.cwd, {
          force: true,
          includeForge: true,
          reason: "open_project",
        })
        .catch((error) => {
          this.sessionLogger.warn(
            { err: error, cwd: workspace.cwd },
            "Background snapshot refresh failed after open_project",
          );
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open project";
      this.sessionLogger.error({ err: error, cwd }, "Failed to open project");
      this.emit({
        type: "open_project_response",
        payload: {
          requestId: request.requestId,
          workspace: null,
          error: message,
        },
      });
    }
  }

  private async handleProjectAddRequest(
    request: Extract<SessionInboundMessage, { type: "project.add.request" }>,
  ): Promise<void> {
    const requestedCwd = request.cwd;
    const cwd = expandTilde(requestedCwd);
    const directoryExists = await this.filesystem.isDirectory(cwd).catch(() => false);
    if (!directoryExists) {
      this.sessionLogger.info(
        { requestedCwd, resolvedCwd: cwd, reason: "directory_not_found" },
        "Add project rejected",
      );
      this.emit({
        type: "project.add.response",
        payload: {
          requestId: request.requestId,
          project: null,
          error: `Directory not found: ${cwd}`,
          errorCode: "directory_not_found",
        },
      });
      return;
    }

    try {
      const projectsBefore = new Map<string, PersistedProjectRecord>();
      for (const project of await this.projectRegistry.list()) {
        projectsBefore.set(project.projectId, project);
      }
      const project = await this.workspaceProvisioning.findOrCreateProjectForDirectory(cwd);
      this.sessionLogger.info(
        {
          requestedCwd,
          resolvedCwd: cwd,
          projectId: project.projectId,
          projectKind: project.kind,
          projectTransition: describeRegistryTransition(
            projectsBefore.get(project.projectId) ?? null,
          ),
        },
        "Project added",
      );
      this.emit({
        type: "project.add.response",
        payload: {
          requestId: request.requestId,
          project: this.buildProjectDescriptor(project),
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add project";
      this.sessionLogger.error({ err: error, cwd }, "Failed to add project");
      this.emit({
        type: "project.add.response",
        payload: {
          requestId: request.requestId,
          project: null,
          error: message,
        },
      });
    }
  }

  private async handleProjectResolveWorkspaceForPathRequest(
    request: Extract<SessionInboundMessage, { type: "project.resolveWorkspaceForPath.request" }>,
  ): Promise<void> {
    const workspaceId = resolveWorkspaceIdForPath(
      request.path,
      await this.workspaceRegistry.list(),
    );
    this.emit({
      type: "project.resolveWorkspaceForPath.response",
      payload: {
        requestId: request.requestId,
        workspaceId,
      },
    });
  }

  private async handleProjectCreateDirectoryRequest(
    request: Extract<SessionInboundMessage, { type: "project.create_directory.request" }>,
  ): Promise<void> {
    try {
      const result = await createProjectDirectory(
        { parentPath: request.parentPath, name: request.name },
        {
          registerProject: (directoryPath) =>
            this.workspaceProvisioning.findOrCreateProjectForDirectory(directoryPath),
        },
      );
      this.emit({
        type: "project.create_directory.response",
        payload: {
          requestId: request.requestId,
          directoryPath: result.directoryPath,
          project: this.buildProjectDescriptor(result.project),
          error: null,
          errorCode: null,
        },
      });
    } catch (error) {
      const requestError =
        error instanceof ProjectDirectoryRequestError
          ? error
          : new ProjectDirectoryRequestError(
              "registration_failed",
              error instanceof Error ? error.message : "Failed to create project directory",
            );
      this.sessionLogger.error(
        {
          err: error,
          parentPath: request.parentPath,
          name: request.name,
          errorCode: requestError.code,
        },
        "Failed to create project directory",
      );
      this.emit({
        type: "project.create_directory.response",
        payload: {
          requestId: request.requestId,
          directoryPath: requestError.directoryPath,
          project: null,
          error: requestError.message,
          errorCode: requestError.code,
        },
      });
    }
  }

  private async handleWorkspaceGithubSearchRepositoriesRequest(
    request: Extract<
      SessionInboundMessage,
      { type: "workspace.github.search_repositories.request" }
    >,
  ): Promise<void> {
    try {
      const searchRepositories = (this.github as Partial<GitHubService>).searchRepositories;
      if (!searchRepositories) {
        throw new Error("GitHub repository search is unavailable");
      }
      const repositories = await searchRepositories.call(this.github, {
        cwd: homedir(),
        query: request.query,
        limit: request.limit,
      });
      this.emit({
        type: "workspace.github.search_repositories.response",
        payload: {
          requestId: request.requestId,
          repositories,
          status: "success",
          available: true,
          error: null,
        },
      });
    } catch (error) {
      const missing = error instanceof GitHubCliMissingError;
      const unauthenticated = error instanceof GitHubAuthenticationError;
      const commandError = error instanceof GitHubCommandError ? error.stderr.trim() : "";
      let message: string;
      if (missing) {
        message = "GitHub CLI (gh) is not installed or not in PATH";
      } else if (unauthenticated) {
        message = "GitHub CLI is not authenticated. Run gh auth login on the host.";
      } else if (commandError) {
        message = commandError;
      } else {
        message = error instanceof Error ? error.message : "GitHub search failed";
      }
      let payload: WorkspaceGithubSearchRepositoriesResponsePayload;
      if (missing) {
        payload = {
          status: "unavailable",
          requestId: request.requestId,
          repositories: [],
          reason: "gh_missing",
          available: false,
          error: message,
        };
      } else if (unauthenticated) {
        payload = {
          status: "unauthenticated",
          requestId: request.requestId,
          repositories: [],
          available: false,
          error: message,
        };
      } else {
        payload = {
          status: "error",
          requestId: request.requestId,
          repositories: [],
          available: true,
          error: message,
        };
      }
      this.sessionLogger.warn({ err: error }, "GitHub repository search failed");
      this.emit({
        type: "workspace.github.search_repositories.response",
        payload,
      });
    }
  }

  private async handleProjectGithubCloneRequest(
    request: Extract<SessionInboundMessage, { type: "project.github.clone.request" }>,
  ): Promise<void> {
    let normalizedRepo = request.repo;
    let checkoutPath: string | null = null;
    try {
      const repo = normalizeCloneRepository({
        repo: request.repo,
        cloneProtocol: request.cloneProtocol,
      });
      normalizedRepo = repo.displayName;
      const targetParent = resolve(expandTilde(request.targetDirectory.trim()));
      checkoutPath = resolve(targetParent, repo.name);
      if (!this.isPathWithinRoot(targetParent, checkoutPath)) {
        throw new Error("Resolved checkout path must stay inside the target directory");
      }

      await mkdir(targetParent, { recursive: true });
      try {
        await lstat(checkoutPath);
        throw new Error(`Checkout path already exists: ${checkoutPath}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      const cloneStagingPath = await mkdtemp(resolve(targetParent, ".otto-clone-"));
      try {
        await runGitCommand(["clone", repo.cloneUrl, cloneStagingPath], {
          cwd: targetParent,
          timeout: 5 * 60 * 1000,
          maxOutputBytes: 1024 * 1024,
          logger: this.sessionLogger,
        });
        await rename(cloneStagingPath, checkoutPath);
      } catch (error) {
        await rm(cloneStagingPath, { recursive: true, force: true }).catch((cleanupError) => {
          this.sessionLogger.warn(
            { err: cleanupError, cloneStagingPath },
            "Failed to clean up partial GitHub clone",
          );
        });
        throw error;
      }

      const project =
        await this.workspaceProvisioning.findOrCreateProjectForDirectory(checkoutPath);

      this.emit({
        type: "project.github.clone.response",
        payload: {
          requestId: request.requestId,
          repo: repo.displayName,
          checkoutPath,
          project: this.buildProjectDescriptor(project),
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clone GitHub repo";
      this.sessionLogger.error(
        { err: error, repo: request.repo, targetDirectory: request.targetDirectory },
        "Failed to clone GitHub project",
      );
      this.emit({
        type: "project.github.clone.response",
        payload: {
          requestId: request.requestId,
          repo: normalizedRepo,
          checkoutPath,
          project: null,
          error: message,
        },
      });
    }
  }

  // Named accessor: the workspace descriptor builder and the git-watch test both read a workspace's
  // scripts snapshot through here; the workspace-scripts module owns the payload assembly.
  private buildWorkspaceScriptPayloadSnapshot(
    workspace: PersistedWorkspaceRecord,
    project: PersistedProjectRecord | null,
  ): WorkspaceDescriptorPayload["scripts"] {
    return this.workspaceScripts.buildSnapshot(workspace, project);
  }

  private handleStartWorkspaceScriptRequest(request: StartWorkspaceScriptRequest): Promise<void> {
    return this.workspaceScripts.start(request);
  }

  private async handleWorkspaceScriptListRequest(
    request: WorkspaceScriptListRequest,
  ): Promise<void> {
    try {
      const scripts = await this.workspaceScripts.list({
        workspaceId: request.workspaceId,
        includeDiscovered: request.includeDiscovered,
      });
      this.emit({
        type: "workspace.script.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scripts,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "workspace.script.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scripts: [],
          error: error instanceof Error ? error.message : "Failed to list workspace scripts",
        },
      });
    }
  }

  private async handleWorkspaceScriptStartRequest(
    request: WorkspaceScriptStartRequest,
  ): Promise<void> {
    try {
      const script = await this.workspaceScripts.launch(request);
      this.emit({
        type: "workspace.script.start.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          script,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "workspace.script.start.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          script: null,
          error: error instanceof Error ? error.message : "Failed to start workspace script",
        },
      });
    }
  }

  private async handleWorkspaceScriptStopRequest(
    request: WorkspaceScriptStopRequest,
  ): Promise<void> {
    try {
      const script = await this.workspaceScripts.stop(request);
      this.emit({
        type: "workspace.script.stop.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          script,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "workspace.script.stop.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          scriptName: request.scriptName,
          script: null,
          error: error instanceof Error ? error.message : "Failed to stop workspace script",
        },
      });
    }
  }

  // COMPAT(desktopEditorBridge): added in v0.1.88, remove after 2026-12-03 once old clients no longer call daemon editor RPCs.
  private async handleLegacyListAvailableEditorsRequest(
    request: Extract<SessionInboundMessage, { type: "list_available_editors_request" }>,
  ): Promise<void> {
    this.emit({
      type: "list_available_editors_response",
      payload: {
        requestId: request.requestId,
        editors: [],
        error: "Editor opening moved to the desktop app and is no longer supported by the daemon",
      },
    });
  }

  private async handleLegacyOpenInEditorRequest(
    request: Extract<SessionInboundMessage, { type: "open_in_editor_request" }>,
  ): Promise<void> {
    this.emit({
      type: "open_in_editor_response",
      payload: {
        requestId: request.requestId,
        error: "Editor opening moved to the desktop app and is no longer supported by the daemon",
      },
    });
  }

  private async handleCreateOttoWorktreeRequest(
    request: Extract<SessionInboundMessage, { type: "create_otto_worktree_request" }>,
  ): Promise<void> {
    return handleCreateWorktreeRequest(
      {
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
        describeWorkspaceRecord: (result) => this.describeCreatedWorktreeWorkspace(result),
        emit: (message) => this.emit(message),
        sessionLogger: this.sessionLogger,
        createOttoWorktreeWorkflow: (input) => this.createOttoWorktreeWorkflow(input),
      },
      request,
    );
  }

  private async createOttoWorktreeWorkflow(
    input: CreateOttoWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
      setupContinuation?: CreateOttoWorktreeSetupContinuationInput;
    },
  ): Promise<CreateOttoWorktreeWorkflowResult> {
    return createWorktreeWorkflow(
      {
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
        createOttoWorktree: (workflowInput, serviceOptions) =>
          this.createOttoWorktree(workflowInput, serviceOptions),
        warmWorkspaceGitData: (workspace) => this.warmWorkspaceGitDataForWorkspace(workspace),
        autoNameWorkspaceBranchForFirstAgent: (autoNameInput) =>
          this.workspaceAutoName.scheduleForWorktree(autoNameInput, {
            currentSelection: this.getFocusedAgentSelectionForCwd(autoNameInput.workspace.cwd),
          }),
        startWorkspaceSetup: (workspaceId, operation) =>
          this.workspaceSetupRuntime.start(workspaceId, operation),
        emitWorkspaceUpdateForWorkspaceId: (workspaceId) =>
          this.emitWorkspaceUpdateForWorkspaceId(workspaceId),
        cacheWorkspaceSetupSnapshot: (workspaceId, snapshot) => {
          this.workspaceSetupSnapshots.set(workspaceId, snapshot);
        },
        emit: (message) => this.emit(message),
        sessionLogger: this.sessionLogger,
        terminalManager: this.terminalManager,
        archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
        serviceProxy: this.serviceProxy,
        scriptRuntimeStore: this.scriptRuntimeStore,
        getDaemonTcpPort: this.getDaemonTcpPort,
        getDaemonTcpHost: this.getDaemonTcpHost,
        serviceProxyPublicBaseUrl: this.serviceProxyPublicBaseUrl,
        onScriptsChanged: (workspaceId, workspaceDirectory) => {
          this.workspaceScripts.emitStatusUpdate(workspaceId, workspaceDirectory);
        },
      },
      input,
      options,
    );
  }

  private async handleWorkspaceSetupStatusRequest(
    request: Extract<SessionInboundMessage, { type: "workspace_setup_status_request" }>,
  ): Promise<void> {
    return handleWorkspaceSetupStatusRequestMessage(
      {
        emit: (message) => this.emit(message),
        workspaceSetupSnapshots: this.workspaceSetupSnapshots,
      },
      request,
    );
  }

  private async handleArchiveWorkspaceRequest(
    request: Extract<SessionInboundMessage, { type: "archive_workspace_request" }>,
  ): Promise<void> {
    try {
      const existing = await this.workspaceRegistry.get(request.workspaceId);
      if (!existing) {
        throw new Error(`Workspace not found: ${request.workspaceId}`);
      }

      const gitSnapshot = await this.workspaceGitService
        .getSnapshot(existing.cwd)
        .catch(() => null);
      const repoRoot = gitSnapshot?.git?.repoRoot ?? null;

      // Resolve the leftover branch to delete before teardown removes the
      // worktree. The client only asks for "delete" after preflight showed the
      // branch is an Otto-owned, deletable one; re-check ownership here so a
      // stale or crafted request can never delete a branch we don't own.
      let branchCleanup: { branchName: string } | null = null;
      if (request.branchDisposition === "delete" && repoRoot) {
        const detection = await detectWorktreeArchiveBranch({
          cwd: existing.cwd,
          repoRoot,
          ottoHome: this.ottoHome,
          worktreesRoot: this.worktreesRoot,
          directoryWillBeRemoved: true,
        }).catch(() => null);
        if (
          detection?.isOttoWorktree &&
          detection.branchName &&
          !detection.branchCheckedOutElsewhere
        ) {
          branchCleanup = { branchName: detection.branchName };
        }
      }

      const archiveResult = await archiveByScope(
        {
          ottoHome: this.ottoHome,
          ottoWorktreesBaseRoot: this.worktreesRoot,
          github: this.github,
          workspaceGitService: this.workspaceGitService,
          removeWorkspaceObserverForWorkspaceId: (workspaceId) =>
            this.workspaceGitObserver.removeForWorkspaceId(workspaceId),
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          findWorkspaceIdForCwd: (cwd) => this.findWorkspaceIdForCwd(cwd),
          getWorkspace: (workspaceId) => this.workspaceRegistry.get(workspaceId),
          listActiveWorkspaces: () => this.listActiveWorkspaceRefs(),
          archiveWorkspaceRecord: (workspaceId) => this.archiveWorkspaceRecord(workspaceId),
          emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds) =>
            this.emitWorkspaceUpdatesForWorkspaceIds(workspaceIds),
          markWorkspaceArchiving: (workspaceIds, archivingAt) =>
            this.markWorkspaceArchiving(workspaceIds, archivingAt),
          clearWorkspaceArchiving: (workspaceIds) => this.clearWorkspaceArchiving(workspaceIds),
          killTerminalsForWorkspace: (workspaceId) =>
            this.terminalController.killTerminalsForWorkspace(workspaceId),
          stopLanguageServers: (rootPath) => this.stopWorkspaceProcesses(rootPath),
          stopWorkspaceSetup: (workspaceId) => this.workspaceSetupRuntime.stop(workspaceId),
          sessionLogger: this.sessionLogger,
        },
        {
          scope: { kind: "workspace", workspaceId: existing.workspaceId },
          repoRoot,
          ottoWorktreesBaseRoot: this.worktreesRoot,
          branchCleanup,
          requestId: request.requestId,
        },
      );

      const archivedWorkspace = await this.workspaceRegistry.get(request.workspaceId);
      const archivedAt = archivedWorkspace?.archivedAt ?? new Date().toISOString();
      this.emit({
        type: "archive_workspace_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          archivedAt,
          error: null,
          deletedBranch: archiveResult.deletedBranch,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to archive workspace";
      this.sessionLogger.error(
        { err: error, workspaceId: request.workspaceId },
        "Failed to archive workspace",
      );
      this.emit({
        type: "archive_workspace_response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          archivedAt: null,
          error: message,
        },
      });
    }
  }

  private async handleWorkspaceArchivePreflightRequest(
    request: Extract<SessionInboundMessage, { type: "workspace.archive.preflight.request" }>,
  ): Promise<void> {
    try {
      const existing = await this.workspaceRegistry.get(request.workspaceId);
      if (!existing) {
        throw new Error(`Workspace not found: ${request.workspaceId}`);
      }

      const gitSnapshot = await this.workspaceGitService
        .getSnapshot(existing.cwd)
        .catch(() => null);
      const repoRoot = gitSnapshot?.git?.repoRoot ?? null;

      // The backing directory is removed only when no other active workspace
      // still references it - the same last-reference rule archiveByScope applies.
      const targetDir = resolve(existing.cwd);
      const activeWorkspaces = await this.listActiveWorkspaceRefs();
      const directoryWillBeRemoved = !activeWorkspaces.some(
        (workspace) =>
          workspace.workspaceId !== existing.workspaceId && resolve(workspace.cwd) === targetDir,
      );

      const detection = await detectWorktreeArchiveBranch({
        cwd: existing.cwd,
        repoRoot,
        ottoHome: this.ottoHome,
        worktreesRoot: this.worktreesRoot,
        directoryWillBeRemoved,
      });

      this.emit({
        type: "workspace.archive.preflight.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          detection,
          error: null,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to inspect workspace for archive";
      this.sessionLogger.warn(
        { err: error, workspaceId: request.workspaceId },
        "Workspace archive preflight failed",
      );
      this.emit({
        type: "workspace.archive.preflight.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          detection: null,
          error: message,
        },
      });
    }
  }

  private async handleWorktreeBaseRefSetRequest(
    request: Extract<SessionInboundMessage, { type: "worktree.baseRef.set.request" }>,
  ): Promise<void> {
    try {
      const existing = await this.workspaceRegistry.get(request.workspaceId);
      if (!existing) {
        throw new Error(`Workspace not found: ${request.workspaceId}`);
      }

      const result = await setCheckoutBaseRef(
        existing.cwd,
        request.baseRef,
        {
          ottoHome: this.ottoHome,
          worktreesRoot: this.worktreesRoot,
          logger: this.sessionLogger,
        },
        request.redetect ? { redetect: true } : undefined,
      );

      this.emit({
        type: "worktree.baseRef.set.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          baseRef: result.baseRef,
          isDefault: result.isDefault,
          baseSource: result.source,
          error: null,
        },
      });

      // The stored base feeds ahead/behind, shortstat and the diff, so the snapshot
      // the client is holding is stale the moment the write lands.
      void this.workspaceGitService
        .getSnapshot(existing.cwd, {
          force: true,
          reason: "worktree.baseRef.set",
        })
        .catch((error) => {
          this.sessionLogger.warn(
            { err: error, cwd: existing.cwd },
            "Background snapshot refresh failed after base branch change",
          );
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to set base branch";
      this.sessionLogger.warn(
        { err: error, workspaceId: request.workspaceId },
        "Worktree base branch change failed",
      );
      this.emit({
        type: "worktree.baseRef.set.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          baseRef: null,
          isDefault: false,
          error: message,
        },
      });
    }
  }

  private async handleWorktreeReattachListRequest(
    request: Extract<SessionInboundMessage, { type: "worktree.reattach.list.request" }>,
  ): Promise<void> {
    try {
      const scope = await this.resolveReattachScope(request);
      const onDiskWorktrees = await this.listReattachOnDiskWorktrees(scope.repoRoot);
      const candidates = buildReattachCandidates({
        worktreeWorkspaces: scope.worktreeWorkspaces,
        onDiskWorktrees,
      });
      this.emit({
        type: "worktree.reattach.list.response",
        payload: { requestId: request.requestId, candidates, error: null },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to list re-attachable worktrees";
      this.sessionLogger.warn({ err: error }, "Worktree reattach list failed");
      this.emit({
        type: "worktree.reattach.list.response",
        payload: { requestId: request.requestId, candidates: [], error: message },
      });
    }
  }

  private async listReattachOnDiskWorktrees(
    repoRoot: string,
  ): Promise<{ path: string; branchName: string | null }[]> {
    try {
      const worktrees = await this.workspaceGitService.listWorktrees(repoRoot);
      return worktrees.map((entry) => ({ path: entry.path, branchName: entry.branchName ?? null }));
    } catch {
      return [];
    }
  }

  // Resolve which project's worktrees a reattach-list request is scoped to. The
  // client normally passes projectId (the sidebar project row); cwd is a fallback
  // that resolves the repo root and matches a project by rootPath.
  private async resolveReattachScope(request: {
    projectId?: string;
    cwd?: string;
  }): Promise<{ repoRoot: string; worktreeWorkspaces: PersistedWorkspaceRecord[] }> {
    const allWorkspaces = await this.workspaceRegistry.list();
    if (request.projectId) {
      const project = await this.projectRegistry.get(request.projectId);
      if (!project) {
        throw new Error(`Project not found: ${request.projectId}`);
      }
      return {
        repoRoot: project.rootPath,
        worktreeWorkspaces: allWorkspaces.filter(
          (workspace) => workspace.projectId === project.projectId && workspace.kind === "worktree",
        ),
      };
    }
    if (request.cwd) {
      const snapshot = await this.workspaceGitService.getSnapshot(request.cwd).catch(() => null);
      const repoRoot =
        snapshot?.git?.mainRepoRoot ?? snapshot?.git?.repoRoot ?? resolve(request.cwd);
      const projects = await this.projectRegistry.list();
      const project = projects.find(
        (candidate) => resolve(candidate.rootPath) === resolve(repoRoot),
      );
      return {
        repoRoot,
        worktreeWorkspaces: project
          ? allWorkspaces.filter(
              (workspace) =>
                workspace.projectId === project.projectId && workspace.kind === "worktree",
            )
          : [],
      };
    }
    throw new Error("projectId or cwd is required to list re-attachable worktrees");
  }

  private async handleWorktreeReattachRequest(
    request: Extract<SessionInboundMessage, { type: "worktree.reattach.request" }>,
  ): Promise<void> {
    try {
      const workspace = await this.reattachWorktreeTarget(request.target);
      // Warm the git snapshot so the returned descriptor carries the live branch
      // and dirty state the sidebar renders on first paint.
      await this.workspaceGitService
        .getSnapshot(workspace.cwd, { force: true, reason: "reattach-worktree" })
        .catch(() => null);
      const descriptor = await this.describeWorkspaceRecordWithGitData(workspace);
      this.emit({ type: "workspace_update", payload: { kind: "upsert", workspace: descriptor } });
      this.emit({
        type: "worktree.reattach.response",
        payload: { requestId: request.requestId, workspace: descriptor, error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to re-attach worktree";
      this.sessionLogger.warn({ err: error }, "Worktree reattach failed");
      this.emit({
        type: "worktree.reattach.response",
        payload: { requestId: request.requestId, workspace: null, error: message },
      });
    }
  }

  private async reattachWorktreeTarget(
    target: Extract<SessionInboundMessage, { type: "worktree.reattach.request" }>["target"],
  ): Promise<PersistedWorkspaceRecord> {
    if (target.kind === "workspace") {
      const workspace = await this.workspaceRegistry.get(target.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${target.workspaceId}`);
      }
      if (!workspace.archivedAt) {
        // Already live - reattach is idempotent.
        return workspace;
      }
      const restored = await this.restoreArchivedWorkspaceRecord(workspace);
      if (!restored) {
        throw new Error(
          "Workspace cannot be re-attached: its worktree directory is gone and no branch was kept to recreate it",
        );
      }
      return restored;
    }

    // Orphan: an on-disk Otto worktree with no live workspace. Bind a fresh
    // workspace to the existing directory (findOrCreate unarchives any prior
    // record at the path, otherwise classifies it as a worktree workspace).
    const ownership = await isOttoOwnedWorktreeCwd(target.worktreePath, {
      ottoHome: this.ottoHome,
      worktreesRoot: this.worktreesRoot,
    });
    if (!ownership.allowed) {
      throw new Error("Not a Otto-owned worktree");
    }
    const directoryExists = await this.filesystem
      .isDirectory(target.worktreePath)
      .catch(() => false);
    if (!directoryExists) {
      throw new Error("Worktree directory no longer exists");
    }
    return this.workspaceProvisioning.findOrCreateWorkspaceForDirectory(target.worktreePath);
  }

  private async handleWorkspaceClearAttentionRequest(
    request: Extract<SessionInboundMessage, { type: "workspace.clear_attention.request" }>,
  ): Promise<void> {
    const { requestId, workspaceId } = request;
    const requestedWorkspaceIds = Array.isArray(workspaceId) ? workspaceId : [workspaceId];
    let agents: AgentSnapshotPayload[];
    try {
      agents = await this.listAgentPayloads();
    } catch (error) {
      const message = getErrorMessage(error);
      const results = requestedWorkspaceIds.map((requestedWorkspaceId) => ({
        workspaceId: requestedWorkspaceId,
        clearedAgentIds: [],
        success: false,
        error: message,
      }));
      this.emit({
        type: "workspace.clear_attention.response",
        payload: {
          requestId,
          workspaceId,
          clearedAgentIds: [],
          results,
          success: false,
          error: message,
        },
      });
      return;
    }
    const results: Array<{
      workspaceId: string;
      clearedAgentIds: string[];
      success: boolean;
      error: string | null;
    }> = [];

    for (const requestedWorkspaceId of requestedWorkspaceIds) {
      const clearedAgentIds: string[] = [];
      try {
        const workspace = await this.workspaceRegistry.get(requestedWorkspaceId);
        if (!workspace || workspace.archivedAt) {
          throw new Error(`Workspace not found: ${requestedWorkspaceId}`);
        }

        // Clearing attention is scoped to the workspace that OWNS the agent, by
        // workspaceId - never by comparing cwd strings. A sibling workspace
        // sharing the same directory keeps its own agents' attention.
        const clearableAgentIds = agents
          .filter((agent) => !agent.archivedAt)
          .filter((agent) => agent.workspaceId === workspace.workspaceId)
          .filter((agent) => agent.requiresAttention === true)
          .filter((agent) => (agent.pendingPermissions?.length ?? 0) === 0)
          .filter((agent) => agent.attentionReason !== "permission")
          .map((agent) => agent.id);

        for (const agentId of clearableAgentIds) {
          const liveAgent = this.agentManager.getAgent(agentId);
          if (liveAgent) {
            await this.agentManager.clearAgentAttention(agentId);
            clearedAgentIds.push(agentId);
            continue;
          }

          const record = await this.agentStorage.get(agentId);
          if (
            !record ||
            record.internal ||
            record.archivedAt ||
            record.requiresAttention !== true
          ) {
            continue;
          }
          const nextRecord: StoredAgentRecord = {
            ...record,
            updatedAt: new Date().toISOString(),
            requiresAttention: false,
            attentionReason: null,
            attentionTimestamp: null,
          };
          await this.agentStorage.upsert(nextRecord);
          const agent = this.buildStoredAgentPayload(nextRecord);
          const project = await this.buildProjectPlacementForWorkspace(workspace);
          this.emit({
            type: "agent_update",
            payload: {
              kind: "upsert",
              agent,
              project,
            },
          });
          clearedAgentIds.push(agentId);
        }

        await this.emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
        results.push({
          workspaceId: requestedWorkspaceId,
          clearedAgentIds,
          success: true,
          error: null,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        this.sessionLogger.error(
          { err: error, workspaceId: requestedWorkspaceId },
          "Failed to clear workspace attention",
        );
        results.push({
          workspaceId: requestedWorkspaceId,
          clearedAgentIds,
          success: false,
          error: message,
        });
      }
    }

    const clearedAgentIds = results.flatMap((result) => result.clearedAgentIds);
    const failedResults = results.filter((result) => !result.success);
    this.emit({
      type: "workspace.clear_attention.response",
      payload: {
        requestId,
        workspaceId,
        clearedAgentIds,
        results,
        success: failedResults.length === 0,
        error:
          failedResults.length === 0
            ? null
            : failedResults
                .map((result) => result.error)
                .filter((error) => error !== null)
                .join("; "),
      },
    });
  }

  private async handleFetchAgent(agentIdOrIdentifier: string, requestId: string): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(agentIdOrIdentifier);
    if (!resolved.ok) {
      this.emit({
        type: "fetch_agent_response",
        payload: { requestId, agent: null, project: null, error: resolved.error },
      });
      return;
    }

    const agent = await this.getAgentPayloadById(resolved.agentId);
    if (!agent) {
      this.emit({
        type: "fetch_agent_response",
        payload: {
          requestId,
          agent: null,
          project: null,
          error: `Agent not found: ${resolved.agentId}`,
        },
      });
      return;
    }

    const project = agent.workspaceId
      ? await this.buildProjectPlacementForWorkspaceId(agent.workspaceId)
      : null;
    this.emit({
      type: "fetch_agent_response",
      payload: { requestId, agent, project, error: null },
    });
  }

  private shouldUseFullTimelineForProjectedPage(input: {
    timeline: AgentTimelineFetchResult;
    pageLimit: number;
  }): boolean {
    const { timeline } = input;
    if (timeline.rows.length === 0) return false;

    if (timeline.rows.some((row) => row.item.type === "tool_call")) return true;

    const firstRow = timeline.rows[0];
    if (
      timeline.hasOlder &&
      (firstRow?.item.type === "assistant_message" || firstRow?.item.type === "reasoning")
    ) {
      return true;
    }

    const lastRow = timeline.rows.at(-1);
    if (
      timeline.hasNewer &&
      (lastRow?.item.type === "assistant_message" || lastRow?.item.type === "reasoning")
    ) {
      return true;
    }

    if (!timeline.hasNewer || input.pageLimit === 0) return false;
    return projectTimelineRows({ rows: timeline.rows, mode: "projected" }).length < input.pageLimit;
  }

  private selectCanonicalTimelineProjection(input: {
    timeline: AgentTimelineFetchResult;
  }): AgentTimelineProjectionSelection {
    const entries = projectTimelineRows({ rows: input.timeline.rows, mode: "canonical" });
    return {
      timeline: input.timeline,
      entries,
      startSeq: entries[0]?.seqStart ?? null,
      endSeq: entries[entries.length - 1]?.seqEnd ?? null,
      hasOlder: input.timeline.hasOlder,
      hasNewer: input.timeline.hasNewer,
    };
  }

  private selectProjectedTimelineProjection(input: {
    agentId: string;
    controlTimeline: AgentTimelineFetchResult;
    direction: AgentTimelineFetchDirection;
    cursor?: AgentTimelineCursor;
    pageLimit: number;
    fullTimeline?: AgentTimelineFetchResult;
  }): AgentTimelineProjectionSelection {
    const selectedTimeline = this.shouldUseFullTimelineForProjectedPage({
      timeline: input.controlTimeline,
      pageLimit: input.pageLimit,
    })
      ? (input.fullTimeline ??
        this.agentManager.fetchTimeline(input.agentId, { direction: "tail", limit: 0 }))
      : input.controlTimeline;
    const page = selectProjectedTimelinePage({
      rows: selectedTimeline.rows,
      bounds: selectedTimeline.window,
      direction: input.controlTimeline.reset ? "tail" : input.direction,
      ...(input.cursor ? { cursorSeq: input.cursor.seq } : {}),
      limit: input.pageLimit,
    });

    return {
      timeline: selectedTimeline,
      entries: page.entries,
      startSeq: page.startSeq,
      endSeq: page.endSeq,
      hasOlder:
        page.hasOlder || (page.startSeq !== null && page.startSeq > selectedTimeline.window.minSeq),
      hasNewer: page.hasNewer,
    };
  }

  private selectTimelineProjection(input: {
    agentId: string;
    projection: TimelineProjectionMode;
    controlTimeline: AgentTimelineFetchResult;
    direction: AgentTimelineFetchDirection;
    cursor?: AgentTimelineCursor;
    pageLimit: number;
    fullTimeline?: AgentTimelineFetchResult;
  }): AgentTimelineProjectionSelection {
    if (input.projection === "canonical") {
      return this.selectCanonicalTimelineProjection({ timeline: input.controlTimeline });
    }

    return this.selectProjectedTimelineProjection(input);
  }

  private async handleFetchAgentTimelineRequest(
    msg: Extract<SessionInboundMessage, { type: "fetch_agent_timeline_request" }>,
    source?: object,
  ): Promise<void> {
    const direction: AgentTimelineFetchDirection = msg.direction ?? (msg.cursor ? "after" : "tail");
    const projection: TimelineProjectionMode = msg.projection ?? "projected";
    const requestedLimit = msg.limit;
    const pageLimit = requestedLimit ?? (direction === "after" ? 0 : 200);
    const cursor: AgentTimelineCursor | undefined = msg.cursor
      ? {
          epoch: msg.cursor.epoch,
          seq: msg.cursor.seq,
        }
      : undefined;

    try {
      // Observed subagents have no ManagedAgent or stored record; serve their
      // last emitted snapshot instead. See projects/observed-subagents/observed-subagents.md.
      const observedPayload = this.agentManager.getObservedSubagentPayload(msg.agentId);
      // Retained generation transcripts (schedule / artifact) are closed internal
      // agents: seed their snapshotted rows into the timeline store so fetchTimeline
      // serves them, and return the stored payload - a pure read, no resume. See
      // docs/safe-unattended.md.
      let retainedPayload: AgentSnapshotPayload | null = null;
      if (
        !observedPayload &&
        (await this.agentManager.ensureRetainedTranscriptLoaded(msg.agentId))
      ) {
        retainedPayload = await this.agentManager.getRetainedTranscriptPayload(msg.agentId);
      }
      const agentPayload =
        observedPayload ??
        retainedPayload ??
        (await this.buildAgentPayload(
          await ensureAgentLoaded(msg.agentId, {
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            logger: this.sessionLogger,
          }),
        ));

      const fetchedControlTimeline = this.agentManager.fetchTimeline(msg.agentId, {
        direction,
        cursor,
        limit: pageLimit,
      });
      const selectedTimeline = this.selectTimelineProjection({
        agentId: msg.agentId,
        projection,
        controlTimeline: fetchedControlTimeline,
        direction,
        ...(cursor ? { cursor } : {}),
        pageLimit,
      });
      const startCursor =
        selectedTimeline.startSeq !== null
          ? { epoch: selectedTimeline.timeline.epoch, seq: selectedTimeline.startSeq }
          : null;
      const endCursor =
        selectedTimeline.endSeq !== null
          ? { epoch: selectedTimeline.timeline.epoch, seq: selectedTimeline.endSeq }
          : null;

      this.emitForSource(
        {
          type: "fetch_agent_timeline_response",
          payload: {
            requestId: msg.requestId,
            agentId: msg.agentId,
            agent: agentPayload,
            direction,
            projection,
            epoch: selectedTimeline.timeline.epoch,
            reset: fetchedControlTimeline.reset,
            staleCursor: fetchedControlTimeline.staleCursor,
            gap: fetchedControlTimeline.gap,
            window: selectedTimeline.timeline.window,
            startCursor,
            endCursor,
            hasOlder: selectedTimeline.hasOlder,
            hasNewer: selectedTimeline.hasNewer,
            ...(msg.mergeWindow === true ? { mergeWindow: true } : {}),
            entries: selectedTimeline.entries.map((entry) => ({
              provider: agentPayload.provider,
              item: entry.item,
              timestamp: entry.timestamp,
              seqStart: entry.seqStart,
              seqEnd: entry.seqEnd,
              sourceSeqRanges: entry.sourceSeqRanges,
              collapsed: (
                source
                  ? this.supportsForSource(CLIENT_CAPS.reasoningMergeEnum, source)
                  : this.supports(CLIENT_CAPS.reasoningMergeEnum)
              )
                ? entry.collapsed
                : entry.collapsed.filter((value) => value !== "reasoning_merge"),
            })),
            error: null,
          },
        },
        source,
      );
    } catch (error) {
      this.sessionLogger.error(
        { err: error, agentId: msg.agentId },
        "Failed to handle fetch_agent_timeline_request",
      );
      this.emitForSource(
        {
          type: "fetch_agent_timeline_response",
          payload: {
            requestId: msg.requestId,
            agentId: msg.agentId,
            agent: null,
            direction,
            projection,
            epoch: "",
            reset: false,
            staleCursor: false,
            gap: false,
            window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
            startCursor: null,
            endCursor: null,
            hasOlder: false,
            hasNewer: false,
            ...(msg.mergeWindow === true ? { mergeWindow: true } : {}),
            entries: [],
            error: error instanceof Error ? error.message : String(error),
          },
        },
        source,
      );
    }
  }

  private async handleAgentTimelineListPromptsRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.timeline.list_prompts.request" }>,
    source?: object,
  ): Promise<void> {
    try {
      await ensureAgentLoaded(msg.agentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      });
      const rows = await this.agentManager.getTimelineRows(msg.agentId);
      const timeline = this.agentManager.fetchTimeline(msg.agentId, {
        direction: "tail",
        limit: 1,
      });
      const index = buildTimelinePromptIndex(timeline.epoch, rows);
      this.emitForSource(
        {
          type: "agent.timeline.list_prompts.response",
          payload: {
            requestId: msg.requestId,
            agentId: msg.agentId,
            ...index,
            error: null,
          },
        },
        source,
      );
    } catch (error) {
      this.sessionLogger.error(
        { err: error, agentId: msg.agentId },
        "Failed to handle agent.timeline.list_prompts.request",
      );
      this.emitForSource(
        {
          type: "agent.timeline.list_prompts.response",
          payload: {
            requestId: msg.requestId,
            agentId: msg.agentId,
            epoch: "",
            prompts: [],
            error: error instanceof Error ? error.message : String(error),
          },
        },
        source,
      );
    }
  }

  private async handleProviderSubagentListRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.provider_subagents.list.request" }>,
  ): Promise<void> {
    try {
      await ensureUnarchivedAgentLoaded(msg.parentAgentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      });
      this.emit({
        type: "agent.provider_subagents.list.response",
        payload: {
          requestId: msg.requestId,
          parentAgentId: msg.parentAgentId,
          subagents: this.agentManager.listProviderSubagents(msg.parentAgentId),
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "agent.provider_subagents.list.response",
        payload: {
          requestId: msg.requestId,
          parentAgentId: msg.parentAgentId,
          subagents: [],
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleProviderSubagentTimelineRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.provider_subagents.timeline.get.request" }>,
  ): Promise<void> {
    const direction: AgentTimelineFetchDirection = msg.direction ?? (msg.cursor ? "after" : "tail");
    try {
      await ensureUnarchivedAgentLoaded(msg.parentAgentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      });
      const descriptor = this.agentManager.getProviderSubagent(msg.parentAgentId, msg.subagentId);
      if (!descriptor) {
        throw new Error("Provider subagent not found");
      }
      const timeline = this.agentManager.fetchProviderSubagentTimeline(
        msg.parentAgentId,
        msg.subagentId,
        {
          direction,
          cursor: msg.cursor,
          limit: msg.limit ?? (direction === "after" ? 0 : 200),
        },
      );
      this.emit({
        type: "agent.provider_subagents.timeline.get.response",
        payload: {
          requestId: msg.requestId,
          parentAgentId: msg.parentAgentId,
          subagentId: msg.subagentId,
          provider: descriptor.provider,
          direction,
          epoch: timeline.epoch,
          reset: timeline.reset,
          staleCursor: timeline.staleCursor,
          gap: timeline.gap,
          window: timeline.window,
          hasOlder: timeline.hasOlder,
          hasNewer: timeline.hasNewer,
          rows: timeline.rows.map((row) => ({
            item: row.item,
            timestamp: row.timestamp,
            seq: row.seq,
          })),
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "agent.provider_subagents.timeline.get.response",
        payload: {
          requestId: msg.requestId,
          parentAgentId: msg.parentAgentId,
          subagentId: msg.subagentId,
          provider: null,
          direction,
          epoch: "",
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
          hasOlder: false,
          hasNewer: false,
          rows: [],
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleAgentForkContextRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.fork_context.request" }>,
  ): Promise<void> {
    try {
      const snapshot = await ensureAgentLoaded(msg.agentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.sessionLogger,
      });
      const agentPayload = await this.buildAgentPayload(snapshot);
      const timeline = this.agentManager.fetchTimeline(msg.agentId, {
        direction: "tail",
        limit: 0,
      });
      const forkContext = buildAgentForkContextAttachment({
        rows: timeline.rows,
        cursorBoundary: msg.boundaryCursor
          ? { timelineEpoch: timeline.epoch, cursor: msg.boundaryCursor }
          : null,
        boundaryMessageId: msg.boundaryMessageId,
        agentTitle: agentPayload.title,
        cwd: snapshot.cwd,
      });

      this.emit({
        type: "agent.fork_context.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          attachment: forkContext.attachment,
          itemCount: forkContext.itemCount,
          boundaryCursor: forkContext.boundaryCursor,
          boundaryMessageId: forkContext.boundaryMessageId,
          error: null,
        },
      });
    } catch (error) {
      this.sessionLogger.error(
        { err: error, agentId: msg.agentId },
        "Failed to handle agent.fork_context.request",
      );
      this.emit({
        type: "agent.fork_context.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          attachment: null,
          itemCount: 0,
          boundaryCursor: msg.boundaryCursor ?? null,
          boundaryMessageId: msg.boundaryMessageId ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleAgentQueueRemoveRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.queue.remove.request" }>,
  ): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(msg.agentId);
    if (!resolved.ok) {
      this.emit({
        type: "agent.queue.remove.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          removed: null,
          error: resolved.error,
        },
      });
      return;
    }

    // A null `removed` is not an error: the turn can drain an entry between the
    // client rendering the row and the tap landing.
    const entry = this.agentManager.removeSteerQueueEntry(resolved.agentId, msg.messageId);
    this.emit({
      type: "agent.queue.remove.response",
      payload: {
        requestId: msg.requestId,
        agentId: resolved.agentId,
        removed: entry ? { id: entry.id, text: steerQueuePromptText(entry.prompt) } : null,
        error: null,
      },
    });
  }

  private async handleAgentQueueReorderRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.queue.reorder.request" }>,
  ): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(msg.agentId);
    if (!resolved.ok) {
      this.emit({
        type: "agent.queue.reorder.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          moved: false,
          error: resolved.error,
        },
      });
      return;
    }

    // `moved: false` is not an error, for the same reason `removed: null` isn't:
    // the turn can drain the entry between the client rendering the row and the
    // tap landing. The new order reaches every client on the agent snapshot.
    this.emit({
      type: "agent.queue.reorder.response",
      payload: {
        requestId: msg.requestId,
        agentId: resolved.agentId,
        moved: this.agentManager.reorderSteerQueueEntry(
          resolved.agentId,
          msg.messageId,
          msg.toIndex,
        ),
        error: null,
      },
    });
  }

  private async handleAgentQueueClearRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.queue.clear.request" }>,
  ): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(msg.agentId);
    if (!resolved.ok) {
      this.emit({
        type: "agent.queue.clear.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          clearedCount: 0,
          error: resolved.error,
        },
      });
      return;
    }

    this.emit({
      type: "agent.queue.clear.response",
      payload: {
        requestId: msg.requestId,
        agentId: resolved.agentId,
        clearedCount: this.agentManager.clearSteerQueue(resolved.agentId),
        error: null,
      },
    });
  }

  private async handleSendAgentMessageRequest(
    msg: Extract<SessionInboundMessage, { type: "send_agent_message_request" }>,
  ): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(msg.agentId);
    if (!resolved.ok) {
      this.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          accepted: false,
          error: resolved.error,
        },
      });
      return;
    }

    try {
      const agentId = resolved.agentId;

      const prompt = buildAgentPrompt(msg.text, msg.images, msg.attachments);
      this.sessionLogger.trace(
        {
          agentId,
          messageId: msg.messageId,
          textPrefix: msg.text.slice(0, 80),
        },
        "agent.session.send_agent_message",
      );
      let dispatchResult: StartAgentRunResult;
      try {
        dispatchResult = await sendPromptToAgent({
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          agentId,
          prompt,
          messageId: msg.messageId,
          ...(msg.delivery ? { delivery: msg.delivery } : {}),
          logger: this.sessionLogger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.handleAgentRunError(agentId, error, "Failed to send agent message");
        this.emit({
          type: "send_agent_message_response",
          payload: {
            requestId: msg.requestId,
            agentId,
            accepted: false,
            error: message,
          },
        });
        return;
      }

      if (dispatchResult.outOfBand) {
        this.emit({
          type: "send_agent_message_response",
          payload: {
            requestId: msg.requestId,
            agentId,
            accepted: true,
            error: null,
          },
        });
        return;
      }

      // A queued message deliberately starts no run - waiting for one would
      // stall for the whole turn and then time out. The entry id lets the
      // sender find its own message in the agent's queuedMessages.
      if (dispatchResult.queued) {
        this.emit({
          type: "send_agent_message_response",
          payload: {
            requestId: msg.requestId,
            agentId,
            accepted: true,
            error: null,
            queued: true,
            ...(dispatchResult.queuedMessageId
              ? { queuedMessageId: dispatchResult.queuedMessageId }
              : {}),
          },
        });
        return;
      }

      try {
        await waitForAgentRunStartWithTimeout(this.agentManager, agentId);
      } catch (error) {
        this.emit({
          type: "send_agent_message_response",
          payload: {
            requestId: msg.requestId,
            agentId,
            accepted: false,
            error: errorToFriendlyMessage(error),
          },
        });
        return;
      }

      this.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId: resolved.agentId,
          accepted: false,
          error: errorToFriendlyMessage(error),
        },
      });
    }
  }

  private async handleWaitForFinish(
    agentIdOrIdentifier: string,
    requestId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const resolved = await this.resolveAgentIdentifier(agentIdOrIdentifier);
    if (!resolved.ok) {
      this.emit({
        type: "wait_for_finish_response",
        payload: {
          requestId,
          status: "error",
          final: null,
          error: resolved.error,
          lastMessage: null,
        },
      });
      return;
    }

    const agentId = resolved.agentId;
    const live = this.agentManager.getAgent(agentId);
    if (!live) {
      const record = await this.agentStorage.get(agentId);
      if (!record || record.internal) {
        this.emit({
          type: "wait_for_finish_response",
          payload: {
            requestId,
            status: "error",
            final: null,
            error: `Agent not found: ${agentId}`,
            lastMessage: null,
          },
        });
        return;
      }
      const final = this.buildStoredAgentPayload(record);
      let status: "permission" | "error" | "idle";
      if (record.attentionReason === "permission") {
        status = "permission";
      } else if (record.lastStatus === "error") {
        status = "error";
      } else {
        status = "idle";
      }
      const error = resolveWaitForFinishError({ status, final });
      this.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status, final, error, lastMessage: null },
      });
      return;
    }

    const abortController = new AbortController();
    const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0;
    const timeoutHandle = hasTimeout
      ? setTimeout(() => {
          abortController.abort("timeout");
        }, timeoutMs)
      : null;

    try {
      let result = await this.agentManager.waitForAgentEvent(agentId, {
        signal: abortController.signal,
        waitForActive: true,
      });
      let final = await this.getAgentPayloadById(agentId);
      if (!final) {
        throw new Error(`Agent ${agentId} disappeared while waiting`);
      }

      let status: "permission" | "error" | "idle";
      if (result.permission) {
        status = "permission";
      } else if (result.status === "error") {
        status = "error";
      } else {
        status = "idle";
      }
      const error = resolveWaitForFinishError({ status, final });

      this.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status, final, error, lastMessage: result.lastMessage },
      });
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
      if (!isAbort) {
        const message = errorToFriendlyMessage(error);
        this.sessionLogger.error({ err: error, agentId }, "wait_for_finish_request failed");
        const final = await this.getAgentPayloadById(agentId);
        this.emit({
          type: "wait_for_finish_response",
          payload: {
            requestId,
            status: "error",
            final,
            error: message,
            lastMessage: null,
          },
        });
        return;
      }

      const final = await this.getAgentPayloadById(agentId);
      if (!final) {
        throw new Error(`Agent ${agentId} disappeared while waiting`, { cause: error });
      }
      this.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status: "timeout", final, error: null, lastMessage: null },
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Emit a message to the client
   */
  private emit(rawMsg: SessionOutboundMessage): void {
    // Scope is checked against the LEGACY type, before any alias rewrite: a
    // session scoped to `personality.*` must still receive the response to a
    // request it was allowed to make, whichever name it asked under.
    if (rawMsg.type !== "rpc_error" && !isSessionRpcAllowed(this.scopes, rawMsg.type)) {
      return;
    }
    // COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
    // Guarded on the tracking set being non-empty, so a client speaking the
    // legacy names never pays for this.
    const msg =
      this.aliasedProfileRpcRequestIds.size > 0 ? this.restoreProfileRpcAlias(rawMsg) : rawMsg;
    // JSON.stringify(msg) is only computed when trace is enabled - it runs for
    // every outbound message otherwise, and trace is disabled by default.
    // Optional-chained because test logger stubs don't implement isLevelEnabled.
    if (this.sessionLogger.isLevelEnabled?.("trace")) {
      this.sessionLogger.trace(
        {
          messageType: msg.type,
          payloadBytes: JSON.stringify(msg).length,
        },
        "agent.session.outbound",
      );
    }
    this.onMessage(msg);
  }

  /**
   * COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
   * Rewrite a profile-named request to the legacy literal its handler is
   * written against, remembering the request id so the response can be
   * rewritten back. Non-alias messages pass straight through.
   */
  private adoptProfileRpcAlias(msg: SessionInboundMessage): SessionInboundMessage {
    const legacyType = resolveAliasedRequestType(msg.type);
    if (!legacyType) {
      return msg;
    }
    const requestId = readRpcRequestId(msg);
    if (requestId !== null) {
      this.aliasedProfileRpcRequestIds.add(requestId);
    }
    return { ...msg, type: legacyType } as SessionInboundMessage;
  }

  /**
   * COMPAT(agentProfileRpcs): added in v0.8.13, remove after 2027-02-22.
   * The mirror of adoptProfileRpcAlias: answer a request that arrived under a
   * profile name with the profile-named response, and stop tracking it.
   */
  private restoreProfileRpcAlias(msg: SessionOutboundMessage): SessionOutboundMessage {
    if (!isAliasableResponseType(msg.type)) {
      return msg;
    }
    const requestId = readRpcRequestId(msg);
    if (requestId === null || !this.aliasedProfileRpcRequestIds.delete(requestId)) {
      return msg;
    }
    const aliasType = resolveAliasedResponseType(msg.type);
    return aliasType ? ({ ...msg, type: aliasType } as SessionOutboundMessage) : msg;
  }

  private emitBinary(frame: Uint8Array): void {
    if (!this.onBinaryMessage) {
      return;
    }
    try {
      this.onBinaryMessage(frame);
    } catch (error) {
      this.sessionLogger.error({ err: error }, "Failed to emit binary frame");
    }
  }

  private async emitBinaryForFileTransfer(frame: Uint8Array, source?: object): Promise<void> {
    if (source && this.onBinaryMessageToSource) {
      await this.onBinaryMessageToSource(source, frame);
      return;
    }
    this.emitBinary(frame);
  }

  private emitForSource(msg: SessionOutboundMessage, source?: object): void {
    if (source && this.onMessageToSource) {
      this.onMessageToSource(source, msg);
      return;
    }
    this.emit(msg);
  }

  /**
   * Clean up session resources
   */
  public async cleanup(): Promise<void> {
    this.sessionLogger.trace({}, "agent.session.lifecycle.cleanup");
    this.isCleanedUp = true;

    if (this.unsubscribeAgentEvents) {
      this.unsubscribeAgentEvents();
      this.unsubscribeAgentEvents = null;
    }
    this.unsubscribeCommunicationsPresenceChanges?.();
    this.unsubscribeCommunicationsPresenceChanges = null;
    this.unsubscribeProjectMutations?.();
    this.unsubscribeProjectMutations = null;
    this.unsubscribeWorkspaceMutations?.();
    this.unsubscribeWorkspaceMutations = null;
    this.agentUpdates.dispose();
    await this.hubExecutionController?.cleanup();
    if (this.unsubscribeTerminalWorkspaceContributionEvents) {
      this.unsubscribeTerminalWorkspaceContributionEvents();
      this.unsubscribeTerminalWorkspaceContributionEvents = null;
    }
    if (this.unsubscribeGitOperationLog) {
      this.unsubscribeGitOperationLog();
      this.unsubscribeGitOperationLog = null;
    }
    this.providerCatalogSession.dispose();

    await this.voiceSession.cleanup();

    this.terminalController.dispose();

    this.checkoutSession.cleanup();

    this.kanbanSession.dispose();

    this.workspaceGitObserver.dispose();

    this.workspaceFilesSession.dispose();

    this.artifactSession.stop();
    this.workspaceFilesSession.dispose();
  }
}

interface CloneRepositoryInput {
  name: string;
  displayName: string;
  cloneUrl: string;
}

function normalizeCloneRepository(input: {
  repo: string;
  cloneProtocol?: "https" | "ssh";
}): CloneRepositoryInput {
  const trimmed = input.repo.trim();
  if (!trimmed) {
    throw new Error("Repository is required");
  }

  const remote = parseGitRemoteLocation(trimmed);
  if (remote) {
    const segments = remote.path.split("/").filter(Boolean);
    const name = segments.at(-1);
    if (!name || !isValidGitHubRepoSegment(name)) {
      throw new Error("Repository name contains invalid characters");
    }
    return { name, displayName: remote.path, cloneUrl: trimmed };
  }

  const [owner, rawName, ...extra] = trimmed.split("/");
  if (!owner || !rawName || extra.length > 0) {
    throw new Error("Repository must use owner/repo format or a git remote URL");
  }
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;
  if (!isValidGitHubRepoSegment(owner) || !isValidGitHubRepoSegment(name)) {
    throw new Error("Repository contains invalid characters");
  }
  if (!input.cloneProtocol) {
    throw new Error("Clone protocol is required for owner/repo repository names");
  }
  const cloneUrl =
    input.cloneProtocol === "ssh"
      ? `git@github.com:${owner}/${name}.git`
      : `https://github.com/${owner}/${name}.git`;
  return {
    name,
    displayName: `${owner}/${name}`,
    cloneUrl,
  };
}

function isValidGitHubRepoSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value);
}
