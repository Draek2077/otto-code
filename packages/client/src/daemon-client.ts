import type { AgentAttentionNotificationPayload } from "@otto-code/protocol/agent-attention-notification";
import type { z } from "zod";
import type { ProjectGithubCloneProtocol } from "@otto-code/protocol/messages";
import { CLIENT_CAPS, type ClientCapability } from "@otto-code/protocol/client-capabilities";
import {
  AgentCreateFailedStatusPayloadSchema,
  AgentCreatedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  CheckoutRenameBranchResponseSchema,
  parseServerInfoStatusPayload,
  RenameTerminalResponseSchema,
  RestartRequestedStatusPayloadSchema,
  ShutdownRequestedStatusPayloadSchema,
  DaemonUpdateResponseSchema,
  SessionInboundMessageSchema,
  type ServerInfoStatusPayload,
} from "@otto-code/protocol/messages";
import { validateWSOutboundMessage } from "@otto-code/protocol/validation/ws-outbound";
import type {
  AgentStreamEventPayload,
  AgentSnapshotPayload,
  ProjectPlacementPayload,
  AgentPermissionResolvedMessage,
  CreateAgentRequestMessage,
  CreateOttoWorktreeRequest,
  CodeListFilesResponse,
  CodeSymbolLocation,
  CodeDefinitionLocation,
  CodeDefinitionStatus,
  CodeRenameApplyStatus,
  CodeRenameFileOutcome,
  CodeRenameUndoFile,
  CodeRenameUndoStatus,
  CodeHoverRange,
  CodeRenameEdit,
  CodeRenameFilePlan,
  LspLanguageState,
  LspRunningServer,
  CodeSolutionGetTreeResponse,
  CodeSolutionLoadProjectResponse,
  SolutionFormat,
  SolutionRef,
  SolutionTreeFolder,
  SolutionTreeProject,
  SolutionProjectNode,
  SolutionProjectStatus,
  SolutionPackageReference,
  FileDownloadTokenResponse,
  FileEntryKind,
  FileEol,
  FileReplaceFileResult,
  FileReplaceRequest,
  FileReplaceResponse,
  FileSearchResultPayload,
  FileSearchSummary,
  FileUploadResponse,
  FileExplorerResponse,
  FileWatchEventPayload,
  FileWriteResult,
  FileRefineResult,
  FileRefineDocument,
  FileRefineReference,
  FetchAgentTimelineResponseMessage,
  AgentForkContextResponseMessage,
  GitSetupOptions,
  CheckoutStatusResponse,
  CheckoutCommitResponse,
  CheckoutGitCommitResponse,
  CheckoutGitCommitAgentResponse,
  CheckoutGitRollbackResponse,
  CheckoutGitFileHistoryResponse,
  CheckoutGitFileCommitDiffResponse,
  CheckoutGitFileBlameResponse,
  CheckoutGitFileOriginResponse,
  CheckoutGitGetOperationLogResponse,
  CheckoutMergeResponse,
  CheckoutMergeFromBaseResponse,
  CheckoutPullResponse,
  CheckoutPushResponse,
  CheckoutRefreshResponse,
  CheckoutGitFetchResponse,
  CheckoutPrCreateResponse,
  CheckoutPrMergeResponse,
  CheckoutPrMergeMethod,
  CheckoutGithubSetAutoMergeResponse,
  CheckoutGithubGetCheckDetailsResponse,
  PreviewListConfigResponse,
  PreviewStartResponse,
  PreviewBindTabResponse,
  PreviewStopResponse,
  CheckoutPrStatusResponse,
  PullRequestTimelineResponse,
  CheckoutSwitchBranchResponse,
  StashSaveResponse,
  StashPopResponse,
  StashListResponse,
  KanbanBoardsListResponse,
  ProjectKanbanTarget,
  KanbanBoardGetResponse,
  KanbanCardMoveResponse,
  KanbanCardCreateResponse,
  KanbanTaskLinkResponse,
  ValidateBranchResponse,
  BranchSuggestionsResponse,
  FileVersion,
  CheckoutCommit,
  ParsedDiffFile,
  WorkspaceRecoveryState,
  CheckoutForgeGetCheckDetailsResponse,
  CheckoutForgeSetAutoMergeResponse,
  ProjectCreateDirectoryResponse,
  FsFileWriteResult,
  FsFileWriteBinaryResult,
  GitHubSearchResponse,
  GitHubSearchRequest,
  ForgeSearchResponse,
  ForgeSearchRequest,
  GitHostingProviderId,
  HostingSearchRequest,
  HostingSearchResponse,
  HostingAuthStatusResponse,
  DirectorySuggestionsResponse,
  OttoWorktreeListResponse,
  OttoWorktreeArchiveResponse,
  ProjectIconSource,
  ProjectIconResponse,
  ContextCategory,
  ContextPromptPreviewGetResponseMessage,
  ContextReportGetResponseMessage,
  ContextEdgeConvertResponseMessage,
  ContextFindingsFixResponseMessage,
  PersonalityMemoryListResponseMessage,
  PersonalityMemoryUpdateResponseMessage,
  PersonalityMemoryTransferResponseMessage,
  PersonalityMemoryStatsResponseMessage,
  ProjectKnowledgeListResponseMessage,
  ProjectKnowledgeGetResponseMessage,
  ProjectKnowledgeCreateResponseMessage,
  ProjectKnowledgeApplyResponseMessage,
  ProjectKnowledgeStatusResponseMessage,
  ProjectKnowledgeProjectApplyResponseMessage,
  ProjectKnowledgeReferenceApplyResponseMessage,
  ProjectKnowledgeRootApplyResponseMessage,
  ProjectKnowledgeDeleteResponseMessage,
  ProjectIconGetResponse,
  ProjectAddResponse,
  ProjectResolveWorkspaceForPathResponse,
  ProjectScaffoldGit,
  ProjectScaffoldProgress,
  ProjectScaffoldResponse,
  HostingListRepositoriesResponse,
  HostingListOwnersResponse,
  OpenProjectResponseMessage,
  ArchiveWorkspaceResponseMessage,
  WorkspaceArchivePreflightResponse,
  WorktreeBaseRefSetResponse,
  WorktreeReattachListResponse,
  WorktreeReattachResponse,
  WorktreeReattachTarget,
  WorkspaceSetupStatusResponseMessage,
  ListCommandsResponse,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  ListAvailableProvidersResponse,
  GetProvidersSnapshotResponseMessage,
  RefreshProvidersSnapshotResponseMessage,
  ProviderDiagnosticResponseMessage,
  ProviderUsageListResponseMessage,
  StatsActivityGetResponseMessage,
  StatsActivityResetResponseMessage,
  UsageLogGetResponseMessage,
  AgentContextGetUsageResponseMessage,
  DaemonGetStatusResponse,
  DaemonGetPairingOfferResponse,
  DiagnosticsResponse,
  AgentRewindResponseMessage,
  ListTerminalsResponse,
  CreateTerminalResponse,
  SubscribeTerminalResponse,
  SubscribeTerminalRequest,
  CloseItemsResponse,
  AttachmentsImagesClearResponse,
  AttachmentsImagesStatsResponse,
  HistoryAgentsClearArchivedResponse,
  HistoryAgentsStorageStatsResponse,
  KillTerminalResponse,
  CaptureTerminalResponse,
  TerminalCompatibilityDiagnosticResponse,
  TerminalInput,
  SessionInboundMessage,
  SessionOutboundMessage,
  SendAgentMessageRequest,
  AgentPromptDelivery,
  TasksSuggestedStartMode,
  OttoConfigRaw,
  OttoConfigRevision,
  WorkspaceCreateRequest,
} from "@otto-code/protocol/messages";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentProviderNotice,
  AgentProvider,
  AgentSessionConfig,
} from "@otto-code/protocol/agent-types";
import type { OrchestrationGraph, PromptTemplate, Run } from "@otto-code/protocol/orchestration";
import type {
  BrainCatalogModel,
  BrainDiskUsage,
  BrainEvals,
  BrainHfSearchResult,
  BrainHostStatus,
  BrainInstalledModel,
  BrainInventoryModel,
  BrainJob,
  BrainLogsTailResponse,
  BrainLogsWatchResponse,
  BrainModelBudgetGetResponse,
  BrainModelDeleteResponse,
  BrainModelLoadResponse,
  BrainModelProfileGetResponse,
  BrainModelProfileSetResponse,
  BrainModelRenameResetResponse,
  BrainModelRenameResponse,
  BrainNetworkInfo,
  BrainRemoteConfig,
  BrainRepoQuant,
  BrainRuntime,
  ConnectorsListToolsResponse,
  ConnectorsOauthAuthorizeResponse,
  ConnectorsOauthDisconnectResponse,
  CommunicationsGetOverviewResponse,
  CommunicationsInboxGetHomeResponse,
  CommunicationsInboxNotificationsAcknowledgeResponse,
  CommunicationsInboxSearchResponse,
  CommunicationsInboxSetFavoriteResponse,
  CommunicationsInboxGetPresenceResponse,
  CommunicationsInboxGetMessagesResponse,
  CommunicationsInboxSetPresenceResponse,
  CommunicationsInboxSetEnabledResponse,
  CommunicationsInboxSendMessageResponse,
  CommunicationsRoomGetResponse,
  CommunicationsRoomThreadGetResponse,
  CommunicationsRoomMessageSendResponse,
  CommunicationsRoomReactionSetResponse,
  IntegrationsAuthorizationGetOverviewResponse,
  IntegrationsAuthorizationGetMethodsResponse,
  IntegrationsAuthorizationStartBrowserResponse,
  IntegrationsZoomStartAuthorizationResponse,
  CueMoment,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProjectLink,
  SpeechSettingsOptions,
  SpeechTtsPreviewResult,
  SpeechTtsSpeakResult,
  SpeechTtsSpeakCancelResult,
  VisualizerVoiceCuesResult,
  AgentPersonalitiesGenerateProfileResult,
} from "@otto-code/protocol/messages";
import type { AgentConfigApply } from "@otto-code/protocol/messages";
import { isRelayClientWebSocketUrl } from "@otto-code/protocol/daemon-endpoints";
import { terminalSubscriptionKey } from "@otto-code/protocol/terminal-subscription-key";
import {
  asUint8Array,
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  decodeTerminalStreamFrame,
  FileTransferOpcode,
  TerminalStreamOpcode,
  type FileTransferFrame,
} from "@otto-code/protocol/binary-frames/index";
import {
  createRelayE2eeTransportFactory,
  createWebSocketTransportFactory,
  decodeMessageData,
  defaultWebSocketFactory,
  describeTransportClose,
  describeTransportError,
  type DaemonTransport,
  type DaemonTransportFactory,
  type WebSocketFactory,
} from "./daemon-client-transport.js";
import {
  DaemonClientRuntimeMetrics,
  type DaemonClientTrafficHotspot,
  type DaemonClientTrafficTotals,
} from "./daemon-client-runtime-metrics.js";
import {
  normalizeListProviderModelsPayload,
  normalizeProviderSnapshotUpdateMessage,
  normalizeProvidersSnapshotPayload,
} from "./compat/normalize-provider-models.js";
import { TerminalStreamRouter, type TerminalStreamEvent } from "./terminal-stream-router.js";
import type {
  BrowserAutomationExecuteRequest,
  BrowserAutomationExecuteResponse,
} from "@otto-code/protocol/browser-automation/rpc-schemas";

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const consoleLogger: Logger = {
  debug: () => {},
  info: (obj, msg) => console.log(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

const perfNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

interface ImportAgentInputBase {
  cwd?: string;
  /**
   * Workspace the import was requested from. Supply it whenever the caller has
   * one, so the imported session lands in that workspace instead of the daemon
   * resolving (or minting) another workspace for the same directory.
   */
  workspaceId?: string;
  labels?: Record<string, string>;
}

export type ImportAgentInput =
  | (ImportAgentInputBase & {
      providerId: string;
      providerHandleId: string;
    })
  | (ImportAgentInputBase & {
      provider: AgentProvider;
      sessionId: string;
    });

function normalizePassword(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > 0 ? value : null;
}

export type {
  DaemonTransport,
  DaemonTransportFactory,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client-transport.js";

export type { TerminalStreamEvent };

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export type DaemonEvent =
  | {
      type: "agent_update";
      agentId: string;
      payload: Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];
    }
  | {
      type: "workspace_update";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_update" }>["payload"];
    }
  | {
      type: "workspace_setup_progress";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }>["payload"];
    }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEventPayload;
      timestamp: string;
      seq?: number;
      epoch?: string;
    }
  | { type: "status"; payload: { status: string } & Record<string, unknown> }
  | { type: "agent_deleted"; agentId: string }
  | {
      type: "agent_permission_request";
      agentId: string;
      request: AgentPermissionRequest;
    }
  | {
      type: "agent_permission_resolved";
      agentId: string;
      requestId: string;
      resolution: AgentPermissionResponse;
    }
  | {
      type: "providers_snapshot_update";
      payload: Extract<SessionOutboundMessage, { type: "providers_snapshot_update" }>["payload"];
    }
  | { type: "error"; message: string };

export type DaemonEventHandler = (event: DaemonEvent) => void;
export type BrowserAutomationExecuteRequestMessage = BrowserAutomationExecuteRequest;
export type BrowserAutomationExecuteResponseMessage = BrowserAutomationExecuteResponse;

export interface DaemonClientConfig {
  url: string;
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  transportFactory?: DaemonTransportFactory;
  webSocketFactory?: WebSocketFactory;
  logger?: Logger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
  trace?: DaemonClientTrace;
  capabilities?: Partial<Record<ClientCapability, unknown>>;
}

export interface DaemonClientTrace {
  isEnabled(): boolean;
  beginSection(name: string, args?: Record<string, string>): void;
  endSection(): void;
}

export interface SendMessageOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
  /**
   * How to reach the agent if it is busy. Omit for `interrupt` (cancel the
   * in-flight turn and run this now). `queue` parks the message and runs it as
   * the agent's next turn. Requires `server_info.features.steerQueue`.
   */
  delivery?: AgentPromptDelivery;
}

export interface SendAgentMessageResult {
  /** True when the daemon parked the message instead of dispatching it. */
  queued: boolean;
  /** The queue entry's id, for finding this message again in `queuedMessages`. */
  queuedMessageId: string | null;
}

type AgentConfigOverrides = Partial<Omit<AgentSessionConfig, "provider" | "cwd">>;

export interface CreateAgentRequestOptions extends AgentConfigOverrides {
  config?: AgentSessionConfig;
  provider?: AgentProvider;
  cwd?: string;
  /** Optional personality id; the daemon snapshots its identity onto the agent. */
  personality?: CreateAgentRequestMessage["personality"];
  env?: CreateAgentRequestMessage["env"];
  workspaceId?: string;
  /**
   * Caller agent making this request. The daemon resolves the caller's own
   * workspace and parentage from it, so a managed CLI run nests under its
   * parent exactly as agent-scoped MCP creation does.
   */
  callerAgentId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: GitSetupOptions;
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface CreateOttoWorktreeInput extends Pick<
  CreateOttoWorktreeRequest,
  | "cwd"
  | "projectId"
  | "worktreeSlug"
  | "firstAgentContext"
  | "refName"
  | "action"
  | "githubPrNumber"
  | "checkoutSource"
> {}

type CheckoutStatusPayload = CheckoutStatusResponse["payload"];
type SubscribeCheckoutDiffPayload = Extract<
  SessionOutboundMessage,
  { type: "subscribe_checkout_diff_response" }
>["payload"];
type CheckoutDiffPayload = Omit<SubscribeCheckoutDiffPayload, "subscriptionId">;
type CheckoutCommitPayload = CheckoutCommitResponse["payload"];
export type CheckoutGitCommitPayload = CheckoutGitCommitResponse["payload"];
export type CheckoutGitCommitAgentPayload = CheckoutGitCommitAgentResponse["payload"];
export type CheckoutGitRollbackPayload = CheckoutGitRollbackResponse["payload"];
export type CheckoutGitGetOperationLogPayload = CheckoutGitGetOperationLogResponse["payload"];
export type CheckoutGitFileHistoryPayload = CheckoutGitFileHistoryResponse["payload"];
export type CheckoutGitFileCommitDiffPayload = CheckoutGitFileCommitDiffResponse["payload"];
export type CheckoutGitFileBlamePayload = CheckoutGitFileBlameResponse["payload"];
export type CheckoutGitFileOriginPayload = CheckoutGitFileOriginResponse["payload"];
type CheckoutMergePayload = CheckoutMergeResponse["payload"];
type CheckoutMergeFromBasePayload = CheckoutMergeFromBaseResponse["payload"];
type CheckoutPullPayload = CheckoutPullResponse["payload"];
type CheckoutPushPayload = CheckoutPushResponse["payload"];
type CheckoutRefreshPayload = CheckoutRefreshResponse["payload"];
type CheckoutGitFetchPayload = CheckoutGitFetchResponse["payload"];
type CheckoutPrCreatePayload = CheckoutPrCreateResponse["payload"];
type CheckoutPrMergePayload = CheckoutPrMergeResponse["payload"];
type CheckoutGithubSetAutoMergePayload = CheckoutGithubSetAutoMergeResponse["payload"];
type PreviewListConfigPayload = PreviewListConfigResponse["payload"];
type PreviewStartPayload = PreviewStartResponse["payload"];
type PreviewBindTabPayload = PreviewBindTabResponse["payload"];
type PreviewStopPayload = PreviewStopResponse["payload"];
type CheckoutGithubGetCheckDetailsPayload = CheckoutGithubGetCheckDetailsResponse["payload"];
type CheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];
type PullRequestTimelinePayload = PullRequestTimelineResponse["payload"];
type CheckoutSwitchBranchPayload = CheckoutSwitchBranchResponse["payload"];
export type RenameBranchResult = z.infer<typeof CheckoutRenameBranchResponseSchema>["payload"];
type StashSavePayload = StashSaveResponse["payload"];
type StashPopPayload = StashPopResponse["payload"];
type StashListPayload = StashListResponse["payload"];
type ValidateBranchPayload = ValidateBranchResponse["payload"];
type BranchSuggestionsPayload = BranchSuggestionsResponse["payload"];
type GitHubSearchPayload = GitHubSearchResponse["payload"];
type CheckoutForgeGetCheckDetailsPayload = CheckoutForgeGetCheckDetailsResponse["payload"];
type CheckoutForgeSetAutoMergePayload = CheckoutForgeSetAutoMergeResponse["payload"];
export type ProjectCreateDirectoryPayload = ProjectCreateDirectoryResponse["payload"];
export type ProjectListPayload = Extract<
  SessionOutboundMessage,
  { type: "project.list.response" }
>["payload"];
export type WorkspaceGithubSearchRepositoriesPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace.github.search_repositories.response" }
>["payload"];

export interface AgentAttentionRequiredNotification {
  agentId: string;
  reason: "finished" | "error" | "permission";
  timestamp: string;
  shouldNotify: boolean;
  notification?: AgentAttentionNotificationPayload;
}

type ForgeSearchPayload = ForgeSearchResponse["payload"];
export type HostingSearchPayload = HostingSearchResponse["payload"];
export type HostingAuthStatusPayload = HostingAuthStatusResponse["payload"];
type DirectorySuggestionsPayload = DirectorySuggestionsResponse["payload"];
type OttoWorktreeListPayload = OttoWorktreeListResponse["payload"];
type OttoWorktreeArchivePayload = OttoWorktreeArchiveResponse["payload"];
type CreateOttoWorktreePayload = Extract<
  SessionOutboundMessage,
  { type: "create_otto_worktree_response" }
>["payload"];
type WorkspaceCreatePayload = Extract<
  SessionOutboundMessage,
  { type: "workspace.create.response" }
>["payload"];
type FileExplorerPayload = FileExplorerResponse["payload"];
export type FileExplorerDirectoryPayload = NonNullable<FileExplorerPayload["directory"]>;
type LegacyFileExplorerFilePayload = NonNullable<FileExplorerPayload["file"]>;
export interface FileReadResult {
  bytes: Uint8Array;
  mime: string;
  size: number;
  path: string;
  kind: LegacyFileExplorerFilePayload["kind"];
  modifiedAt: string;
  /**
   * Detected line endings. Optional because only the inline JSON read path
   * reports them - the chunked binary transfer never does, and neither do
   * daemons older than v0.4.4. Absent means "not reported", not "LF".
   */
  eol?: FileEol;
  /** Opaque version tag for optimistic-concurrency writes; same caveat as eol. */
  revision?: string;
}
export interface TextFileReadResult {
  path: string;
  content: string;
  size: number;
  modifiedAt: string;
  eol: FileEol;
  hash: string | null;
}
export interface FileWriteOptions {
  cwd: string;
  path: string;
  content: string;
  expectedModifiedAt: string;
  expectedHash?: string;
  /** Only the deleted-file "save re-creates" flow sets these two. */
  allowCreate?: boolean;
  eol?: FileEol;
  requestId?: string;
}
/**
 * Bytes to a workspace path. Gated on `features.binaryFileWrite`. Unlike
 * {@link FileWriteOptions} this carries no precondition: `overwrite` is the
 * whole policy - see `FsFileWriteBinaryRequestSchema` for why a generated
 * artifact has nothing to reconcile against.
 */
export interface FileWriteBinaryOptions {
  cwd: string;
  /** Workspace-relative, like every other file RPC. */
  path: string;
  /** Sent as file-transfer frames, not inside the request. */
  bytes: Uint8Array | ArrayBuffer;
  overwrite?: boolean;
  requestId?: string;
  /** Frame size, for tests that want to observe chunking. Defaults to 1 MB. */
  chunkSize?: number;
}
/**
 * The general file-mutation surface - what exists in a directory, rather than
 * what is inside a file. Gated on `features.fileMutations`; there is no
 * client-side substitute, so callers check the flag before offering the action.
 */
export interface FileCreateOptions {
  cwd: string;
  /** Workspace-relative. The parent directory must already exist. */
  path: string;
  kind: FileEntryKind;
  requestId?: string;
}
export interface FileDeleteOptions {
  cwd: string;
  path: string;
  /** Required for a directory with children; otherwise the daemon reports `not_empty`. */
  recursive?: boolean;
  requestId?: string;
}
export interface FileRenameOptions {
  cwd: string;
  path: string;
  /** Workspace-relative destination. A different parent makes this a move. */
  newPath: string;
  requestId?: string;
}
/**
 * Refine - ask the daemon for proposed rewrites of a pinned set of documents.
 * This call never writes: accepted proposals go back through {@link
 * DaemonClient.writeFile}, one per file, like any other save.
 */
export interface FileRefineOptions {
  /** Provider resolution only; the documents themselves travel inline. */
  cwd: string;
  /** What the model may rewrite - this list is the request's blast radius. */
  documents: FileRefineDocument[];
  /** What it may read for context but must never rewrite. */
  references?: FileRefineReference[];
  instruction: string;
  requestId?: string;
}
export type {
  FileReplaceFileResult,
  FileSearchResultPayload,
  FileSearchSummary,
  FileWatchEventPayload,
  FileWriteResult,
  FileRefineResult,
  FileRefineDocument,
  FileRefineReference,
};

export interface FileSearchOptions {
  cwd: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  include?: string;
  exclude?: string;
  /** Called once per file with matches while the scan streams. */
  onFileResult: (result: FileSearchResultPayload) => void;
  requestId?: string;
}

export type FileReplaceFilesInput = FileReplaceRequest["files"];
export type FileReplaceResultPayload = FileReplaceResponse["payload"];
export type {
  CodeSymbolLocation,
  CodeHoverRange,
  CodeRenameEdit,
  CodeRenameFilePlan,
  LspLanguageState,
  LspRunningServer,
};
export type CodeListFilesResultPayload = CodeListFilesResponse["payload"];

/** 1-based, matching the wire and `CodeSymbolLocation`. */
export interface CodeDefinitionQuery {
  cwd: string;
  path: string;
  line: number;
  column: number;
}

export interface LspServersSnapshot {
  languages: LspLanguageState[];
  running: LspRunningServer[];
}

/** The Solution view (projects/solution-view). Independent of the LSP family above. */
export type {
  SolutionFormat,
  SolutionRef,
  SolutionTreeFolder,
  SolutionTreeProject,
  SolutionProjectNode,
  SolutionProjectStatus,
  SolutionPackageReference,
};

export type SolutionTree = Omit<
  CodeSolutionGetTreeResponse["payload"],
  "cwd" | "error" | "requestId"
>;

export type SolutionProjectContents = Omit<
  CodeSolutionLoadProjectResponse["payload"],
  "cwd" | "solutionPath" | "requestId"
>;

export interface CodeHoverResult {
  status: CodeDefinitionStatus;
  /** Markdown, or null when the server had nothing to say here. */
  markdown: string | null;
  range: CodeHoverRange | null;
  serverId: string | null;
  error: string | null;
}

export interface CodeReferencesResult {
  status: CodeDefinitionStatus;
  locations: CodeDefinitionLocation[];
  error: string | null;
}

export interface CodeRenamePreviewQuery extends CodeDefinitionQuery {
  newName: string;
}

export interface CodeRenamePlan {
  status: CodeDefinitionStatus;
  files: CodeRenameFilePlan[];
  /** Blast radius, so a dry-run surface can lead with it. */
  fileCount: number;
  editCount: number;
  /** Identity of this exact plan. Send it back to apply; see `applyCodeRename`. */
  planId: string;
  error: string | null;
}

export interface CodeRenameApplyQuery extends CodeRenamePreviewQuery {
  /** The `planId` of the plan that was actually shown to the user. */
  planId: string;
}

export interface CodeRenameApplyOutcome {
  status: CodeRenameApplyStatus;
  /** Identity of the run, for undo. Null when nothing ran. */
  runId: string | null;
  files: CodeRenameFileOutcome[];
  appliedFiles: number;
  appliedEdits: number;
  skippedEdits: number;
  /** True only when every planned edit landed. */
  complete: boolean;
  error: string | null;
}

export interface CodeRenameUndoOutcome {
  status: CodeRenameUndoStatus;
  files: CodeRenameUndoFile[];
  restoredFiles: number;
  /** True only when every file the run wrote was put back. */
  complete: boolean;
  error: string | null;
}

export interface CodeDefinitionResult {
  status: CodeDefinitionStatus;
  locations: CodeDefinitionLocation[];
  error: string | null;
}
export interface FileUploadInput {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array | ArrayBuffer;
  modifiedAt?: string;
  requestId?: string;
  chunkSize?: number;
}
export type FileUploadResult = FileUploadResponse["payload"];
type FileDownloadTokenPayload = FileDownloadTokenResponse["payload"];
type ListProviderFeaturesPayload = ListProviderFeaturesResponseMessage["payload"];
type ListProviderModelsPayload = ListProviderModelsResponseMessage["payload"];
type ListProviderModesPayload = ListProviderModesResponseMessage["payload"];
type ListAvailableProvidersPayload = ListAvailableProvidersResponse["payload"];
type GetProvidersSnapshotPayload = GetProvidersSnapshotResponseMessage["payload"];
type RefreshProvidersSnapshotPayload = RefreshProvidersSnapshotResponseMessage["payload"];
type ProviderDiagnosticPayload = ProviderDiagnosticResponseMessage["payload"];
type ProviderUsageListPayload = ProviderUsageListResponseMessage["payload"];
type AgentContextGetUsagePayload = AgentContextGetUsageResponseMessage["payload"];
type DaemonStatusPayload = DaemonGetStatusResponse["payload"];
type DaemonPairingOfferPayload = DaemonGetPairingOfferResponse["payload"];
type DiagnosticsPayload = DiagnosticsResponse["payload"];
type ReadProjectConfigPayload = Extract<
  SessionOutboundMessage,
  { type: "read_project_config_response" }
>["payload"];
type WriteProjectConfigPayload = Extract<
  SessionOutboundMessage,
  { type: "write_project_config_response" }
>["payload"];
type ListCommandsPayload = ListCommandsResponse["payload"];
type ListCommandsDraftConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId" | "featureValues"
>;
export interface WriteProjectConfigInput {
  repoRoot: string;
  config: OttoConfigRaw;
  expectedRevision: OttoConfigRevision | null;
  requestId?: string;
}
interface ListCommandsOptions {
  agentId: string;
  requestId?: string;
  draftConfig?: ListCommandsDraftConfig;
}
type LegacyListCommandsOptions = Omit<ListCommandsOptions, "agentId">;
type SetVoiceModePayload = Extract<
  SessionOutboundMessage,
  { type: "set_voice_mode_response" }
>["payload"];
type DictationFinishAcceptedPayload = Extract<
  SessionOutboundMessage,
  { type: "dictation_stream_finish_accepted" }
>["payload"];
type AgentPermissionResolvedPayload = AgentPermissionResolvedMessage["payload"];
type ListTerminalsPayload = ListTerminalsResponse["payload"];
type CreateTerminalPayload = CreateTerminalResponse["payload"];
export type RenameTerminalResult = z.infer<typeof RenameTerminalResponseSchema>["payload"];
type SubscribeTerminalPayload = SubscribeTerminalResponse["payload"];
type CloseItemsPayload = CloseItemsResponse["payload"];
type KillTerminalPayload = KillTerminalResponse["payload"];
type CaptureTerminalPayload = CaptureTerminalResponse["payload"];
type TerminalCompatibilityDiagnosticPayload = TerminalCompatibilityDiagnosticResponse["payload"];
type ScheduleCreatePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/create/response" }
>["payload"];
type ScheduleListPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/list/response" }
>["payload"];
type ScheduleInspectPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/inspect/response" }
>["payload"];
type ScheduleLogsPayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/logs/response" }
>["payload"];
type SchedulePausePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/pause/response" }
>["payload"];
type ScheduleResumePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/resume/response" }
>["payload"];
type ScheduleDeletePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/delete/response" }
>["payload"];
type ScheduleRunOncePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/run-once/response" }
>["payload"];
type ScheduleUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "schedule/update/response" }
>["payload"];
type ArtifactListPayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.list.response" }
>["payload"];
type ArtifactCreatePayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.create.response" }
>["payload"];
type ArtifactUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.update.response" }
>["payload"];
type ArtifactRegeneratePayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.regenerate.response" }
>["payload"];
type ArtifactCancelPayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.cancel.response" }
>["payload"];
type ArtifactDeletePayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.delete.response" }
>["payload"];
type ArtifactStarPayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.star.response" }
>["payload"];
type ArtifactGetContentPayload = Extract<
  SessionOutboundMessage,
  { type: "artifact.get-content.response" }
>["payload"];
export type FetchAgentTimelinePayload = FetchAgentTimelineResponseMessage["payload"];
export type AgentForkContextPayload = AgentForkContextResponseMessage["payload"];

export type FetchAgentTimelineDirection = FetchAgentTimelinePayload["direction"];
export type FetchAgentTimelineProjection = FetchAgentTimelinePayload["projection"];
export type FetchAgentTimelineCursor = NonNullable<FetchAgentTimelinePayload["startCursor"]>;
export interface FetchAgentOptions {
  agentId: string;
  requestId?: string;
  timeout?: number;
}
type LegacyFetchAgentOptions = Omit<FetchAgentOptions, "agentId">;
export interface FetchAgentTimelineOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  mergeWindow?: boolean;
  requestId?: string;
  timeout?: number;
}

export type AgentTimelinePromptIndexPayload = Extract<
  SessionOutboundMessage,
  { type: "agent.timeline.list_prompts.response" }
>["payload"];

export type ProviderSubagentListPayload = Extract<
  SessionOutboundMessage,
  { type: "agent.provider_subagents.list.response" }
>["payload"];
export type ProviderSubagentTimelinePayload = Extract<
  SessionOutboundMessage,
  { type: "agent.provider_subagents.timeline.get.response" }
>["payload"];
export interface FetchProviderSubagentTimelineOptions {
  direction?: ProviderSubagentTimelinePayload["direction"];
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  requestId?: string;
  timeout?: number;
}

// COMPAT(daemon-client-object-options): added in v0.1.102; remove after
// 2026-12-29 once SDK callers have migrated to object parameters.
function normalizeFetchAgentOptions(
  input: FetchAgentOptions | string,
  legacyOptions?: LegacyFetchAgentOptions | string,
): FetchAgentOptions {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof legacyOptions === "string") {
    return { agentId: input, requestId: legacyOptions };
  }
  return { agentId: input, ...legacyOptions };
}

function normalizeListCommandsOptions(
  input: ListCommandsOptions | string,
  legacyOptions?: LegacyListCommandsOptions | string,
): ListCommandsOptions {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof legacyOptions === "string") {
    return { agentId: input, requestId: legacyOptions };
  }
  return { agentId: input, ...legacyOptions };
}
export interface AgentForkContextOptions {
  boundaryCursor?: FetchAgentTimelineCursor;
  boundaryMessageId?: string;
  requestId?: string;
}

type AgentRefreshedStatusPayload = z.infer<typeof AgentRefreshedStatusPayloadSchema>;
type RestartRequestedStatusPayload = z.infer<typeof RestartRequestedStatusPayloadSchema>;
type ShutdownRequestedStatusPayload = z.infer<typeof ShutdownRequestedStatusPayloadSchema>;
export interface ShutdownServerOptions {
  requestId?: string;
  timeout?: number;
}
export interface DaemonStatusOptions {
  requestId?: string;
  timeout?: number;
}
export interface DaemonPairingOfferOptions {
  requestId?: string;
  timeout?: number;
}
type DaemonUpdateResponse = z.infer<typeof DaemonUpdateResponseSchema>;
type FetchAgentsPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"];
type FetchAgentsRequest = Extract<SessionInboundMessage, { type: "fetch_agents_request" }>;
export type FetchAgentsOptions = Omit<FetchAgentsRequest, "type" | "requestId"> & {
  requestId?: string;
  timeout?: number;
};
export type FetchAgentsEntry = FetchAgentsPayload["entries"][number];
export type FetchAgentsPageInfo = FetchAgentsPayload["pageInfo"];
type FetchAgentHistoryPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agent_history_response" }
>["payload"];
type FetchAgentHistoryRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_history_request" }
>;
export type FetchAgentHistoryOptions = Omit<FetchAgentHistoryRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchAgentHistoryEntry = FetchAgentHistoryPayload["entries"][number];
export type FetchAgentHistoryPageInfo = FetchAgentHistoryPayload["pageInfo"];
type FetchRecentProviderSessionsPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_recent_provider_sessions_response" }
>["payload"];
type FetchRecentProviderSessionsRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_recent_provider_sessions_request" }
>;
export type FetchRecentProviderSessionsOptions = Omit<
  FetchRecentProviderSessionsRequest,
  "type" | "requestId"
> & {
  requestId?: string;
};
export type FetchRecentProviderSessionEntry = FetchRecentProviderSessionsPayload["entries"][number];
type FetchWorkspacesPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesRequest = Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>;
export type FetchWorkspacesOptions = Omit<FetchWorkspacesRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchWorkspacesEntry = FetchWorkspacesPayload["entries"][number];
export type FetchWorkspacesPageInfo = FetchWorkspacesPayload["pageInfo"];
export interface CreateScheduleOptions {
  prompt: string;
  name?: string | null;
  cadence:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
        timezone?: string;
      };
  target:
    | {
        type: "self";
        agentId: string;
      }
    | {
        type: "agent";
        agentId: string;
      }
    | {
        type: "new-agent";
        config: {
          provider: AgentProvider;
          cwd: string;
          /** Personality binding by name, or the "@team-scheduler" sentinel. */
          personality?: string;
          modeId?: string;
          model?: string;
          thinkingOptionId?: string;
          archiveOnFinish?: boolean;
          isolation?: "local" | "worktree";
          title?: string | null;
          providerOptions?: AgentSessionConfig["providerOptions"];
          systemPrompt?: string;
          mcpServers?: AgentSessionConfig["mcpServers"];
        };
      };
  maxRuns?: number;
  expiresAt?: string;
  runOnCreate?: boolean;
  requestId?: string;
}
export interface InspectScheduleOptions {
  id: string;
  requestId?: string;
}
export interface UpdateScheduleNewAgentConfig {
  provider?: string;
  /**
   * Personality binding by name, or the "@team-scheduler" sentinel. Explicit
   * null clears a stored binding; omission leaves it untouched.
   */
  personality?: string | null;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  archiveOnFinish?: boolean;
  isolation?: "local" | "worktree";
  cwd?: string;
}
export interface UpdateScheduleOptions {
  id: string;
  name?: string | null;
  prompt?: string;
  cadence?:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
        timezone?: string;
      };
  newAgentConfig?: UpdateScheduleNewAgentConfig;
  maxRuns?: number | null;
  expiresAt?: string | null;
  requestId?: string;
}
export interface RenameBranchInput {
  cwd: string;
  branch: string;
  requestId?: string;
}
export interface RenameTerminalInput {
  terminalId: string;
  title: string;
  clear?: boolean;
  requestId?: string;
}
type OpenProjectPayload = OpenProjectResponseMessage["payload"];
type ProjectAddPayload = ProjectAddResponse["payload"];
export type ProjectScaffoldPayload = ProjectScaffoldResponse["payload"];
export type HostingListRepositoriesPayload = HostingListRepositoriesResponse["payload"];
export type HostingListOwnersPayload = HostingListOwnersResponse["payload"];
type ArchiveWorkspacePayload = ArchiveWorkspaceResponseMessage["payload"];
type WorkspaceArchivePreflightPayload = WorkspaceArchivePreflightResponse["payload"];
type WorktreeBaseRefSetPayload = WorktreeBaseRefSetResponse["payload"];
type WorktreeReattachListPayload = WorktreeReattachListResponse["payload"];
type WorktreeReattachPayload = WorktreeReattachResponse["payload"];
type WorkspaceSetupStatusPayload = WorkspaceSetupStatusResponseMessage["payload"];

export interface FetchAgentResult {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload | null;
}

export interface WaitForFinishResult {
  status: "idle" | "error" | "permission" | "timeout";
  final: AgentSnapshotPayload | null;
  error: string | null;
  lastMessage: string | null;
}

interface Waiter<T> {
  predicate: (msg: SessionOutboundMessage) => T | null;
  resolve(value: T): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  /**
   * Set for RPC waiters so a response that fails schema validation can be
   * matched back to its caller. Without it the caller only learns of a
   * malformed response when its timeout expires.
   */
  requestId?: string;
}

interface WaitOptions {
  skipQueue?: boolean;
  requestId?: string;
}

interface CorrelatedResponseIdentity {
  requestId: string;
  responseType?: string;
}

interface WaitHandle<T> {
  promise: Promise<T>;
  cancel: (error: Error) => void;
}

interface PendingBinaryFileRead {
  cwd: string;
  path: string;
}

interface BinaryFileTransferState extends PendingBinaryFileRead {
  mime: string;
  size: number;
  encoding: Extract<
    FileTransferFrame,
    { opcode: typeof FileTransferOpcode.FileBegin }
  >["metadata"]["encoding"];
  modifiedAt: string;
  chunks: Uint8Array[];
}

type RpcWaitResult<T> = { kind: "ok"; value: T } | { kind: "error"; error: DaemonRpcError };
type GetDaemonConfigResponse = Extract<
  SessionOutboundMessage,
  { type: "get_daemon_config_response" }
>;
type SetDaemonConfigResponse = Extract<
  SessionOutboundMessage,
  { type: "set_daemon_config_response" }
>;
type CorrelatedResponseMessage =
  | Extract<SessionOutboundMessage, { payload: { requestId: string } }>
  | GetDaemonConfigResponse
  | SetDaemonConfigResponse;
type CorrelatedResponseType = CorrelatedResponseMessage["type"];
type CorrelatedResponsePayload<TType extends CorrelatedResponseType> = Extract<
  CorrelatedResponseMessage,
  { type: TType }
>["payload"];

class DaemonRpcError extends Error {
  readonly requestId: string;
  readonly requestType?: string;
  readonly code?: string;

  constructor(params: { requestId: string; error: string; requestType?: string; code?: string }) {
    const parts = [params.error];
    if (params.requestType) parts.push(`requestType=${params.requestType}`);
    if (params.code) parts.push(`code=${params.code}`);
    super(parts.join(" "));
    this.name = "DaemonRpcError";
    this.requestId = params.requestId;
    this.requestType = params.requestType;
    this.code = params.code;
  }
}

class DaemonProtocolError extends Error {
  readonly requestId: string;
  readonly responseType?: string;
  readonly code = "invalid_response";

  constructor(identity: CorrelatedResponseIdentity) {
    const responseLabel = identity.responseType ?? "unknown response";
    super(`Response validation failed for ${responseLabel}`);
    this.name = "DaemonProtocolError";
    this.requestId = identity.requestId;
    this.responseType = identity.responseType;
  }
}

class PingTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Ping timed out (${timeoutMs}ms)`);
    this.name = "PingTimeoutError";
  }
}

/**
 * Pull the request correlation out of a frame that failed schema validation.
 * Reads only the envelope and `payload.requestId`, which is exactly the part a
 * malformed response still gets right, so the waiting caller can be failed with
 * a real reason rather than left to time out.
 */
function extractCorrelatedResponseIdentity(input: unknown): CorrelatedResponseIdentity | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const envelope = input as { type?: unknown; message?: unknown };
  if (envelope.type !== "session" || !envelope.message || typeof envelope.message !== "object") {
    return null;
  }

  const message = envelope.message as { type?: unknown; payload?: unknown };
  if (
    typeof message.type !== "string" ||
    !(
      message.type === "rpc_error" ||
      message.type.endsWith("_response") ||
      message.type.endsWith(".response") ||
      message.type.endsWith("/response")
    )
  ) {
    return null;
  }
  if (!message.payload || typeof message.payload !== "object") {
    return null;
  }

  const payload = message.payload as { requestId?: unknown };
  if (typeof payload.requestId !== "string") {
    return null;
  }

  return {
    requestId: payload.requestId,
    responseType: message.type,
  };
}

function toTimeoutError(error: unknown, label: string, timeoutMs: number): Error {
  if (error instanceof PingTimeoutError) {
    return new Error(`${label} timed out (${timeoutMs}ms)`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_SESSION_RPC_TIMEOUT_MS = 60_000;
const PUSH_TOKEN_REVOCATION_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 5000;
const LIVENESS_HEARTBEAT_INTERVAL_MS = 10_000;
const LIVENESS_HEARTBEAT_TIMEOUT_MS = 15_000;
const LIVENESS_FAILURE_RECONNECT_THRESHOLD = 2;

/** Default timeout for waiting for connection before sending queued messages */
const DEFAULT_SEND_QUEUE_TIMEOUT_MS = DEFAULT_SESSION_RPC_TIMEOUT_MS;
const DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS = DEFAULT_SESSION_RPC_TIMEOUT_MS;
const DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS = 5000;

function isWaiterTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Timeout waiting for message");
}

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function legacyExplorerFileToBytes(file: LegacyFileExplorerFilePayload): FileReadResult {
  let bytes: Uint8Array;
  if (file.encoding === "base64" && file.content) {
    bytes = decodeBase64ToBytes(file.content);
  } else if (file.encoding === "utf-8" && file.content) {
    bytes = new TextEncoder().encode(file.content);
  } else {
    bytes = new Uint8Array();
  }

  return {
    bytes,
    mime: file.mimeType ?? "application/octet-stream",
    size: file.size,
    path: file.path,
    kind: file.kind,
    modifiedAt: file.modifiedAt,
    eol: file.eol,
    revision: file.revision,
  };
}

function binaryFileKind(mime: string, encoding: string): FileReadResult["kind"] {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (encoding === "utf-8" || mime.startsWith("text/") || mime === "application/json") {
    return "text";
  }
  return "binary";
}

function concatByteChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function getTransportFrameSize(frame: string | Uint8Array | ArrayBuffer): number {
  if (typeof frame === "string") {
    return frame.length;
  }
  return frame.byteLength;
}

function describeInboundTransportFrame(
  frame: unknown,
  rawBytes: Uint8Array | null,
): Record<string, string> {
  if (typeof frame === "string") {
    return { kind: "text", size: String(frame.length) };
  }
  if (rawBytes) {
    return { kind: "binary", size: String(rawBytes.byteLength) };
  }
  return { kind: "unknown", size: "0" };
}

function hashForLog(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

function toReasonCode(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  const normalized = reason.toLowerCase();
  if (normalized.includes("timed out")) {
    return "connect_timeout";
  }
  if (normalized.includes("disposed")) {
    return "disposed";
  }
  if (normalized.includes("client closed")) {
    return "client_closed";
  }
  if (normalized.includes("transport")) {
    return "transport_error";
  }
  if (normalized.includes("failed to connect")) {
    return "connect_failed";
  }
  return "unknown";
}

interface PendingSend {
  message: SessionInboundMessage;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface PingProbe {
  promise: Promise<number>;
  resolve: (value: number) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  startedAt: number;
  // Whether a timeout on this ping should be recorded as a liveness failure. Only the
  // heartbeat sets this; a latency measurement never drives teardown, even when a
  // heartbeat tick shares (dedupes onto) an in-flight measurement ping.
  drivesLivenessFailure: boolean;
}

// A job-starting brain RPC returns { job, error }; surface the error as a throw
// so callers get a plain Promise<BrainJob>.
function unwrapBrainJob(payload: { job: BrainJob | null; error: string | null }): BrainJob {
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.job) {
    throw new Error("The brain did not start the operation.");
  }
  return payload.job;
}

type ProjectGithubClonePayload = Extract<
  SessionOutboundMessage,
  { type: "project.github.clone.response" }
>["payload"];

// A repo clone can take minutes on a large history, so it gets its own budget
// rather than the default request timeout.
const PROJECT_GITHUB_CLONE_TIMEOUT_MS = 5 * 60 * 1000;

export class DaemonClient {
  private transport: DaemonTransport | null = null;
  private transportCleanup: Array<() => void> = [];
  private rawMessageListeners: Set<(message: SessionOutboundMessage) => void> = new Set();
  private messageHandlers: Map<
    SessionOutboundMessage["type"],
    Set<(message: SessionOutboundMessage) => void>
  > = new Map();
  private eventListeners: Set<DaemonEventHandler> = new Set();
  private waiters: Set<Waiter<unknown>> = new Set();
  private checkoutStatusInFlight: Map<string, Promise<CheckoutStatusPayload>> = new Map();
  private connectionListeners: Set<(status: ConnectionState) => void> = new Set();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingGenericTransportErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private lastErrorValue: string | null = null;
  private connectionState: ConnectionState = { status: "idle" };
  private checkoutDiffSubscriptions = new Map<
    string,
    {
      cwd: string;
      compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean };
    }
  >();
  private terminalDirectorySubscriptions = new Map<string, { cwd: string; workspaceId?: string }>();
  private fileSubscriptions = new Map<
    string,
    { cwd: string; path: string; onUpdate: (version: FileVersion) => void }
  >();
  private readonly terminalStreams = new TerminalStreamRouter();
  // requestId -> progress listener for an in-flight project.scaffold.request.
  // Entries are always removed in scaffoldProject's finally block.
  private readonly scaffoldProgressListeners = new Map<
    string,
    (payload: ProjectScaffoldProgress["payload"]) => void
  >();
  private pendingBinaryFileReads = new Map<string, PendingBinaryFileRead>();
  private activeBinaryFileTransfers = new Map<string, BinaryFileTransferState>();
  private completedBinaryFileReads = new Map<string, FileReadResult>();
  private readonly fileWatchRefCounts = new Map<
    string,
    { count: number; cwd: string; path: string }
  >();
  private logger: Logger;
  private pendingSendQueue: PendingSend[] = [];
  private readonly logConnectionPath: "direct" | "relay";
  private readonly logServerId: string | null;
  private readonly logClientIdHash: string;
  private readonly logGeneration: number | null;
  private lastServerInfoMessage: ServerInfoStatusPayload | null = null;
  private runtimeMetricsInterval: ReturnType<typeof setInterval> | null = null;
  private runtimeMetrics: DaemonClientRuntimeMetrics | null = null;
  private pingProbe: PingProbe | null = null;
  private livenessHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLivenessRttMs: number | null = null;
  private consecutiveLivenessFailures = 0;

  constructor(private config: DaemonClientConfig) {
    this.logger = config.logger ?? consoleLogger;
    this.logConnectionPath = isRelayClientWebSocketUrl(this.config.url) ? "relay" : "direct";
    let parsedUrlForLog: URL | null = null;
    try {
      parsedUrlForLog = new URL(this.config.url);
    } catch {
      parsedUrlForLog = null;
    }
    const parsedServerIdForLog = normalizeClientId(parsedUrlForLog?.searchParams.get("serverId"));
    this.logServerId = parsedServerIdForLog ?? parsedUrlForLog?.host ?? null;
    const resolvedClientId = normalizeClientId(this.config.clientId);
    if (!resolvedClientId) {
      throw new Error("Daemon client requires a non-empty clientId");
    }
    this.config.clientId = resolvedClientId;
    this.logClientIdHash = hashForLog(resolvedClientId);
    this.logGeneration =
      typeof this.config.runtimeGeneration === "number" &&
      Number.isFinite(this.config.runtimeGeneration)
        ? this.config.runtimeGeneration
        : null;
    const runtimeMetricsIntervalMs =
      typeof config.runtimeMetricsIntervalMs === "number" && config.runtimeMetricsIntervalMs > 0
        ? config.runtimeMetricsIntervalMs
        : 0;
    // The metrics object is always constructed - it is a handful of Maps keyed
    // by message type, and its per-message cost is dwarfed by the JSON.parse it
    // is measuring. What `runtimeMetricsIntervalMs` gates is the *periodic log*,
    // which is the part that is actually noisy. Keeping the counters on
    // unconditionally is what lets the app read cumulative traffic (see
    // getTrafficTotals) without every embedder having to opt in; before this
    // split, nothing in the app package passed the interval, so client-side wire
    // accounting existed but never ran.
    const runtimeMetricsWindowMs =
      typeof config.runtimeMetricsWindowMs === "number" && config.runtimeMetricsWindowMs > 0
        ? Math.max(config.runtimeMetricsWindowMs, runtimeMetricsIntervalMs)
        : undefined;
    this.runtimeMetrics = new DaemonClientRuntimeMetrics(
      this.logger,
      {
        connectionPath: this.logConnectionPath,
        serverId: this.logServerId,
        getConnectionStatus: () => this.connectionState.status,
      },
      runtimeMetricsWindowMs ? { windowMs: runtimeMetricsWindowMs } : undefined,
    );
    if (runtimeMetricsIntervalMs > 0) {
      this.runtimeMetricsInterval = setInterval(() => {
        this.runtimeMetrics?.flush();
      }, runtimeMetricsIntervalMs);
    }
  }

  // ============================================================================
  // Connection
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connectionState.status === "disposed") {
      throw new Error("Daemon client is disposed");
    }
    if (this.connectionState.status === "connected") {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.shouldReconnect = true;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.attemptConnect();
    });

    return this.connectPromise;
  }

  private attemptConnect(): void {
    if (this.connectionState.status === "disposed") {
      this.rejectConnect(new Error("Daemon client is disposed"));
      return;
    }
    if (!this.shouldReconnect) {
      this.rejectConnect(new Error("Daemon client is closed"));
      return;
    }

    if (this.connectionState.status === "connecting") {
      return;
    }

    const headers: Record<string, string> = {};
    const password = normalizePassword(this.config.password);
    if (password) {
      headers.Authorization = `Bearer ${password}`;
    } else if (this.config.authHeader) {
      headers.Authorization = this.config.authHeader;
    }
    const protocols = password ? [`otto.bearer.${password}`] : undefined;

    try {
      // Reconnect can overlap with browser close/error delivery ordering.
      // Always dispose previous transport before constructing the next one.
      this.disposeTransport();
      const baseTransportFactory =
        this.config.transportFactory ??
        createWebSocketTransportFactory(this.config.webSocketFactory ?? defaultWebSocketFactory);
      const shouldUseRelayE2ee =
        this.config.e2ee?.enabled === true && isRelayClientWebSocketUrl(this.config.url);

      let transportFactory = baseTransportFactory;
      if (shouldUseRelayE2ee) {
        const daemonPublicKeyB64 = this.config.e2ee?.daemonPublicKeyB64;
        if (!daemonPublicKeyB64) {
          throw new Error("daemonPublicKeyB64 is required for relay E2EE");
        }
        transportFactory = createRelayE2eeTransportFactory({
          baseFactory: baseTransportFactory,
          daemonPublicKeyB64,
          logger: this.logger,
        });
      }
      const transportUrl = this.resolveTransportUrlForAttempt();
      const transport = transportFactory({
        url: transportUrl,
        headers,
        ...(protocols ? { protocols } : {}),
      });
      this.transport = transport;
      this.lastServerInfoMessage = null;

      this.updateConnectionState(
        {
          status: "connecting",
          attempt: this.reconnectAttempt,
        },
        { event: "CONNECT_REQUEST" },
      );
      this.resetConnectTimeout();
      const timeoutMs = Math.max(1, this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      this.connectTimeout = setTimeout(() => {
        if (this.connectionState.status !== "connecting") {
          return;
        }
        this.lastErrorValue = "Connection timed out";
        this.disposeTransport(1001, "Connection timed out");
        this.scheduleReconnect({
          reason: "Connection timed out",
          event: "CONNECT_TIMEOUT",
          reasonCode: "connect_timeout",
        });
      }, timeoutMs);

      this.transportCleanup = [
        transport.onOpen(() => {
          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          this.lastErrorValue = null;
          this.sendHelloMessage();
        }),
        transport.onClose((event) => {
          this.resetConnectTimeout();
          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          const reason = describeTransportClose(event);
          if (reason) {
            this.lastErrorValue = reason;
          }
          this.scheduleReconnect({
            reason,
            event: "TRANSPORT_CLOSE",
            reasonCode: "transport_closed",
          });
        }),
        transport.onError((event) => {
          this.resetConnectTimeout();
          const reason = describeTransportError(event);
          const isGeneric = reason === "Transport error";
          // Browser WebSocket.onerror often provides no useful details and is followed
          // by a close event (often with code 1006). Prefer surfacing the close details
          // instead of immediately disconnecting with a generic "Transport error".
          if (isGeneric) {
            this.lastErrorValue ??= reason;
            if (!this.pendingGenericTransportErrorTimeout) {
              this.pendingGenericTransportErrorTimeout = setTimeout(() => {
                this.pendingGenericTransportErrorTimeout = null;
                if (
                  this.connectionState.status === "connected" ||
                  this.connectionState.status === "connecting"
                ) {
                  this.lastErrorValue = reason;
                  this.scheduleReconnect({
                    reason,
                    event: "TRANSPORT_ERROR",
                    reasonCode: "transport_error",
                  });
                }
              }, 250);
            }
            return;
          }

          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          this.lastErrorValue = reason;
          this.scheduleReconnect({
            reason,
            event: "TRANSPORT_ERROR",
            reasonCode: "transport_error",
          });
        }),
        transport.onMessage((data) => this.handleTransportMessage(data)),
      ];
    } catch (error) {
      this.resetConnectTimeout();
      const message = error instanceof Error ? error.message : "Failed to connect";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "CONNECT_FAILED",
        reasonCode: "connect_failed",
      });
      this.rejectConnect(error instanceof Error ? error : new Error(message));
    }
  }

  private resolveConnect(): void {
    if (this.connectResolve) {
      this.connectResolve();
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private rejectConnect(error: Error): void {
    if (this.connectReject) {
      this.connectReject(error);
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  async close(): Promise<void> {
    if (this.connectionState.status === "disposed") {
      return;
    }
    this.shouldReconnect = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.resetConnectTimeout();
    this.disposeTransport(1000, "Client closed");
    this.clearWaiters(new Error("Daemon client closed"));
    this.rejectPendingSendQueue(new Error("Daemon client closed"));
    this.rejectPingProbe(new Error("Daemon client closed"));
    this.terminalStreams.clearSlots();
    this.lastServerInfoMessage = null;
    if (this.runtimeMetricsInterval) {
      clearInterval(this.runtimeMetricsInterval);
      this.runtimeMetricsInterval = null;
      // Only the interval-logging clients emit the closing window; a
      // counters-only client has nothing to log.
      this.runtimeMetrics?.flush({ final: true });
    }
    this.runtimeMetrics = null;
    this.updateConnectionState(
      { status: "disposed" },
      { event: "DISPOSE", reason: "Client closed", reasonCode: "disposed" },
    );
  }

  ensureConnected(): void {
    if (this.connectionState.status === "disposed") {
      return;
    }
    if (!this.shouldReconnect) {
      this.shouldReconnect = true;
    }
    if (
      this.connectionState.status === "connected" ||
      this.connectionState.status === "connecting"
    ) {
      return;
    }
    void this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  subscribeConnectionStatus(listener: (status: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  get isConnected(): boolean {
    return this.connectionState.status === "connected";
  }

  get isConnecting(): boolean {
    return this.connectionState.status === "connecting";
  }

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  getLastLivenessRttMs(): number | null {
    return this.lastLivenessRttMs;
  }

  // ============================================================================
  // Message Subscription
  // ============================================================================

  subscribe(handler: DaemonEventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  subscribeRawMessages(handler: (message: SessionOutboundMessage) => void): () => void {
    this.rawMessageListeners.add(handler);
    return () => {
      this.rawMessageListeners.delete(handler);
    };
  }

  on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void;
  on(handler: DaemonEventHandler): () => void;
  on(
    arg1: SessionOutboundMessage["type"] | DaemonEventHandler,
    arg2?: (message: SessionOutboundMessage) => void,
  ): () => void {
    if (typeof arg1 === "function") {
      return this.subscribe(arg1);
    }

    const type = arg1;
    const handler = arg2!;

    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    return () => {
      const handlers = this.messageHandlers.get(type);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    };
  }

  // ============================================================================
  // Core Send Helpers
  // ============================================================================

  private beginTraceSection(name: string, args?: Record<string, string>): boolean {
    const trace = this.config.trace;
    if (!trace?.isEnabled()) {
      return false;
    }
    trace.beginSection(name, args);
    return true;
  }

  private endTraceSection(isOpen: boolean): void {
    if (isOpen) {
      this.config.trace?.endSection();
    }
  }

  private traceInstant(name: string, args?: Record<string, string>): void {
    const isOpen = this.beginTraceSection(name, args);
    this.endTraceSection(isOpen);
  }

  private sendJsonMessage(envelopeType: string, messageType: string, message: unknown): void {
    this.traceInstant("otto.ws.message.outbound", {
      envelopeType,
      messageType,
    });
    this.sendTransportFrame(JSON.stringify(message));
  }

  private sendTransportFrame(frame: string | Uint8Array | ArrayBuffer): void {
    if (!this.transport) {
      throw new Error("Transport not connected");
    }
    const isOpen = this.beginTraceSection("otto.ws.frame.outbound", {
      kind: typeof frame === "string" ? "text" : "binary",
      size: String(getTransportFrameSize(frame)),
    });
    try {
      this.transport.send(frame);
    } finally {
      this.endTraceSection(isOpen);
    }
  }

  /**
   * Send a session message. For fire-and-forget messages (heartbeats, etc.),
   * failures are suppressed if `suppressSendErrors` is configured.
   * For RPC methods that wait for responses, use `sendSessionMessageOrThrow` instead.
   */
  private sendSessionMessage(message: SessionInboundMessage): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw new Error(`Transport not connected (status: ${this.connectionState.status})`);
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.sendJsonMessage("session", payload.type, { type: "session", message: payload });
    } catch (error) {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private sendBinaryFrame(frame: Uint8Array): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw new Error(`Transport not connected (status: ${this.connectionState.status})`);
    }
    try {
      this.traceInstant("otto.ws.message.outbound", {
        envelopeType: "binary",
        messageType: "binary",
      });
      this.sendTransportFrame(frame);
    } catch (error) {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Send a session message for RPC methods that create waiters.
   * If the connection is still being established ("connecting"), the message
   * is queued and will be sent once connected (or rejected after timeout).
   * This prevents waiters from hanging forever when called during connection.
   */
  private sendSessionMessageOrThrow(message: SessionInboundMessage): Promise<void> {
    const status = this.connectionState.status;

    // If connected, send immediately
    if (this.transport && status === "connected") {
      const payload = SessionInboundMessageSchema.parse(message);
      this.sendJsonMessage("session", payload.type, { type: "session", message: payload });
      return Promise.resolve();
    }

    // If connecting, queue the message to be sent once connected
    if (status === "connecting") {
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          // Remove from queue
          const idx = this.pendingSendQueue.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) {
            this.pendingSendQueue.splice(idx, 1);
          }
          reject(new Error(`Timed out waiting for connection to send message`));
        }, DEFAULT_SEND_QUEUE_TIMEOUT_MS);

        this.pendingSendQueue.push({ message, resolve, reject, timeoutHandle });
      });
    }

    // Not connected and not connecting - fail immediately
    return Promise.reject(new Error(`Transport not connected (status: ${status})`));
  }

  /**
   * Flush pending send queue - called when connection is established.
   */
  private flushPendingSendQueue(): void {
    const queue = this.pendingSendQueue;
    this.pendingSendQueue = [];

    for (const pending of queue) {
      clearTimeout(pending.timeoutHandle);
      try {
        if (this.transport && this.connectionState.status === "connected") {
          const payload = SessionInboundMessageSchema.parse(pending.message);
          this.sendJsonMessage("session", payload.type, { type: "session", message: payload });
          pending.resolve();
        } else {
          pending.reject(new Error("Connection lost before message could be sent"));
        }
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Reject all pending sends - called when connection fails or is closed.
   */
  private rejectPendingSendQueue(error: Error): void {
    const queue = this.pendingSendQueue;
    this.pendingSendQueue = [];

    for (const pending of queue) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }

  private async sendRequest<T>(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout?: number;
    select: (msg: SessionOutboundMessage) => T | null;
    options?: { skipQueue?: boolean };
  }): Promise<T> {
    const timeout = params.timeout ?? DEFAULT_SESSION_RPC_TIMEOUT_MS;
    const { promise, cancel } = this.waitForWithCancel<RpcWaitResult<T>>(
      (msg) => {
        if (msg.type === "rpc_error" && msg.payload.requestId === params.requestId) {
          return {
            kind: "error",
            error: new DaemonRpcError({
              requestId: msg.payload.requestId,
              error: msg.payload.error,
              requestType: msg.payload.requestType,
              code: msg.payload.code,
            }),
          };
        }
        const value = params.select(msg);
        if (value === null) {
          return null;
        }
        return { kind: "ok", value };
      },
      timeout,
      { ...params.options, requestId: params.requestId },
    );

    try {
      await this.sendSessionMessageOrThrow(params.message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      cancel(err);
      void promise.catch(() => undefined);
      throw err;
    }

    const result = await promise;
    if (result.kind === "error") {
      throw result.error;
    }
    return result.value;
  }

  private async sendCorrelatedRequest<
    TResponseType extends CorrelatedResponseType,
    TResult = CorrelatedResponsePayload<TResponseType>,
  >(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout?: number;
    responseType: TResponseType;
    options?: { skipQueue?: boolean };
    selectPayload?: (payload: CorrelatedResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    return this.sendRequest({
      requestId: params.requestId,
      message: params.message,
      timeout: params.timeout,
      options: params.options,
      select: (msg) => {
        const correlated = msg as CorrelatedResponseMessage;
        if (correlated.type !== params.responseType) {
          return null;
        }
        const payload = correlated.payload as unknown as CorrelatedResponsePayload<TResponseType>;
        if (payload.requestId !== params.requestId) {
          return null;
        }
        if (!params.selectPayload) {
          return payload as TResult;
        }
        return params.selectPayload(payload);
      },
    });
  }

  private sendCorrelatedSessionRequest<
    TResponseType extends CorrelatedResponseType,
    TResult = CorrelatedResponsePayload<TResponseType>,
  >(params: {
    requestId?: string;
    message: { type: SessionInboundMessage["type"] } & Record<string, unknown>;
    responseType: TResponseType;
    timeout?: number;
    selectPayload?: (payload: CorrelatedResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    const resolvedRequestId = this.createRequestId(params.requestId);
    const message = SessionInboundMessageSchema.parse({
      ...params.message,
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: params.responseType,
      timeout: params.timeout,
      options: { skipQueue: true },
      ...(params.selectPayload ? { selectPayload: params.selectPayload } : {}),
    });
  }

  private sendNamespacedCorrelatedSessionRequest<
    TResponseType extends CorrelatedResponseType,
    TResult = CorrelatedResponsePayload<TResponseType>,
  >(params: {
    requestId?: string;
    message: { type: Extract<SessionInboundMessage["type"], `${string}.request`> } & Record<
      string,
      unknown
    >;
    timeout?: number;
    selectPayload?: (payload: CorrelatedResponsePayload<TResponseType>) => TResult | null;
  }): Promise<TResult> {
    const responseType = params.message.type.replace(/\.request$/, ".response") as TResponseType;
    return this.sendCorrelatedSessionRequest({
      ...params,
      responseType,
    });
  }

  private sendSessionMessageStrict(message: SessionInboundMessage): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      throw new Error("Transport not connected");
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.sendJsonMessage("session", payload.type, { type: "session", message: payload });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async clearAgentAttention(agentId: string | string[]): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "clear_agent_attention",
      agentId,
      requestId,
    });
    await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "clear_agent_attention_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async clearWorkspaceAttention(workspaceId: string | string[]): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "workspace.clear_attention.request",
      workspaceId,
      requestId,
    });
    const response = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "workspace.clear_attention.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!response.success) {
      throw new Error(response.error ?? "Failed to clear workspace attention");
    }
  }

  sendHeartbeat(params: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId?: string | null;
    lastActivityAt: string;
    appVisible: boolean;
    appVisibilityChangedAt?: string;
  }): void {
    this.sendSessionMessage({
      type: "client_heartbeat",
      deviceType: params.deviceType,
      focusedAgentId: params.focusedAgentId,
      focusedTerminalId: params.focusedTerminalId ?? null,
      lastActivityAt: params.lastActivityAt,
      appVisible: params.appVisible,
      appVisibilityChangedAt: params.appVisibilityChangedAt,
    });
  }

  registerPushToken(token: string): void {
    this.sendSessionMessage({
      type: "register_push_token",
      token,
    });
  }

  async unregisterPushToken(token: string): Promise<void> {
    const requestId = this.createRequestId();
    await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "push.unregister.request", token, requestId },
      responseType: "push.unregister.response",
      timeout: PUSH_TOKEN_REVOCATION_TIMEOUT_MS,
    });
  }

  async ping(params?: { requestId?: string; timeoutMs?: number }): Promise<{
    requestId: string;
    clientSentAt: number;
    serverReceivedAt: number;
    serverSentAt: number;
    rttMs: number;
  }> {
    const requestId =
      params?.requestId ?? `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientSentAt = Date.now();

    const payload = await this.sendRequest({
      requestId,
      message: { type: "ping", requestId, clientSentAt },
      timeout: params?.timeoutMs ?? 5000,
      select: (msg) => {
        if (msg.type !== "pong") return null;
        if (msg.payload.requestId !== requestId) return null;
        if (typeof msg.payload.serverReceivedAt !== "number") return null;
        if (typeof msg.payload.serverSentAt !== "number") return null;
        return msg.payload;
      },
    });

    return {
      requestId,
      clientSentAt,
      serverReceivedAt: payload.serverReceivedAt,
      serverSentAt: payload.serverSentAt,
      rttMs: Date.now() - clientSentAt,
    };
  }

  measureLatency(params?: { timeoutMs?: number }): Promise<number> {
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    return this.sendPingAwaitRtt({ timeoutMs, drivesLivenessFailure: false }).catch((error) => {
      throw toTimeoutError(error, "Latency measurement", timeoutMs);
    });
  }

  private async livenessPing(params?: { timeoutMs?: number }): Promise<number> {
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    try {
      const rttMs = await this.sendPingAwaitRtt({ timeoutMs, drivesLivenessFailure: true });
      this.lastLivenessRttMs = rttMs;
      return rttMs;
    } catch (error) {
      throw toTimeoutError(error, "Liveness check", timeoutMs);
    }
  }

  private sendPingAwaitRtt(params: {
    timeoutMs: number;
    drivesLivenessFailure: boolean;
  }): Promise<number> {
    if (this.connectionState.status !== "connected" || !this.transport) {
      return Promise.reject(
        new Error(`Transport not connected (status: ${this.connectionState.status})`),
      );
    }

    if (this.pingProbe) {
      return this.pingProbe.promise;
    }

    const startedAt = perfNow();
    const timeoutMs = params.timeoutMs;
    let resolveProbe: ((value: number) => void) | null = null;
    let rejectProbe: ((error: Error) => void) | null = null;
    const promise = new Promise<number>((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const probe: PingProbe = {
      promise,
      resolve: (value) => resolveProbe?.(value),
      reject: (error) => rejectProbe?.(error),
      timeoutHandle: setTimeout(() => {
        if (this.pingProbe !== probe) {
          return;
        }
        this.pingProbe = null;
        const error = new PingTimeoutError(timeoutMs);
        probe.reject(error);
        if (probe.drivesLivenessFailure) {
          this.recordLivenessFailure(toTimeoutError(error, "Liveness check", timeoutMs));
        }
      }, timeoutMs),
      startedAt,
      drivesLivenessFailure: params.drivesLivenessFailure,
    };
    this.pingProbe = probe;

    try {
      this.sendJsonMessage("ping", "ping", { type: "ping" });
    } catch (error) {
      this.clearPingProbe();
      const sendError = error instanceof Error ? error : new Error(String(error));
      if (probe.drivesLivenessFailure) {
        this.recordLivenessFailure(sendError);
      }
      return Promise.reject(sendError);
    }

    return promise;
  }

  private startLivenessHeartbeat(): void {
    this.stopLivenessHeartbeat();
    this.lastLivenessRttMs = null;
    this.scheduleNextLivenessHeartbeat();
  }

  private stopLivenessHeartbeat(): void {
    if (!this.livenessHeartbeatTimer) {
      return;
    }
    clearTimeout(this.livenessHeartbeatTimer);
    this.livenessHeartbeatTimer = null;
  }

  private scheduleNextLivenessHeartbeat(): void {
    if (this.connectionState.status !== "connected" || this.livenessHeartbeatTimer) {
      return;
    }
    this.livenessHeartbeatTimer = setTimeout(() => {
      this.livenessHeartbeatTimer = null;
      this.livenessPing({ timeoutMs: LIVENESS_HEARTBEAT_TIMEOUT_MS })
        .catch(() => {})
        .finally(() => {
          this.scheduleNextLivenessHeartbeat();
        });
    }, LIVENESS_HEARTBEAT_INTERVAL_MS);
  }

  // ============================================================================
  // Agent RPCs (requestId-correlated)
  // ============================================================================

  async fetchAgents(options?: FetchAgentsOptions): Promise<FetchAgentsPayload> {
    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agents_request",
      requestId: resolvedRequestId,
      ...(options?.scope ? { scope: options.scope } : {}),
      ...(options?.filter ? { filter: options.filter } : {}),
      ...(options?.sort ? { sort: options.sort } : {}),
      ...(options?.page ? { page: options.page } : {}),
      ...(options?.subscribe ? { subscribe: options.subscribe } : {}),
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: options?.timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_agents_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async fetchAgentHistory(options?: FetchAgentHistoryOptions): Promise<FetchAgentHistoryPayload> {
    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_history_request",
      requestId: resolvedRequestId,
      ...(options?.filter ? { filter: options.filter } : {}),
      ...(options?.search ? { search: options.search } : {}),
      ...(options?.sort ? { sort: options.sort } : {}),
      ...(options?.page ? { page: options.page } : {}),
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_agent_history_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async getHistoryStorageStats(
    requestId?: string,
  ): Promise<HistoryAgentsStorageStatsResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"history.agents.get_storage_stats.response">(
      {
        requestId,
        message: { type: "history.agents.get_storage_stats.request" },
      },
    );
  }

  async fetchRecentProviderSessions(
    options?: FetchRecentProviderSessionsOptions,
  ): Promise<FetchRecentProviderSessionsPayload> {
    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_recent_provider_sessions_request",
      requestId: resolvedRequestId,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.providers ? { providers: options.providers } : {}),
      ...(options?.since ? { since: options.since } : {}),
      ...(options?.limit ? { limit: options.limit } : {}),
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_recent_provider_sessions_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async fetchWorkspaces(options?: FetchWorkspacesOptions): Promise<FetchWorkspacesPayload> {
    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_workspaces_request",
      requestId: resolvedRequestId,
      ...(options?.filter ? { filter: options.filter } : {}),
      ...(options?.sort ? { sort: options.sort } : {}),
      ...(options?.page ? { page: options.page } : {}),
      ...(options?.subscribe ? { subscribe: options.subscribe } : {}),
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_workspaces_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async openProject(cwd: string, requestId?: string): Promise<OpenProjectPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "open_project_request",
        cwd,
      },
      responseType: "open_project_response",
    });
  }

  async addProject(cwd: string, requestId?: string): Promise<ProjectAddPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "project.add.request",
        cwd,
      },
      responseType: "project.add.response",
    });
  }

  async resolveWorkspaceForPath(
    path: string,
    requestId?: string,
  ): Promise<ProjectResolveWorkspaceForPathResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "project.resolveWorkspaceForPath.request",
        path,
      },
      responseType: "project.resolveWorkspaceForPath.response",
    });
  }

  // Creates a project directory from scratch and registers it. Requires
  // server_info features.projectScaffold. `onProgress` is optional: the
  // resolved payload carries the authoritative step list either way.
  async scaffoldProject(
    options: {
      parentDirectory: string;
      folderName?: string;
      git: ProjectScaffoldGit;
      onProgress?: (payload: ProjectScaffoldProgress["payload"]) => void;
    },
    requestId?: string,
  ): Promise<ProjectScaffoldPayload> {
    // Resolved here rather than inside sendCorrelatedSessionRequest so the
    // progress listener is registered under the same id before the send.
    const resolvedRequestId = this.createRequestId(requestId);
    if (options.onProgress) {
      this.scaffoldProgressListeners.set(resolvedRequestId, options.onProgress);
    }
    try {
      return await this.sendCorrelatedSessionRequest({
        requestId: resolvedRequestId,
        message: {
          type: "project.scaffold.request",
          parentDirectory: options.parentDirectory,
          folderName: options.folderName,
          git: options.git,
        },
        responseType: "project.scaffold.response",
      });
    } finally {
      this.scaffoldProgressListeners.delete(resolvedRequestId);
    }
  }

  async listHostingRepositories(
    options: { provider: GitHostingProviderId; query?: string; limit?: number },
    requestId?: string,
  ): Promise<HostingListRepositoriesPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "hosting.list_repositories.request",
        provider: options.provider,
        query: options.query,
        limit: options.limit,
      },
      responseType: "hosting.list_repositories.response",
    });
  }

  async listHostingOwners(
    options: { provider: GitHostingProviderId },
    requestId?: string,
  ): Promise<HostingListOwnersPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "hosting.list_owners.request",
        provider: options.provider,
      },
      responseType: "hosting.list_owners.response",
    });
  }

  async startWorkspaceScript(
    workspaceId: string,
    scriptName: string,
    requestId?: string,
  ): Promise<
    Extract<SessionOutboundMessage, { type: "start_workspace_script_response" }>["payload"]
  > {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "start_workspace_script_request",
        workspaceId,
        scriptName,
      },
      responseType: "start_workspace_script_response",
    });
  }

  async archiveWorkspace(
    workspaceId: string,
    options?: { branchDisposition?: "keep" | "delete"; requestId?: string },
  ): Promise<ArchiveWorkspacePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "archive_workspace_request",
        workspaceId,
        ...(options?.branchDisposition ? { branchDisposition: options.branchDisposition } : {}),
      },
      responseType: "archive_workspace_response",
    });
  }

  // Read-only pre-archive inspection of a worktree's leftover branch (merge
  // state, deletability). Gated by server_info.features.worktreeArchiveBranchCleanup.
  async workspaceArchivePreflight(
    workspaceId: string,
    requestId?: string,
  ): Promise<WorkspaceArchivePreflightPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "workspace.archive.preflight.request",
        workspaceId,
      },
      responseType: "workspace.archive.preflight.response",
    });
  }

  // Repoint a workspace's base branch (what Changes diffs against, and what
  // merge-into-base / PR creation target). Pass null to reset to the repository
  // default, or `redetect` to forget the stored base and detect the branch's parent
  // again. An `origin/` prefix is preserved: `main` and `origin/main` are different
  // comparisons whenever local and origin have drifted.
  // Gated by server_info.features.worktreeDiffBase; repointing a plain (non-worktree)
  // checkout additionally needs server_info.features.checkoutDiffBaseAnyRepo.
  async setWorktreeBaseRef(
    workspaceId: string,
    baseRef: string | null,
    options?: { redetect?: boolean },
    requestId?: string,
  ): Promise<WorktreeBaseRefSetPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "worktree.baseRef.set.request",
        workspaceId,
        baseRef,
        ...(options?.redetect ? { redetect: true } : {}),
      },
      responseType: "worktree.baseRef.set.response",
    });
  }

  // List re-attachable Otto worktrees for a project (or the repo containing cwd):
  // archived worktree workspaces with a kept branch, plus orphaned on-disk
  // worktrees. Gated by server_info.features.worktreeReattach.
  async listReattachableWorktrees(
    scope: { projectId?: string; cwd?: string },
    requestId?: string,
  ): Promise<WorktreeReattachListPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "worktree.reattach.list.request",
        ...(scope.projectId ? { projectId: scope.projectId } : {}),
        ...(scope.cwd ? { cwd: scope.cwd } : {}),
      },
      responseType: "worktree.reattach.list.response",
    });
  }

  // Re-attach a "left" worktree as a live workspace: revive an archived workspace
  // record in place, or bind a fresh workspace to an orphaned on-disk worktree.
  async reattachWorktree(
    target: WorktreeReattachTarget,
    requestId?: string,
  ): Promise<WorktreeReattachPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "worktree.reattach.request",
        target,
      },
      responseType: "worktree.reattach.response",
    });
  }

  async fetchWorkspaceSetupStatus(
    workspaceId: string,
    requestId?: string,
  ): Promise<WorkspaceSetupStatusPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "workspace_setup_status_request",
        workspaceId,
      },
      responseType: "workspace_setup_status_response",
    });
  }

  async fetchAgent(options: FetchAgentOptions): Promise<FetchAgentResult | null>;
  async fetchAgent(agentId: string, requestId?: string): Promise<FetchAgentResult | null>;
  async fetchAgent(
    agentId: string,
    options?: LegacyFetchAgentOptions,
  ): Promise<FetchAgentResult | null>;
  async fetchAgent(
    input: FetchAgentOptions | string,
    legacyOptions?: LegacyFetchAgentOptions | string,
  ): Promise<FetchAgentResult | null> {
    const options = normalizeFetchAgentOptions(input, legacyOptions);
    const resolvedRequestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_request",
      requestId: resolvedRequestId,
      agentId: options.agentId,
    });
    const payload = await this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_agent_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.agent) {
      return null;
    }
    return { agent: payload.agent, project: payload.project ?? null };
  }

  private resubscribeCheckoutDiffSubscriptions(): void {
    if (this.checkoutDiffSubscriptions.size === 0) {
      return;
    }
    for (const [subscriptionId, subscription] of this.checkoutDiffSubscriptions) {
      const message = SessionInboundMessageSchema.parse({
        type: "subscribe_checkout_diff_request",
        subscriptionId,
        cwd: subscription.cwd,
        compare: subscription.compare,
        requestId: this.createRequestId(),
      });
      this.sendSessionMessage(message);
    }
  }

  private resubscribeTerminalDirectorySubscriptions(): void {
    if (this.terminalDirectorySubscriptions.size === 0) {
      return;
    }
    for (const subscription of this.terminalDirectorySubscriptions.values()) {
      this.sendSessionMessage({
        type: "subscribe_terminals_request",
        cwd: subscription.cwd,
        ...(subscription.workspaceId !== undefined
          ? { workspaceId: subscription.workspaceId }
          : {}),
      });
    }
  }

  // A reconnect starts a fresh daemon session with no watch subscriptions, but
  // the UI components watching those files never unmount, so watchFile is never
  // re-called. Re-issue subscribe for every still-referenced file so live
  // updates resume after a drop.
  private resubscribeFileWatches(): void {
    if (this.fileWatchRefCounts.size === 0) {
      return;
    }
    for (const entry of this.fileWatchRefCounts.values()) {
      if (entry.count <= 0) {
        continue;
      }
      this.sendSessionMessage({
        type: "file.watch.subscribe.request",
        cwd: entry.cwd,
        path: entry.path,
        requestId: this.createRequestId(),
      });
    }
  }

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  async createAgent(options: CreateAgentRequestOptions): Promise<AgentSnapshotPayload> {
    const requestId = this.createRequestId(options.requestId);
    const config = resolveAgentConfig(options);

    const message = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId,
      config,
      ...(options.personality ? { personality: options.personality } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
      ...(options.callerAgentId !== undefined ? { callerAgentId: options.callerAgentId } : {}),
      ...(options.initialPrompt ? { initialPrompt: options.initialPrompt } : {}),
      ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
      ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
      ...(options.attachments && options.attachments.length > 0
        ? { attachments: options.attachments }
        : {}),
      ...(options.git ? { git: options.git } : {}),
      ...(options.worktree ? { worktree: options.worktree } : {}),
      ...(options.autoArchive !== undefined ? { autoArchive: options.autoArchive } : {}),
      ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
      ...(options.labels && Object.keys(options.labels).length > 0
        ? { labels: options.labels }
        : {}),
    });

    const status = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const created = AgentCreatedStatusPayloadSchema.safeParse(msg.payload);
        if (created.success && created.data.requestId === requestId) {
          return created.data;
        }
        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(msg.payload);
        if (failed.success && failed.data.requestId === requestId) {
          return failed.data;
        }
        return null;
      },
    });
    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }

    return status.agent;
  }

  async deleteAgent(agentId: string): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "delete_agent_request",
      agentId,
      requestId,
    });
    await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent_deleted") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  /**
   * Bulk-delete archived chat records on this host. Server-side by necessity:
   * the client's history list is cursor-paginated across hosts and never holds
   * the whole archived set. Pass `dryRun: true` first to get the count the
   * confirm dialog quotes, then the same call with `dryRun: false` to delete.
   *
   * Removes Otto's records only - provider transcripts are left on disk. Gated
   * by `server_info.features.historyDelete`; there is no fallback path, so check
   * the flag before offering the action.
   */
  async clearArchivedAgents(options: {
    dryRun: boolean;
    olderThanDays?: number;
    requestId?: string;
  }): Promise<HistoryAgentsClearArchivedResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"history.agents.clear_archived.response">({
      requestId: options.requestId,
      message: {
        type: "history.agents.clear_archived.request",
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays ?? 0,
      },
    });
  }

  /**
   * How much disk the images agents produced occupy on this host, plus the
   * retention policy currently ageing them out. Gated by
   * `server_info.features.attachmentStorage`.
   */
  async getAttachmentImageStats(
    requestId?: string,
  ): Promise<AttachmentsImagesStatsResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"attachments.images.get_stats.response">({
      requestId,
      message: { type: "attachments.images.get_stats.request" },
    });
  }

  /**
   * Reclaims the materialized image store. Call once with `dryRun: true` for
   * the count and size the confirm dialog quotes, then again with
   * `dryRun: false` to delete.
   *
   * Cleared images do not come back: a message that referenced one renders its
   * alt text from then on. Scope is the whole host - filenames are a content
   * hash, so per-chat or per-workspace scope does not exist. Gated by
   * `server_info.features.attachmentStorage`.
   */
  async clearAttachmentImages(options: {
    dryRun: boolean;
    olderThanDays?: number;
    requestId?: string;
  }): Promise<AttachmentsImagesClearResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"attachments.images.clear.response">({
      requestId: options.requestId,
      message: {
        type: "attachments.images.clear.request",
        dryRun: options.dryRun,
        olderThanDays: options.olderThanDays ?? 0,
      },
    });
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "archive_agent_request",
      agentId,
      requestId,
    });
    const result = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent_archived") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    return { archivedAt: result.archivedAt };
  }

  async detachAgent(agentId: string): Promise<void> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"agent.detach.response">({
      message: {
        type: "agent.detach.request",
        agentId,
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "detachAgent rejected");
    }
  }

  /**
   * Stop a running observed subagent (Claude Task / ultracode fan-out). The
   * daemon resolves the observed subagent to its owning provider task and calls
   * the provider's stopTask. See projects/observed-subagents/observed-subagents.md.
   */
  async stopObservedSubagent(agentId: string): Promise<void> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"agent.subagent.stop.response">({
        message: {
          type: "agent.subagent.stop.request",
          agentId,
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "stopObservedSubagent rejected");
    }
  }

  /**
   * Stop a running background shell task (Claude Bash tool run_in_background).
   * Not an AI subagent - the daemon resolves it to its owning provider task and
   * calls the provider's stopTask, same mechanism as stopObservedSubagent.
   */
  async stopBackgroundShellTask(parentAgentId: string, taskId: string): Promise<void> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"agent.background_task.stop.response">({
        message: {
          type: "agent.background_task.stop.request",
          parentAgentId,
          taskId,
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "stopBackgroundShellTask rejected");
    }
  }

  /**
   * Clear one or more terminal background shell tasks from the Background
   * Tasks track. Still-live tasks are stopped best-effort first.
   */
  async clearBackgroundShellTasks(
    parentAgentId: string,
    taskIds: readonly string[],
  ): Promise<void> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"agent.background_task.clear.response">({
        message: {
          type: "agent.background_task.clear.request",
          parentAgentId,
          taskIds: [...taskIds],
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "clearBackgroundShellTasks rejected");
    }
  }

  /**
   * Start one or more suggested tasks (from `spawn_task` chips), applying the
   * same mode to each - a new worktree workspace per task, a new local session
   * per task, or steering the parent's current session. Individual actions pass
   * a single-element array; the "Start all" collective action passes the whole
   * pending queue. Resolves to the count started; throws only if all failed.
   */
  async startSuggestedTasks(
    parentAgentId: string,
    taskIds: readonly string[],
    mode: TasksSuggestedStartMode,
  ): Promise<{ succeeded: number; failed: number }> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"tasks.suggested.start.response">({
        message: {
          type: "tasks.suggested.start.request",
          parentAgentId,
          taskIds: [...taskIds],
          mode,
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "startSuggestedTasks rejected");
    }
    return { succeeded: payload.succeeded, failed: payload.failed };
  }

  /** Dismiss one or more suggested-task chips the user has not acted on. */
  async dismissSuggestedTasks(parentAgentId: string, taskIds: readonly string[]): Promise<void> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"tasks.suggested.dismiss.response">({
        message: {
          type: "tasks.suggested.dismiss.request",
          parentAgentId,
          taskIds: [...taskIds],
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "dismissSuggestedTasks rejected");
    }
  }

  /** Orchestration: fetch the current snapshot of all runs on this host. */
  async getRunsSnapshot(): Promise<Run[]> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.get_snapshot.response">(
      {
        message: { type: "runs.get_snapshot.request" },
      },
    );
    return payload.runs;
  }

  /** Orchestration: approve or reject a run's attended gate. */
  async respondToRunGate(input: {
    runId: string;
    phaseId: string;
    approved: boolean;
    note?: string;
  }): Promise<boolean> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.gate_respond.response">(
      {
        message: {
          type: "runs.gate_respond.request",
          runId: input.runId,
          phaseId: input.phaseId,
          approved: input.approved,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      },
    );
    return payload.accepted;
  }

  /** Orchestration: cancel a run. */
  async cancelRun(runId: string): Promise<boolean> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.cancel.response">({
      message: { type: "runs.cancel.request", runId },
    });
    return payload.canceled;
  }

  /** Orchestration: delete every finished (done/failed/canceled) run. */
  async clearFinishedRuns(): Promise<string[]> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.clear.response">({
      message: { type: "runs.clear.request" },
    });
    return payload.runIds;
  }

  /**
   * Orchestration: delete one finished (or draft) run. Throws with the
   * daemon's reason when it refuses - an active run has to be canceled first.
   */
  async deleteRun(runId: string): Promise<string> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.delete.response">({
      message: { type: "runs.delete.request", runId },
    });
    if (!payload.runId) {
      throw new Error(payload.error ?? "Failed to delete the orchestration");
    }
    return payload.runId;
  }

  /** Orchestration: list the host's reusable graph templates. */
  async listOrchestrationGraphs(): Promise<OrchestrationGraph[]> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.graphs.list.response">({
      message: { type: "runs.graphs.list.request" },
    });
    return payload.graphs;
  }

  /** Orchestration: upsert a graph template. Returns the persisted graph. */
  async saveOrchestrationGraph(graph: OrchestrationGraph): Promise<OrchestrationGraph> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.graphs.save.response">({
      message: { type: "runs.graphs.save.request", graph },
    });
    if (payload.error !== undefined || payload.graph === undefined) {
      throw new Error(payload.error ?? "saveOrchestrationGraph rejected");
    }
    return payload.graph;
  }

  /** Orchestration: delete a graph template (built-in starters refuse). */
  async deleteOrchestrationGraph(graphId: string): Promise<boolean> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"runs.graphs.delete.response">({
        message: { type: "runs.graphs.delete.request", graphId },
      });
    if (payload.error !== undefined) {
      throw new Error(payload.error);
    }
    return payload.deleted;
  }

  /** Orchestration: list the host's reusable prompt templates and snippets. */
  async listPromptTemplates(): Promise<PromptTemplate[]> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"runs.templates.list.response">({
        message: { type: "runs.templates.list.request" },
      });
    return payload.templates;
  }

  /** Orchestration: upsert a prompt template. Returns the persisted template. */
  async savePromptTemplate(template: PromptTemplate): Promise<PromptTemplate> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"runs.templates.save.response">({
        message: { type: "runs.templates.save.request", template },
      });
    if (payload.error !== undefined || payload.template === undefined) {
      throw new Error(payload.error ?? "savePromptTemplate rejected");
    }
    return payload.template;
  }

  /** Orchestration: delete a prompt template (built-in starters refuse). */
  async deletePromptTemplate(templateId: string): Promise<boolean> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"runs.templates.delete.response">({
        message: { type: "runs.templates.delete.request", templateId },
      });
    if (payload.error !== undefined) {
      throw new Error(payload.error);
    }
    return payload.deleted;
  }

  /**
   * Orchestration: start (or draft) a user-initiated orchestration. Returns the
   * run id (graph flavor) and the orchestrator chat's agent id to navigate to.
   */
  async startOrchestration(input: {
    flavor: "ai" | "graph";
    cwd: string;
    workspaceId?: string;
    title?: string;
    description?: string;
    orchestratorPersonalityId?: string;
    orchestratorProvider?: string;
    orchestratorModel?: string;
    orchestratorThinkingOptionId?: string;
    prompt?: string;
    graphId?: string;
    graphInputs?: Record<string, string>;
    draft?: boolean;
    runId?: string;
  }): Promise<{ runId?: string; agentId?: string; workspaceId?: string }> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"runs.start.response">({
      message: {
        type: "runs.start.request",
        flavor: input.flavor,
        cwd: input.cwd,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.orchestratorPersonalityId !== undefined
          ? { orchestratorPersonalityId: input.orchestratorPersonalityId }
          : {}),
        ...(input.orchestratorProvider !== undefined
          ? { orchestratorProvider: input.orchestratorProvider }
          : {}),
        ...(input.orchestratorModel !== undefined
          ? { orchestratorModel: input.orchestratorModel }
          : {}),
        ...(input.orchestratorThinkingOptionId !== undefined
          ? { orchestratorThinkingOptionId: input.orchestratorThinkingOptionId }
          : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.graphId !== undefined ? { graphId: input.graphId } : {}),
        ...(input.graphInputs !== undefined ? { graphInputs: input.graphInputs } : {}),
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
      },
    });
    if (payload.error !== undefined) {
      throw new Error(payload.error);
    }
    return {
      ...(payload.runId !== undefined ? { runId: payload.runId } : {}),
      ...(payload.agentId !== undefined ? { agentId: payload.agentId } : {}),
      ...(payload.workspaceId !== undefined ? { workspaceId: payload.workspaceId } : {}),
    };
  }

  async updateAgent(
    agentId: string,
    updates: { name?: string; labels?: Record<string, string> },
  ): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "update_agent_request",
      agentId,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.labels && Object.keys(updates.labels).length > 0
        ? { labels: updates.labels }
        : {}),
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "update_agent_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "updateAgent rejected");
    }
  }

  async renameProject(
    projectId: string,
    customName: string | null,
    requestId?: string,
  ): Promise<{ customName: string | null }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "project.rename.request",
        projectId,
        customName,
      },
      responseType: "project.rename.response",
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "renameProject rejected");
    }
    return { customName: payload.customName };
  }

  /**
   * Sets (or with a null target, clears) which tracking board a project shows
   * on the Kanban screen. The daemon normalizes what it stores - a pasted board
   * URL comes back as the parsed id - so the caller should render the returned
   * target rather than its own draft.
   */
  async setKanbanProjectTarget(
    input: { projectId: string; target: ProjectKanbanTarget | null },
    requestId?: string,
  ): Promise<{ target: ProjectKanbanTarget | null }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "kanban.project.target.set.request",
        projectId: input.projectId,
        target: input.target,
      },
      responseType: "kanban.project.target.set.response",
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setKanbanProjectTarget rejected");
    }
    return { target: payload.target };
  }

  async setProjectIcon(
    projectId: string,
    source: ProjectIconSource,
    requestId?: string,
  ): Promise<void> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"project.icon.set.response">({
      requestId,
      message: { type: "project.icon.set.request", projectId, source },
    });
    if (!payload.accepted) throw new Error(payload.error ?? "setProjectIcon rejected");
  }

  async removeProject(
    projectId: string,
    requestId?: string,
  ): Promise<{ removedWorkspaceIds: string[] }> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"project.remove.response">({
      requestId,
      message: {
        type: "project.remove.request",
        projectId,
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "removeProject rejected");
    }
    return { removedWorkspaceIds: payload.removedWorkspaceIds };
  }

  async setWorkspaceTitle(
    workspaceId: string,
    title: string | null,
    requestId?: string,
  ): Promise<{ title: string | null }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "workspace.title.set.request",
        workspaceId,
        title,
      },
      responseType: "workspace.title.set.response",
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setWorkspaceTitle rejected");
    }
    return { title: payload.title };
  }

  /**
   * Moves a chat to another workspace over the same directory. Throws with the
   * daemon's reason when refused; the same-directory rule is enforced there, not
   * here, so the caller gets one explanation rather than two.
   */
  async transferAgentWorkspace(
    agentId: string,
    workspaceId: string,
    requestId?: string,
  ): Promise<{ workspaceId: string }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "agent.workspace.transfer.request",
        agentId,
        workspaceId,
      },
      responseType: "agent.workspace.transfer.response",
    });
    if (!payload.accepted || !payload.workspaceId) {
      throw new Error(payload.error ?? "Failed to move chat");
    }
    return { workspaceId: payload.workspaceId };
  }

  async listProjectLinks(requestId?: string): Promise<ProjectLink[]> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"project.links.list.response">({
        requestId,
        message: { type: "project.links.list.request" },
      });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.links;
  }

  async linkProjects(
    projectId: string,
    otherProjectId: string,
    requestId?: string,
  ): Promise<ProjectLink[]> {
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"project.links.set.response">(
      {
        requestId,
        message: { type: "project.links.set.request", projectId, otherProjectId },
      },
    );
    if (!payload.accepted) {
      throw new Error(payload.error ?? "linkProjects rejected");
    }
    return payload.links;
  }

  async unlinkProjects(
    projectId: string,
    otherProjectId: string,
    requestId?: string,
  ): Promise<ProjectLink[]> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"project.links.unset.response">({
        requestId,
        message: { type: "project.links.unset.request", projectId, otherProjectId },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "unlinkProjects rejected");
    }
    return payload.links;
  }

  async resumeAgent(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSnapshotPayload> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "resume_agent_request",
      requestId,
      handle,
      ...(overrides ? { overrides } : {}),
    });

    const status = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(msg.payload);
        if (resumed.success && resumed.data.requestId === requestId) {
          return resumed.data;
        }
        return null;
      },
    });

    return status.agent;
  }

  async importAgent(input: ImportAgentInput): Promise<AgentSnapshotPayload> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "import_agent_request",
      requestId,
      ...("providerId" in input
        ? { providerId: input.providerId, providerHandleId: input.providerHandleId }
        : { provider: input.provider, sessionId: input.sessionId }),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.labels && Object.keys(input.labels).length > 0 ? { labels: input.labels } : {}),
    });

    const status = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(msg.payload);
        if (resumed.success && resumed.data.requestId === requestId) {
          return resumed.data;
        }

        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(msg.payload);
        if (failed.success && failed.data.requestId === requestId) {
          return failed.data;
        }

        return null;
      },
    });

    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }

    return status.agent;
  }

  async refreshAgent(agentId: string, requestId?: string): Promise<AgentRefreshedStatusPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "refresh_agent_request",
      agentId,
      requestId: resolvedRequestId,
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const refreshed = AgentRefreshedStatusPayloadSchema.safeParse(msg.payload);
        if (refreshed.success && refreshed.data.requestId === resolvedRequestId) {
          return refreshed.data;
        }
        return null;
      },
    });
  }

  async listProviderSubagents(
    parentAgentId: string,
    options: { requestId?: string; timeout?: number } = {},
  ): Promise<ProviderSubagentListPayload> {
    const requestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "agent.provider_subagents.list.request",
      parentAgentId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (response) =>
        response.type === "agent.provider_subagents.list.response" &&
        response.payload.requestId === requestId
          ? response.payload
          : null,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  async fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options: FetchProviderSubagentTimelineOptions = {},
  ): Promise<ProviderSubagentTimelinePayload> {
    const requestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "agent.provider_subagents.timeline.get.request",
      parentAgentId,
      subagentId,
      requestId,
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (response) =>
        response.type === "agent.provider_subagents.timeline.get.response" &&
        response.payload.requestId === requestId
          ? response.payload
          : null,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  async checkoutForgeGetCheckDetails(
    input: {
      cwd: string;
      repoOwner?: string;
      repoName?: string;
      checkRunId?: number;
      workflowRunId?: number;
      changeRequestNumber?: number;
    },
    requestId?: string,
  ): Promise<CheckoutForgeGetCheckDetailsPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.forge.get_check_details.response">(
      {
        requestId,
        message: {
          type: "checkout.forge.get_check_details.request",
          cwd: input.cwd,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          checkRunId: input.checkRunId,
          workflowRunId: input.workflowRunId,
          changeRequestNumber: input.changeRequestNumber,
        },
        timeout: 60000,
      },
    );
  }

  async checkoutForgeSetAutoMerge(
    cwd: string,
    input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
    requestId?: string,
  ): Promise<CheckoutForgeSetAutoMergePayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.forge.set_auto_merge.response">({
      requestId,
      message: {
        type: "checkout.forge.set_auto_merge.request",
        cwd,
        enabled: input.enabled,
        ...(input.enabled ? { mergeMethod: input.method } : {}),
      },
      timeout: 60000,
    });
  }

  async createProjectDirectory(
    input: { parentPath: string; name: string },
    requestId?: string,
  ): Promise<ProjectCreateDirectoryPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"project.create_directory.response">({
      requestId,
      message: {
        type: "project.create_directory.request",
        parentPath: input.parentPath,
        name: input.name,
      },
    });
  }

  /**
   * The provider-agnostic Kanban board surface. Each call names its provider
   * ("memory", "github", ...) - the daemon dispatches to the registered
   * KanbanProvider implementation and the wire never carries provider-native
   * identifiers beyond the opaque board/card/column ids.
   *
   * A project-scoped request is authoritative: the daemon resolves the
   * project's configured board target and overrides providerId from it. The
   * wire still carries providerId so older clients keep working; pass an inert
   * value (e.g. "github") when a project is supplied.
   */
  async kanbanListBoards(
    input: { providerId: string; projectId?: string; projectKey?: string },
    requestId?: string,
  ): Promise<KanbanBoardsListResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"kanban.boards.list.response">({
      requestId,
      message: {
        type: "kanban.boards.list.request",
        providerId: input.providerId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectKey ? { projectKey: input.projectKey } : {}),
        requestId: "",
      },
      timeout: 60000,
    });
  }

  async kanbanGetBoard(
    providerId: string,
    boardId: string,
    requestId?: string,
  ): Promise<KanbanBoardGetResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"kanban.board.get.response">({
      requestId,
      message: { type: "kanban.board.get.request", providerId, boardId, requestId: "" },
      timeout: 60000,
    });
  }

  async kanbanMoveCard(
    input: { providerId: string; boardId: string; cardId: string; targetColumnId: string },
    requestId?: string,
  ): Promise<KanbanCardMoveResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"kanban.card.move.response">({
      requestId,
      message: { ...input, type: "kanban.card.move.request", requestId: "" },
      timeout: 60000,
    });
  }

  async kanbanCreateCard(
    input: {
      providerId: string;
      boardId: string;
      columnId?: string;
      title: string;
      body?: string;
    },
    requestId?: string,
  ): Promise<KanbanCardCreateResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"kanban.card.create.response">({
      requestId,
      message: { ...input, type: "kanban.card.create.request", requestId: "" },
      timeout: 60000,
    });
  }

  async kanbanLinkTask(
    input: { providerId: string; boardId: string; externalId: string; columnId?: string },
    requestId?: string,
  ): Promise<KanbanTaskLinkResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"kanban.task.link.response">({
      requestId,
      message: { ...input, type: "kanban.task.link.request", requestId: "" },
      timeout: 60000,
    });
  }

  async getCommitFileDiff(
    cwd: string,
    sha: string,
    path: string,
    requestId?: string,
  ): Promise<{ file: ParsedDiffFile | null }> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"checkout.commits.file_diff.response">({
        requestId,
        message: {
          type: "checkout.commits.file_diff.request",
          cwd,
          sha,
          path,
        },
        timeout: 60000,
      });
    if (payload.error) {
      throw new Error(payload.error.message);
    }
    return { file: payload.file };
  }

  async inspectWorkspaceRecovery(
    workspaceId: string,
    requestId?: string,
  ): Promise<WorkspaceRecoveryState> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"workspace.recovery.inspect.response">({
        requestId,
        message: {
          type: "workspace.recovery.inspect.request",
          workspaceId,
        },
      });
    return payload.state;
  }

  async listCheckoutCommits(
    cwd: string,
    requestId?: string,
  ): Promise<{ baseRef: string | null; commits: CheckoutCommit[] }> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"checkout.commits.list.response">({
        requestId,
        message: {
          type: "checkout.commits.list.request",
          cwd,
        },
        timeout: 60000,
      });
    if (payload.error) {
      throw new Error(payload.error.message);
    }
    return { baseRef: payload.baseRef, commits: payload.commits };
  }

  async listProjects(requestId?: string): Promise<ProjectListPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "project.list.request",
      requestId: resolvedRequestId,
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "project.list.response") return null;
        if (msg.payload.requestId !== resolvedRequestId) return null;
        return msg.payload;
      },
    });
  }

  onAgentAttentionRequired(
    handler: (notification: AgentAttentionRequiredNotification) => void,
  ): () => void {
    const unsubscribeLegacy = this.on("agent_stream", (message) => {
      if (message.payload.event.type !== "attention_required") {
        return;
      }
      const event = message.payload.event;
      handler({
        agentId: message.payload.agentId,
        reason: event.reason,
        timestamp: event.timestamp,
        shouldNotify: event.shouldNotify,
        ...(event.notification ? { notification: event.notification } : {}),
      });
    });
    const unsubscribeDedicated = this.on("agent_attention_required", (message) => {
      handler(message.payload);
    });
    return () => {
      unsubscribeLegacy();
      unsubscribeDedicated();
    };
  }

  async restoreWorkspace(workspaceId: string, requestId?: string): Promise<void> {
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"workspace.recovery.restore.response">({
        requestId,
        message: {
          type: "workspace.recovery.restore.request",
          workspaceId,
        },
        timeout: 150_000,
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "Workspace recovery was rejected by the host");
    }
  }

  async searchGithubRepositories(
    input: { query: string; limit?: number },
    requestId?: string,
  ): Promise<WorkspaceGithubSearchRepositoriesPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"workspace.github.search_repositories.response">(
      {
        requestId,
        message: {
          type: "workspace.github.search_repositories.request",
          query: input.query,
          limit: input.limit,
        },
      },
    );
  }

  async setAgentTimelineSubscription(agentIds: string[]): Promise<void> {
    // COMPAT(selectiveAgentTimeline): added in v0.1.106. Old daemons keep their
    // legacy global stream and do not understand this RPC. Remove after
    // 2027-01-12 once the supported daemon floor is >= v0.1.106.
    if (!this.lastServerInfoMessage?.features?.selectiveAgentTimeline) {
      return;
    }

    const requestId = this.createRequestId();
    const normalizedAgentIds = [...new Set(agentIds)].sort();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.timeline.set_subscription.request",
      agentIds: normalizedAgentIds,
      requestId,
    });

    await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (response) => {
        if (response.type !== "agent.timeline.set_subscription.response") {
          return null;
        }
        return response.payload.requestId === requestId ? response.payload : null;
      },
    });
  }

  async setWorkspacePinned(
    workspaceId: string,
    pinned: boolean,
    requestId?: string,
  ): Promise<{ pinnedAt: string | null }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "workspace.pin.set.request",
        workspaceId,
        pinned,
      },
      responseType: "workspace.pin.set.response",
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setWorkspacePinned rejected");
    }
    return { pinnedAt: payload.pinnedAt };
  }

  async subscribeFile(
    input: { cwd: string; path: string },
    onUpdate: (version: FileVersion) => void,
  ): Promise<{ initial: FileVersion; unsubscribe: () => void }> {
    const subscriptionId = this.createRequestId();
    this.fileSubscriptions.set(subscriptionId, { ...input, onUpdate });
    try {
      const payload = await this.sendCorrelatedSessionRequest({
        message: {
          type: "fs.file.subscribe.request",
          cwd: input.cwd,
          path: input.path,
          subscriptionId,
        },
        responseType: "fs.file.subscribe.response",
      });
      return {
        initial: payload.initial,
        unsubscribe: () => {
          if (!this.fileSubscriptions.delete(subscriptionId)) return;
          void this.sendCorrelatedSessionRequest({
            message: { type: "fs.file.unsubscribe.request", subscriptionId },
            responseType: "fs.file.unsubscribe.response",
          }).catch(() => undefined);
        },
      };
    } catch (error) {
      this.fileSubscriptions.delete(subscriptionId);
      throw error;
    }
  }

  async fetchAgentTimeline(
    agentId: string,
    options: FetchAgentTimelineOptions = {},
  ): Promise<FetchAgentTimelinePayload> {
    const resolvedRequestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_timeline_request",
      agentId,
      requestId: resolvedRequestId,
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
      ...(options.projection ? { projection: options.projection } : {}),
      ...(options.mergeWindow === true ? { mergeWindow: true } : {}),
    });

    const payload = await this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_agent_timeline_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });

    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  }
  async listAgentTimelinePrompts(
    agentId: string,
    options: { requestId?: string; timeout?: number } = {},
  ): Promise<AgentTimelinePromptIndexPayload> {
    const requestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "agent.timeline.list_prompts.request",
      agentId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (response) =>
        response.type === "agent.timeline.list_prompts.response" &&
        response.payload.requestId === requestId
          ? response.payload
          : null,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  async buildAgentForkContext(
    agentId: string,
    options: AgentForkContextOptions = {},
  ): Promise<AgentForkContextPayload> {
    const resolvedRequestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "agent.fork_context.request",
      agentId,
      requestId: resolvedRequestId,
      ...(options.boundaryCursor ? { boundaryCursor: options.boundaryCursor } : {}),
      ...(options.boundaryMessageId ? { boundaryMessageId: options.boundaryMessageId } : {}),
    });

    const payload = await this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: 15000,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.fork_context.response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });

    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  }

  // ============================================================================
  // Agent Interaction
  // ============================================================================

  async sendAgentMessage(
    agentId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendAgentMessageResult> {
    const requestId = this.createRequestId();
    const messageId = options?.messageId ?? crypto.randomUUID();
    const message = SessionInboundMessageSchema.parse({
      type: "send_agent_message_request",
      requestId,
      agentId,
      text,
      ...(messageId ? { messageId } : {}),
      ...(options?.images ? { images: options.images } : {}),
      ...(options?.attachments ? { attachments: options.attachments } : {}),
      ...(options?.delivery ? { delivery: options.delivery } : {}),
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "send_agent_message_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "sendAgentMessage rejected");
    }
    return {
      queued: payload.queued ?? false,
      queuedMessageId: payload.queuedMessageId ?? null,
    };
  }

  async sendMessage(agentId: string, text: string, options?: SendMessageOptions): Promise<void> {
    await this.sendAgentMessage(agentId, text, options);
  }

  /**
   * Pull one message back out of an agent's queue. Returns its text so the
   * caller can put it back in the composer, or null when the turn already
   * drained it. Requires `server_info.features.steerQueue`.
   */
  async removeQueuedAgentMessage(
    agentId: string,
    messageId: string,
  ): Promise<{ id: string; text: string } | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.queue.remove.request",
      requestId,
      agentId,
      messageId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.queue.remove.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.removed;
  }

  /**
   * Move one queued message to a new position. Resolves false when the entry
   * was already drained or was already there - the authoritative order arrives
   * on the agent snapshot either way. Requires
   * `server_info.features.steerQueueReorder`.
   */
  async reorderQueuedAgentMessage(
    agentId: string,
    messageId: string,
    toIndex: number,
  ): Promise<boolean> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.queue.reorder.request",
      requestId,
      agentId,
      messageId,
      toIndex,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.queue.reorder.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.moved;
  }

  /** Drop every message queued behind an agent's current turn. */
  async clearAgentQueue(agentId: string): Promise<number> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.queue.clear.request",
      requestId,
      agentId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.queue.clear.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.clearedCount;
  }

  async rewindAgent(
    agentId: string,
    messageId: string,
    mode: "conversation" | "files" | "both",
  ): Promise<AgentRewindResponseMessage["payload"]> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.rewind.request",
      requestId,
      agentId,
      messageId,
      mode,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.rewind.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.ok) {
      throw new Error(payload.error ?? "Agent rewind failed");
    }
    return payload;
  }

  async cancelAgent(agentId: string): Promise<{ cancelled?: boolean }> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "cancel_agent_request",
      agentId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "cancel_agent_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    // A refused cancellation comes back as an error payload, not a rejected
    // frame. Dropping it reported Stop as successful while the provider was
    // still running and still spending tokens - the exact outcome the daemon
    // refuses the cancel to avoid.
    if (payload.error) {
      throw new Error(payload.error);
    }
    // Absent ⇒ old daemon that doesn't report whether a run was interrupted.
    return payload.cancelled !== undefined ? { cancelled: payload.cancelled } : {};
  }

  async setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "set_agent_mode_request",
      agentId,
      modeId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "set_agent_mode_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setAgentMode rejected");
    }
    return payload.notice ?? null;
  }

  async setAgentModel(
    agentId: string,
    modelId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "set_agent_model_request",
      agentId,
      modelId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "set_agent_model_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setAgentModel rejected");
    }
    return payload.notice ?? null;
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "set_agent_feature_request",
      agentId,
      featureId,
      value,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "set_agent_feature_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setAgentFeature rejected");
    }
  }

  async setAgentThinkingOption(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "set_agent_thinking_request",
      agentId,
      thinkingOptionId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "set_agent_thinking_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setAgentThinkingOption rejected");
    }
    return payload.notice ?? null;
  }

  /**
   * Live-switch a running agent's personality (null clears it). The daemon
   * re-resolves the roster id against the agent's cwd and applies the full
   * personality - system prompt, identity, model/mode/effort - restarting the
   * provider query so the prompt takes effect on the next turn. Gate on
   * server_info.features.setAgentPersonality.
   */
  async setAgentPersonality(
    agentId: string,
    personalityId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.personality.set.request",
      agentId,
      personalityId,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.personality.set.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "setAgentPersonality rejected");
    }
    return payload.notice ?? null;
  }

  /**
   * Applies a whole agent-config bundle in one request. Use this instead of
   * chaining the single-field setters when the values belong together so client
   * interruption and other mutations cannot interleave between steps. A
   * provider rejection can still leave earlier steps applied.
   * Gated on `server_info.features.agentConfigApply`.
   */
  async applyAgentConfig(
    agentId: string,
    config: AgentConfigApply,
  ): Promise<AgentProviderNotice | null> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "agent.config.apply.request",
      agentId,
      config,
      requestId,
    });
    const payload = await this.sendRequest({
      requestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent.config.apply.response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "applyAgentConfig rejected");
    }
    return payload.notice ?? null;
  }

  async restartServer(reason?: string, requestId?: string): Promise<RestartRequestedStatusPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "restart_server_request",
      ...(reason && reason.trim().length > 0 ? { reason } : {}),
      requestId: resolvedRequestId,
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const restarted = RestartRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!restarted.success) {
          return null;
        }
        if (restarted.data.requestId !== resolvedRequestId) {
          return null;
        }
        return restarted.data;
      },
    });
  }

  async shutdownServer(options?: ShutdownServerOptions): Promise<ShutdownRequestedStatusPayload> {
    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "shutdown_server_request",
      requestId: resolvedRequestId,
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: options?.timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const shutdown = ShutdownRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!shutdown.success) {
          return null;
        }
        if (shutdown.data.requestId !== resolvedRequestId) {
          return null;
        }
        return shutdown.data;
      },
    });
  }

  async updateDaemon(requestId?: string): Promise<DaemonUpdateResponse["payload"]> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "daemon.update.request",
      requestId: resolvedRequestId,
    });
    return this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: 300_000, // 5 minutes - npm update can be slow on remote machines
      options: { skipQueue: true },
      select: (msg) => {
        const parsed = DaemonUpdateResponseSchema.safeParse(msg);
        if (!parsed.success) {
          return null;
        }
        if (parsed.data.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return parsed.data.payload;
      },
    });
  }

  // ============================================================================
  // Audio / Voice
  // ============================================================================

  async setVoiceMode(enabled: boolean, agentId?: string): Promise<SetVoiceModePayload> {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "set_voice_mode",
      enabled,
      ...(agentId ? { agentId } : {}),
      requestId,
    });
    const response = await this.sendRequest({
      requestId,
      message,
      select: (msg) => {
        if (msg.type !== "set_voice_mode_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (!response.accepted) {
      const codeSuffix =
        typeof response.reasonCode === "string" && response.reasonCode.trim().length > 0
          ? ` (${response.reasonCode})`
          : "";
      throw new Error((response.error ?? "Failed to set voice mode") + codeSuffix);
    }
    return response;
  }

  async sendVoiceAudioChunk(audio: string, format: string, isLast = false): Promise<void> {
    this.sendSessionMessage({ type: "voice_audio_chunk", audio, format, isLast });
  }

  async startDictationStream(dictationId: string, format: string): Promise<void> {
    const ack = this.waitForWithCancel(
      (msg) => {
        if (msg.type !== "dictation_stream_ack") {
          return null;
        }
        if (msg.payload.dictationId !== dictationId) {
          return null;
        }
        if (msg.payload.ackSeq !== -1) {
          return null;
        }
        return msg.payload;
      },
      30000,
      { skipQueue: true },
    );
    const ackPromise = ack.promise.then(() => undefined);

    const streamError = this.waitForWithCancel(
      (msg) => {
        if (msg.type !== "dictation_stream_error") {
          return null;
        }
        if (msg.payload.dictationId !== dictationId) {
          return null;
        }
        return msg.payload;
      },
      30000,
      { skipQueue: true },
    );
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });

    const cleanupError = new Error("Cancelled dictation start waiter");
    try {
      this.sendSessionMessageStrict({ type: "dictation_stream_start", dictationId, format });
      await Promise.race([ackPromise, errorPromise]);
    } finally {
      ack.cancel(cleanupError);
      streamError.cancel(cleanupError);
      void ackPromise.catch(() => undefined);
      void errorPromise.catch(() => undefined);
    }
  }

  sendDictationStreamChunk(dictationId: string, seq: number, audio: string, format: string): void {
    this.sendSessionMessageStrict({
      type: "dictation_stream_chunk",
      dictationId,
      seq,
      audio,
      format,
    });
  }

  async finishDictationStream(
    dictationId: string,
    finalSeq: number,
  ): Promise<{ dictationId: string; text: string }> {
    const final = this.waitForWithCancel(
      (msg) => {
        if (msg.type !== "dictation_stream_final") {
          return null;
        }
        if (msg.payload.dictationId !== dictationId) {
          return null;
        }
        return msg.payload;
      },
      0,
      { skipQueue: true },
    );

    const streamError = this.waitForWithCancel(
      (msg) => {
        if (msg.type !== "dictation_stream_error") {
          return null;
        }
        if (msg.payload.dictationId !== dictationId) {
          return null;
        }
        return msg.payload;
      },
      0,
      { skipQueue: true },
    );

    const finishAccepted = this.waitForWithCancel<DictationFinishAcceptedPayload>(
      (msg) => {
        if (msg.type !== "dictation_stream_finish_accepted") {
          return null;
        }
        if (msg.payload.dictationId !== dictationId) {
          return null;
        }
        return msg.payload;
      },
      DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS,
      { skipQueue: true },
    );

    const finalPromise = final.promise;
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });
    const finishAcceptedPromise = finishAccepted.promise;

    const finalOutcomePromise = finalPromise.then((payload) => ({
      kind: "final" as const,
      payload,
    }));
    const errorOutcomePromise = errorPromise.then(
      () => ({
        kind: "error" as const,
        error: new Error("Unexpected dictation stream error state"),
      }),
      (error) => ({
        kind: "error" as const,
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    );
    const finishAcceptedOutcomePromise = finishAcceptedPromise.then(
      (payload) => ({ kind: "accepted" as const, payload }),
      (error) => {
        if (isWaiterTimeoutError(error)) {
          return { kind: "accepted_timeout" as const };
        }
        return {
          kind: "accepted_error" as const,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      },
    );

    const waitForFinalResult = async (
      timeoutMs: number,
    ): Promise<{ dictationId: string; text: string }> => {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        const outcome = await Promise.race([finalOutcomePromise, errorOutcomePromise]);
        if (outcome.kind === "error") {
          throw outcome.error;
        }
        return outcome.payload;
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      });

      const outcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        timeoutPromise,
      ]);

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (outcome.kind === "timeout") {
        throw new Error(`Timeout waiting for dictation finalization (${timeoutMs}ms)`);
      }
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      return outcome.payload;
    };

    const cleanupError = new Error("Cancelled dictation finish waiter");
    try {
      this.sendSessionMessageStrict({ type: "dictation_stream_finish", dictationId, finalSeq });
      const firstOutcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        finishAcceptedOutcomePromise,
      ]);

      if (firstOutcome.kind === "final") {
        return firstOutcome.payload;
      }
      if (firstOutcome.kind === "error") {
        throw firstOutcome.error;
      }

      if (firstOutcome.kind === "accepted") {
        return await waitForFinalResult(
          firstOutcome.payload.timeoutMs + DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS,
        );
      }

      return await waitForFinalResult(DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS);
    } finally {
      final.cancel(cleanupError);
      streamError.cancel(cleanupError);
      finishAccepted.cancel(cleanupError);
      void finalPromise.catch(() => undefined);
      void errorPromise.catch(() => undefined);
      void finishAcceptedPromise.catch(() => undefined);
    }
  }

  cancelDictationStream(dictationId: string): void {
    this.sendSessionMessageStrict({ type: "dictation_stream_cancel", dictationId });
  }

  async abortRequest(): Promise<void> {
    this.sendSessionMessage({ type: "abort_request" });
  }

  async audioPlayed(id: string): Promise<void> {
    this.sendSessionMessage({ type: "audio_played", id });
  }

  // ============================================================================
  // Git Operations
  // ============================================================================

  async getCheckoutStatus(
    cwd: string,
    options?: { requestId?: string },
  ): Promise<CheckoutStatusPayload> {
    const requestId = options?.requestId;

    if (!requestId) {
      const existing = this.checkoutStatusInFlight.get(cwd);
      if (existing) {
        return existing;
      }
    }

    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "checkout_status_request",
      cwd,
      requestId: resolvedRequestId,
    });

    const responsePromise = this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "checkout_status_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });

    if (!requestId) {
      this.checkoutStatusInFlight.set(cwd, responsePromise);
      void responsePromise
        .finally(() => {
          if (this.checkoutStatusInFlight.get(cwd) === responsePromise) {
            this.checkoutStatusInFlight.delete(cwd);
          }
        })
        .catch(() => undefined);
    }

    return responsePromise;
  }

  private normalizeCheckoutDiffCompare(compare: {
    mode: "uncommitted" | "base";
    baseRef?: string;
    ignoreWhitespace?: boolean;
  }): { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean } {
    if (compare.mode === "uncommitted") {
      return compare.ignoreWhitespace === true
        ? { mode: "uncommitted", ignoreWhitespace: true }
        : { mode: "uncommitted" };
    }
    const trimmedBaseRef = compare.baseRef?.trim();
    if (!trimmedBaseRef) {
      return compare.ignoreWhitespace === true
        ? { mode: "base", ignoreWhitespace: true }
        : { mode: "base" };
    }
    return compare.ignoreWhitespace === true
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace: true }
      : { mode: "base", baseRef: trimmedBaseRef };
  }

  async getCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    requestId?: string,
  ): Promise<CheckoutDiffPayload> {
    const oneShotSubscriptionId = `oneshot-checkout-diff:${crypto.randomUUID()}`;
    try {
      const payload = await this.subscribeCheckoutDiff(cwd, compare, {
        subscriptionId: oneShotSubscriptionId,
        requestId,
      });
      return {
        cwd: payload.cwd,
        files: payload.files,
        error: payload.error,
        requestId: payload.requestId,
      };
    } finally {
      try {
        this.unsubscribeCheckoutDiff(oneShotSubscriptionId);
      } catch {
        // Ignore disconnect races during one-shot cleanup.
      }
    }
  }

  async subscribeCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    options?: { subscriptionId?: string; requestId?: string },
  ): Promise<SubscribeCheckoutDiffPayload> {
    const subscriptionId = options?.subscriptionId ?? crypto.randomUUID();
    const normalizedCompare = this.normalizeCheckoutDiffCompare(compare);
    const previousSubscription = this.checkoutDiffSubscriptions.get(subscriptionId) ?? null;
    this.checkoutDiffSubscriptions.set(subscriptionId, {
      cwd,
      compare: normalizedCompare,
    });

    const resolvedRequestId = this.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "subscribe_checkout_diff_request",
      subscriptionId,
      cwd,
      compare: normalizedCompare,
      requestId: resolvedRequestId,
    });

    try {
      return await this.sendCorrelatedRequest({
        requestId: resolvedRequestId,
        message,
        responseType: "subscribe_checkout_diff_response",
        options: { skipQueue: true },
        selectPayload: (payload) => {
          if (payload.subscriptionId !== subscriptionId) {
            return null;
          }
          return payload;
        },
      });
    } catch (error) {
      if (previousSubscription) {
        this.checkoutDiffSubscriptions.set(subscriptionId, previousSubscription);
      } else {
        this.checkoutDiffSubscriptions.delete(subscriptionId);
      }
      throw error;
    }
  }

  unsubscribeCheckoutDiff(subscriptionId: string): void {
    this.checkoutDiffSubscriptions.delete(subscriptionId);
    this.sendSessionMessage({
      type: "unsubscribe_checkout_diff_request",
      subscriptionId,
    });
  }

  async checkoutCommit(
    cwd: string,
    input: { message?: string; addAll?: boolean },
    requestId?: string,
  ): Promise<CheckoutCommitPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_commit_request",
        cwd,
        message: input.message,
        addAll: input.addAll,
      },
      responseType: "checkout_commit_response",
    });
  }

  async checkoutGitCommit(
    cwd: string,
    input: { message: string; paths: string[]; allowWithRunningAgents?: boolean },
    requestId?: string,
  ): Promise<CheckoutGitCommitPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.commit.response">({
      requestId,
      message: {
        type: "checkout.git.commit.request",
        cwd,
        message: input.message,
        paths: input.paths,
        ...(input.allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
      },
    });
  }

  async checkoutGitCommitAgent(
    cwd: string,
    requestId?: string,
  ): Promise<CheckoutGitCommitAgentPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.commit_agent.response">({
      requestId,
      message: {
        type: "checkout.git.commit_agent.request",
        cwd,
      },
    });
  }

  async checkoutGitRollback(
    cwd: string,
    input: { paths: string[]; allowWithRunningAgents?: boolean },
    requestId?: string,
  ): Promise<CheckoutGitRollbackPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.rollback.response">({
      requestId,
      message: {
        type: "checkout.git.rollback.request",
        cwd,
        paths: input.paths,
        ...(input.allowWithRunningAgents ? { allowWithRunningAgents: true } : {}),
      },
    });
  }

  async checkoutGitGetOperationLog(
    cwd: string,
    operation: string,
    requestId?: string,
  ): Promise<CheckoutGitGetOperationLogPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.get_operation_log.response">({
      requestId,
      message: {
        type: "checkout.git.get_operation_log.request",
        cwd,
        operation,
      },
    });
  }

  // ── Git file investigation ────────────────────────────────────────────────
  // Local git only: no remote, no forge, and no per-provider variant - the same
  // four calls answer for every agent provider. Gated by
  // server_info.features.checkoutGitFileHistory.

  async checkoutGitFileHistory(
    cwd: string,
    input: { path: string; limit?: number; offset?: number; startLine?: number; endLine?: number },
    requestId?: string,
  ): Promise<CheckoutGitFileHistoryPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.get_file_history.response">({
      requestId,
      message: {
        type: "checkout.git.get_file_history.request",
        cwd,
        path: input.path,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
        ...(input.endLine !== undefined ? { endLine: input.endLine } : {}),
      },
    });
  }

  async checkoutGitFileCommitDiff(
    cwd: string,
    input: { path: string; sha: string; ignoreWhitespace?: boolean },
    requestId?: string,
  ): Promise<CheckoutGitFileCommitDiffPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.get_file_commit_diff.response">(
      {
        requestId,
        message: {
          type: "checkout.git.get_file_commit_diff.request",
          cwd,
          path: input.path,
          sha: input.sha,
          ...(input.ignoreWhitespace ? { ignoreWhitespace: true } : {}),
        },
      },
    );
  }

  async checkoutGitFileBlame(
    cwd: string,
    input: { path: string; startLine?: number; lineCount?: number; sha?: string },
    requestId?: string,
  ): Promise<CheckoutGitFileBlamePayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.get_file_blame.response">({
      requestId,
      message: {
        type: "checkout.git.get_file_blame.request",
        cwd,
        path: input.path,
        ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
        ...(input.lineCount !== undefined ? { lineCount: input.lineCount } : {}),
        ...(input.sha !== undefined ? { sha: input.sha } : {}),
      },
    });
  }

  async checkoutGitFileOrigin(
    cwd: string,
    input: { path: string },
    requestId?: string,
  ): Promise<CheckoutGitFileOriginPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.git.get_file_origin.response">({
      requestId,
      message: {
        type: "checkout.git.get_file_origin.request",
        cwd,
        path: input.path,
      },
    });
  }

  async checkoutMerge(
    cwd: string,
    input: { baseRef?: string; strategy?: "merge" | "squash"; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<CheckoutMergePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_merge_request",
        cwd,
        baseRef: input.baseRef,
        strategy: input.strategy,
        requireCleanTarget: input.requireCleanTarget,
      },
      responseType: "checkout_merge_response",
    });
  }

  async checkoutMergeFromBase(
    cwd: string,
    input: { baseRef?: string; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<CheckoutMergeFromBasePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_merge_from_base_request",
        cwd,
        baseRef: input.baseRef,
        requireCleanTarget: input.requireCleanTarget,
      },
      responseType: "checkout_merge_from_base_response",
    });
  }

  async checkoutPull(cwd: string, requestId?: string): Promise<CheckoutPullPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_pull_request",
        cwd,
      },
      responseType: "checkout_pull_response",
    });
  }

  async checkoutPush(cwd: string, requestId?: string): Promise<CheckoutPushPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_push_request",
        cwd,
      },
      responseType: "checkout_push_response",
    });
  }

  async checkoutRefresh(cwd: string, requestId?: string): Promise<CheckoutRefreshPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout.refresh.request",
        cwd,
      },
      responseType: "checkout.refresh.response",
    });
  }

  async checkoutGitFetch(cwd: string, requestId?: string): Promise<CheckoutGitFetchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout.git.fetch.request",
        cwd,
      },
      responseType: "checkout.git.fetch.response",
    });
  }

  async checkoutPrCreate(
    cwd: string,
    input: { title?: string; body?: string; baseRef?: string },
    requestId?: string,
  ): Promise<CheckoutPrCreatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_pr_create_request",
        cwd,
        title: input.title,
        body: input.body,
        baseRef: input.baseRef,
      },
      responseType: "checkout_pr_create_response",
    });
  }

  async checkoutPrMerge(
    cwd: string,
    input: { method: CheckoutPrMergeMethod },
    requestId?: string,
  ): Promise<CheckoutPrMergePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_pr_merge_request",
        cwd,
        mergeMethod: input.method,
      },
      responseType: "checkout_pr_merge_response",
    });
  }

  async checkoutGithubSetAutoMerge(
    cwd: string,
    input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
    requestId?: string,
  ): Promise<CheckoutGithubSetAutoMergePayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.github.set_auto_merge.response">({
      requestId,
      message: {
        type: "checkout.github.set_auto_merge.request",
        cwd,
        enabled: input.enabled,
        ...(input.enabled ? { mergeMethod: input.method } : {}),
      },
    });
  }

  async previewListConfig(cwd: string, requestId?: string): Promise<PreviewListConfigPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"preview.list_config.response">({
      requestId,
      message: {
        type: "preview.list_config.request",
        cwd,
      },
    });
  }

  async previewStart(cwd: string, name: string, requestId?: string): Promise<PreviewStartPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"preview.start.response">({
      requestId,
      message: {
        type: "preview.start.request",
        cwd,
        name,
      },
    });
  }

  async previewBindTab(
    serverId: string,
    browserId: string,
    requestId?: string,
  ): Promise<PreviewBindTabPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"preview.bind_tab.response">({
      requestId,
      message: {
        type: "preview.bind_tab.request",
        serverId,
        browserId,
      },
    });
  }

  async previewStop(serverId: string, requestId?: string): Promise<PreviewStopPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"preview.stop.response">({
      requestId,
      message: {
        type: "preview.stop.request",
        serverId,
      },
    });
  }

  async checkoutGithubGetCheckDetails(
    input: {
      cwd: string;
      repoOwner: string;
      repoName: string;
      checkRunId: number;
      workflowRunId?: number;
    },
    requestId?: string,
  ): Promise<CheckoutGithubGetCheckDetailsPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.github.get_check_details.response">(
      {
        requestId,
        message: {
          type: "checkout.github.get_check_details.request",
          cwd: input.cwd,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          checkRunId: input.checkRunId,
          workflowRunId: input.workflowRunId,
        },
      },
    );
  }

  async checkoutPrStatus(cwd: string, requestId?: string): Promise<CheckoutPrStatusPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_pr_status_request",
        cwd,
      },
      responseType: "checkout_pr_status_response",
    });
  }

  async pullRequestTimeline(
    input: { cwd: string; prNumber: number; repoOwner: string; repoName: string },
    requestId?: string,
  ): Promise<PullRequestTimelinePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "pull_request_timeline_request",
        cwd: input.cwd,
        prNumber: input.prNumber,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      },
      responseType: "pull_request_timeline_response",
    });
  }

  async checkoutSwitchBranch(
    cwd: string,
    branch: string,
    requestId?: string,
  ): Promise<CheckoutSwitchBranchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "checkout_switch_branch_request",
        cwd,
        branch,
      },
      responseType: "checkout_switch_branch_response",
    });
  }

  async renameBranch(input: RenameBranchInput): Promise<RenameBranchResult> {
    return this.sendCorrelatedSessionRequest({
      requestId: input.requestId,
      message: {
        type: "checkout.rename_branch.request",
        cwd: input.cwd,
        branch: input.branch,
      },
      responseType: "checkout.rename_branch.response",
    });
  }

  async stashSave(
    cwd: string,
    options?: { branch?: string },
    requestId?: string,
  ): Promise<StashSavePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "stash_save_request",
        cwd,
        branch: options?.branch,
      },
      responseType: "stash_save_response",
    });
  }

  async stashPop(cwd: string, stashIndex: number, requestId?: string): Promise<StashPopPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "stash_pop_request",
        cwd,
        stashIndex,
      },
      responseType: "stash_pop_response",
    });
  }

  async stashList(
    cwd: string,
    options?: { ottoOnly?: boolean },
    requestId?: string,
  ): Promise<StashListPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "stash_list_request",
        cwd,
        ottoOnly: options?.ottoOnly,
      },
      responseType: "stash_list_response",
    });
  }

  async getOttoWorktreeList(
    input: { cwd?: string; repoRoot?: string },
    requestId?: string,
  ): Promise<OttoWorktreeListPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "otto_worktree_list_request",
        cwd: input.cwd,
        repoRoot: input.repoRoot,
      },
      responseType: "otto_worktree_list_response",
    });
  }

  async archiveOttoWorktree(
    input: {
      worktreePath?: string;
      repoRoot?: string;
      branchName?: string;
      workspaceId?: string;
      scope?: "workspace" | "worktree";
    },
    requestId?: string,
  ): Promise<OttoWorktreeArchivePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "otto_worktree_archive_request",
        worktreePath: input.worktreePath,
        repoRoot: input.repoRoot,
        branchName: input.branchName,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
      },
      responseType: "otto_worktree_archive_response",
    });
  }

  async createOttoWorktree(
    input: CreateOttoWorktreeInput,
    requestId?: string,
  ): Promise<CreateOttoWorktreePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "create_otto_worktree_request",
        cwd: input.cwd,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        worktreeSlug: input.worktreeSlug,
        ...(input.firstAgentContext !== undefined
          ? { firstAgentContext: input.firstAgentContext }
          : {}),
        ...(input.refName !== undefined ? { refName: input.refName } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.githubPrNumber !== undefined ? { githubPrNumber: input.githubPrNumber } : {}),
      },
      responseType: "create_otto_worktree_response",
    });
  }

  async createWorkspace(
    input: {
      source: WorkspaceCreateRequest["source"];
      title?: string;
      firstAgentContext?: WorkspaceCreateRequest["firstAgentContext"];
    },
    requestId?: string,
  ): Promise<WorkspaceCreatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "workspace.create.request",
        source: input.source,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.firstAgentContext !== undefined
          ? { firstAgentContext: input.firstAgentContext }
          : {}),
      },
      responseType: "workspace.create.response",
    });
  }

  async validateBranch(
    options: { cwd: string; branchName: string },
    requestId?: string,
  ): Promise<ValidateBranchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "validate_branch_request",
        cwd: options.cwd,
        branchName: options.branchName,
      },
      responseType: "validate_branch_response",
    });
  }

  async getBranchSuggestions(
    options: { cwd: string; query?: string; limit?: number },
    requestId?: string,
  ): Promise<BranchSuggestionsPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "branch_suggestions_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
      },
      responseType: "branch_suggestions_response",
    });
  }

  async searchForge(
    options: { cwd: string; query: string; limit?: number; kinds?: ForgeSearchRequest["kinds"] },
    requestId?: string,
  ): Promise<ForgeSearchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "forge.search.request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
        kinds: options.kinds,
      },
      responseType: "forge.search.response",
      timeout: 15000,
    });
  }

  async searchGitHub(
    options: { cwd: string; query: string; limit?: number; kinds?: GitHubSearchRequest["kinds"] },
    requestId?: string,
  ): Promise<GitHubSearchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "github_search_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
        kinds: options.kinds,
      },
      responseType: "github_search_response",
    });
  }

  // Provider-neutral issue/PR search: the daemon resolves the project's git
  // hosting provider from cwd. Requires server_info features.gitHostingProviders.
  async searchHosting(
    options: { cwd: string; query: string; limit?: number; kinds?: HostingSearchRequest["kinds"] },
    requestId?: string,
  ): Promise<HostingSearchPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "hosting.search.request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
        kinds: options.kinds,
      },
      responseType: "hosting.search.response",
    });
  }

  // One-shot connection probe for a host-level provider's credentials, used by
  // the host Git providers settings section. Requires
  // server_info features.gitHostingProviders.
  async getHostingAuthStatus(
    options: { provider: GitHostingProviderId },
    requestId?: string,
  ): Promise<HostingAuthStatusPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "hosting.auth_status.request",
        provider: options.provider,
      },
      responseType: "hosting.auth_status.response",
    });
  }

  async getDirectorySuggestions(
    options: {
      query: string;
      limit?: number;
      cwd?: string;
      includeFiles?: boolean;
      includeDirectories?: boolean;
      matchMode?: "fuzzy" | "suffix";
    },
    requestId?: string,
  ): Promise<DirectorySuggestionsPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "directory_suggestions_request",
        query: options.query,
        cwd: options.cwd,
        includeFiles: options.includeFiles,
        includeDirectories: options.includeDirectories,
        matchMode: options.matchMode,
        limit: options.limit,
      },
      responseType: "directory_suggestions_response",
      // Home-tree scans on large home dirs can take several seconds; don't cut
      // the suggestion request off early (it would surface as an empty list).
    });
  }

  // ============================================================================
  // File Explorer
  // ============================================================================

  private async requestFileExplorer(
    cwd: string,
    path: string,
    mode: "list" | "file",
    requestId?: string,
    acceptBinary = false,
  ): Promise<FileExplorerPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "file_explorer_request",
        cwd,
        path,
        mode,
        ...(acceptBinary ? { acceptBinary: true } : {}),
      },
      responseType: "file_explorer_response",
    });
  }

  async listDirectory(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileExplorerDirectoryPayload> {
    const payload = await this.requestFileExplorer(cwd, path, "list", requestId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.directory) {
      throw new Error("Directory listing unavailable.");
    }
    return payload.directory;
  }

  async readFile(cwd: string, path: string, requestId?: string): Promise<FileReadResult> {
    const resolvedRequestId = this.createRequestId(requestId);
    this.pendingBinaryFileReads.set(resolvedRequestId, { cwd, path });
    try {
      const payload = await this.requestFileExplorer(cwd, path, "file", resolvedRequestId, true);
      if (payload.error) {
        throw new Error(payload.error);
      }
      const binaryResult = this.completedBinaryFileReads.get(resolvedRequestId);
      if (binaryResult) {
        this.completedBinaryFileReads.delete(resolvedRequestId);
        return binaryResult;
      }
      if (!payload.file) {
        throw new Error("File unavailable.");
      }
      return legacyExplorerFileToBytes(payload.file);
    } finally {
      this.pendingBinaryFileReads.delete(resolvedRequestId);
      this.activeBinaryFileTransfers.delete(resolvedRequestId);
    }
  }

  /**
   * Text-editor read: inline JSON path so the payload carries the editor's
   * save-precondition baseline (modifiedAt, eol, hash) alongside the content.
   */
  async readTextFile(cwd: string, path: string, requestId?: string): Promise<TextFileReadResult> {
    const payload = await this.requestFileExplorer(cwd, path, "file", requestId, false);
    if (payload.error) {
      throw new Error(payload.error);
    }
    const file = payload.file;
    if (!file) {
      throw new Error("File unavailable.");
    }
    if (file.kind !== "text" || typeof file.content !== "string") {
      throw new Error("File is not a text file.");
    }
    return {
      path: file.path,
      content: file.content,
      size: file.size,
      modifiedAt: file.modifiedAt,
      // COMPAT(textEditor): added in v0.4.4 - the editor is gated on
      // features.textEditor, so a gated daemon always sends both fields.
      eol: file.eol ?? "lf",
      hash: file.hash ?? null,
    };
  }

  /**
   * The fs.file.write RPC: optimistic-concurrency writes keyed by an opaque
   * revision. The hash-keyed `writeFile` below is kept for callers
   * that have not moved over.
   */
  async writeFsFile(input: {
    cwd: string;
    path: string;
    content: string;
    expectedModifiedAt: string;
    expectedRevision?: string;
  }): Promise<FsFileWriteResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      message: { type: "fs.file.write.request", ...input },
      responseType: "fs.file.write.response",
    });
    return payload.result;
  }

  /** Conditional save - see FileWriteRequestSchema for the no-clobber contract. */
  async writeFile(options: FileWriteOptions): Promise<FileWriteResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "file.write.request",
        cwd: options.cwd,
        path: options.path,
        content: options.content,
        expectedModifiedAt: options.expectedModifiedAt,
        expectedHash: options.expectedHash,
        allowCreate: options.allowCreate,
        eol: options.eol,
      },
      responseType: "file.write.response",
    });
    return payload.result;
  }

  /**
   * Write bytes to a workspace file - the path for generated artifacts the
   * text write cannot carry (it refuses binary targets outright). Gated on
   * `features.binaryFileWrite`; there is no client-side substitute, because
   * the client never touches a workspace file on any platform.
   *
   * Shaped like {@link uploadFile}: the JSON request says where the bytes go
   * and how many to expect, then the bytes follow as file-transfer frames
   * correlated on the same `requestId`. The daemon answers at FileEnd.
   */
  async writeBinaryFile(options: FileWriteBinaryOptions): Promise<FsFileWriteBinaryResult> {
    const bytes = asUint8Array(options.bytes);
    if (!bytes) {
      throw new Error("File bytes are required.");
    }
    const resolvedRequestId = this.createRequestId(options.requestId);
    const responsePromise = this.sendCorrelatedSessionRequest({
      requestId: resolvedRequestId,
      message: {
        type: "fs.file.write_binary.request",
        cwd: options.cwd,
        path: options.path,
        size: bytes.byteLength,
        overwrite: options.overwrite,
      },
      responseType: "fs.file.write_binary.response",
    });

    this.sendFileTransfer({
      requestId: resolvedRequestId,
      bytes,
      // Nothing downstream reads the mime for a workspace write - the path
      // decides what the file is - but the frame metadata requires one.
      mime: "application/octet-stream",
      chunkSize: options.chunkSize,
    });

    const payload = await responsePromise;
    return payload.result;
  }

  /**
   * FileBegin, chunks, FileEnd. Synchronous through `sendBinaryFrame`, so the
   * frames leave in order and behind the JSON request that announced them.
   */
  private sendFileTransfer(input: {
    requestId: string;
    bytes: Uint8Array;
    mime: string;
    fileName?: string;
    modifiedAt?: string;
    chunkSize?: number;
  }): void {
    this.sendBinaryFrame(
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: input.requestId,
        metadata: {
          mime: input.mime,
          size: input.bytes.byteLength,
          encoding: "binary",
          modifiedAt: input.modifiedAt ?? new Date().toISOString(),
          ...(input.fileName ? { fileName: input.fileName } : {}),
        },
      }),
    );

    const chunkSize = input.chunkSize ?? 1024 * 1024;
    for (let offset = 0; offset < input.bytes.byteLength; offset += chunkSize) {
      this.sendBinaryFrame(
        encodeFileTransferFrame({
          opcode: FileTransferOpcode.FileChunk,
          requestId: input.requestId,
          payload: input.bytes.subarray(
            offset,
            Math.min(offset + chunkSize, input.bytes.byteLength),
          ),
        }),
      );
    }

    this.sendBinaryFrame(
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileEnd,
        requestId: input.requestId,
      }),
    );
  }

  async refineFile(options: FileRefineOptions): Promise<FileRefineResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "file.refine.request",
        cwd: options.cwd,
        documents: options.documents,
        references: options.references,
        instruction: options.instruction,
      },
      responseType: "file.refine.response",
    });
    return payload.result;
  }

  /**
   * Project-wide search. Per-file results stream through onFileResult (the
   * daemon emits them in order, before the summary response resolves); the
   * returned summary carries the completion status and totals.
   */
  async searchFiles(options: FileSearchOptions): Promise<FileSearchSummary> {
    const resolvedRequestId = this.createRequestId(options.requestId);
    const offResults = this.on("file.search.result", (message) => {
      if (message.type !== "file.search.result") {
        return;
      }
      if (message.payload.searchId === resolvedRequestId) {
        options.onFileResult(message.payload);
      }
    });
    try {
      return await this.sendCorrelatedSessionRequest({
        requestId: resolvedRequestId,
        message: {
          type: "file.search.request",
          cwd: options.cwd,
          query: options.query,
          caseSensitive: options.caseSensitive,
          wholeWord: options.wholeWord,
          regexp: options.regexp,
          include: options.include,
          exclude: options.exclude,
        },
        responseType: "file.search.response",
      });
    } finally {
      offResults();
    }
  }

  /** Gitignore-aware workspace file listing for the fuzzy finder. */
  async listCodeFiles(cwd: string, requestId?: string): Promise<CodeListFilesResultPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.list_files.request", cwd },
      responseType: "code.list_files.response",
    });
  }

  /** Name-based go-to-definition: one hit jumps, multiple hits are a picker. */
  async findCodeSymbols(
    cwd: string,
    name: string,
    requestId?: string,
  ): Promise<CodeSymbolLocation[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.symbols.request", cwd, name },
      responseType: "code.symbols.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.locations;
  }

  /**
   * Language-server-backed go-to-definition. Unlike `findCodeSymbols` this resolves the
   * reference *at a position*, so multiple results mean real overloads or
   * implementations rather than "two files happen to use this name".
   *
   * Line and column are 1-based. Returns the whole payload, not just the locations,
   * because `indexing` and `unavailable` are answers the caller must show differently
   * from an empty result.
   */
  async findCodeDefinition(
    input: CodeDefinitionQuery,
    requestId?: string,
  ): Promise<CodeDefinitionResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.definition.request",
        cwd: input.cwd,
        path: input.path,
        line: input.line,
        column: input.column,
      },
      responseType: "code.definition.response",
    });
    return { status: payload.status, locations: payload.locations, error: payload.error };
  }

  /**
   * Mirror the editor's current buffer to the daemon so definitions resolve against
   * unsaved edits. Debounced by the caller - this is not a per-keystroke RPC.
   */
  async syncCodeDocument(
    cwd: string,
    path: string,
    text: string,
    requestId?: string,
  ): Promise<void> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.document.sync.request", cwd, path, text },
      responseType: "code.document.sync.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
  }

  /** Release the daemon-side mirror when a file tab closes. */
  async closeCodeDocument(cwd: string, path: string, requestId?: string): Promise<void> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.document.close.request", cwd, path },
      responseType: "code.document.close.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
  }

  /**
   * The language server's own explanation of the symbol at a position. Returns the
   * whole payload: `indexing` and `unavailable` read differently to a user than "the
   * server had nothing to say", which is `ok` with a null `markdown`.
   */
  async getCodeHover(input: CodeDefinitionQuery, requestId?: string): Promise<CodeHoverResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.hover.request",
        cwd: input.cwd,
        path: input.path,
        line: input.line,
        column: input.column,
      },
      responseType: "code.hover.response",
    });
    return {
      status: payload.status,
      markdown: payload.markdown,
      range: payload.range,
      serverId: payload.serverId,
      error: payload.error,
    };
  }

  /** Every reference to the symbol at a position, for the references results tab. */
  async findCodeReferences(
    input: CodeDefinitionQuery,
    requestId?: string,
  ): Promise<CodeReferencesResult> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.references.request",
        cwd: input.cwd,
        path: input.path,
        line: input.line,
        column: input.column,
      },
      responseType: "code.references.response",
    });
    return { status: payload.status, locations: payload.locations, error: payload.error };
  }

  /**
   * A rename **dry run** - every edit it would make, and nothing written. The client
   * puts this in front of the user as a job to audit before applying.
   */
  async previewCodeRename(
    input: CodeRenamePreviewQuery,
    requestId?: string,
  ): Promise<CodeRenamePlan> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.rename.preview.request",
        cwd: input.cwd,
        path: input.path,
        line: input.line,
        column: input.column,
        newName: input.newName,
      },
      responseType: "code.rename.preview.response",
    });
    return {
      status: payload.status,
      files: payload.files,
      fileCount: payload.fileCount,
      editCount: payload.editCount,
      planId: payload.planId,
      error: payload.error,
    };
  }

  /**
   * Execute a rename the user audited. Sends the  and NOT the edits: the daemon
   * recomputes the plan and refuses unless the identity still matches, which is what keeps
   * this from being an arbitrary-write RPC and what makes "what you approved is what
   * happens" enforceable rather than merely intended.
   */
  async applyCodeRename(
    input: CodeRenameApplyQuery,
    requestId?: string,
  ): Promise<CodeRenameApplyOutcome> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.rename.apply.request",
        cwd: input.cwd,
        path: input.path,
        line: input.line,
        column: input.column,
        newName: input.newName,
        planId: input.planId,
      },
      responseType: "code.rename.apply.response",
    });
    return {
      status: payload.status,
      runId: payload.runId,
      files: payload.files,
      appliedFiles: payload.appliedFiles,
      appliedEdits: payload.appliedEdits,
      skippedEdits: payload.skippedEdits,
      complete: payload.complete,
      error: payload.error,
    };
  }

  /**
   * Take a rename run back. Sends only the run id: the daemon holds the before-images, and
   * restores a file only if it still holds exactly what the run wrote.
   */
  async undoCodeRename(
    cwd: string,
    runId: string,
    requestId?: string,
  ): Promise<CodeRenameUndoOutcome> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.rename.undo.request", cwd, runId },
      responseType: "code.rename.undo.response",
    });
    return {
      status: payload.status,
      files: payload.files,
      restoredFiles: payload.restoredFiles,
      complete: payload.complete,
      error: payload.error,
    };
  }

  /**
   * Live language-server state for the Daemon → Code screen: what this host can
   * supply, and what is running now.
   *
   * Omit `cwd` for the host-wide answer the settings screen wants: every row the daemon
   * knows, resolved against the rungs a host has. Pass one only to additionally probe that
   * project's `node_modules/.bin`, the single rung that is genuinely per-project.
   * Requires features.lspHostServers when omitted.
   */
  async listLspServers(cwd?: string, requestId?: string): Promise<LspServersSnapshot> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "lsp.servers.list.request", cwd },
      responseType: "lsp.servers.list.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return { languages: payload.languages, running: payload.running };
  }

  /** Stop one running language server. */
  async stopLspServer(rootPath: string, serverId: string, requestId?: string): Promise<void> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "lsp.server.stop.request", rootPath, serverId },
      responseType: "lsp.server.stop.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
  }

  /**
   * Solutions in a workspace, which is what decides whether the Files tab shows a view switcher
   * at all.
   *
   * Never throws and never carries an error the caller has to render. A workspace with no
   * solution, a host with no .NET SDK, and a host with the feature switched off all answer with an
   * empty list, so the caller has one silent case - "no switcher" - rather than four states.
   */
  async listSolutions(cwd: string, requestId?: string): Promise<SolutionRef[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.solution.list.request", cwd },
      responseType: "code.solution.list.response",
    });
    return payload.solutions;
  }

  /** One solution's organisation: folders, the projects inside them, configurations. */
  async getSolutionTree(
    input: { cwd: string; solutionPath: string },
    requestId?: string,
  ): Promise<SolutionTree> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.solution.get_tree.request",
        cwd: input.cwd,
        solutionPath: input.solutionPath,
      },
      responseType: "code.solution.get_tree.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      solutionPath: payload.solutionPath,
      name: payload.name,
      format: payload.format,
      folders: payload.folders,
      projects: payload.projects,
      buildTypes: payload.buildTypes,
      platforms: payload.platforms,
    };
  }

  /**
   * One project's evaluated file membership, fetched on expand.
   *
   * A `failed` status is a normal answer, not an exception: the daemon carries MSBuild's own
   * message for a project it refused, and one bad project must not blank the tree.
   */
  async loadSolutionProject(
    input: { cwd: string; solutionPath: string; projectPath: string },
    requestId?: string,
  ): Promise<SolutionProjectContents> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "code.solution.load_project.request",
        cwd: input.cwd,
        solutionPath: input.solutionPath,
        projectPath: input.projectPath,
      },
      responseType: "code.solution.load_project.response",
    });
    return {
      projectPath: payload.projectPath,
      status: payload.status,
      nodes: payload.nodes,
      projectReferences: payload.projectReferences,
      packageReferences: payload.packageReferences,
      targetFrameworks: payload.targetFrameworks,
      outputType: payload.outputType,
      isSdkStyle: payload.isSdkStyle,
      error: payload.error,
    };
  }

  /** Definition symbols for a single file (document outline). */
  async getCodeOutline(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<CodeSymbolLocation[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "code.outline.request", cwd, path },
      responseType: "code.outline.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.symbols;
  }

  /** Preview-first project replace - see FileReplaceRequestSchema. */
  async replaceFiles(options: {
    cwd: string;
    replacement: string;
    files: FileReplaceFilesInput;
    requestId?: string;
  }): Promise<FileReplaceResultPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "file.replace.request",
        cwd: options.cwd,
        replacement: options.replacement,
        files: options.files,
      },
      responseType: "file.replace.response",
    });
  }

  /**
   * Watch a workspace file for external changes. Reference-counted per
   * (cwd, path): the daemon subscription is created for the first watcher and
   * torn down when the last disposer runs; events fan out to every caller.
   */
  watchFile(
    cwd: string,
    path: string,
    onEvent: (event: FileWatchEventPayload) => void,
  ): () => void {
    const key = `${cwd}${path}`;
    const offMessage = this.on("file.watch.event", (message) => {
      if (message.type !== "file.watch.event") {
        return;
      }
      if (message.payload.cwd === cwd && message.payload.path === path) {
        onEvent(message.payload);
      }
    });
    let entry = this.fileWatchRefCounts.get(key);
    if (!entry) {
      entry = { count: 0, cwd, path };
      this.fileWatchRefCounts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count === 1) {
      void this.sendCorrelatedSessionRequest({
        message: { type: "file.watch.subscribe.request", cwd, path },
        responseType: "file.watch.subscribe.response",
      }).catch(() => undefined);
    }
    const trackedEntry = entry;
    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      offMessage();
      trackedEntry.count -= 1;
      if (trackedEntry.count <= 0) {
        this.fileWatchRefCounts.delete(key);
        void this.sendCorrelatedSessionRequest({
          message: { type: "file.watch.unsubscribe.request", cwd, path },
          responseType: "file.watch.unsubscribe.response",
        }).catch(() => undefined);
      }
    };
  }

  async uploadFile(input: FileUploadInput): Promise<FileUploadResult> {
    const bytes = asUint8Array(input.bytes);
    if (!bytes) {
      throw new Error("File bytes are required.");
    }
    const resolvedRequestId = this.createRequestId(input.requestId);
    const modifiedAt = input.modifiedAt ?? new Date().toISOString();
    const responsePromise = this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message: {
        type: "file.upload.request",
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: bytes.byteLength,
        modifiedAt,
        requestId: resolvedRequestId,
      },
      responseType: "file.upload.response",
      options: { skipQueue: true },
    });

    this.sendFileTransfer({
      requestId: resolvedRequestId,
      bytes,
      mime: input.mimeType,
      fileName: input.fileName,
      modifiedAt,
      ...(input.chunkSize === undefined ? {} : { chunkSize: input.chunkSize }),
    });

    return responsePromise;
  }

  async requestDownloadToken(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileDownloadTokenPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "file_download_token_request",
        cwd,
        path,
      },
      responseType: "file_download_token_response",
    });
  }

  async requestProjectIcon(
    cwd: string,
    requestId?: string,
  ): Promise<ProjectIconResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "project_icon_request",
        cwd,
      },
      responseType: "project_icon_response",
    });
  }

  // ============================================================================
  // Context Management
  // ============================================================================

  /**
   * Everything the workspace's provider sends before the user types. `provider`
   * and `windowTokens` are what-if overrides for the Context Management tab's
   * pickers; omit both to evaluate the active agent's real setup.
   */
  async requestContextReport(
    input: {
      workspaceId: string;
      provider?: string;
      windowTokens?: number;
      personalityId?: string;
    },
    requestId?: string,
  ): Promise<ContextReportGetResponseMessage["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "context.report.get.request",
        workspaceId: input.workspaceId,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(typeof input.windowTokens === "number" ? { windowTokens: input.windowTokens } : {}),
        ...(input.personalityId ? { personalityId: input.personalityId } : {}),
      },
      responseType: "context.report.get.response",
    });
  }

  /**
   * The assembled prompt, for reading. Takes the same what-if inputs as the
   * report so the text on screen always matches the numbers beside it.
   */
  async requestContextPromptPreview(
    input: {
      workspaceId: string;
      provider?: string;
      windowTokens?: number;
      personalityId?: string;
      /** Assemble only this section; omitted means the whole prompt. */
      category?: ContextCategory;
    },
    requestId?: string,
  ): Promise<ContextPromptPreviewGetResponseMessage["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "context.prompt.preview.get.request",
        workspaceId: input.workspaceId,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(typeof input.windowTokens === "number" ? { windowTokens: input.windowTokens } : {}),
        ...(input.personalityId ? { personalityId: input.personalityId } : {}),
        ...(input.category ? { category: input.category } : {}),
      },
      responseType: "context.prompt.preview.get.response",
    });
  }

  async listProjectKnowledge(
    workspaceId: string,
    requestId?: string,
  ): Promise<ProjectKnowledgeListResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.list.request", workspaceId },
    });
  }
  async getProjectKnowledge(
    input: { workspaceId: string; id: string },
    requestId?: string,
  ): Promise<ProjectKnowledgeGetResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.get.request", ...input },
    });
  }
  async createProjectKnowledge(
    input: {
      workspaceId: string;
      id?: string;
      kind:
        | "decision"
        | "constraint"
        | "requirement"
        | "architecture"
        | "finding"
        | "project"
        | "reference";
      title: string;
      statement: string;
      evidence?: string;
      tags?: string[];
      affects?: string[];
      status?: "proposed" | "confirmed" | "superseded";
      deliveryStatus?:
        | "charter"
        | "in_build"
        | "partial"
        | "blocked"
        | "complete"
        | "reference"
        | "deferred"
        | "cancelled";
      progress?: { completed: number; total: number; unit: string };
      referenceDisposition?: "unevaluated" | "read" | "adopted" | "rejected" | "dependency";
      sourceUrl?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeCreateResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.create.request", ...input },
    });
  }
  async applyProjectKnowledge(
    input: {
      workspaceId: string;
      id: string;
      title?: string;
      statement?: string;
      evidence?: string;
      provenanceText?: string;
      provenanceSource?: string;
      provenanceAffects?: string[];
      expectedUpdatedAt?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeApplyResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.apply.request", ...input },
    });
  }
  async setProjectKnowledgeStatus(
    input: {
      workspaceId: string;
      id: string;
      status: "proposed" | "confirmed" | "superseded";
      reason?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeStatusResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.status.request", ...input },
    });
  }
  async applyProjectKnowledgeProject(
    input: {
      workspaceId: string;
      id: string;
      deliveryStatus?:
        | "charter"
        | "in_build"
        | "partial"
        | "blocked"
        | "complete"
        | "reference"
        | "deferred"
        | "cancelled";
      progress?: { completed: number; total: number; unit: string } | null;
      reason: string;
      expectedUpdatedAt?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeProjectApplyResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.project.apply.request", ...input },
    });
  }
  async applyProjectKnowledgeReference(
    input: {
      workspaceId: string;
      id: string;
      disposition?: "unevaluated" | "read" | "adopted" | "rejected" | "dependency";
      sourceUrl?: string | null;
      reason: string;
      expectedUpdatedAt?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeReferenceApplyResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.reference.apply.request", ...input },
    });
  }
  async applyProjectKnowledgeRoot(
    input: { workspaceId: string; slug: string; body: string },
    requestId?: string,
  ): Promise<ProjectKnowledgeRootApplyResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.root.apply.request", ...input },
    });
  }
  async deleteProjectKnowledge(
    input: {
      workspaceId: string;
      id: string;
      reason: string;
      expectedUpdatedAt?: string;
    },
    requestId?: string,
  ): Promise<ProjectKnowledgeDeleteResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "project.knowledge.delete.request", ...input },
    });
  }

  // ============================================================================
  // Personality memory
  // ============================================================================

  /**
   * A personality's accrued lessons plus the EXACT brief the daemon would inject
   * for `projectRoot`. The brief is returned rather than rebuilt client-side
   * because memory is only trustworthy if what you are shown is what is sent.
   */
  async listPersonalityMemory(
    input: { personalityId: string; workspaceId?: string; projectRoot?: string },
    requestId?: string,
  ): Promise<PersonalityMemoryListResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "personality.memory.list.request",
        personalityId: input.personalityId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      },
    });
  }

  /**
   * Add (no `entryId`), edit, or forget (`drop`) one lesson.
   *
   * Pass `workspaceId` whenever the write may be project-scoped: the daemon
   * binds the entry to the repo root that workspace resolves to, and an entry
   * scoped to "project" with no root is filtered out of every brief - stored,
   * listed, and never sent.
   */
  async updatePersonalityMemory(
    input: {
      personalityId: string;
      entryId?: string;
      text?: string;
      scope?: string;
      workspaceId?: string;
      projectRoot?: string;
      drop?: boolean;
    },
    requestId?: string,
  ): Promise<PersonalityMemoryUpdateResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "personality.memory.update.request",
        personalityId: input.personalityId,
        ...(input.entryId ? { entryId: input.entryId } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.drop ? { drop: true } : {}),
      },
    });
  }

  /**
   * Resolve a deleted personality's lessons: move them to another personality or
   * discard them. Called BEFORE the roster write, so a failure leaves both the
   * personality and its memory intact.
   */
  async transferPersonalityMemory(
    input: { fromPersonalityId: string; toPersonalityId?: string; mode: "transfer" | "delete" },
    requestId?: string,
  ): Promise<PersonalityMemoryTransferResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "personality.memory.transfer.request",
        fromPersonalityId: input.fromPersonalityId,
        ...(input.toPersonalityId ? { toPersonalityId: input.toPersonalityId } : {}),
        mode: input.mode,
      },
    });
  }

  /** Per-personality lesson counts, for the accrual indicator and the selector. */
  async getPersonalityMemoryStats(
    requestId?: string,
  ): Promise<PersonalityMemoryStatsResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "personality.memory.stats.request" },
    });
  }

  /** Rewrites one reference between "always loaded" and "link only". */
  async requestContextEdgeConvert(
    input: {
      workspaceId: string;
      filePath: string;
      rawTarget: string;
      range: { start: number; end: number };
      target: "import" | "reference";
    },
    requestId?: string,
  ): Promise<ContextEdgeConvertResponseMessage["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "context.edge.convert.request",
        workspaceId: input.workspaceId,
        filePath: input.filePath,
        rawTarget: input.rawTarget,
        range: input.range,
        target: input.target,
      },
      responseType: "context.edge.convert.response",
    });
  }

  /** Deletes every mechanically-fixable finding's range in one pass. */
  async requestContextFindingsFix(
    input: {
      workspaceId: string;
      findings: Array<{
        filePath: string;
        range: { start: number; end: number };
        snippet: string;
      }>;
    },
    requestId?: string,
  ): Promise<ContextFindingsFixResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"context.findings.fix.response">({
      requestId,
      message: {
        type: "context.findings.fix.request",
        workspaceId: input.workspaceId,
        findings: input.findings,
      },
    });
  }

  // ============================================================================
  // Provider Models / Commands
  // ============================================================================

  async listProviderModels(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<ListProviderModelsPayload> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "list_provider_models_request",
        provider,
        cwd: options?.cwd,
      },
      responseType: "list_provider_models_response",
      // Provider SDK cold starts (especially model discovery) can exceed 60s.
      timeout: 90000,
    });
    return normalizeListProviderModelsPayload(payload);
  }

  async listProviderModes(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<ListProviderModesPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "list_provider_modes_request",
        provider,
        cwd: options?.cwd,
      },
      responseType: "list_provider_modes_response",
      timeout: 90000,
    });
  }

  async listProviderFeatures(
    draftConfig: ListCommandsDraftConfig,
    options?: { requestId?: string },
  ): Promise<ListProviderFeaturesPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "list_provider_features_request",
        draftConfig,
      },
      responseType: "list_provider_features_response",
      timeout: 90000,
    });
  }

  async listAvailableProviders(options?: {
    requestId?: string;
  }): Promise<ListAvailableProvidersPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "list_available_providers_request",
      },
      responseType: "list_available_providers_response",
    });
  }

  async getProvidersSnapshot(options?: {
    cwd?: string;
    ifNoneMatch?: string;
    requestId?: string;
  }): Promise<GetProvidersSnapshotPayload> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "get_providers_snapshot_request",
        cwd: options?.cwd,
        ifNoneMatch: options?.ifNoneMatch,
      },
      responseType: "get_providers_snapshot_response",
    });
    return normalizeProvidersSnapshotPayload(payload);
  }

  async getDaemonConfig(
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "get_daemon_config_request",
      },
      responseType: "get_daemon_config_response",
    });
  }

  async getDaemonStatus(options?: DaemonStatusOptions): Promise<DaemonStatusPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "daemon.get_status.request",
      },
      responseType: "daemon.get_status.response",
      timeout: options?.timeout,
    });
  }

  async getDaemonPairingOffer(
    options?: DaemonPairingOfferOptions,
  ): Promise<DaemonPairingOfferPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "daemon.get_pairing_offer.request",
      },
      responseType: "daemon.get_pairing_offer.response",
      timeout: options?.timeout,
    });
  }

  async collectDiagnostics(requestId?: string): Promise<DiagnosticsPayload> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "diagnostics.request",
      },
    });
  }

  async patchDaemonConfig(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "set_daemon_config_request",
        config,
      },
      responseType: "set_daemon_config_response",
    });
  }

  // Enumerate a connector's tools live (connect + listTools), each flagged with
  // its configured disabled state. Registry edits (add/enable/disable a
  // connector or a tool) go through patchDaemonConfig's `connectors` instead.
  async connectorsListTools(
    connectorId: string,
    requestId?: string,
  ): Promise<ConnectorsListToolsResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "connectors.list_tools.request",
        connectorId,
      },
      responseType: "connectors.list_tools.response",
    });
  }

  /**
   * Start a connector's OAuth login. Resolves with the URL to open, or with
   * status "authorized" when the daemon already held a usable token. The login
   * itself settles later on the `connectors.oauth.status` push, because the user
   * is in a browser by then.
   */
  async connectorsOauthAuthorize(
    connectorId: string,
    scope?: string,
    requestId?: string,
  ): Promise<ConnectorsOauthAuthorizeResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "connectors.oauth.authorize.request",
        connectorId,
        ...(scope ? { scope } : {}),
      },
      responseType: "connectors.oauth.authorize.response",
    });
  }

  /** Drop a connector's stored authorization. */
  async connectorsOauthDisconnect(
    connectorId: string,
    requestId?: string,
  ): Promise<ConnectorsOauthDisconnectResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "connectors.oauth.disconnect.request",
        connectorId,
      },
      responseType: "connectors.oauth.disconnect.response",
    });
  }

  /**
   * Read the daemon-owned, provider-neutral communications inbox projection.
   * Requires server_info.features.communications; callers own that one gate.
   */
  async communicationsGetOverview(
    requestId?: string,
  ): Promise<CommunicationsGetOverviewResponse["payload"]["overview"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.get_overview.request" },
      responseType: "communications.get_overview.response",
    });
    return payload.overview;
  }

  async communicationsInboxGetHome(
    providerId: string,
    requestId?: string,
  ): Promise<CommunicationsInboxGetHomeResponse["payload"]["home"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.get_home.request", providerId },
      responseType: "communications.inbox.get_home.response",
    });
    return payload.home;
  }

  async communicationsInboxAcknowledgeNotifications(
    input: {
      providerId: string;
      notificationIds?: string[];
      conversationId?: string;
      clearAll?: boolean;
    },
    requestId?: string,
  ): Promise<CommunicationsInboxNotificationsAcknowledgeResponse["payload"]["home"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.notifications.acknowledge.request", ...input },
      responseType: "communications.inbox.notifications.acknowledge.response",
    });
    return payload.home;
  }

  async communicationsInboxSearch(
    input: { providerId: string; query: string },
    requestId?: string,
  ): Promise<CommunicationsInboxSearchResponse["payload"]["results"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.search.request", ...input },
      responseType: "communications.inbox.search.response",
    });
    return payload.results;
  }

  async communicationsInboxSetFavorite(
    input: { providerId: string; conversationId: string; favorite: boolean },
    requestId?: string,
  ): Promise<CommunicationsInboxSetFavoriteResponse["payload"]["home"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.set_favorite.request", ...input },
      responseType: "communications.inbox.set_favorite.response",
    });
    return payload.home;
  }

  async communicationsInboxGetPresence(
    providerId: string,
    requestId?: string,
  ): Promise<CommunicationsInboxGetPresenceResponse["payload"]["presence"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.get_presence.request", providerId },
      responseType: "communications.inbox.get_presence.response",
    });
    return payload.presence;
  }

  async communicationsInboxSetPresence(
    input: {
      providerId: string;
      status: "available" | "busy" | "do_not_disturb" | "away" | "out_of_office" | "unknown";
    },
    requestId?: string,
  ): Promise<CommunicationsInboxSetPresenceResponse["payload"]["presence"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.set_presence.request", ...input },
      responseType: "communications.inbox.set_presence.response",
    });
    return payload.presence;
  }

  async communicationsInboxSetEnabled(
    input: { providerId: string; enabled: boolean },
    requestId?: string,
  ): Promise<CommunicationsInboxSetEnabledResponse["payload"]["presence"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.set_enabled.request", ...input },
      responseType: "communications.inbox.set_enabled.response",
    });
    return payload.presence;
  }

  async communicationsInboxGetMessages(
    input: { providerId: string; conversationId: string },
    requestId?: string,
  ): Promise<CommunicationsInboxGetMessagesResponse["payload"]["messages"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.get_messages.request", ...input },
      responseType: "communications.inbox.get_messages.response",
    });
    return payload.messages;
  }

  async communicationsInboxSendMessage(
    input: { providerId: string; conversationId: string; text: string },
    requestId?: string,
  ): Promise<CommunicationsInboxSendMessageResponse["payload"]["message"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.inbox.send_message.request", ...input },
      responseType: "communications.inbox.send_message.response",
    });
    return payload.message;
  }

  /** Requires server_info.features.communicationsRooms. */
  async communicationsRoomGet(
    input: { providerId: string; conversationId: string },
    requestId?: string,
  ): Promise<CommunicationsRoomGetResponse["payload"]["room"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.room.get.request", ...input },
      responseType: "communications.room.get.response",
    });
    return payload.room;
  }

  async communicationsRoomThreadGet(
    input: { providerId: string; conversationId: string; parentMessageId: string },
    requestId?: string,
  ): Promise<CommunicationsRoomThreadGetResponse["payload"]["messages"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.room.thread.get.request", ...input },
      responseType: "communications.room.thread.get.response",
    });
    return payload.messages;
  }

  async communicationsRoomMessageSend(
    input: {
      providerId: string;
      conversationId: string;
      text: string;
      parentMessageId?: string | null;
    },
    requestId?: string,
  ): Promise<CommunicationsRoomMessageSendResponse["payload"]["message"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.room.message.send.request", ...input },
      responseType: "communications.room.message.send.response",
    });
    return payload.message;
  }

  async communicationsRoomReactionSet(
    input: {
      providerId: string;
      conversationId: string;
      messageId: string;
      emoji: string;
      active: boolean;
    },
    requestId?: string,
  ): Promise<CommunicationsRoomReactionSetResponse["payload"]["message"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "communications.room.reaction.set.request", ...input },
      responseType: "communications.room.reaction.set.response",
    });
    return payload.message;
  }

  /**
   * Daemon-owned meeting transcript library. Requires
   * `server_info.features.meetingTranscripts`; callers own that capability gate.
   */
  async meetingsTranscriptsList(
    requestId?: string,
  ): Promise<
    Extract<
      SessionOutboundMessage,
      { type: "meetings.transcripts.list.response" }
    >["payload"]["records"]
  > {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "meetings.transcripts.list.request" },
      responseType: "meetings.transcripts.list.response",
    });
    return payload.records;
  }

  async meetingsTranscriptsCreate(
    input: { provider: string; title: string; content: string; occurredAt?: string },
    requestId?: string,
  ): Promise<
    Extract<
      SessionOutboundMessage,
      { type: "meetings.transcripts.create.response" }
    >["payload"]["record"]
  > {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "meetings.transcripts.create.request", ...input },
      responseType: "meetings.transcripts.create.response",
    });
    return payload.record;
  }

  async meetingsTranscriptsUpdate(
    input: { id: string; title?: string; content?: string },
    requestId?: string,
  ): Promise<
    Extract<
      SessionOutboundMessage,
      { type: "meetings.transcripts.update.response" }
    >["payload"]["record"]
  > {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "meetings.transcripts.update.request", ...input },
      responseType: "meetings.transcripts.update.response",
    });
    return payload.record;
  }

  async meetingsTranscriptsDelete(id: string, requestId?: string): Promise<boolean> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "meetings.transcripts.delete.request", id },
      responseType: "meetings.transcripts.delete.response",
    });
    return payload.deleted;
  }

  /**
   * Read daemon-owned connection metadata for reusable integration settings.
   * Requires server_info.features.integrationAuthorization; callers own that
   * one capability gate.
   */
  async integrationsAuthorizationGetOverview(
    requestId?: string,
  ): Promise<IntegrationsAuthorizationGetOverviewResponse["payload"]["overview"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "integrations.authorization.get_overview.request" },
      responseType: "integrations.authorization.get_overview.response",
    });
    return payload.overview;
  }

  /**
   * List the daemon's nonsecret authorization choices for an integration.
   * Requires server_info.features.integrationAuthorization; callers own that
   * one capability gate.
   */
  async integrationsAuthorizationGetMethods(
    integrationId?: string,
    requestId?: string,
  ): Promise<IntegrationsAuthorizationGetMethodsResponse["payload"]["methods"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "integrations.authorization.get_methods.request",
        ...(integrationId ? { integrationId } : {}),
      },
      responseType: "integrations.authorization.get_methods.response",
    });
    return payload.methods;
  }

  /**
   * Starts a daemon-owned browser sign-in through a registered integration
   * driver. Requires server_info.features.integrationAuthorizationBrowserFlow;
   * callers own that one capability gate.
   */
  async integrationsAuthorizationStartBrowser(
    input: { integrationId: string; connectionId: string },
    requestId?: string,
  ): Promise<IntegrationsAuthorizationStartBrowserResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "integrations.authorization.start_browser.request", ...input },
      responseType: "integrations.authorization.start_browser.response",
    });
  }

  /** Starts the daemon-owned Zoom Team Chat browser sign-in. */
  async integrationsZoomStartAuthorization(
    requestId?: string,
  ): Promise<IntegrationsZoomStartAuthorizationResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "integrations.zoom.start_authorization.request" },
      responseType: "integrations.zoom.start_authorization.response",
    });
  }

  /**
   * The brain's status. Pass `resources` only from a surface that renders the
   * live CPU/RAM/GPU numbers: it costs an `nvidia-smi` spawn on the brain, and
   * this call is also the liveness poll.
   */
  async brainHostStatus(
    options?: { resources?: boolean },
    requestId?: string,
  ): Promise<BrainHostStatus> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.host.status.request",
        resources: options?.resources ?? false,
      },
      responseType: "brain.host.status.response",
    });
    return payload.status;
  }

  async brainHostStart(model?: string | null, requestId?: string): Promise<BrainHostStatus> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.host.start.request",
        model: model ?? null,
      },
      responseType: "brain.host.start.response",
    });
    return payload.status;
  }

  async brainHostStop(requestId?: string): Promise<BrainHostStatus> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.host.stop.request",
      },
      responseType: "brain.host.stop.response",
    });
    return payload.status;
  }

  async brainHostRestart(model?: string | null, requestId?: string): Promise<BrainHostStatus> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.host.restart.request",
        model: model ?? null,
      },
      responseType: "brain.host.restart.response",
    });
    return payload.status;
  }

  async brainEvalsGet(requestId?: string): Promise<BrainEvals | null> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.evals.get.request",
      },
      responseType: "brain.evals.get.response",
    });
    return payload.evals;
  }

  async brainRemoteConfigGet(requestId?: string): Promise<BrainRemoteConfig | null> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.remote.config.get.request",
      },
      responseType: "brain.remote.config.get.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.config;
  }

  async brainRemoteConfigPatch(
    patch: BrainRemoteConfig,
    requestId?: string,
  ): Promise<BrainRemoteConfig | null> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.remote.config.patch.request",
        patch,
      },
      responseType: "brain.remote.config.patch.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.config;
  }

  async brainModelsList(requestId?: string): Promise<string[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.models.list.request",
      },
      responseType: "brain.models.list.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.models;
  }

  async brainNetworkDiscover(requestId?: string): Promise<BrainNetworkInfo | null> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.network.discover.request",
      },
      responseType: "brain.network.discover.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.info;
  }

  async brainModelsScan(requestId?: string): Promise<BrainInstalledModel[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.models.scan.request" },
      responseType: "brain.models.scan.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.models;
  }

  async brainCatalogList(requestId?: string): Promise<BrainCatalogModel[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.catalog.list.request" },
      responseType: "brain.catalog.list.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.models;
  }

  async brainRuntimeList(requestId?: string): Promise<BrainRuntime[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.runtime.list.request" },
      responseType: "brain.runtime.list.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.runtimes;
  }

  async brainModelsPull(
    model: string,
    componentsOrRequestId?: string[] | string,
    quantOrRequestId?: string,
    expectedBytes?: number,
  ): Promise<BrainJob> {
    const components = Array.isArray(componentsOrRequestId) ? componentsOrRequestId : undefined;
    const quant = Array.isArray(componentsOrRequestId) ? quantOrRequestId : undefined;
    const correlationId =
      typeof componentsOrRequestId === "string" ? componentsOrRequestId : undefined;
    const payload = await this.sendCorrelatedSessionRequest({
      requestId: correlationId,
      message: {
        type: "brain.models.pull.request",
        model,
        ...(components ? { components } : {}),
        ...(quant ? { quant } : {}),
        ...(expectedBytes !== undefined ? { expectedBytes } : {}),
      },
      responseType: "brain.models.pull.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainHfSearch(
    query: string,
    limit?: number | null,
    requestId?: string,
  ): Promise<BrainHfSearchResult[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.hf.search.request", query, limit: limit ?? null },
      responseType: "brain.hf.search.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.results;
  }

  async brainHfQuants(repo: string, requestId?: string): Promise<BrainRepoQuant[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.hf.quants.request", repo },
      responseType: "brain.hf.quants.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.quants;
  }

  async brainModelsAdd(
    repo: string,
    quant: string,
    components?: string[],
    requestId?: string,
    expectedBytes?: number,
  ): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "brain.models.add.request",
        repo,
        quant,
        components,
        ...(expectedBytes !== undefined ? { expectedBytes } : {}),
      },
      responseType: "brain.models.add.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainRuntimeInstall(build?: string | null, requestId?: string): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.runtime.install.request", build: build ?? null },
      responseType: "brain.runtime.install.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainRuntimeRemove(name: string, requestId?: string): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.runtime.remove.request", name },
      responseType: "brain.runtime.remove.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainCalibrate(model: string, requestId?: string): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.calibrate.request", model },
      responseType: "brain.calibrate.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainSweep(model: string, requestId?: string): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.sweep.request", model },
      responseType: "brain.sweep.response",
    });
    return unwrapBrainJob(payload);
  }

  async brainBench(model?: string | null, requestId?: string): Promise<BrainJob> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.bench.request", model: model ?? null },
      responseType: "brain.bench.response",
    });
    return unwrapBrainJob(payload);
  }

  async createFileEntry(input: {
    cwd: string;
    parentPath: string;
    name: string;
    kind: "file" | "directory";
  }): Promise<CorrelatedResponsePayload<"fs.entry.create.response">> {
    return this.sendNamespacedCorrelatedSessionRequest<"fs.entry.create.response">({
      message: { type: "fs.entry.create.request", ...input },
    });
  }

  async renameFileEntry(input: {
    cwd: string;
    path: string;
    name: string;
  }): Promise<CorrelatedResponsePayload<"fs.entry.rename.response">> {
    return this.sendNamespacedCorrelatedSessionRequest<"fs.entry.rename.response">({
      message: { type: "fs.entry.rename.request", ...input },
    });
  }

  async duplicateFileEntry(input: {
    cwd: string;
    path: string;
  }): Promise<CorrelatedResponsePayload<"fs.entry.duplicate.response">> {
    return this.sendNamespacedCorrelatedSessionRequest<"fs.entry.duplicate.response">({
      message: { type: "fs.entry.duplicate.request", ...input },
    });
  }

  async deleteFileEntry(input: {
    cwd: string;
    path: string;
  }): Promise<CorrelatedResponsePayload<"fs.entry.delete.response">> {
    return this.sendNamespacedCorrelatedSessionRequest<"fs.entry.delete.response">({
      message: { type: "fs.entry.delete.request", ...input },
    });
  }

  async checkoutDiscardChanges(
    cwd: string,
    input: { paths: string[] },
  ): Promise<CorrelatedResponsePayload<"checkout.discard_changes.response">> {
    return this.sendNamespacedCorrelatedSessionRequest<"checkout.discard_changes.response">({
      message: { type: "checkout.discard_changes.request", cwd, paths: input.paths },
    });
  }

  async brainJobsList(requestId?: string): Promise<BrainJob[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.jobs.list.request" },
      responseType: "brain.jobs.list.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.jobs;
  }

  async brainJobsCancel(jobId: string, requestId?: string): Promise<BrainJob[]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.jobs.cancel.request", jobId },
      responseType: "brain.jobs.cancel.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.jobs;
  }

  // --- Brain Console --------------------------------------------------------
  // These proxy the brain's own /__host/* management API and work against a
  // local or a remote brain identically. Gated by features.brainConsole on the
  // daemon, and by `capabilities` on brain.host.status for the brain itself.
  // Each throws the brain's own message on failure, because "could not delete
  // the model" with no reason is not a usable error.

  /**
   * The joined model inventory: scan row, GGUF metadata, saved profile,
   * calibration state, VRAM budget and benchmark score per model, plus disk
   * usage. One call feeds the whole Models tab.
   */
  async brainModelsInventory(
    requestId?: string,
  ): Promise<{ models: BrainInventoryModel[]; disk: BrainDiskUsage | null }> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.models.inventory.request" },
      responseType: "brain.models.inventory.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return { models: payload.models, disk: payload.disk };
  }

  /** One model's saved profile, the field descriptors, and its warnings. */
  async brainModelProfileGet(
    modelId: string,
    requestId?: string,
  ): Promise<BrainModelProfileGetResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.profile.get.request", modelId },
      responseType: "brain.model.profile.get.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /**
   * Write the editable profile fields. The reply carries the recomputed budget,
   * so an edit costs one round trip rather than a write the UI has to follow
   * with a read.
   */
  async brainModelProfileSet(
    modelId: string,
    patch: Record<string, unknown>,
    requestId?: string,
  ): Promise<BrainModelProfileSetResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.profile.set.request", modelId, patch },
      responseType: "brain.model.profile.set.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /**
   * The VRAM budget for a hypothetical profile. `overrides` are string-encoded
   * field values, so the UI can preview the budget while a control is mid-drag
   * without persisting a value the user is scrubbing past.
   */
  async brainModelBudget(
    modelId: string,
    overrides?: Record<string, string>,
    requestId?: string,
  ): Promise<BrainModelBudgetGetResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.budget.get.request", modelId, overrides: overrides ?? {} },
      responseType: "brain.model.budget.get.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /**
   * Load a model into the running brain. This is not `brainHostStart`, which
   * restarts the daemon's child process and has no remote equivalent.
   */
  async brainModelLoad(
    modelId: string,
    requestId?: string,
  ): Promise<BrainModelLoadResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.load.request", modelId },
      responseType: "brain.model.load.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /** Unload the resident model, leaving the brain up and serving nothing. */
  async brainModelUnload(requestId?: string): Promise<BrainHostStatus | null> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.unload.request" },
      responseType: "brain.model.unload.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.status;
  }
  async getProjectIcon(
    projectId: string,
    requestId?: string,
  ): Promise<ProjectIconGetResponse["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest<"project.icon.get.response">({
      requestId,
      message: { type: "project.icon.get.request", projectId },
    });
  }

  // ============================================================================
  // Provider Models / Commands
  // ============================================================================

  /** Delete a model's files. The brain refuses while that model is loaded. */
  async brainModelDelete(
    modelId: string,
    requestId?: string,
  ): Promise<BrainModelDeleteResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.delete.request", modelId },
      responseType: "brain.model.delete.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  async brainModelComponentDelete(modelId: string, componentId: string, requestId?: string) {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.component.delete.request", modelId, componentId },
      responseType: "brain.model.component.delete.response",
    });
    if (payload.error) throw new Error(payload.error);
    return payload;
  }

  /**
   * Rename a model's display name. The brain rejects a collision with
   * another model's current id/displayName.
   */
  async brainModelRename(
    modelId: string,
    displayName: string,
    requestId?: string,
  ): Promise<BrainModelRenameResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.rename.request", modelId, displayName },
      responseType: "brain.model.rename.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /** Reset a model's display name back to its scan-derived default. */
  async brainModelRenameReset(
    modelId: string,
    requestId?: string,
  ): Promise<BrainModelRenameResetResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.model.rename.reset.request", modelId },
      responseType: "brain.model.rename.reset.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /** Tail the brain's llama-server log. */
  async brainLogsTail(
    limit?: number | null,
    requestId?: string,
  ): Promise<BrainLogsTailResponse["payload"]> {
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.logs.tail.request", limit: limit ?? null },
      responseType: "brain.logs.tail.response",
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }

  /**
   * Turn the live Brain log feed on or off for this socket.
   *
   * Only meaningful against a daemon advertising `features.brainLogWatch`; older
   * daemons push every line regardless, and the request would go unrouted.
   * Watching is per socket, so this does not affect the same account's other
   * connected clients.
   */
  async brainLogsWatch(
    watching: boolean,
    requestId?: string,
  ): Promise<BrainLogsWatchResponse["payload"]> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "brain.logs.watch.request", watching },
      responseType: "brain.logs.watch.response",
    });
  }

  async getSpeechSettingsOptions(
    requestId?: string,
  ): Promise<{ requestId: string; options: SpeechSettingsOptions }> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "speech.settings.get_options.request",
      },
    });
  }

  // Synthesize a short sample with the given voice for the preview button. The
  // voice binding is soft (host default when unavailable); an empty/failed
  // synthesis comes back as `error` in the payload rather than rejecting.
  async previewTtsVoice(
    params: { text: string; voice?: { provider?: string; model?: string; name: string } },
    requestId?: string,
  ): Promise<SpeechTtsPreviewResult> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "speech.tts.preview.request",
        text: params.text,
        ...(params.voice ? { voice: params.voice } : {}),
      },
    });
  }

  // Stream a full message aloud on demand (per-message playback button). Audio
  // arrives as `audio_output` chunks the session already plays; this promise
  // resolves when playback finishes, is canceled, or errors. `voice` is the
  // speaking agent's personality voice (resolved on the client).
  async speakMessage(
    params: { text: string; voice?: { provider?: string; model?: string; name: string } },
    requestId?: string,
  ): Promise<SpeechTtsSpeakResult> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "speech.tts.speak.request",
        text: params.text,
        ...(params.voice ? { voice: params.voice } : {}),
      },
    });
  }

  // Stop the in-flight message playback started by speakMessage.
  async cancelSpeakMessage(requestId?: string): Promise<SpeechTtsSpeakCancelResult> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: { type: "speech.tts.speak.cancel.request" },
    });
  }

  // Author short spoken cue lines (join / thinking / done) for a persona,
  // described inline (name + prompt) so it works for an unsaved editor draft.
  // Routed through the Writer chain; the caller stores the result on the
  // personality's `voiceCues`.
  async generateVisualizerVoiceCues(
    params: {
      name: string;
      prompt?: string;
      cwd?: string;
      // Persona roles (e.g. "researcher", "coder") to flavor the lines.
      roles?: string[];
      // One CUE_MOMENTS moment to author just that group (the editor fans out
      // one request per moment for progress + distinctness).
      moment?: CueMoment;
    },
    requestId?: string,
  ): Promise<VisualizerVoiceCuesResult> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "visualizer.voiceCues.generate.request",
        name: params.name,
        ...(params.prompt ? { prompt: params.prompt } : {}),
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(params.roles && params.roles.length > 0 ? { roles: params.roles } : {}),
        ...(params.moment ? { moment: params.moment } : {}),
      },
      // The daemon spawns a structured-generation agent for this; provider SDK
      // cold starts can blow well past the 60s default.
      timeout: 180000,
    });
  }

  async getPersonalityStats(
    requestId?: string,
  ): Promise<{ requestId: string; stats: Record<string, number> }> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "agentPersonalities.get_stats.request",
      },
    });
  }

  // Author a personality profile (the prose personality prompt) from a draft's
  // name, roles, and spinner colors. Routed through the Writer chain; the caller
  // drops the result into the editor's prompt field.
  async generatePersonalityProfile(
    params: {
      name: string;
      roles?: string[];
      glowA?: string;
      glowB?: string;
      cwd?: string;
    },
    requestId?: string,
  ): Promise<AgentPersonalitiesGenerateProfileResult> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId,
      message: {
        type: "agentPersonalities.generate_profile.request",
        name: params.name,
        ...(params.roles && params.roles.length > 0 ? { roles: params.roles } : {}),
        ...(params.glowA ? { glowA: params.glowA } : {}),
        ...(params.glowB ? { glowB: params.glowB } : {}),
        ...(params.cwd ? { cwd: params.cwd } : {}),
      },
      // Same reason as the voice cues: the daemon spawns a structured-generation
      // agent, and provider SDK cold starts blow past the 60s default.
      timeout: 180000,
    });
  }

  sendBrowserAutomationExecuteResponse(response: BrowserAutomationExecuteResponse): void {
    this.sendSessionMessageStrict(response);
  }

  async readProjectConfig(repoRoot: string, requestId?: string): Promise<ReadProjectConfigPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "read_project_config_request",
        repoRoot,
      },
      responseType: "read_project_config_response",
    });
  }

  async writeProjectConfig(input: WriteProjectConfigInput): Promise<WriteProjectConfigPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: input.requestId,
      message: {
        type: "write_project_config_request",
        repoRoot: input.repoRoot,
        config: input.config,
        expectedRevision: input.expectedRevision,
      },
      responseType: "write_project_config_response",
    });
  }

  async refreshProvidersSnapshot(options?: {
    cwd?: string;
    providers?: AgentProvider[];
    requestId?: string;
  }): Promise<RefreshProvidersSnapshotPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "refresh_providers_snapshot_request",
        cwd: options?.cwd,
        providers: options?.providers,
      },
      responseType: "refresh_providers_snapshot_response",
      timeout: 120000,
    });
  }

  async getProviderDiagnostic(
    provider: AgentProvider,
    options?: { requestId?: string },
  ): Promise<ProviderDiagnosticPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "provider_diagnostic_request",
        provider,
      },
      responseType: "provider_diagnostic_response",
      timeout: 180000,
    });
  }

  async listProviderUsage(options?: { requestId?: string }): Promise<ProviderUsageListPayload> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "provider.usage.list.request",
      },
    });
  }

  /** Daemon-wide "fun stats" - see docs/data-model.md ActivityStatsStore. */
  async getActivityStats(options?: {
    requestId?: string;
  }): Promise<StatsActivityGetResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "stats.activity.get.request",
      },
    });
  }

  /** Wipe all usage counters AND the itemized ledger back to zero (Metrics "Reset"). */
  async resetActivityStats(options?: {
    requestId?: string;
  }): Promise<StatsActivityResetResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "stats.activity.reset.request",
      },
    });
  }

  /** Itemized usage ledger - the scrollable rows behind the stats tiles (usage-ledger). */
  async getUsageLog(options?: {
    limit?: number;
    before?: number;
    requestId?: string;
  }): Promise<UsageLogGetResponseMessage["payload"]> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "usage.log.get.request",
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.before !== undefined ? { before: options.before } : {}),
      },
    });
  }

  async getAgentContextUsage(
    agentId: string,
    options?: { requestId?: string },
  ): Promise<AgentContextGetUsagePayload> {
    return this.sendNamespacedCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "agent.context.get_usage.request",
        agentId,
      },
    });
  }

  async listCommands(options: ListCommandsOptions): Promise<ListCommandsPayload>;
  async listCommands(agentId: string, requestId?: string): Promise<ListCommandsPayload>;
  async listCommands(
    agentId: string,
    options?: LegacyListCommandsOptions,
  ): Promise<ListCommandsPayload>;
  async listCommands(
    input: ListCommandsOptions | string,
    legacyOptions?: LegacyListCommandsOptions | string,
  ): Promise<ListCommandsPayload> {
    const options = normalizeListCommandsOptions(input, legacyOptions);
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "list_commands_request",
        agentId: options.agentId,
        ...(options.draftConfig ? { draftConfig: options.draftConfig } : {}),
      },
      responseType: "list_commands_response",
    });
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    this.sendSessionMessage({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
  }

  async respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    timeout = 15000,
  ): Promise<AgentPermissionResolvedPayload> {
    const message = SessionInboundMessageSchema.parse({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
    return this.sendRequest({
      requestId,
      message,
      timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent_permission_resolved") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        if (msg.payload.agentId !== agentId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  // ============================================================================
  // Waiting / Streaming Helpers
  // ============================================================================

  async waitForAgentUpsert(
    agentId: string,
    predicate: (snapshot: AgentSnapshotPayload) => boolean,
    timeout = 60000,
  ): Promise<AgentSnapshotPayload> {
    const deadline = Date.now() + timeout;
    const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());
    const timeoutError = () => new Error(`Timed out waiting for agent ${agentId}`);
    const fetchAgentWithinDeadline = () =>
      this.fetchAgent({ agentId, timeout: remainingTimeoutMs() }).catch(() => null);

    const initialResult = await fetchAgentWithinDeadline();
    if (initialResult && predicate(initialResult.agent)) {
      return initialResult.agent;
    }
    if (Date.now() >= deadline) {
      throw timeoutError();
    }

    return await new Promise<AgentSnapshotPayload>((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;

      const finish = (
        result: { kind: "ok"; snapshot: AgentSnapshotPayload } | { kind: "error"; error: Error },
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (result.kind === "ok") {
          resolve(result.snapshot);
          return;
        }
        reject(result.error);
      };

      const maybeResolve = (snapshot: AgentSnapshotPayload | null) => {
        if (!snapshot) {
          return false;
        }
        if (!predicate(snapshot)) {
          return false;
        }
        finish({ kind: "ok", snapshot });
        return true;
      };

      const poll = async () => {
        if (settled || pollInFlight) {
          return;
        }
        pollInFlight = true;
        try {
          const result = await fetchAgentWithinDeadline();
          maybeResolve(result?.agent ?? null);
        } finally {
          pollInFlight = false;
        }
      };

      unsubscribe = this.on("agent_update", (message) => {
        if (settled) {
          return;
        }
        if (message.payload.kind !== "upsert") {
          return;
        }
        const snapshot = message.payload.agent;
        if (snapshot.id !== agentId) {
          return;
        }
        maybeResolve(snapshot);
      });

      const remaining = Math.max(1, deadline - Date.now());
      timeoutTimer = setTimeout(() => {
        finish({
          kind: "error",
          error: timeoutError(),
        });
      }, remaining);

      pollTimer = setInterval(() => {
        void poll();
      }, 250);
      void poll();
    });
  }

  async waitForFinish(agentId: string, timeout = 60000): Promise<WaitForFinishResult> {
    const requestId = this.createRequestId();
    const hasTimeout = Number.isFinite(timeout) && timeout > 0;
    const message = SessionInboundMessageSchema.parse({
      type: "wait_for_finish_request",
      requestId,
      agentId,
      ...(hasTimeout ? { timeoutMs: timeout } : {}),
    });
    const payload = await this.sendCorrelatedRequest({
      requestId,
      message,
      responseType: "wait_for_finish_response",
      timeout: hasTimeout ? timeout + 5000 : 0,
      options: { skipQueue: true },
    });
    return {
      status: payload.status,
      final: payload.final,
      error: payload.error,
      lastMessage: payload.lastMessage,
    };
  }

  // ============================================================================
  // Terminals
  // ============================================================================

  subscribeTerminals(input: { cwd: string; workspaceId?: string }): void {
    this.terminalDirectorySubscriptions.set(terminalSubscriptionKey(input.cwd, input.workspaceId), {
      cwd: input.cwd,
      workspaceId: input.workspaceId,
    });
    if (!this.transport || this.connectionState.status !== "connected") {
      return;
    }
    this.sendSessionMessage({
      type: "subscribe_terminals_request",
      cwd: input.cwd,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    });
  }

  unsubscribeTerminals(input: { cwd: string; workspaceId?: string }): void {
    this.terminalDirectorySubscriptions.delete(
      terminalSubscriptionKey(input.cwd, input.workspaceId),
    );
    if (!this.transport || this.connectionState.status !== "connected") {
      return;
    }
    this.sendSessionMessage({
      type: "unsubscribe_terminals_request",
      cwd: input.cwd,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    });
  }

  async listTerminals(
    cwd?: string,
    requestId?: string,
    options?: { workspaceId?: string },
  ): Promise<ListTerminalsPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "list_terminals_request",
      ...(cwd === undefined ? {} : { cwd }),
      ...(options?.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "list_terminals_response",
      options: { skipQueue: true },
    });
  }

  async createTerminal(
    cwd: string,
    name?: string,
    requestId?: string,
    options?: {
      agentId?: string;
      command?: string;
      args?: string[];
      workspaceId?: string;
      presentation?: "embedded";
      presentationOwner?: string;
    },
  ): Promise<CreateTerminalPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "create_terminal_request",
      cwd,
      name,
      agentId: options?.agentId,
      command: options?.command,
      args: options?.args,
      presentation: options?.presentation,
      presentationOwner: options?.presentationOwner,
      ...(options?.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "create_terminal_response",
      options: { skipQueue: true },
    });
  }

  async renameTerminal(input: RenameTerminalInput): Promise<RenameTerminalResult> {
    return this.sendCorrelatedSessionRequest({
      requestId: input.requestId,
      message: {
        type: "terminal.rename.request",
        terminalId: input.terminalId,
        title: input.title,
        ...(input.clear ? { clear: true } : {}),
      },
      responseType: "terminal.rename.response",
    });
  }

  async subscribeTerminal(
    terminalId: string,
    optionsOrRequestId?:
      | { restore?: SubscribeTerminalRequest["restore"]; requestId?: string }
      | string,
  ): Promise<SubscribeTerminalPayload> {
    const restore = typeof optionsOrRequestId === "object" ? optionsOrRequestId.restore : undefined;
    const requestId =
      typeof optionsOrRequestId === "object" ? optionsOrRequestId.requestId : optionsOrRequestId;
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "subscribe_terminal_request",
      terminalId,
      requestId: resolvedRequestId,
      ...(restore ? { restore } : {}),
    });
    const payload = await this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "subscribe_terminal_response",
      options: { skipQueue: true },
    });
    if (payload.error === null) {
      this.terminalStreams.setSlot(terminalId, payload.slot);
    }
    return payload;
  }

  unsubscribeTerminal(terminalId: string): void {
    this.terminalStreams.removeTerminal(terminalId);
    this.sendSessionMessage({
      type: "unsubscribe_terminal_request",
      terminalId,
    });
  }

  sendTerminalInput(terminalId: string, message: TerminalInput["message"]): void {
    const frame = this.terminalStreams.encodeInput(terminalId, message);
    if (frame) {
      this.sendBinaryFrame(frame);
      return;
    }
    this.sendSessionMessage({
      type: "terminal_input",
      terminalId,
      message,
    });
  }

  async killTerminal(terminalId: string, requestId?: string): Promise<KillTerminalPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "kill_terminal_request",
      terminalId,
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "kill_terminal_response",
      options: { skipQueue: true },
    });
  }

  async closeItems(
    input: { agentIds?: string[]; terminalIds?: string[] },
    requestId?: string,
  ): Promise<CloseItemsPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "close_items_request",
      agentIds: input.agentIds ?? [],
      terminalIds: input.terminalIds ?? [],
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "close_items_response",
      options: { skipQueue: true },
    });
  }

  async captureTerminal(
    terminalId: string,
    options?: { start?: number; end?: number; stripAnsi?: boolean },
    requestId?: string,
  ): Promise<CaptureTerminalPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "capture_terminal_request",
      terminalId,
      ...(options?.start === undefined ? {} : { start: options.start }),
      ...(options?.end === undefined ? {} : { end: options.end }),
      ...(options?.stripAnsi === undefined ? {} : { stripAnsi: options.stripAnsi }),
      requestId: resolvedRequestId,
    });
    return this.sendCorrelatedRequest({
      requestId: resolvedRequestId,
      message,
      responseType: "capture_terminal_response",
      options: { skipQueue: true },
    });
  }

  async runTerminalCompatibilityDiagnostic(
    requestId?: string,
  ): Promise<TerminalCompatibilityDiagnosticPayload> {
    const resolvedRequestId = this.createRequestId(requestId);
    return this.sendCorrelatedSessionRequest({
      requestId: resolvedRequestId,
      message: {
        type: "terminal.compatibility.diagnostic.request",
      },
      responseType: "terminal.compatibility.diagnostic.response",
    });
  }

  async scheduleCreate(options: CreateScheduleOptions): Promise<ScheduleCreatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/create",
        prompt: options.prompt,
        cadence: options.cadence,
        target: options.target,
        ...(options.name ? { name: options.name } : {}),
        ...(typeof options.maxRuns === "number" ? { maxRuns: options.maxRuns } : {}),
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
        ...(typeof options.runOnCreate === "boolean" ? { runOnCreate: options.runOnCreate } : {}),
      },
      responseType: "schedule/create/response",
    });
  }

  async scheduleList(requestId?: string): Promise<ScheduleListPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: {
        type: "schedule/list",
      },
      responseType: "schedule/list/response",
    });
  }

  async scheduleInspect(options: InspectScheduleOptions): Promise<ScheduleInspectPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/inspect",
        scheduleId: options.id,
      },
      responseType: "schedule/inspect/response",
    });
  }

  async scheduleLogs(options: InspectScheduleOptions): Promise<ScheduleLogsPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/logs",
        scheduleId: options.id,
      },
      responseType: "schedule/logs/response",
    });
  }

  async schedulePause(options: InspectScheduleOptions): Promise<SchedulePausePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/pause",
        scheduleId: options.id,
      },
      responseType: "schedule/pause/response",
    });
  }

  async scheduleResume(options: InspectScheduleOptions): Promise<ScheduleResumePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/resume",
        scheduleId: options.id,
      },
      responseType: "schedule/resume/response",
    });
  }

  async scheduleDelete(options: InspectScheduleOptions): Promise<ScheduleDeletePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/delete",
        scheduleId: options.id,
      },
      responseType: "schedule/delete/response",
    });
  }

  async scheduleRunOnce(options: InspectScheduleOptions): Promise<ScheduleRunOncePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/run-once",
        scheduleId: options.id,
      },
      responseType: "schedule/run-once/response",
    });
  }

  async scheduleUpdate(options: UpdateScheduleOptions): Promise<ScheduleUpdatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "schedule/update",
        scheduleId: options.id,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
        ...(options.cadence !== undefined ? { cadence: options.cadence } : {}),
        ...(options.newAgentConfig !== undefined ? { newAgentConfig: options.newAgentConfig } : {}),
        ...(options.maxRuns !== undefined ? { maxRuns: options.maxRuns } : {}),
        ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
      },
      responseType: "schedule/update/response",
    });
  }

  async artifactList(options?: {
    projectId?: string;
    requestId?: string;
  }): Promise<ArtifactListPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "artifact.list.request",
        ...(options?.projectId ? { projectId: options.projectId } : {}),
      },
      responseType: "artifact.list.response",
    });
  }

  async artifactCreate(options: {
    name: string;
    description: string;
    projectId: string;
    provider: string;
    model?: string;
    modeId?: string;
    thinkingOptionId?: string;
    systemPrompt?: string;
    spinner?: { glowA: string; glowB: string };
    personalityName?: string;
    requestId?: string;
  }): Promise<ArtifactCreatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.create.request",
        name: options.name,
        description: options.description,
        projectId: options.projectId,
        provider: options.provider,
        ...(options.model ? { model: options.model } : {}),
        ...(options.modeId ? { modeId: options.modeId } : {}),
        ...(options.thinkingOptionId ? { thinkingOptionId: options.thinkingOptionId } : {}),
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.spinner ? { spinner: options.spinner } : {}),
        ...(options.personalityName ? { personalityName: options.personalityName } : {}),
      },
      responseType: "artifact.create.response",
    });
  }

  async artifactUpdate(options: {
    artifactId: string;
    name?: string;
    description?: string;
    projectId?: string;
    provider?: string;
    model?: string;
    thinkingOptionId?: string;
    requestId?: string;
  }): Promise<ArtifactUpdatePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.update.request",
        artifactId: options.artifactId,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
        ...(options.provider !== undefined ? { provider: options.provider } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.thinkingOptionId !== undefined
          ? { thinkingOptionId: options.thinkingOptionId }
          : {}),
      },
      responseType: "artifact.update.response",
    });
  }

  async artifactRegenerate(options: {
    artifactId: string;
    requestId?: string;
  }): Promise<ArtifactRegeneratePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.regenerate.request",
        artifactId: options.artifactId,
      },
      responseType: "artifact.regenerate.response",
    });
  }

  async artifactCancel(options: {
    artifactId: string;
    requestId?: string;
  }): Promise<ArtifactCancelPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.cancel.request",
        artifactId: options.artifactId,
      },
      responseType: "artifact.cancel.response",
    });
  }

  async artifactDelete(options: {
    artifactId: string;
    requestId?: string;
  }): Promise<ArtifactDeletePayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.delete.request",
        artifactId: options.artifactId,
      },
      responseType: "artifact.delete.response",
    });
  }

  async artifactStar(options: {
    artifactId: string;
    starred: boolean;
    requestId?: string;
  }): Promise<ArtifactStarPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.star.request",
        artifactId: options.artifactId,
        starred: options.starred,
      },
      responseType: "artifact.star.response",
    });
  }

  async artifactGetContent(options: {
    artifactId: string;
    requestId?: string;
  }): Promise<ArtifactGetContentPayload> {
    return this.sendCorrelatedSessionRequest({
      requestId: options.requestId,
      message: {
        type: "artifact.get-content.request",
        artifactId: options.artifactId,
      },
      responseType: "artifact.get-content.response",
    });
  }

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    return this.terminalStreams.onEvent(handler);
  }

  async waitForTerminalStreamEvent(
    predicate: (event: TerminalStreamEvent) => boolean,
    timeout = 5000,
  ): Promise<TerminalStreamEvent> {
    return new Promise<TerminalStreamEvent>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for terminal stream event (${timeout}ms)`));
      }, timeout);

      const unsubscribe = this.onTerminalStreamEvent((event) => {
        if (!predicate(event)) {
          return;
        }
        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve(event);
      });
    });
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private createRequestId(requestId?: string): string {
    return requestId ?? crypto.randomUUID();
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.lastServerInfoMessage;
  }

  /**
   * Session totals for inbound daemon traffic, including the main-thread time
   * spent handling it. Null when runtime metrics are disabled for this client.
   * Read by the app's resource monitor - the wire is a first-class suspect when
   * the UI thread degrades, so it has to be measurable rather than inferred.
   */
  getTrafficTotals(): DaemonClientTrafficTotals | null {
    return this.runtimeMetrics?.getTrafficTotals() ?? null;
  }

  getTrafficHotspots(limit?: number): DaemonClientTrafficHotspot[] {
    return this.runtimeMetrics?.getTrafficHotspots(limit) ?? [];
  }

  private resolveTransportUrlForAttempt(): string {
    return this.config.url;
  }

  private sendHelloMessage(): void {
    if (!this.transport) {
      this.scheduleReconnect({
        reason: "Transport unavailable before hello",
        event: "HELLO_TRANSPORT_MISSING",
        reasonCode: "transport_error",
      });
      return;
    }

    try {
      this.sendJsonMessage("hello", "hello", {
        type: "hello",
        clientId: this.config.clientId,
        clientType: this.config.clientType ?? "cli",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.customModeIcons]: true,
          [CLIENT_CAPS.reasoningMergeEnum]: true,
          [CLIENT_CAPS.terminalReflowableSnapshot]: true,
          [CLIENT_CAPS.providerSubagents]: true,
          // The daemon gates project.updated.notification on this (session.ts),
          // so dropping it silently kills cross-session project renames.
          [CLIENT_CAPS.projectUpdates]: true,
          [CLIENT_CAPS.communicationsPresenceUpdates]: true,
          [CLIENT_CAPS.compactProviderSnapshots]: true,
          ...this.config.capabilities,
        },
        ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send hello message";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "HELLO_SEND_FAILED",
        reasonCode: "transport_error",
      });
    }
  }

  private disposeTransport(code = 1001, reason = "Reconnecting"): void {
    this.stopLivenessHeartbeat();
    this.cleanupTransport();
    if (this.transport) {
      try {
        this.transport.close(code, reason);
      } catch {
        // no-op
      }
      this.transport = null;
    }
  }

  private cleanupTransport(): void {
    this.resetConnectTimeout();
    if (this.pendingGenericTransportErrorTimeout) {
      clearTimeout(this.pendingGenericTransportErrorTimeout);
      this.pendingGenericTransportErrorTimeout = null;
    }
    for (const cleanup of this.transportCleanup) {
      try {
        cleanup();
      } catch {
        // no-op
      }
    }
    this.transportCleanup = [];
  }

  private resetConnectTimeout(): void {
    if (!this.connectTimeout) {
      return;
    }
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  private handleTransportMessage(data: unknown): void {
    const rawData =
      data && typeof data === "object" && "data" in data ? (data as { data: unknown }).data : data;

    if (
      typeof Blob !== "undefined" &&
      rawData instanceof Blob &&
      typeof rawData.arrayBuffer === "function"
    ) {
      void rawData
        .arrayBuffer()
        .then((buffer) => {
          this.handleTransportMessage(buffer);
          return;
        })
        .catch(() => {
          // Ignore failed blob decoding and allow reconnect logic to recover.
        });
      return;
    }

    const rawBytes = asUint8Array(rawData);
    const isOpen = this.beginTraceSection(
      "otto.ws.frame.inbound",
      describeInboundTransportFrame(rawData, rawBytes),
    );
    try {
      if (rawBytes && this.tryHandleBinaryFrame(rawBytes)) {
        return;
      }
      const payload = decodeMessageData(rawData);
      if (!payload) {
        return;
      }
      this.handleJsonPayload(payload, rawBytes?.byteLength);
    } finally {
      this.endTraceSection(isOpen);
    }
  }

  private handleJsonPayload(payload: string, rawBytesLength: number | undefined): void {
    const bytes = rawBytesLength ?? payload.length;
    const startMs = perfNow();
    let parsedJson: unknown;
    const parseTraceOpen = this.beginTraceSection("otto.ws.json.parse", {
      size: String(bytes),
    });
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    } finally {
      this.endTraceSection(parseTraceOpen);
    }

    const parsed = validateWSOutboundMessage(parsedJson);
    if (!parsed.success) {
      const responseIdentity = extractCorrelatedResponseIdentity(parsedJson);
      const envelopeType =
        parsedJson != null &&
        typeof parsedJson === "object" &&
        "type" in parsedJson &&
        typeof parsedJson.type === "string"
          ? parsedJson.type
          : "unknown";
      const msgType = responseIdentity?.responseType ?? envelopeType;
      this.logger.warn({ msgType, error: parsed.error.message }, "Message validation failed");
      if (responseIdentity) {
        this.rejectWaitersForRequestId(
          responseIdentity.requestId,
          new DaemonProtocolError(responseIdentity),
        );
      }
      return;
    }

    this.consecutiveLivenessFailures = 0;

    if (parsed.data.type === "pong") {
      this.traceInstant("otto.ws.message.inbound", {
        envelopeType: "pong",
        messageType: "pong",
      });
      this.resolvePingProbe();
      this.runtimeMetrics?.recordMessage("pong", bytes, perfNow() - startMs);
      return;
    }

    this.traceInstant("otto.ws.message.inbound", {
      envelopeType: "session",
      messageType: parsed.data.message.type,
    });
    this.handleSessionMessage(parsed.data.message);
    const msgType = parsed.data.message.type;
    this.runtimeMetrics?.recordMessage(msgType, bytes, perfNow() - startMs);
    if (parsed.data.message.type === "agent_stream") {
      this.runtimeMetrics?.recordAgentStream(parsed.data.message.payload);
    }
  }

  private tryHandleBinaryFrame(rawBytes: Uint8Array): boolean {
    const fileFrame = decodeFileTransferFrame(rawBytes);
    if (fileFrame) {
      this.traceInstant("otto.ws.message.inbound", {
        envelopeType: "binary",
        messageType: "file",
        opcode: String(fileFrame.opcode),
      });
      this.consecutiveLivenessFailures = 0;
      this.handleFileTransferFrame(fileFrame);
      this.runtimeMetrics?.recordBinaryFrame("other", rawBytes.byteLength, 0);
      return true;
    }

    const frame = decodeTerminalStreamFrame(rawBytes);
    if (!frame) {
      return false;
    }
    this.traceInstant("otto.ws.message.inbound", {
      envelopeType: "binary",
      messageType: "terminal",
      opcode: String(frame.opcode),
    });
    this.consecutiveLivenessFailures = 0;
    const binaryStartMs = perfNow();
    this.terminalStreams.handleFrame(frame);
    let frameKind: "output" | "snapshot" | "other" = "other";
    if (frame.opcode === TerminalStreamOpcode.Output) {
      frameKind = "output";
    } else if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      frameKind = "snapshot";
    } else if (frame.opcode === TerminalStreamOpcode.Restore) {
      frameKind = "output";
    }
    this.runtimeMetrics?.recordBinaryFrame(
      frameKind,
      rawBytes.byteLength,
      perfNow() - binaryStartMs,
    );
    return true;
  }

  private handleFileTransferFrame(frame: FileTransferFrame): void {
    if (frame.opcode === FileTransferOpcode.FileBegin) {
      const pending = this.pendingBinaryFileReads.get(frame.requestId);
      if (!pending) {
        return;
      }
      this.activeBinaryFileTransfers.set(frame.requestId, {
        ...pending,
        mime: frame.metadata.mime,
        size: frame.metadata.size,
        encoding: frame.metadata.encoding,
        modifiedAt: frame.metadata.modifiedAt,
        chunks: [],
      });
      return;
    }

    const transfer = this.activeBinaryFileTransfers.get(frame.requestId);
    if (!transfer) {
      return;
    }

    if (frame.opcode === FileTransferOpcode.FileChunk) {
      transfer.chunks.push(frame.payload);
      return;
    }

    const bytes = concatByteChunks(transfer.chunks, transfer.size);
    this.activeBinaryFileTransfers.delete(frame.requestId);
    this.completedBinaryFileReads.set(frame.requestId, {
      bytes,
      mime: transfer.mime,
      size: transfer.size,
      path: transfer.path,
      kind: binaryFileKind(transfer.mime, transfer.encoding),
      modifiedAt: transfer.modifiedAt,
    });
    this.handleSessionMessage({
      type: "file_explorer_response",
      payload: {
        cwd: transfer.cwd,
        path: transfer.path,
        mode: "file",
        directory: null,
        file: null,
        error: null,
        requestId: frame.requestId,
      },
    });
  }

  private updateConnectionState(
    next: ConnectionState,
    metadata?: { event: string; reason?: string; reasonCode?: string },
  ): void {
    const previous = this.connectionState;
    this.connectionState = next;
    const reasonFromNext =
      next.status === "disconnected" && typeof next.reason === "string" ? next.reason : null;
    const reason = metadata?.reason ?? reasonFromNext;
    const reasonCode = metadata?.reasonCode ?? toReasonCode(reason);
    this.logger.debug(
      {
        serverId: this.logServerId,
        clientIdHash: this.logClientIdHash,
        from: previous.status,
        to: next.status,
        event: metadata?.event ?? "STATE_UPDATE",
        connectionPath: this.logConnectionPath,
        generation: this.logGeneration,
        reasonCode,
        reason,
      },
      "DaemonClientTransition",
    );
    for (const listener of this.connectionListeners) {
      try {
        listener(next);
      } catch {
        // no-op
      }
    }
  }

  setReconnectEnabled(enabled: boolean): void {
    this.config = { ...this.config, reconnect: { ...this.config.reconnect, enabled } };
  }

  private scheduleReconnect(input?: {
    reason?: string;
    event?: string;
    reasonCode?: string;
  }): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const wasDisposed = this.connectionState.status === "disposed";
    const reason = input?.reason;

    if (typeof reason === "string" && reason.trim().length > 0) {
      this.lastErrorValue = reason.trim();
    }

    // Clear all pending waiters and queued sends since the connection was lost
    // and responses from the previous connection will never arrive.
    this.clearWaiters(new Error(reason ?? "Connection lost"));
    this.rejectPendingSendQueue(new Error(reason ?? "Connection lost"));
    this.rejectPingProbe(new Error(reason ?? "Connection lost"));
    this.terminalStreams.clearSlots();
    this.lastServerInfoMessage = null;

    if (wasDisposed) {
      this.rejectConnect(new Error(reason ?? "Daemon client is disposed"));
      return;
    }
    this.emitDisconnectedStateForReconnect(reason, input);
    if (!this.shouldReconnect || this.config.reconnect?.enabled === false) {
      this.rejectConnect(new Error(reason ?? "Transport disconnected before connect"));
      return;
    }

    this.armReconnectTimer();
  }

  private emitDisconnectedStateForReconnect(
    reason: string | undefined,
    input: { reason?: string; event?: string; reasonCode?: string } | undefined,
  ): void {
    this.updateConnectionState(
      {
        status: "disconnected",
        ...(reason ? { reason } : {}),
      },
      {
        event: input?.event ?? "TRANSPORT_CLOSE",
        ...(reason ? { reason } : {}),
        ...(input?.reasonCode ? { reasonCode: input.reasonCode } : {}),
      },
    );
  }

  private armReconnectTimer(): void {
    const attempt = this.reconnectAttempt;
    const baseDelay = this.config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    this.reconnectAttempt = attempt + 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.shouldReconnect) {
        return;
      }
      this.attemptConnect();
    }, delay);
  }

  private resolvePingProbe(): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.resolve(perfNow() - probe.startedAt);
  }

  private clearPingProbe(): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
  }

  private rejectPingProbe(error: Error): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.reject(error);
  }

  private recordLivenessFailure(error: Error): void {
    this.consecutiveLivenessFailures += 1;
    if (this.consecutiveLivenessFailures < LIVENESS_FAILURE_RECONNECT_THRESHOLD) {
      return;
    }
    this.consecutiveLivenessFailures = 0;
    this.lastErrorValue = error.message;
    this.disposeTransport(1001, "Liveness check timed out");
    this.scheduleReconnect({
      reason: error.message,
      event: "LIVENESS_TIMEOUT",
      reasonCode: "liveness_timeout",
    });
  }

  private handleSessionMessage(msg: SessionOutboundMessage): void {
    const consumerMessage = normalizeProviderSnapshotUpdateMessage(msg);

    if (consumerMessage.type === "status") {
      const serverInfo = parseServerInfoStatusPayload(consumerMessage.payload);
      if (serverInfo) {
        this.lastServerInfoMessage = serverInfo;
        if (this.connectionState.status === "connecting") {
          this.resetConnectTimeout();
          this.reconnectAttempt = 0;
          this.updateConnectionState({ status: "connected" }, { event: "HELLO_SERVER_INFO" });
          this.startLivenessHeartbeat();
          this.resubscribeCheckoutDiffSubscriptions();
          this.resubscribeTerminalDirectorySubscriptions();
          this.resubscribeFileWatches();
          this.flushPendingSendQueue();
          this.resolveConnect();
        }
      }
    }

    if (consumerMessage.type === "terminal_stream_exit") {
      this.terminalStreams.removeTerminal(consumerMessage.payload.terminalId);
    }

    // Scaffold progress is advisory and scoped to one in-flight request, so it
    // is delivered to that request's own listener rather than the global
    // DaemonEvent stream every consumer would then have to ignore.
    if (consumerMessage.type === "project.scaffold.progress") {
      this.scaffoldProgressListeners.get(consumerMessage.payload.requestId)?.(
        consumerMessage.payload,
      );
    }

    if (this.rawMessageListeners.size > 0) {
      for (const handler of this.rawMessageListeners) {
        try {
          handler(consumerMessage);
        } catch {
          // no-op
        }
      }
    }

    const handlers = this.messageHandlers.get(consumerMessage.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(consumerMessage);
        } catch {
          // no-op
        }
      }
    }

    const event = this.toEvent(consumerMessage);
    if (event) {
      for (const handler of this.eventListeners) {
        handler(event);
      }
    }

    this.resolveWaiters(consumerMessage);
  }

  private resolveWaiters(msg: SessionOutboundMessage): void {
    for (const waiter of Array.from(this.waiters)) {
      const result = waiter.predicate(msg);
      if (result !== null) {
        this.waiters.delete(waiter);
        if (waiter.timeoutHandle) {
          clearTimeout(waiter.timeoutHandle);
        }
        waiter.resolve(result);
      }
    }
  }

  private rejectWaitersForRequestId(requestId: string, error: Error): void {
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.requestId !== requestId) {
        continue;
      }
      this.waiters.delete(waiter);
      if (waiter.timeoutHandle) {
        clearTimeout(waiter.timeoutHandle);
      }
      waiter.reject(error);
    }
  }

  private clearWaiters(error: Error): void {
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.timeoutHandle) {
        clearTimeout(waiter.timeoutHandle);
      }
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private toEvent(msg: SessionOutboundMessage): DaemonEvent | null {
    switch (msg.type) {
      case "agent_update":
        return {
          type: "agent_update",
          agentId: msg.payload.kind === "upsert" ? msg.payload.agent.id : msg.payload.agentId,
          payload: msg.payload,
        };
      case "workspace_update":
        return {
          type: "workspace_update",
          workspaceId: msg.payload.kind === "upsert" ? msg.payload.workspace.id : msg.payload.id,
          payload: msg.payload,
        };
      case "workspace_setup_progress":
        return {
          type: "workspace_setup_progress",
          workspaceId: msg.payload.workspaceId,
          payload: msg.payload,
        };
      case "agent_stream":
        return {
          type: "agent_stream",
          agentId: msg.payload.agentId,
          event: msg.payload.event,
          timestamp: msg.payload.timestamp,
          ...(typeof msg.payload.seq === "number" ? { seq: msg.payload.seq } : {}),
          ...(typeof msg.payload.epoch === "string" ? { epoch: msg.payload.epoch } : {}),
        };
      case "status":
        return { type: "status", payload: msg.payload };
      case "agent_deleted":
        return { type: "agent_deleted", agentId: msg.payload.agentId };
      case "agent_permission_request":
        return {
          type: "agent_permission_request",
          agentId: msg.payload.agentId,
          request: msg.payload.request,
        };
      case "agent_permission_resolved":
        return {
          type: "agent_permission_resolved",
          agentId: msg.payload.agentId,
          requestId: msg.payload.requestId,
          resolution: msg.payload.resolution,
        };
      case "providers_snapshot_update":
        return {
          type: "providers_snapshot_update",
          payload: msg.payload,
        };
      default:
        return null;
    }
  }

  private waitForWithCancel<T>(
    predicate: (msg: SessionOutboundMessage) => T | null,
    timeout = 30000,
    options?: WaitOptions,
  ): WaitHandle<T> {
    // Capture stack trace at call site, not inside setTimeout
    const timeoutError = new Error(`Timeout waiting for message (${timeout}ms)`);

    let waiter: Waiter<T> | null = null;
    let settled = false;
    let rejectFn: ((error: Error) => void) | null = null;

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedResolve = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      rejectFn = wrappedReject;

      const timeoutHandle =
        timeout > 0
          ? setTimeout(() => {
              if (waiter) {
                this.waiters.delete(waiter);
              }
              wrappedReject(timeoutError);
            }, timeout)
          : null;

      waiter = {
        predicate,
        resolve: wrappedResolve,
        reject: wrappedReject,
        timeoutHandle,
        requestId: options?.requestId,
      };
      this.waiters.add(waiter);
    });

    const cancel = (error: Error) => {
      if (settled) {
        return;
      }

      if (waiter) {
        this.waiters.delete(waiter);
        if (waiter.timeoutHandle) {
          clearTimeout(waiter.timeoutHandle);
        }
      }

      if (rejectFn) {
        rejectFn(error);
        return;
      }

      // Extremely unlikely: cancel called before the Promise executor ran.
      queueMicrotask(() => {
        if (!settled && rejectFn) {
          rejectFn(error);
        }
      });
    };

    return { promise, cancel };
  }

  async cloneGithubProject(
    input: { repo: string; targetDirectory: string; cloneProtocol?: ProjectGithubCloneProtocol },
    requestId?: string,
  ): Promise<ProjectGithubClonePayload> {
    const message = {
      type: "project.github.clone.request",
      repo: input.repo,
      targetDirectory: input.targetDirectory,
      ...(input.cloneProtocol ? { cloneProtocol: input.cloneProtocol } : {}),
    } as const;
    return this.sendNamespacedCorrelatedSessionRequest<"project.github.clone.response">({
      requestId,
      message,
      timeout: PROJECT_GITHUB_CLONE_TIMEOUT_MS,
    });
  }

  /**
   * `includeDiscovered` also returns the Scripts the workspace's own project
   * files declare (package.json scripts today), each tagged with its `source`.
   * Gate it on `server_info.features.workspaceScriptDiscovery` - an older
   * daemon ignores the flag and answers with the otto.json list only.
   */
  async listWorkspaceScripts(
    workspaceId: string,
    options?: { includeDiscovered?: boolean; requestId?: string },
  ): Promise<
    Extract<SessionOutboundMessage, { type: "workspace.script.list.response" }>["payload"]
  > {
    return this.sendCorrelatedSessionRequest({
      requestId: options?.requestId,
      message: {
        type: "workspace.script.list.request",
        workspaceId,
        includeDiscovered: options?.includeDiscovered ?? false,
      },
      responseType: "workspace.script.list.response",
    });
  }

  async startWorkspaceScriptWithStatus(
    workspaceId: string,
    scriptName: string,
    requestId?: string,
  ): Promise<
    Extract<SessionOutboundMessage, { type: "workspace.script.start.response" }>["payload"]
  > {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "workspace.script.start.request", workspaceId, scriptName },
      responseType: "workspace.script.start.response",
    });
  }

  async stopWorkspaceScript(
    workspaceId: string,
    scriptName: string,
    requestId?: string,
  ): Promise<
    Extract<SessionOutboundMessage, { type: "workspace.script.stop.response" }>["payload"]
  > {
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "workspace.script.stop.request", workspaceId, scriptName },
      responseType: "workspace.script.stop.response",
    });
  }

  async connectHub(hubUrl: string, token: string, requestId?: string) {
    this.requireHubRelationshipSupport();
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "hub.management.daemon.connect.request", hubUrl, token },
      responseType: "hub.management.daemon.connect.response",
    });
  }

  async getHubStatus(requestId?: string) {
    this.requireHubRelationshipSupport();
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "hub.management.daemon.get_status.request" },
      responseType: "hub.management.daemon.get_status.response",
    });
  }

  async disconnectHub(force = false, requestId?: string) {
    this.requireHubRelationshipSupport();
    return this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "hub.management.daemon.disconnect.request", force },
      responseType: "hub.management.daemon.disconnect.response",
    });
  }

  private requireHubRelationshipSupport(): void {
    // COMPAT(hubRelationship): added in v0.2.5, drop the gate when floor >= v0.2.5.
    if (this.lastServerInfoMessage?.features?.hubRelationship !== true) {
      throw new Error("Update the host to use Hub relationship management.");
    }
  }
}

function resolveAgentConfig(options: CreateAgentRequestOptions): AgentSessionConfig {
  const {
    config,
    provider,
    cwd,
    env: _env,
    workspaceId: _workspaceId,
    initialPrompt: _initialPrompt,
    images: _images,
    git: _git,
    worktreeName: _worktreeName,
    requestId: _requestId,
    labels: _labels,
    ...overrides
  } = options;

  const baseConfig: Partial<AgentSessionConfig> = {
    ...(provider ? { provider } : {}),
    ...(cwd ? { cwd } : {}),
    ...overrides,
  };

  const merged = config ? { ...baseConfig, ...config } : baseConfig;

  if (!merged.provider || !merged.cwd) {
    throw new Error("createAgent requires provider and cwd");
  }

  return {
    ...merged,
    provider: merged.provider,
    cwd: merged.cwd,
  };
}
