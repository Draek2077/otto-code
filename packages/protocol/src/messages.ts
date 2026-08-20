import { z } from "zod";
import {
  MutableAgentBehaviorsConfigSchema,
  MutableLspConfigSchema,
  MutableDotnetSolutionConfigSchema,
  MutableGitHostingConfigSchema,
  MutableKanbanConfigSchema,
  MutableAgentPersonalitiesConfigSchema,
  MutableAgentPersonalitiesConfigPatchSchema,
  MutableAgentTeamsConfigSchema,
  MutableAgentTeamsConfigPatchSchema,
  MutableBrainConfigSchema,
  MutableBrainConfigPatchSchema,
  MutableGitFetchConfigSchema,
  DEFAULT_MUTABLE_BRAIN_CONFIG,
} from "./daemon-config.js";
import {
  VisualizerVoiceCuesGenerateRequestSchema,
  VisualizerVoiceCuesGenerateResponseSchema,
  AgentPersonalitySpinnerSchema,
  AgentPersonalitiesGetStatsRequestSchema,
  AgentPersonalitiesGenerateProfileRequestSchema,
  AgentPersonalitiesGetStatsResponseSchema,
  AgentPersonalitiesGenerateProfileResponseSchema,
  PersonalityMemoryListRequestMessageSchema,
  PersonalityMemoryListResponseMessageSchema,
  PersonalityMemoryUpdateRequestMessageSchema,
  PersonalityMemoryUpdateResponseMessageSchema,
  PersonalityMemoryTransferRequestMessageSchema,
  PersonalityMemoryTransferResponseMessageSchema,
  PersonalityMemoryStatsRequestMessageSchema,
  PersonalityMemoryStatsResponseMessageSchema,
} from "./personality-schemas.js";
import {
  TerminalCompatibilityDiagnosticRequestSchema,
  TerminalCompatibilityDiagnosticResponseSchema,
} from "./terminal-compatibility.js";
import {
  HostingPrAttachmentSchema,
  HostingIssueAttachmentSchema,
  HostingSearchRequestSchema,
  HostingAuthStatusRequestSchema,
  HostingListRepositoriesRequestSchema,
  HostingListOwnersRequestSchema,
  HostingListRepositoriesResponseSchema,
  HostingListOwnersResponseSchema,
  HostingAuthStatusResponseSchema,
  GitHostingCapabilitiesSchema,
  GitHostingProviderIdWireSchema,
} from "./git-hosting.js";
import {
  ProjectKanbanTargetSchema,
  KanbanProjectTargetSetRequestSchema,
  KanbanProjectTargetSetResponseSchema,
  KanbanBoardsListRequestSchema,
  KanbanBoardsListResponseSchema,
  KanbanBoardGetRequestSchema,
  KanbanBoardGetResponseSchema,
  KanbanCardMoveRequestSchema,
  KanbanCardMoveResponseSchema,
  KanbanCardCreateRequestSchema,
  KanbanCardCreateResponseSchema,
  KanbanTaskLinkRequestSchema,
  KanbanTaskLinkResponseSchema,
} from "./kanban.js";
import {
  WorkspaceArchivePreflightRequestSchema,
  CheckoutBaseSourceSchema,
  WorktreeBaseRefSetRequestSchema,
  WorkspaceArchivePreflightResponseSchema,
  WorktreeBaseRefSetResponseSchema,
} from "./worktree-ops.js";
import {
  SuggestedTasksChangedSchema,
  TasksSuggestedStartRequestMessageSchema,
  TasksSuggestedStartResponseMessageSchema,
  TasksSuggestedDismissRequestMessageSchema,
  TasksSuggestedDismissResponseMessageSchema,
} from "./suggested-tasks.js";
import {
  HistoryAgentsClearArchivedRequestSchema,
  HistoryAgentsClearArchivedResponseSchema,
  HistoryAgentsStorageStatsRequestSchema,
  HistoryAgentsStorageStatsResponseSchema,
  AttachmentsImagesStatsRequestSchema,
  AttachmentsImagesStatsResponseSchema,
  AttachmentsImagesClearRequestSchema,
  AttachmentsImagesClearResponseSchema,
} from "./storage.js";
import {
  StatsActivityGetRequestMessageSchema,
  StatsActivityGetResponseMessageSchema,
  ActivityStatsChangedSchema,
  UsageLogGetRequestMessageSchema,
  UsageLogGetResponseMessageSchema,
  StatsActivityResetRequestMessageSchema,
  StatsActivityResetResponseMessageSchema,
} from "./usage-stats.js";
import {
  AgentContextGetUsageRequestMessageSchema,
  AgentContextGetUsageResponseMessageSchema,
  ContextReportChangedSchema,
  ContextReportGetRequestMessageSchema,
  ContextReportGetResponseMessageSchema,
  ContextPromptPreviewGetRequestMessageSchema,
  ContextPromptPreviewGetResponseMessageSchema,
  ContextEdgeConvertRequestMessageSchema,
  ContextEdgeConvertResponseMessageSchema,
  ContextFindingsFixRequestMessageSchema,
  ContextFindingsFixResponseMessageSchema,
} from "./context.js";
import {
  QueuedAgentMessagePayloadSchema,
  AgentQueueRemoveRequestMessageSchema,
  AgentQueueReorderRequestMessageSchema,
  AgentQueueClearRequestMessageSchema,
  AgentQueueRemoveResponseMessageSchema,
  AgentQueueReorderResponseMessageSchema,
  AgentQueueClearResponseMessageSchema,
} from "./agent-queue.js";
import {
  FileEolSchema,
  FileCreateRequestSchema,
  FileDeleteRequestSchema,
  FileRenameRequestSchema,
  FileWatchSubscribeRequestSchema,
  FileWatchUnsubscribeRequestSchema,
  FileSearchRequestSchema,
  FileReplaceRequestSchema,
  FileCreateResponseSchema,
  FileDeleteResponseSchema,
  FileRenameResponseSchema,
  FileWatchSubscribeResponseSchema,
  FileWatchUnsubscribeResponseSchema,
  FileSearchResultEventSchema,
  FileSearchResponseSchema,
  FileReplaceResponseSchema,
  FileWatchEventSchema,
} from "./file-operations.js";
import { FileRefineRequestSchema, FileRefineResponseSchema } from "./refine.js";
import {
  MutableSpeechConfigSchema,
  SpeechSettingsGetOptionsRequestSchema,
  SpeechTtsPreviewRequestSchema,
  SpeechTtsSpeakRequestSchema,
  SpeechTtsSpeakCancelRequestSchema,
  SpeechSettingsGetOptionsResponseSchema,
  SpeechTtsPreviewResponseSchema,
  SpeechTtsSpeakResponseSchema,
  SpeechTtsSpeakCancelResponseSchema,
} from "./speech.js";
import {
  ProjectLinksListRequestSchema,
  ProjectLinksSetRequestSchema,
  ProjectLinksUnsetRequestSchema,
  ProjectLinksListResponseSchema,
  ProjectLinksSetResponseSchema,
  ProjectLinksUnsetResponseSchema,
  ProjectLinksChangedSchema,
} from "./project-links.js";
import {
  ProjectKnowledgeListRequestMessageSchema,
  ProjectKnowledgeListResponseMessageSchema,
  ProjectKnowledgeGetRequestMessageSchema,
  ProjectKnowledgeGetResponseMessageSchema,
  ProjectKnowledgeCreateRequestMessageSchema,
  ProjectKnowledgeCreateResponseMessageSchema,
  ProjectKnowledgeApplyRequestMessageSchema,
  ProjectKnowledgeApplyResponseMessageSchema,
  ProjectKnowledgeStatusRequestMessageSchema,
  ProjectKnowledgeStatusResponseMessageSchema,
  ProjectKnowledgeProjectApplyRequestMessageSchema,
  ProjectKnowledgeProjectApplyResponseMessageSchema,
  ProjectKnowledgeReferenceApplyRequestMessageSchema,
  ProjectKnowledgeReferenceApplyResponseMessageSchema,
  ProjectKnowledgeRootApplyRequestMessageSchema,
  ProjectKnowledgeRootApplyResponseMessageSchema,
  ProjectKnowledgeDeleteRequestMessageSchema,
  ProjectKnowledgeDeleteResponseMessageSchema,
} from "./project-knowledge.js";
import {
  CheckoutGitGetOperationLogRequestSchema,
  CheckoutGitGetOperationLogResponseSchema,
  CheckoutGitLogAppendedNotificationSchema,
  CheckoutGitCommitRequestSchema,
  CheckoutGitCommitAgentRequestSchema,
  CheckoutGitRollbackRequestSchema,
  CheckoutGitCommitResponseSchema,
  CheckoutGitCommitAgentResponseSchema,
  CheckoutGitRollbackResponseSchema,
  GitFileHistoryEntrySchema,
  GitBlameLineSchema,
  GitBlameCommitSchema,
} from "./git-operations.js";
import {
  LspServersListRequestSchema,
  LspServerStopRequestSchema,
  LspActivityChangedStatusPayloadSchema,
  LspDiagnosticsChangedStatusPayloadSchema,
  LspServersListResponseSchema,
  LspServerStopResponseSchema,
  CodeListFilesRequestSchema,
  CodeSymbolsRequestSchema,
  CodeOutlineRequestSchema,
  CodeDefinitionRequestSchema,
  CodeDocumentSyncRequestSchema,
  CodeDocumentCloseRequestSchema,
  CodeHoverRequestSchema,
  CodeReferencesRequestSchema,
  CodeRenamePreviewRequestSchema,
  CodeRenameApplyRequestSchema,
  CodeRenameUndoRequestSchema,
  CodeSolutionListRequestSchema,
  CodeSolutionGetTreeRequestSchema,
  CodeSolutionLoadProjectRequestSchema,
  CodeListFilesResponseSchema,
  CodeSymbolsResponseSchema,
  CodeDefinitionResponseSchema,
  CodeDocumentSyncResponseSchema,
  CodeDocumentCloseResponseSchema,
  CodeHoverResponseSchema,
  CodeReferencesResponseSchema,
  CodeRenamePreviewResponseSchema,
  CodeRenameUndoResponseSchema,
  CodeRenameApplyResponseSchema,
  CodeSolutionListResponseSchema,
  CodeSolutionGetTreeResponseSchema,
  CodeSolutionLoadProjectResponseSchema,
  CodeOutlineResponseSchema,
} from "./code-intelligence.js";
import {
  CommunicationsGetOverviewRequestSchema,
  CommunicationsGetOverviewResponseSchema,
  CommunicationsInboxGetHomeRequestSchema,
  CommunicationsInboxGetHomeResponseSchema,
  CommunicationsInboxSearchRequestSchema,
  CommunicationsInboxSearchResponseSchema,
  CommunicationsInboxSetFavoriteRequestSchema,
  CommunicationsInboxSetFavoriteResponseSchema,
  CommunicationsInboxNotificationsAcknowledgeRequestSchema,
  CommunicationsInboxNotificationsAcknowledgeResponseSchema,
  CommunicationsInboxGetPresenceRequestSchema,
  CommunicationsInboxGetPresenceResponseSchema,
  CommunicationsInboxPresenceChangedNotificationSchema,
  CommunicationsInboxSetPresenceRequestSchema,
  CommunicationsInboxSetPresenceResponseSchema,
  CommunicationsInboxSetEnabledRequestSchema,
  CommunicationsInboxSetEnabledResponseSchema,
  CommunicationsInboxGetMessagesRequestSchema,
  CommunicationsInboxGetMessagesResponseSchema,
  CommunicationsInboxSendMessageRequestSchema,
  CommunicationsInboxSendMessageResponseSchema,
  CommunicationsRoomGetRequestSchema,
  CommunicationsRoomGetResponseSchema,
  CommunicationsRoomThreadGetRequestSchema,
  CommunicationsRoomThreadGetResponseSchema,
  CommunicationsRoomMessageSendRequestSchema,
  CommunicationsRoomMessageSendResponseSchema,
  CommunicationsRoomReactionSetRequestSchema,
  CommunicationsRoomReactionSetResponseSchema,
} from "./communications.js";
import {
  IntegrationsAuthorizationGetOverviewRequestSchema,
  IntegrationsAuthorizationGetOverviewResponseSchema,
  IntegrationsAuthorizationGetMethodsRequestSchema,
  IntegrationsAuthorizationGetMethodsResponseSchema,
  IntegrationsAuthorizationStartBrowserRequestSchema,
  IntegrationsAuthorizationStartBrowserResponseSchema,
  IntegrationsZoomStartAuthorizationRequestSchema,
  IntegrationsZoomStartAuthorizationResponseSchema,
} from "./integration-authorization.js";
import {
  RunsGetSnapshotRequestSchema,
  RunsGetSnapshotResponseSchema,
  RunsUpdatedNotificationSchema,
  RunsGateRespondRequestSchema,
  RunsGateRespondResponseSchema,
  RunsCancelRequestSchema,
  RunsCancelResponseSchema,
  RunsClearRequestSchema,
  RunsClearResponseSchema,
  RunsDeleteRequestSchema,
  RunsDeleteResponseSchema,
  RunsClearedNotificationSchema,
  RunsGraphsListRequestSchema,
  RunsGraphsListResponseSchema,
  RunsGraphsSaveRequestSchema,
  RunsGraphsSaveResponseSchema,
  RunsGraphsDeleteRequestSchema,
  RunsGraphsDeleteResponseSchema,
  RunsGraphsChangedNotificationSchema,
  RunsTemplatesListRequestSchema,
  RunsTemplatesListResponseSchema,
  RunsTemplatesSaveRequestSchema,
  RunsTemplatesSaveResponseSchema,
  RunsTemplatesDeleteRequestSchema,
  RunsTemplatesDeleteResponseSchema,
  RunsTemplatesChangedNotificationSchema,
  RunsStartRequestSchema,
  RunsStartResponseSchema,
} from "./orchestration.js";
import {
  MeetingsTranscriptsListRequestSchema,
  MeetingsTranscriptsListResponseSchema,
  MeetingsTranscriptsCreateRequestSchema,
  MeetingsTranscriptsCreateResponseSchema,
  MeetingsTranscriptsUpdateRequestSchema,
  MeetingsTranscriptsUpdateResponseSchema,
  MeetingsTranscriptsDeleteRequestSchema,
  MeetingsTranscriptsDeleteResponseSchema,
} from "./meetings.js";
import {
  PreviewListConfigRequestSchema,
  PreviewStartRequestSchema,
  PreviewBindTabRequestSchema,
  PreviewStopRequestSchema,
  PreviewListConfigResponseSchema,
  PreviewStartResponseSchema,
  PreviewBindTabResponseSchema,
  PreviewStopResponseSchema,
} from "./preview.js";
import {
  BrainLogsWatchRequestSchema,
  BrainLogLineAddedStatusPayloadSchema,
  BrainBenchRequestSchema,
  BrainBenchResponseSchema,
  BrainCalibrateRequestSchema,
  BrainCalibrateResponseSchema,
  BrainCatalogListRequestSchema,
  BrainCatalogListResponseSchema,
  BrainEvalsGetRequestSchema,
  BrainEvalsGetResponseSchema,
  BrainHfQuantsRequestSchema,
  BrainHfQuantsResponseSchema,
  BrainHfSearchRequestSchema,
  BrainHfSearchResponseSchema,
  BrainHostRestartRequestSchema,
  BrainHostRestartResponseSchema,
  BrainHostStartRequestSchema,
  BrainHostStartResponseSchema,
  BrainHostStatusRequestSchema,
  BrainHostStatusResponseSchema,
  BrainHostStopRequestSchema,
  BrainHostStopResponseSchema,
  BrainJobsCancelRequestSchema,
  BrainJobsCancelResponseSchema,
  BrainJobsListRequestSchema,
  BrainJobsListResponseSchema,
  BrainLogsTailRequestSchema,
  BrainLogsTailResponseSchema,
  BrainLogsWatchResponseSchema,
  BrainModelBudgetGetRequestSchema,
  BrainModelBudgetGetResponseSchema,
  BrainModelComponentDeleteRequestSchema,
  BrainModelComponentDeleteResponseSchema,
  BrainModelDeleteRequestSchema,
  BrainModelDeleteResponseSchema,
  BrainModelLoadRequestSchema,
  BrainModelLoadResponseSchema,
  BrainModelProfileGetRequestSchema,
  BrainModelProfileGetResponseSchema,
  BrainModelProfileSetRequestSchema,
  BrainModelProfileSetResponseSchema,
  BrainModelRenameRequestSchema,
  BrainModelRenameResetRequestSchema,
  BrainModelRenameResetResponseSchema,
  BrainModelRenameResponseSchema,
  BrainModelUnloadRequestSchema,
  BrainModelUnloadResponseSchema,
  BrainModelsAddRequestSchema,
  BrainModelsAddResponseSchema,
  BrainModelsInventoryRequestSchema,
  BrainModelsInventoryResponseSchema,
  BrainModelsListRequestSchema,
  BrainModelsListResponseSchema,
  BrainModelsPullRequestSchema,
  BrainModelsPullResponseSchema,
  BrainModelsScanRequestSchema,
  BrainModelsScanResponseSchema,
  BrainNetworkDiscoverRequestSchema,
  BrainNetworkDiscoverResponseSchema,
  BrainRemoteConfigGetRequestSchema,
  BrainRemoteConfigGetResponseSchema,
  BrainRemoteConfigPatchRequestSchema,
  BrainRemoteConfigPatchResponseSchema,
  BrainRuntimeInstallRequestSchema,
  BrainRuntimeInstallResponseSchema,
  BrainRuntimeListRequestSchema,
  BrainRuntimeListResponseSchema,
  BrainRuntimeRemoveRequestSchema,
  BrainRuntimeRemoveResponseSchema,
  BrainStatusChangedStatusPayloadSchema,
  BrainSweepRequestSchema,
  BrainSweepResponseSchema,
} from "./brain.js";
import { TerminalActivitySchema } from "./terminal-activity.js";
import { ArtifactMetadataSchema } from "./artifacts/types.js";
import {
  ArtifactListRequestSchema,
  ArtifactCreateRequestSchema,
  ArtifactUpdateRequestSchema,
  ArtifactRegenerateRequestSchema,
  ArtifactCancelRequestSchema,
  ArtifactDeleteRequestSchema,
  ArtifactStarRequestSchema,
  ArtifactGetContentRequestSchema,
  ArtifactListResponseSchema,
  ArtifactCreateResponseSchema,
  ArtifactUpdateResponseSchema,
  ArtifactRegenerateResponseSchema,
  ArtifactCancelResponseSchema,
  ArtifactDeleteResponseSchema,
  ArtifactStarResponseSchema,
  ArtifactGetContentResponseSchema,
  ArtifactCreatedNotificationSchema,
  ArtifactUpdatedNotificationSchema,
  ArtifactDeletedNotificationSchema,
} from "./artifacts/rpc-schemas.js";
import { CLIENT_CAPS } from "./client-capabilities.js";
import { AGENT_LIFECYCLE_STATUSES } from "./agent-lifecycle.js";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "./agent-title-limits.js";
import { AgentProviderSchema } from "./provider-manifest.js";
import {
  ConnectorConfigSchema,
  McpServerConfigSchema,
  OTTO_TOOL_GROUPS,
  STALL_GUARD_DEFAULT_THRESHOLD,
} from "./provider-config.js";
import { TOOL_CALL_ICON_NAMES } from "./agent-types.js";
import {
  ChatCreateRequestSchema,
  ChatListRequestSchema,
  ChatInspectRequestSchema,
  ChatDeleteRequestSchema,
  ChatPostRequestSchema,
  ChatReadRequestSchema,
  ChatWaitRequestSchema,
  ChatCreateResponseSchema,
  ChatListResponseSchema,
  ChatInspectResponseSchema,
  ChatDeleteResponseSchema,
  ChatPostResponseSchema,
  ChatReadResponseSchema,
  ChatWaitResponseSchema,
} from "./chat/rpc-schemas.js";
import {
  ScheduleCreateRequestSchema,
  ScheduleListRequestSchema,
  ScheduleInspectRequestSchema,
  ScheduleLogsRequestSchema,
  SchedulePauseRequestSchema,
  ScheduleResumeRequestSchema,
  ScheduleDeleteRequestSchema,
  ScheduleRunOnceRequestSchema,
  ScheduleUpdateRequestSchema,
  ScheduleCreateResponseSchema,
  ScheduleListResponseSchema,
  ScheduleInspectResponseSchema,
  ScheduleLogsResponseSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeResponseSchema,
  ScheduleDeleteResponseSchema,
  ScheduleRunOnceResponseSchema,
  ScheduleUpdateResponseSchema,
} from "./schedule/rpc-schemas.js";
import {
  LoopRunRequestSchema,
  LoopListRequestSchema,
  LoopInspectRequestSchema,
  LoopLogsRequestSchema,
  LoopStopRequestSchema,
  LoopRunResponseSchema,
  LoopListResponseSchema,
  LoopInspectResponseSchema,
  LoopLogsResponseSchema,
  LoopStopResponseSchema,
} from "./loop/rpc-schemas.js";
import {
  BrowserAutomationExecuteRequestSchema,
  BrowserAutomationExecuteResponseSchema,
} from "./browser-automation/rpc-schemas.js";
import { BrowserAutomationHostCapabilitySchema } from "./browser-automation/capabilities.js";
import {
  OttoConfigRawSchema,
  OttoLifecycleCommandRawSchema,
  OttoMetadataGenerationEntrySchema,
  OttoMetadataGenerationSchema,
  OttoScriptEntryRawSchema,
  OttoWorktreeConfigRawSchema,
  OttoConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type OttoConfigRaw,
  type OttoConfigRevision,
  type OttoMetadataGeneration,
  type OttoMetadataGenerationEntry,
  type OttoScriptEntryRaw,
  type ProjectConfigRpcError,
} from "./otto-config-schema.js";

export * from "./git-hosting.js";
export {
  OttoConfigRawSchema,
  OttoLifecycleCommandRawSchema,
  OttoMetadataGenerationEntrySchema,
  OttoMetadataGenerationSchema,
  OttoScriptEntryRawSchema,
  OttoWorktreeConfigRawSchema,
  type OttoConfigRaw,
  type OttoConfigRevision,
  type OttoMetadataGeneration,
  type OttoMetadataGenerationEntry,
  type OttoScriptEntryRaw,
  type ProjectConfigRpcError,
};
// ---------------------------------------------------------------------------
// Mutable daemon config schemas (shared between server store and client)
// ---------------------------------------------------------------------------

const MutableDaemonProviderModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .passthrough();

const MutableDaemonProviderConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    additionalModels: z.array(MutableDaemonProviderModelSchema).optional(),
    ottoToolGroups: z.array(z.enum(OTTO_TOOL_GROUPS)).optional(),
  })
  .passthrough();

const MutableStructuredGenerationProviderSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .passthrough();

const MutableMetadataGenerationConfigSchema = z
  .object({
    providers: z.array(MutableStructuredGenerationProviderSchema).default([]),
    // Master switch for daemon-side metadata generation (chat auto-titles,
    // agent progress summaries, and other structured side-generations). Default
    // true preserves today's behavior. Read by the generation path (WP-B).
    enabled: z.boolean().default(true),
    // When true, metadata generation prefers a role-matched Writer personality
    // over the cheap default tier. Default false - cheap-tier routing is the
    // default. Read by the generation routing (WP-B).
    preferWriterPersonalities: z.boolean().default(false),
  })
  .passthrough();

export const TerminalProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    icon: z.string().optional(),
  })
  .passthrough();

export type TerminalProfile = z.infer<typeof TerminalProfileSchema>;

const MutableBrowserToolsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .passthrough();

export const ModelTierSchema: z.ZodType<ModelTier> = z.enum(["deep", "standard", "fast"]);

// A user's explicit tier tag for one model of one provider. The daemon stamps
// `model.tier` at ingest, preferring a matching override here over inference
// (see model-tiers.ts). Stored as an array (not a nested record) so a patch
// replaces it wholesale - that's how a tag gets cleared, since deep-merge can't
// delete a record key.
export const ModelTierOverrideSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    tier: ModelTierSchema,
  })
  .passthrough();

export type ModelTierOverride = z.infer<typeof ModelTierOverrideSchema>;

// A remembered provider endpoint: a base URL together with the credential it
// was saved with, so pointing a provider back at a previous endpoint is one
// pick instead of re-typing the key. Entries are scoped by the connection
// env-var pair they belong to (OPENAI_BASE_URL/OPENAI_API_KEY vs
// ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN), which is exactly what the provider
// settings sheet keys its dropdown off - so every openai-compatible provider
// entry on the host shares one pool, and Claude-compatible entries share
// another. Deliberately `z.string()` rather than an enum: a future env-var
// family must not make old entries unparseable.
export const SavedProviderEndpointSchema = z
  .object({
    /** Stable identity, `${baseUrlKey}::${baseUrl}` - dedupes on re-save. */
    id: z.string().min(1),
    baseUrlKey: z.string().min(1),
    apiKeyKey: z.string().min(1),
    baseUrl: z.string().min(1),
    apiKey: z.string().default(""),
    /** User-facing name; the UI falls back to the URL when absent. */
    label: z.string().optional(),
    /** Epoch ms of the last save, used to order the dropdown newest-first. */
    savedAt: z.number().optional(),
  })
  .passthrough();

export type SavedProviderEndpoint = z.infer<typeof SavedProviderEndpointSchema>;

export const MutableDaemonConfigSchema = z
  .object({
    mcp: z
      .object({
        injectIntoAgents: z.boolean(),
        // Daemon-wide Otto tool-group allowlist for the MCP (Claude) path.
        // undefined = all groups enabled (mirrors openai-compat's per-provider
        // ottoToolGroups semantics). An empty array = no Otto tools. Read by the
        // MCP catalog gating (WP-A).
        toolGroups: z.array(z.enum(OTTO_TOOL_GROUPS)).optional(),
      })
      .passthrough(),
    // Defaults off, matching the daemon's own resolution - browser tools are an
    // explicit opt-in, so an omitted section must never read as on.
    browserTools: MutableBrowserToolsConfigSchema.default({ enabled: false }),
    // Daemon-wide agent behavior toggles (Claude-tier capabilities). Defaults to
    // all-on so a new client parsing an old daemon's config sees today's behavior.
    agentBehaviors: MutableAgentBehaviorsConfigSchema.default({
      promptSuggestions: true,
      agentProgressSummaries: true,
      notifyOnFinishDefault: true,
      todoNudge: true,
      todoReconcileOnIdle: true,
      stallGuardThreshold: STALL_GUARD_DEFAULT_THRESHOLD,
    }),
    providers: z.record(z.string(), MutableDaemonProviderConfigSchema).default({}),
    metadataGeneration: MutableMetadataGenerationConfigSchema.default({
      providers: [],
      enabled: true,
      preferWriterPersonalities: false,
    }),
    autoArchiveAfterMerge: z.boolean().default(false),
    // Host-owned because the daemon runs the network operation for every connected client.
    // COMPAT(gitFetchControl): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
    gitFetch: MutableGitFetchConfigSchema.optional(),
    // Drop the "Merge into <base>" action from the client's source-control menu
    // (and stop promoting it to the primary CTA) for a pull-request-only
    // workflow. Host-level so the whole team's clients share one policy.
    // Defaults false so a new client parsing an old daemon's config keeps the
    // action visible. Gated by server_info features.hideMergeIntoBaseSetting.
    hideMergeIntoBaseAction: z.boolean().default(false),
    // Retention for the images agents produce (docs/attachment-lifecycle.md).
    // Host-level, because the store they govern is the daemon's. Defaults match
    // the constants the daemon shipped with, so a client parsing an old daemon's
    // config sees the policy actually in force rather than zeros. 0 on either
    // disables that lever. Gated by server_info features.attachmentStorage.
    attachmentImageMaxAgeDays: z.number().int().min(0).default(30),
    attachmentImageMaxTotalMb: z.number().int().min(0).default(512),
    enableTerminalAgentHooks: z.boolean().default(false),
    // Gated by server_info.features.terminalTitleSettings. The daemon owns
    // title policy because terminals can be created from any connected client.
    terminalTitleMode: z.enum(["auto", "default"]).optional(),
    terminalTitleIncludePaths: z.boolean().optional(),
    // Windows-only preference for ordinary interactive terminals. Absent keeps
    // the operating system's normal default shell on every platform.
    defaultTerminalShell: z
      .enum(["command-prompt", "windows-powershell", "powershell-7"])
      .optional(),
    appendSystemPrompt: z.string().default(""),
    terminalProfiles: z.array(TerminalProfileSchema).optional(),
    // Absent on daemons without the speechSettings feature.
    speech: MutableSpeechConfigSchema.optional(),
    // Absent on daemons without the gitHostingProviders feature.
    gitHosting: MutableGitHostingConfigSchema.optional(),
    // Per-host agent personality roster. Gated by the agentPersonalities
    // feature; defaults to an empty roster so a new client parsing an old
    // daemon's config still sees a well-formed section.
    agentPersonalities: MutableAgentPersonalitiesConfigSchema.default({ personalities: [] }),
    // Per-host agent teams + the active team id. Gated by the agentTeams
    // feature; defaults to an empty section so a new client parsing an old
    // daemon's config still sees a well-formed shape.
    agentTeams: MutableAgentTeamsConfigSchema.default({ teams: [] }),
    // Per-host user overrides of model tiers, keyed by provider + model id.
    // Gated by the modelTierOverrides feature; defaults empty so a new client
    // parsing an old daemon's config still sees a well-formed array.
    modelTierOverrides: z.array(ModelTierOverrideSchema).default([]),
    // Per-host remembered provider endpoints (base URL + credential), pooled by
    // env-var family. Gated by the savedProviderEndpoints feature; defaults
    // empty so a new client parsing an old daemon's config still sees a
    // well-formed array.
    savedProviderEndpoints: z.array(SavedProviderEndpointSchema).default([]),
    // Language-server code intelligence. Gated by server_info features.lsp; the
    // default section is well-formed so a new client parsing an old daemon's config
    // still renders the screen.
    lsp: MutableLspConfigSchema.default({
      enabled: true,
      languages: {},
      maxRunningServers: 6,
      idleMinutes: 10,
      backgroundIdleMinutes: 2,
    }),
    // The Solution view's switch. Gated by server_info features.solutionView; the default
    // section is well-formed and OFF, so a new client parsing an old daemon's config renders
    // the row without ever implying the feature is running.
    dotnetSolutionManagement: MutableDotnetSolutionConfigSchema.default({
      enabled: false,
      maxRunningProbes: 2,
      idleMinutes: 10,
    }),
    // Local AI host (otto-brain) management. Gated by server_info features.brainControl;
    // defaults OFF and well-formed so a new client parsing an old daemon's config renders
    // the row without ever implying the brain is running.
    brain: MutableBrainConfigSchema.default(DEFAULT_MUTABLE_BRAIN_CONFIG),
    // Host-wide connector registry (MCP servers surfaced as named, toggle-able
    // integrations). Gated by server_info features.connectors; defaults to an
    // empty roster so a new client parsing an old daemon's config still sees a
    // well-formed section.
    connectors: z.array(ConnectorConfigSchema).default([]),
    // Kanban board surface credentials (provider tokens). Gated by
    // server_info features.kanbanBoard; absent on older daemons.
    kanban: MutableKanbanConfigSchema.optional(),
  })
  .passthrough();

export const MutableDaemonConfigPatchSchema = z
  .object({
    mcp: MutableDaemonConfigSchema.shape.mcp.partial().optional(),
    browserTools: MutableBrowserToolsConfigSchema.partial().optional(),
    // Gated by server_info features.agentBehaviorToggles; patches deep-merge.
    agentBehaviors: MutableAgentBehaviorsConfigSchema.partial().optional(),
    // A null entry removes the provider's config entirely (custom provider
    // uninstall). Gated by server_info features.providerRemove - old daemons
    // reject null values.
    providers: z
      .record(z.string(), MutableDaemonProviderConfigSchema.partial().passthrough().nullable())
      .optional(),
    removeProviders: z.array(z.string().min(1)).optional(),
    metadataGeneration: MutableMetadataGenerationConfigSchema.partial().optional(),
    autoArchiveAfterMerge: z.boolean().optional(),
    // Gated by server_info.features.gitFetchControl; patches deep-merge.
    gitFetch: MutableGitFetchConfigSchema.partial().optional(),
    // Gated by server_info features.hideMergeIntoBaseSetting.
    hideMergeIntoBaseAction: z.boolean().optional(),
    // Gated by server_info features.attachmentStorage.
    attachmentImageMaxAgeDays: z.number().int().min(0).optional(),
    attachmentImageMaxTotalMb: z.number().int().min(0).optional(),
    enableTerminalAgentHooks: z.boolean().optional(),
    terminalTitleMode: z.enum(["auto", "default"]).optional(),
    terminalTitleIncludePaths: z.boolean().optional(),
    defaultTerminalShell: z
      .enum(["command-prompt", "windows-powershell", "powershell-7"])
      .optional(),
    appendSystemPrompt: z.string().optional(),
    terminalProfiles: z.array(TerminalProfileSchema).optional(),
    // Gated by server_info features.speechSettings; every field is optional so
    // patches deep-merge into the daemon's current speech config.
    speech: MutableSpeechConfigSchema.optional(),
    // Gated by server_info features.gitHostingProviders; patches deep-merge.
    gitHosting: MutableGitHostingConfigSchema.optional(),
    // Gated by server_info features.agentPersonalities. A patch replaces the
    // full roster (read-modify-write the array), matching how terminalProfiles
    // and metadataGeneration.providers patch.
    agentPersonalities: MutableAgentPersonalitiesConfigPatchSchema.optional(),
    // Gated by server_info features.agentTeams. A `teams` patch replaces the
    // full array (read-modify-write), matching agentPersonalities;
    // `activeTeamId: null` deactivates the team without touching the array.
    agentTeams: MutableAgentTeamsConfigPatchSchema.optional(),
    // Gated by server_info features.modelTierOverrides. Replaces the full array
    // (read-modify-write), so removing an entry clears that model's tag.
    modelTierOverrides: z.array(ModelTierOverrideSchema).optional(),
    // Gated by server_info features.savedProviderEndpoints. Replaces the full
    // array (read-modify-write), so forgetting an endpoint drops it from disk.
    savedProviderEndpoints: z.array(SavedProviderEndpointSchema).optional(),
    // Gated by server_info features.lsp; patches deep-merge, so a `languages`
    // patch replaces only the keys it names.
    lsp: MutableLspConfigSchema.partial().optional(),
    // Gated by server_info features.solutionView; patches deep-merge.
    dotnetSolutionManagement: MutableDotnetSolutionConfigSchema.partial().optional(),
    // Gated by server_info features.brainControl; patches deep-merge. Uses the
    // dedicated no-default patch schema (see MutableBrainConfigPatchSchema): a
    // plain `.partial()` here keeps every field's default and resets the whole
    // block on a single-field patch.
    brain: MutableBrainConfigPatchSchema.optional(),
    // Gated by server_info features.connectors. Replaces the full array
    // (read-modify-write), matching modelTierOverrides/savedProviderEndpoints, so
    // enabling/disabling a connector or a tool is a whole-array rewrite.
    connectors: z.array(ConnectorConfigSchema).optional(),
  })
  .partial()
  .passthrough();

export type MutableDaemonConfig = z.infer<typeof MutableDaemonConfigSchema>;
export type MutableDaemonConfigPatch = z.infer<typeof MutableDaemonConfigPatchSchema>;
import type {
  AgentCapabilityFlags,
  AgentModelDefinition,
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  ModelTier,
  ProviderStatus,
  AgentRuntimeInfo,
  AgentTimelineItem,
  AgentProviderNotice,
  ToolCallDetail,
  ToolCallTimelineItem,
  AgentUsage,
  AgentContextCategory,
  ContextComposition,
} from "./agent-types.js";

export const AgentStatusSchema = z.enum(AGENT_LIFECYCLE_STATUSES);

const AgentModeSchema: z.ZodType<AgentMode> = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: z.string().optional(),
});

const ProviderStatusSchema: z.ZodType<ProviderStatus> = z.enum([
  "ready",
  "loading",
  "error",
  "unavailable",
]);

const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  family: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const AgentProviderNoticeSchema: z.ZodType<AgentProviderNotice> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("info"), message: z.string() }),
  z.object({ type: z.literal("warning"), message: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

// Provider-reported plan rate-limit status (e.g. Claude claude.ai plan
// windows), pushed on the agent stream when it changes. Presentation-only:
// the app decides whether to show it (rateLimitWarningsEnabled setting).
export const AgentRateLimitInfoSchema = z.object({
  status: z.enum(["allowed", "warning", "rejected"]),
  // Percentage of the limit window used, 0-100. Absent when the provider
  // does not report it (Claude only includes it near the limit).
  utilizationPercent: z.number().optional(),
  // Provider-reported window identifier, e.g. "five_hour" | "seven_day".
  // Open set - display code falls back to a generic label for unknown values.
  limitType: z.string().optional(),
  // ISO 8601 timestamp when the window resets.
  resetsAt: z.string().optional(),
  // True when usage is currently drawing from overage/extra usage credits.
  isUsingOverage: z.boolean().optional(),
});

export const AgentFeatureToggleSchema = z.object({
  type: z.literal("toggle"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.boolean(),
});

export const AgentFeatureSelectSchema = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.string().nullable(),
  options: z.array(AgentSelectOptionSchema),
});

export const AgentFeatureSchema = z.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema,
]);

const AgentModelDefinitionSchema: z.ZodType<AgentModelDefinition> = z.object({
  provider: AgentProviderSchema,
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  family: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  contextWindowMaxTokens: z.number().optional(),
  thinkingOptions: z.array(AgentSelectOptionSchema).optional(),
  defaultThinkingOptionId: z.string().optional(),
  // Daemon-stamped capability tier (deep/standard/fast). Optional: absent on old
  // daemons and on models neither classified nor user-tagged.
  tier: ModelTierSchema.optional(),
  // False when the model can't run the provider's "auto" permission mode.
  // Optional: absent on old daemons and when supported/unknown.
  supportsAutoMode: z.boolean().optional(),
});

export const ProviderSnapshotEntrySchema = z.object({
  provider: AgentProviderSchema,
  status: ProviderStatusSchema,
  enabled: z.boolean().optional().default(true),
  source: z.enum(["builtin", "custom"]).optional(),
  error: z.string().optional(),
  models: z.array(AgentModelDefinitionSchema).optional(),
  modes: z.array(AgentModeSchema).optional(),
  fetchedAt: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  defaultModeId: z.string().nullable().optional(),
});

const AgentCapabilityFlagsSchema: z.ZodType<AgentCapabilityFlags> = z
  .object({
    supportsStreaming: z.boolean(),
    supportsSessionPersistence: z.boolean(),
    supportsSessionListing: z.boolean().optional(),
    supportsDynamicModes: z.boolean(),
    supportsMcpServers: z.boolean(),
    supportsReasoningStream: z.boolean(),
    supportsToolInvocations: z.boolean(),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindConversation: z.boolean().optional().default(false),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindFiles: z.boolean().optional().default(false),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindBoth: z.boolean().optional().default(false),
  })
  .catchall(z.boolean());

const ContextCompositionSchema: z.ZodType<ContextComposition> = z.object({
  systemPrompt: z.number().optional(),
  userMessages: z.number().optional(),
  toolResults: z.number().optional(),
  reasoning: z.number().optional(),
  subagentResults: z.number().optional(),
});

// Declared above AgentUsageSchema on purpose: a schema referenced before its
// declaration is a build-time ReferenceError in the zod-aot output.
const AgentContextCategorySchema: z.ZodType<AgentContextCategory> = z.object({
  /** Provider-supplied display label, not translated and not an enum. */
  name: z.string(),
  tokens: z.number(),
  isDeferred: z.boolean().optional(),
});

const AgentUsageSchema: z.ZodType<AgentUsage> = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  // Cache-write (prompt-cache creation) tokens; Claude-specific, optional/additive.
  cacheCreationInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  contextWindowMaxTokens: z.number().optional(),
  contextWindowUsedTokens: z.number().optional(),
  // Provider-graded context breakdown for the visualizer ring/bar; absent ⇒
  // occupancy only (pre-composition behavior). See ContextComposition.
  contextComposition: ContextCompositionSchema.optional(),
  // The provider's own labelled split - same accounting as
  // `agent.context.get_usage`, pushed on the snapshot. Preferred over
  // contextComposition; absent ⇒ fall back to the estimate, then to occupancy.
  contextCategories: z.array(AgentContextCategorySchema).optional(),
});

const AgentSessionConfigSchema = z.object({
  provider: AgentProviderSchema,
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  title: z.string().trim().min(1).max(MAX_EXPLICIT_AGENT_TITLE_CHARS).optional().nullable(),
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  networkAccess: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  extra: z
    .object({
      codex: z.record(z.string(), z.unknown()).optional(),
      claude: z.record(z.string(), z.unknown()).optional(),
    })
    .partial()
    .optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

const AgentPermissionUpdateSchema = z.record(z.string(), z.unknown());
const AgentPermissionActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  behavior: z.enum(["allow", "deny"]),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  intent: z.enum(["implement", "implement_resume", "dismiss"]).optional(),
});

export const AgentPermissionResponseSchema: z.ZodType<AgentPermissionResponse> =
  z.discriminatedUnion("behavior", [
    z.object({
      behavior: z.literal("allow"),
      selectedActionId: z.string().optional(),
      updatedInput: z.record(z.string(), z.unknown()).optional(),
      updatedPermissions: z.array(AgentPermissionUpdateSchema).optional(),
    }),
    z.object({
      behavior: z.literal("deny"),
      selectedActionId: z.string().optional(),
      message: z.string().optional(),
      interrupt: z.boolean().optional(),
    }),
  ]);

export const AgentPermissionRequestPayloadSchema: z.ZodType<AgentPermissionRequest, unknown> =
  z.object({
    id: z.string(),
    provider: AgentProviderSchema,
    name: z.string(),
    kind: z.enum(["tool", "plan", "question", "mode", "other"]),
    title: z.string().optional(),
    description: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    detail: z.lazy(() => ToolCallDetailPayloadSchema).optional(),
    suggestions: z.array(AgentPermissionUpdateSchema).optional(),
    actions: z.array(AgentPermissionActionSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

const UnknownValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.object({}).passthrough(),
]);

const NonNullUnknownSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.object({}).passthrough(),
]);

const WorktreeSetupCommandSnapshotSchema = z.object({
  index: z.number().int().positive(),
  command: z.string(),
  cwd: z.string(),
  log: z.string().optional().default(""),
  status: z.enum(["running", "completed", "failed"]),
  exitCode: z.number().nullable(),
  durationMs: z.number().nonnegative().optional(),
});

const WorktreeSetupDetailPayloadSchema = z.object({
  type: z.literal("worktree_setup"),
  worktreePath: z.string(),
  branchName: z.string(),
  log: z.string(),
  commands: z.array(WorktreeSetupCommandSnapshotSchema),
  truncated: z.boolean().optional(),
});

const ToolCallDetailPayloadSchema: z.ZodType<ToolCallDetail, unknown> = z.discriminatedUnion(
  "type",
  [
    WorktreeSetupDetailPayloadSchema,
    z.object({
      type: z.literal("shell"),
      command: z.string(),
      cwd: z.string().optional(),
      output: z.string().optional(),
      exitCode: z.number().nullable().optional(),
    }),
    z.object({
      type: z.literal("read"),
      filePath: z.string(),
      content: z.string().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    }),
    z.object({
      type: z.literal("edit"),
      filePath: z.string(),
      oldString: z.string().optional(),
      newString: z.string().optional(),
      unifiedDiff: z.string().optional(),
    }),
    z.object({
      type: z.literal("write"),
      filePath: z.string(),
      content: z.string().optional(),
    }),
    z.object({
      type: z.literal("search"),
      query: z.string(),
      toolName: z.enum(["search", "grep", "glob", "web_search"]).optional(),
      content: z.string().optional(),
      filePaths: z.array(z.string()).optional(),
      webResults: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        )
        .optional(),
      annotations: z.array(z.string()).optional(),
      numFiles: z.number().optional(),
      numMatches: z.number().optional(),
      durationMs: z.number().optional(),
      durationSeconds: z.number().optional(),
      truncated: z.boolean().optional(),
      mode: z.enum(["content", "files_with_matches", "count"]).optional(),
    }),
    z.object({
      type: z.literal("fetch"),
      url: z.string(),
      prompt: z.string().optional(),
      result: z.string().optional(),
      code: z.number().optional(),
      codeText: z.string().optional(),
      bytes: z.number().optional(),
      durationMs: z.number().optional(),
    }),
    z.object({
      type: z.literal("sub_agent"),
      subAgentType: z.string().optional(),
      description: z.string().optional(),
      childSessionId: z.string().optional(),
      log: z.string(),
      // Compat cruft for clients <= 0.1.65-beta.3 that required this field. Producers still
      // emit `[]`; nothing reads it. Drop the field (and the `[]` emissions) once those
      // clients are no longer in the field.
      actions: z
        .array(
          z.object({
            index: z.number().int().positive(),
            toolName: z.string(),
            summary: z.string().optional(),
          }),
        )
        .optional(),
    }),
    z.object({
      type: z.literal("plain_text"),
      label: z.string().optional(),
      text: z.string().optional(),
      icon: z.enum(TOOL_CALL_ICON_NAMES).optional(),
    }),
    z.object({
      type: z.literal("plan"),
      text: z.string(),
    }),
    z.object({
      type: z.literal("unknown"),
      input: UnknownValueSchema,
      output: UnknownValueSchema,
    }),
  ],
);

const ToolCallBasePayloadSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  detail: ToolCallDetailPayloadSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ToolCallRunningPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("running"),
  error: z.null(),
});

const ToolCallCompletedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("completed"),
  error: z.null(),
});

const ToolCallFailedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("failed"),
  error: NonNullUnknownSchema,
});

const ToolCallCanceledPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: z.literal("canceled"),
  error: z.null(),
});

const ToolCallTimelineItemPayloadSchema: z.ZodType<ToolCallTimelineItem, unknown> =
  z.discriminatedUnion("status", [
    ToolCallRunningPayloadSchema,
    ToolCallCompletedPayloadSchema,
    ToolCallFailedPayloadSchema,
    ToolCallCanceledPayloadSchema,
  ]);

// zod-aot 0.20.4 miscompiles this as a nested discriminated union by omitting
// the inner tool_call branch from the generated outer dispatch.
export const AgentTimelineItemPayloadSchema: z.ZodType<AgentTimelineItem, unknown> = z.union([
  z.object({
    type: z.literal("user_message"),
    text: z.string(),
    messageId: z.string().optional(),
    clientMessageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("assistant_message"),
    text: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    type: z.literal("reasoning"),
    text: z.string(),
  }),
  ToolCallTimelineItemPayloadSchema,
  z.object({
    type: z.literal("todo"),
    items: z.array(
      z.object({
        text: z.string(),
        completed: z.boolean(),
      }),
    ),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("compaction"),
    // COMPAT(compactionFailedStatus): "failed" added in v0.4.3. Clients older
    // than that drop the whole timeline event on parse and keep showing the
    // loading row - exactly their pre-"failed" behavior, so no gate is needed.
    // Nothing to remove: this tag records why the enum could be widened without
    // a shim, so it has no cleanup date by design.
    status: z.enum(["loading", "completed", "failed"]),
    trigger: z.enum(["auto", "manual"]).optional(),
    preTokens: z.number().optional(),
    postTokens: z.number().optional(),
  }),
]);

export const AgentStreamEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread_started"),
    sessionId: z.string(),
    provider: AgentProviderSchema,
  }),
  z.object({
    type: z.literal("turn_started"),
    provider: AgentProviderSchema,
  }),
  z.object({
    type: z.literal("turn_completed"),
    provider: AgentProviderSchema,
    usage: AgentUsageSchema.optional(),
  }),
  z.object({
    type: z.literal("turn_failed"),
    provider: AgentProviderSchema,
    error: z.string(),
    code: z.string().optional(),
    diagnostic: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn_canceled"),
    provider: AgentProviderSchema,
    reason: z.string(),
  }),
  z.object({
    type: z.literal("timeline"),
    provider: AgentProviderSchema,
    item: AgentTimelineItemPayloadSchema,
  }),
  z.object({
    type: z.literal("permission_requested"),
    provider: AgentProviderSchema,
    request: AgentPermissionRequestPayloadSchema,
  }),
  z.object({
    type: z.literal("permission_resolved"),
    provider: AgentProviderSchema,
    requestId: z.string(),
    resolution: AgentPermissionResponseSchema,
  }),
  z.object({
    type: z.literal("attention_required"),
    provider: AgentProviderSchema,
    reason: z.enum(["finished", "error", "permission"]),
    timestamp: z.string(),
    shouldNotify: z.boolean(),
    notification: z
      .object({
        title: z.string(),
        body: z.string(),
        data: z.object({
          serverId: z.string(),
          workspaceId: z.string().optional(),
          agentId: z.string(),
          reason: z.enum(["finished", "error", "permission"]),
        }),
      })
      .optional(),
  }),
  // Predicted next-user-prompt suggestion emitted after a turn. Transient: the
  // app shows the latest as composer ghost text (Tab to accept) and clears it on
  // the next turn_started. COMPAT(promptSuggestions): added in v0.6.3.
  z.object({
    type: z.literal("prompt_suggestion"),
    provider: AgentProviderSchema,
    suggestion: z.string(),
  }),
  // Provider-reported plan rate-limit status (Claude claude.ai plan windows).
  // Transient: the app shows a suppressible warning strip near the composer.
  // Deduped provider-side. COMPAT(rateLimitEvents): added in v0.6.3.
  z.object({
    type: z.literal("rate_limit_updated"),
    provider: AgentProviderSchema,
    info: AgentRateLimitInfoSchema,
  }),
]);

const AgentPersistenceHandleSchema: z.ZodType<AgentPersistenceHandle | null> = z
  .object({
    provider: AgentProviderSchema,
    sessionId: z.string(),
    nativeHandle: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .nullable();

const AgentRuntimeInfoSchema: z.ZodType<AgentRuntimeInfo> = z.object({
  provider: AgentProviderSchema,
  sessionId: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinkingOptionId: z.string().nullable().optional(),
  modeId: z.string().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/**
 * An agent's LIFETIME SPEND, kept as the real token split plus the provider's
 * own cost - the raw material for "what did this chat cost".
 *
 * Deliberately distinct from context-window occupancy (`agent.context.get_usage`
 * and `lastUsage.contextWindow*`), which answers "how full am I" and shares no
 * units with this. Conflating the two is why the numbers used to feel wrong; the
 * UI must never mix them. See docs/glossary.md.
 *
 * `costUsd` is only ever a provider's OWN reported cost, already de-inflated so
 * a parent never carries what its sub-agents reported. It is NEVER derived from
 * a $/M rate table - a rate keyed off a model id misprices a gateway serving
 * that model at its own prices (docs/subagent-accounting.md, pricing invariant).
 * `costCoverage` says how far it can be trusted, so a surface can show a floor
 * or an honest blank rather than a confident wrong figure.
 *
 * Declared above AgentSnapshotPayloadSchema - zod-aot emits schemas in source
 * order, so a forward reference is a build-time ReferenceError.
 */
export const AgentCumulativeUsageSchema = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  /** Provider-reported cost booked so far. Absent ⇒ nothing was priceable. */
  costUsd: z.number().optional(),
  /**
   * `complete` - every token-bearing turn was priced; `costUsd` is the total.
   * `partial` - some turns were unpriced; `costUsd` is a FLOOR, present it as
   * one. `none` - nothing priceable; show tokens and a blank, never an estimate.
   */
  costCoverage: z.enum(["complete", "partial", "none"]).optional(),
});

export type AgentCumulativeUsage = z.infer<typeof AgentCumulativeUsageSchema>;

export const AgentSnapshotPayloadSchema = z.object({
  id: z.string(),
  provider: AgentProviderSchema,
  cwd: z.string(),
  workspaceId: z.string().optional(),
  model: z.string().nullable(),
  features: z.array(AgentFeatureSchema).optional(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  status: AgentStatusSchema,
  capabilities: AgentCapabilityFlagsSchema,
  currentModeId: z.string().nullable(),
  availableModes: z.array(AgentModeSchema),
  pendingPermissions: z.array(AgentPermissionRequestPayloadSchema),
  persistence: AgentPersistenceHandleSchema.nullable(),
  runtimeInfo: AgentRuntimeInfoSchema.optional(),
  lastUsage: AgentUsageSchema.optional(),
  // Honest cumulative token total (Σ across the whole run) from the provider,
  // for the subagents-track cost readout - the only currency that works for
  // cost-less local models. Observed subagents source it from the provider's
  // per-task usage.total_tokens (already cumulative-per-subagent). Purely
  // additive; absent ⇒ no readout. Old clients ignore it.
  // See docs/agent-lifecycle.md (Item 3).
  cumulativeTokens: z.number().optional(),
  // The same lifetime spend as `cumulativeTokens`, but as the REAL split plus
  // the provider's own cost, so a chat total can be priced honestly instead of
  // flattened to one scalar and multiplied by a guessed rate. Its token leaves
  // sum to `cumulativeTokens`; a client that ignores this loses only the split
  // and the cost. Absent ⇒ the daemon predates the field or reported nothing.
  // COMPAT(cumulativeUsage): added in v0.7.0; gated on
  // server_info.features.cumulativeUsage, drop the gate when floor >= v0.7.0.
  // See docs/subagent-accounting.md (Chat totals).
  cumulativeUsage: AgentCumulativeUsageSchema.optional(),
  // Liveness signals for the sub-agents track: how much work this agent has done
  // (`toolUseCount`, cumulative and monotonic) and what it is doing right now
  // (`currentTool`, the latest tool name, cleared once the agent is terminal -
  // a finished agent isn't "running Bash"). Both are purely additive optional
  // leaves: a provider that can't report them leaves them absent and the row
  // omits the readout rather than showing a wrong value.
  // COMPAT(subagentLiveness): added in v0.6.7, drop the optional gate when the
  // floor is >= v0.6.7. Old clients ignore both fields and show the row without
  // its liveness readouts, which is their pre-v0.6.7 behaviour.
  // See docs/chat-lifecycle.md (the subagents track).
  toolUseCount: z.number().optional(),
  currentTool: z.string().optional(),
  // Messages parked for delivery as this agent's NEXT turn (delivery: "queue").
  // Daemon-owned and ephemeral - the composer's Queue track renders straight
  // from this. Absent/empty ⇒ nothing queued; old clients ignore it.
  // COMPAT(steerQueue): added in v0.6.8, drop the gate when floor >= v0.6.8.
  queuedMessages: z.array(QueuedAgentMessagePayloadSchema).optional(),
  lastError: z.string().optional(),
  title: z.string().nullable(),
  labels: z.record(z.string(), z.string()).default({}),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  // Bytes in Otto's record captured at archive time. This is a projection,
  // never a transcript rescan during rendering.
  archiveBytes: z.number().int().nonnegative().optional(),
  providerUnavailable: z.boolean().optional(),
  // Attendability. "observed" marks a provider-managed subagent (Claude Task /
  // ultracode fan-out) that the user can watch but not prompt or reconfigure -
  // the daemon refuses attended operations and the client renders it read-only.
  // COMPAT(observedSubagents): added in v0.4.3; absent ⇒ "attended". Drop the
  // gate when daemon floor >= v0.4.3. See projects/observed-subagents/observed-subagents.md.
  attend: z.enum(["attended", "observed"]).optional(),
  // True when an observed sub-agent run outlives an interrupt of the parent's
  // turn: a backgrounded Task/Agent (its tool_result was only a launch ack) or
  // a Workflow orchestration run. The client uses it to stop claiming that
  // interrupting the parent stops work it will not actually stop.
  // COMPAT(backgroundedObservedSubagents): added in v0.7.5; absent ⇒ treated as
  // foreground, which is the pre-existing behavior. Drop the gate when daemon
  // floor >= v0.7.5. See docs/chat-lifecycle.md.
  backgrounded: z.boolean().optional(),
  // Spinner colors from the Agent Personality this agent was spawned from, so
  // its live thinking indicator renders in the personality's identity. Absent ⇒
  // the client falls back to the theme's default spinner colors. Purely additive
  // (no daemon floor needed). See docs/agent-personalities.md.
  personalitySpinner: AgentPersonalitySpinnerSchema.optional(),
  // Name of the Agent Personality this agent was spawned from, so the running
  // agent's controls keep showing the personality identity (trigger label +
  // effort hidden) instead of reverting to the raw model. Absent ⇒ no bound
  // personality. Purely additive. See docs/agent-personalities.md.
  personalityName: z.string().optional(),
  // Stable id of the bound Agent Personality. The client keys roster selection
  // on this (names can be renamed/duplicated); personalityName remains for
  // display and as the selection fallback against daemons that predate this
  // field. Purely additive. See docs/agent-personalities.md.
  personalityId: z.string().optional(),
});

export type AgentSnapshotPayload = z.infer<typeof AgentSnapshotPayloadSchema>;

export const AgentListItemPayloadSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string().nullable(),
  provider: AgentProviderSchema,
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  status: AgentStatusSchema,
  cwd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  archivedAt: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  providerUnavailable: z.boolean().optional(),
});

export type AgentListItemPayload = z.infer<typeof AgentListItemPayloadSchema>;

export type AgentStreamEventPayload = z.infer<typeof AgentStreamEventPayloadSchema>;

export const RecentProviderSessionDescriptorPayloadSchema = z.object({
  providerId: z.string(),
  providerLabel: z.string(),
  providerHandleId: z.string(),
  cwd: z.string(),
  title: z.string().nullable(),
  firstPromptPreview: z.string().nullable(),
  lastPromptPreview: z.string().nullable(),
  lastActivityAt: z.string(),
});

export type RecentProviderSessionDescriptorPayload = z.infer<
  typeof RecentProviderSessionDescriptorPayloadSchema
>;

// ============================================================================
// Session Inbound Messages (Session receives these)
// ============================================================================

export const VoiceAudioChunkMessageSchema = z.object({
  type: z.literal("voice_audio_chunk"),
  audio: z.string(), // base64 encoded
  format: z.string(),
  isLast: z.boolean(),
});

export const AbortRequestMessageSchema = z.object({
  type: z.literal("abort_request"),
});

export const AudioPlayedMessageSchema = z.object({
  type: z.literal("audio_played"),
  id: z.string(),
});

const AgentDirectoryFilterSchema = z.object({
  labels: z.record(z.string(), z.string()).optional(),
  projectKeys: z.array(z.string()).optional(),
  statuses: z.array(AgentStatusSchema).optional(),
  includeArchived: z.boolean().optional(),
  requiresAttention: z.boolean().optional(),
  thinkingOptionId: z.string().nullable().optional(),
});

export const DeleteAgentRequestMessageSchema = z.object({
  type: z.literal("delete_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const ArchiveAgentRequestMessageSchema = z.object({
  type: z.literal("archive_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const CloseItemsRequestMessageSchema = z.object({
  type: z.literal("close_items_request"),
  agentIds: z.array(z.string()).default([]),
  terminalIds: z.array(z.string()).default([]),
  requestId: z.string(),
});

export const UpdateAgentRequestMessageSchema = z.object({
  type: z.literal("update_agent_request"),
  agentId: z.string(),
  name: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  requestId: z.string(),
});

// --- Local AI host (otto-brain) management -------------------------------
// Lifecycle + evals are correlated request/response RPCs. Gated by
// server_info.features.brainControl (lifecycle) and features.brainStatus
// (evals). Live status streaming (subscribe_brain_status + brain_status_changed)
// is added alongside its client/daemon consumers.

// --- Brain model management (runtimes, catalog, downloads, ops) ----------
// The daemon drives these by shelling out to `otto-brain <verb> --json` (it
// never imports the brain's runtime modules in-process). Reads (scan, catalog,
// runtime list) are correlated request/response; long operations (pull, runtime
// install, calibrate, sweep, bench) run as tracked JOBS the client polls via
// brain.jobs.list. All gated by server_info.features.brainManage.

// --- Hugging Face discovery (search + add arbitrary repos) ---------------
// The daemon shells out to `otto-brain search`/`add --json`. Reads are
// correlated request/response; the download runs as a `pull` job. Gated by
// server_info.features.brainHfSearch. The brain resolves its own HF token (env
// HF_TOKEN or its config), so no secret crosses this boundary.

export const ProjectRenameRequestSchema = z.object({
  type: z.literal("project.rename.request"),
  projectId: z.string(),
  // Null or empty string clears the override and reverts to the derived name.
  customName: z.string().nullable(),
  requestId: z.string(),
});

export const ProjectRemoveRequestSchema = z.object({
  type: z.literal("project.remove.request"),
  projectId: z.string(),
  requestId: z.string(),
});

export const WorkspaceTitleSetRequestSchema = z.object({
  type: z.literal("workspace.title.set.request"),
  workspaceId: z.string(),
  // Null or empty string clears the title and reverts to the derived name.
  title: z.string().nullable(),
  requestId: z.string(),
});

export const WorkspacePinSetRequestSchema = z.object({
  type: z.literal("workspace.pin.set.request"),
  workspaceId: z.string(),
  pinned: z.boolean(),
  requestId: z.string(),
});

export const WorkspaceRecoveryInspectRequestSchema = z.object({
  type: z.literal("workspace.recovery.inspect.request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

export const WorkspaceRecoveryRestoreRequestSchema = z.object({
  type: z.literal("workspace.recovery.restore.request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

export const SetVoiceModeMessageSchema = z.object({
  type: z.literal("set_voice_mode"),
  enabled: z.boolean(),
  agentId: z.string().optional(),
  requestId: z.string().optional(),
});

export const GitHubPrAttachmentSchema = z.object({
  type: z.literal("github_pr"),
  mimeType: z.literal("application/github-pr"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

export const ForgeChangeRequestAttachmentSchema = z.object({
  type: z.literal("forge_change_request"),
  mimeType: z.literal("application/otto-forge-change-request"),
  forge: z.string().optional().default("github"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

export const GitHubIssueAttachmentSchema = z.object({
  type: z.literal("github_issue"),
  mimeType: z.literal("application/github-issue"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
});

export const ForgeIssueAttachmentSchema = z.object({
  type: z.literal("forge_issue"),
  mimeType: z.literal("application/otto-forge-issue"),
  forge: z.string().optional().default("github"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  projectPath: z.string().optional(),
});

export const TextAttachmentSchema = z
  .object({
    type: z.literal("text"),
    mimeType: z.literal("text/plain"),
    contextKind: z.string().optional(),
    title: z.string().nullable().optional(),
    text: z.string(),
  })
  .transform(({ contextKind, ...attachment }) => ({
    ...attachment,
    ...(contextKind === "chat_history" ? { contextKind } : {}),
  }));

export const ReviewAttachmentContextLineSchema = z.object({
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  type: z.enum(["add", "remove", "context"]),
  content: z.string(),
});

export const ReviewAttachmentCommentSchema = z.object({
  filePath: z.string(),
  side: z.enum(["old", "new"]),
  lineNumber: z.number().int().positive(),
  body: z.string(),
  context: z.object({
    hunkHeader: z.string(),
    targetLine: ReviewAttachmentContextLineSchema,
    lines: z.array(ReviewAttachmentContextLineSchema),
  }),
});

export const ReviewAttachmentSchema = z.object({
  type: z.literal("review"),
  mimeType: z.literal("application/otto-review"),
  cwd: z.string(),
  mode: z.enum(["uncommitted", "base"]),
  baseRef: z.string().nullable().optional(),
  comments: z.array(ReviewAttachmentCommentSchema),
});

export const UploadedFileAttachmentSchema = z.object({
  type: z.literal("uploaded_file"),
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  path: z.string(),
});

export const AgentAttachmentSchema = z.discriminatedUnion("type", [
  ForgeChangeRequestAttachmentSchema,
  ForgeIssueAttachmentSchema,
  GitHubPrAttachmentSchema,
  GitHubIssueAttachmentSchema,
  HostingPrAttachmentSchema,
  HostingIssueAttachmentSchema,
  TextAttachmentSchema,
  ReviewAttachmentSchema,
  UploadedFileAttachmentSchema,
]);

function normalizeAgentAttachments(input: unknown): AgentAttachment[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: AgentAttachment[] = [];
  for (const item of input) {
    const parsed = AgentAttachmentSchema.safeParse(item);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}

const AgentAttachmentsSchema = z.unknown().transform(normalizeAgentAttachments).optional();

export const ChangeRequestCheckoutSourceSchema = z.object({
  kind: z.literal("change_request"),
  forge: z.string().optional(),
  number: z.number().int().positive(),
  projectPath: z.string().optional(),
});

const ImageAttachmentSchema = z.object({
  data: z.string(), // base64 encoded image
  mimeType: z.string(), // e.g., "image/jpeg", "image/png"
});

export const SendAgentMessageSchema = z.object({
  type: z.literal("send_agent_message"),
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().optional(), // Client-provided ID for deduplication
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
});

// ============================================================================
// Agent RPCs (requestId-correlated)
// ============================================================================

export const FetchAgentsRequestMessageSchema = z.object({
  type: z.literal("fetch_agents_request"),
  requestId: z.string(),
  scope: z.enum(["active"]).optional(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().max(200),
      cursor: z.string().min(1).optional(),
    })
    .optional(),
  subscribe: z
    .object({
      subscriptionId: z.string().optional(),
    })
    .optional(),
});

const WorkspaceStateBucketSchema = z.enum([
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
]);

export const FetchWorkspacesRequestMessageSchema = z.object({
  type: z.literal("fetch_workspaces_request"),
  requestId: z.string(),
  filter: z
    .object({
      query: z.string().optional(),
      projectId: z.string().optional(),
      // Unused: accepted so older clients still parse, but the server does not filter on it.
      idPrefix: z.string().optional(),
    })
    .optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "activity_at", "name", "project_id"]),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().max(200),
      cursor: z.string().min(1).optional(),
    })
    .optional(),
  subscribe: z
    .object({
      subscriptionId: z.string().optional(),
    })
    .optional(),
});

export const ProjectListRequestMessageSchema = z.object({
  type: z.literal("project.list.request"),
  requestId: z.string(),
});

export const ProjectResolveWorkspaceForPathRequestSchema = z.object({
  type: z.literal("project.resolveWorkspaceForPath.request"),
  requestId: z.string(),
  path: z.string(),
});

export const FetchAgentHistoryRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_history_request"),
  requestId: z.string(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().max(200),
      cursor: z.string().min(1).optional(),
    })
    .optional(),
});

export const FetchRecentProviderSessionsRequestMessageSchema = z.object({
  type: z.literal("fetch_recent_provider_sessions_request"),
  requestId: z.string(),
  cwd: z.string().optional(),
  providers: z.array(z.string()).optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const FetchAgentRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
});

export const SendAgentMessageRequestSchema = z.object({
  type: z.literal("send_agent_message_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().optional(), // Client-provided ID for deduplication
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  // How to reach a BUSY agent. "interrupt" (default, and what every older
  // client means by omitting this) cancels the in-flight turn and runs this
  // instead; "queue" lets the turn finish and runs this as the next one.
  // Against an idle agent both run immediately.
  // COMPAT(steerQueue): added in v0.6.8, drop the gate when floor >= v0.6.8.
  delivery: z.enum(["interrupt", "queue"]).optional(),
});

export const WaitForFinishRequestSchema = z.object({
  type: z.literal("wait_for_finish_request"),
  requestId: z.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

export const DaemonGetStatusRequestSchema = z.object({
  type: z.literal("daemon.get_status.request"),
  requestId: z.string(),
});

export const DaemonGetPairingOfferRequestSchema = z.object({
  type: z.literal("daemon.get_pairing_offer.request"),
  requestId: z.string(),
});

export const HubManagementDaemonConnectRequestSchema = z.object({
  type: z.literal("hub.management.daemon.connect.request"),
  requestId: z.string(),
  hubUrl: z.string(),
  token: z.string(),
});
export const HubManagementDaemonGetStatusRequestSchema = z.object({
  type: z.literal("hub.management.daemon.get_status.request"),
  requestId: z.string(),
});
export const HubManagementDaemonDisconnectRequestSchema = z.object({
  type: z.literal("hub.management.daemon.disconnect.request"),
  requestId: z.string(),
  force: z.boolean().optional(),
});

export const DiagnosticsRequestSchema = z.object({
  type: z.literal("diagnostics.request"),
  requestId: z.string(),
});

export const GetDaemonConfigRequestMessageSchema = z.object({
  type: z.literal("get_daemon_config_request"),
  requestId: z.string(),
});

export const SetDaemonConfigRequestMessageSchema = z.object({
  type: z.literal("set_daemon_config_request"),
  requestId: z.string(),
  config: MutableDaemonConfigPatchSchema,
});

// Connectors - MCP servers surfaced as named, toggle-able integrations. The
// registry itself (add/remove/enable/disable a connector or an individual tool)
// lives in daemon config and is edited via set_daemon_config's `connectors`
// patch. The one thing config can't answer is what tools a connector actually
// exposes, which needs a live connect + listTools - that is this RPC. Gated by
// features.connectors.
export const ConnectorsListToolsRequestSchema = z.object({
  type: z.literal("connectors.list_tools.request"),
  requestId: z.string(),
  connectorId: z.string(),
});
export const ConnectorsListToolsResponseSchema = z.object({
  type: z.literal("connectors.list_tools.response"),
  payload: z.object({
    connectorId: z.string(),
    tools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string().nullable().default(null),
          disabled: z.boolean().default(false),
        }),
      )
      .default([]),
    // Non-null when the connector could not be reached / enumerated.
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});
export type ConnectorsListToolsRequest = z.infer<typeof ConnectorsListToolsRequestSchema>;
export type ConnectorsListToolsResponse = z.infer<typeof ConnectorsListToolsResponseSchema>;

// Connector OAuth - the "sign in" path for connectors whose MCP server
// authenticates by login rather than by a pasted token. Three steps, because a
// login is not a request/response: the client asks to authorize, the daemon
// answers with a URL to open (or "already authorized"), and the actual result
// arrives later as a pushed status once the user finishes in their browser.
// Gated by features.connectorOauth.
export const ConnectorsOauthAuthorizeRequestSchema = z.object({
  type: z.literal("connectors.oauth.authorize.request"),
  requestId: z.string(),
  connectorId: z.string(),
  /** Scopes to request, when the catalog entry names them. */
  scope: z.string().optional(),
});
export const ConnectorsOauthAuthorizeResponseSchema = z.object({
  type: z.literal("connectors.oauth.authorize.response"),
  payload: z.object({
    connectorId: z.string(),
    /**
     * Present when the user must sign in: the client opens this URL. Absent when
     * the daemon already held a usable authorization, in which case status is
     * "authorized" and there is nothing to open.
     */
    authorizationUrl: z.string().nullable().default(null),
    status: z.enum(["redirect", "authorized", "error"]).default("error"),
    error: z.string().nullable().default(null),
    requestId: z.string(),
  }),
});

export const ConnectorsOauthDisconnectRequestSchema = z.object({
  type: z.literal("connectors.oauth.disconnect.request"),
  requestId: z.string(),
  connectorId: z.string(),
});
export const ConnectorsOauthDisconnectResponseSchema = z.object({
  type: z.literal("connectors.oauth.disconnect.response"),
  payload: z.object({
    connectorId: z.string(),
    requestId: z.string(),
  }),
});

/**
 * Pushed when an in-flight authorization settles. Not correlated to a requestId:
 * the browser round-trip outlives the request that started it, and more than one
 * client may be watching the same connector.
 */
export const ConnectorsOauthStatusMessageSchema = z.object({
  type: z.literal("connectors.oauth.status"),
  payload: z.object({
    connectorId: z.string(),
    status: z.enum(["connected", "failed"]),
    /** Account label to show once connected, when the server reveals one. */
    account: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
  }),
});

export type ConnectorsOauthAuthorizeRequest = z.infer<typeof ConnectorsOauthAuthorizeRequestSchema>;
export type ConnectorsOauthAuthorizeResponse = z.infer<
  typeof ConnectorsOauthAuthorizeResponseSchema
>;
export type ConnectorsOauthDisconnectRequest = z.infer<
  typeof ConnectorsOauthDisconnectRequestSchema
>;
export type ConnectorsOauthDisconnectResponse = z.infer<
  typeof ConnectorsOauthDisconnectResponseSchema
>;
export type ConnectorsOauthStatusMessage = z.infer<typeof ConnectorsOauthStatusMessageSchema>;

export const ReadProjectConfigRequestMessageSchema = z.object({
  type: z.literal("read_project_config_request"),
  requestId: z.string(),
  repoRoot: z.string(),
});

export const WriteProjectConfigRequestMessageSchema = z.object({
  type: z.literal("write_project_config_request"),
  requestId: z.string(),
  repoRoot: z.string(),
  config: OttoConfigRawSchema,
  expectedRevision: OttoConfigRevisionSchema.nullable(),
});

// ============================================================================
// Dictation Streaming (lossless, resumable)
// ============================================================================

export const DictationStreamStartMessageSchema = z.object({
  type: z.literal("dictation_stream_start"),
  dictationId: z.string(),
  format: z.string(), // e.g. "audio/pcm;rate=16000;bits=16"
});

export const DictationStreamChunkMessageSchema = z.object({
  type: z.literal("dictation_stream_chunk"),
  dictationId: z.string(),
  seq: z.number().int().nonnegative(),
  audio: z.string(), // base64 encoded chunk
  format: z.string(), // e.g. "audio/pcm;rate=16000;bits=16"
});

export const DictationStreamFinishMessageSchema = z.object({
  type: z.literal("dictation_stream_finish"),
  dictationId: z.string(),
  finalSeq: z.number().int().nonnegative(),
});

export const DictationStreamCancelMessageSchema = z.object({
  type: z.literal("dictation_stream_cancel"),
  dictationId: z.string(),
});

const GitSetupOptionsSchema = z.object({
  baseBranch: z.string().optional(),
  createNewBranch: z.boolean().optional(),
  newBranchName: z.string().optional(),
  createWorktree: z.boolean().optional(),
  worktreeSlug: z.string().optional(),
  refName: z.string().min(1).optional(),
  action: z.enum(["branch-off", "checkout"]).optional(),
  checkoutSource: ChangeRequestCheckoutSourceSchema.optional(),
  // COMPAT(githubPrNumber): added in v0.1.106, remove after 2026-12-28 once
  // clients send checkoutSource.
  githubPrNumber: z.number().int().positive().optional(),
});

export type GitSetupOptions = z.infer<typeof GitSetupOptionsSchema>;

export const CreateAgentWorktreeTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("branch-off"),
    newBranch: z.string().min(1),
    base: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal("checkout-branch"),
    branch: z.string().min(1),
  }),
  z.object({
    mode: z.literal("checkout-pr"),
    prNumber: z.number().int().positive(),
  }),
]);

export type CreateAgentWorktreeTarget = z.infer<typeof CreateAgentWorktreeTargetSchema>;

export const CreateAgentRequestMessageSchema = z.object({
  type: z.literal("create_agent_request"),
  config: AgentSessionConfigSchema,
  // Optional personality id. When present the daemon resolves the personality
  // against this cwd's provider snapshot and snapshots its identity (spinner,
  // voice, prompt) onto the agent - the brain (provider/model/mode/effort) still
  // comes from `config`, so hand-deviations in the picker keep the identity.
  // COMPAT(agentPersonalities): added in v0.5.0; gate lives in features.agentPersonalities.
  personality: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  workspaceId: z.string().optional(),
  // Optional caller context lets managed CLI invocations use the same daemon-owned
  // workspace and parentage policy as agent-scoped MCP creation.
  callerAgentId: z.string().optional(),
  worktreeName: z.string().optional(),
  initialPrompt: z.string().optional(),
  clientMessageId: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  git: GitSetupOptionsSchema.optional(),
  worktree: CreateAgentWorktreeTargetSchema.optional(),
  autoArchive: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  requestId: z.string(),
});

export const ListProviderModelsRequestMessageSchema = z.object({
  type: z.literal("list_provider_models_request"),
  provider: AgentProviderSchema,
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const ListProviderModesRequestMessageSchema = z.object({
  type: z.literal("list_provider_modes_request"),
  provider: AgentProviderSchema,
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const ListAvailableProvidersRequestMessageSchema = z.object({
  type: z.literal("list_available_providers_request"),
  requestId: z.string(),
});

export const GetProvidersSnapshotRequestMessageSchema = z.object({
  type: z.literal("get_providers_snapshot_request"),
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const RefreshProvidersSnapshotRequestMessageSchema = z.object({
  type: z.literal("refresh_providers_snapshot_request"),
  cwd: z.string().optional(),
  providers: z.array(AgentProviderSchema).optional(),
  requestId: z.string(),
});

export const ProviderDiagnosticRequestMessageSchema = z.object({
  type: z.literal("provider_diagnostic_request"),
  provider: AgentProviderSchema,
  requestId: z.string(),
});

export const ProviderUsageListRequestMessageSchema = z.object({
  type: z.literal("provider.usage.list.request"),
  requestId: z.string(),
});

export const ResumeAgentRequestMessageSchema = z.object({
  type: z.literal("resume_agent_request"),
  handle: AgentPersistenceHandleSchema,
  overrides: AgentSessionConfigSchema.partial().optional(),
  requestId: z.string(),
});

export const ImportAgentRequestMessageSchema = z.object({
  type: z.literal("import_agent_request"),
  provider: AgentProviderSchema.optional(),
  providerId: z.string().optional(),
  sessionId: z.string().optional(),
  providerHandleId: z.string().optional(),
  cwd: z.string().optional(),
  // The workspace the import was requested from. Present when the client has a
  // workspace context (a chat tab); absent from the home screen, where the
  // daemon resolves a workspace for the cwd instead.
  // COMPAT(importAgentWorkspaceId): added in v0.7.1, drop the optionality when
  // the floor is >= v0.7.1. An older client omits it and keeps the
  // resolve-by-directory behaviour.
  workspaceId: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  requestId: z.string(),
});

export const RefreshAgentRequestMessageSchema = z.object({
  type: z.literal("refresh_agent_request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const CancelAgentRequestMessageSchema = z.object({
  type: z.literal("cancel_agent_request"),
  agentId: z.string(),
  requestId: z.string().optional(),
});

export const RestartServerRequestMessageSchema = z.object({
  type: z.literal("restart_server_request"),
  reason: z.string().optional(),
  requestId: z.string(),
});

export const ShutdownServerRequestMessageSchema = z.object({
  type: z.literal("shutdown_server_request"),
  requestId: z.string(),
});

export const DaemonUpdateRequestMessageSchema = z.object({
  type: z.literal("daemon.update.request"),
  requestId: z.string(),
});

export const AgentTimelineCursorSchema = z.object({
  epoch: z.string(),
  seq: z.number().int().nonnegative(),
});

export const FetchAgentTimelineRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_request"),
  agentId: z.string(),
  requestId: z.string(),
  direction: z.enum(["tail", "before", "after"]).optional(),
  cursor: AgentTimelineCursorSchema.optional(),
  // 0 means "all matching rows for this query window".
  limit: z.number().int().nonnegative().optional(),
  // Default should be projected for app timeline loading.
  projection: z.enum(["projected", "canonical"]).optional(),
});

export const ProviderSubagentListRequestMessageSchema = z.object({
  type: z.literal("agent.provider_subagents.list.request"),
  parentAgentId: z.string(),
  requestId: z.string(),
});

export const ProviderSubagentTimelineRequestMessageSchema = z.object({
  type: z.literal("agent.provider_subagents.timeline.get.request"),
  parentAgentId: z.string(),
  subagentId: z.string(),
  requestId: z.string(),
  direction: z.enum(["tail", "before", "after"]).optional(),
  cursor: AgentTimelineCursorSchema.optional(),
  limit: z.number().int().nonnegative().optional(),
});

export const SetAgentTimelineSubscriptionRequestMessageSchema = z.object({
  type: z.literal("agent.timeline.set_subscription.request"),
  agentIds: z.array(z.string()),
  requestId: z.string(),
});

export const AgentForkContextRequestMessageSchema = z.object({
  type: z.literal("agent.fork_context.request"),
  agentId: z.string(),
  boundaryCursor: AgentTimelineCursorSchema.optional(),
  boundaryMessageId: z.string().optional(),
  requestId: z.string(),
});

export const SetAgentModeRequestMessageSchema = z.object({
  type: z.literal("set_agent_mode_request"),
  agentId: z.string(),
  modeId: z.string(),
  requestId: z.string(),
});

const AgentActionResponsePayloadSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  accepted: z.boolean(),
  error: z.string().nullable(),
  notice: AgentProviderNoticeSchema.nullable().optional(),
});

export const SetAgentModeResponseMessageSchema = z.object({
  type: z.literal("set_agent_mode_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentModelRequestMessageSchema = z.object({
  type: z.literal("set_agent_model_request"),
  agentId: z.string(),
  modelId: z.string().nullable(),
  requestId: z.string(),
});

export const SetAgentModelResponseMessageSchema = z.object({
  type: z.literal("set_agent_model_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentThinkingRequestMessageSchema = z.object({
  type: z.literal("set_agent_thinking_request"),
  agentId: z.string(),
  thinkingOptionId: z.string().nullable(),
  requestId: z.string(),
});

export const SetAgentThinkingResponseMessageSchema = z.object({
  type: z.literal("set_agent_thinking_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const SetAgentFeatureRequestMessageSchema = z.object({
  type: z.literal("set_agent_feature_request"),
  agentId: z.string(),
  featureId: z.string(),
  value: z.unknown(),
  requestId: z.string(),
});

export const SetAgentFeatureResponseMessageSchema = z.object({
  type: z.literal("set_agent_feature_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const AgentDetachRequestMessageSchema = z.object({
  type: z.literal("agent.detach.request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const AgentDetachResponseMessageSchema = z.object({
  type: z.literal("agent.detach.response"),
  payload: AgentActionResponsePayloadSchema,
});

// Move a chat into another workspace, in the same project or a different one.
//
// Ownership is one field (see the agent snapshot's `workspaceId`), independent of
// cwd, so re-stamping it is all a move takes: nothing on disk is keyed by
// workspace, and clients derive which workspace shows a chat from that field
// alone.
//
// The chat's `cwd` does not change, and does not have to match the target
// workspace's directory. The daemon has never required those to agree (an
// agent's cwd can already be a subdirectory of its workspace, and nothing
// validates one against the other), and a session already rooted on disk cannot
// honestly be re-rooted. So a moved chat keeps running where it was started.
//
// Gated by server_info.features.agentWorkspaceTransfer.
export const AgentWorkspaceTransferRequestMessageSchema = z.object({
  type: z.literal("agent.workspace.transfer.request"),
  agentId: z.string(),
  // The workspace that should own the chat from now on.
  workspaceId: z.string(),
  requestId: z.string(),
});

// Stop a running observed subagent (Claude Task / ultracode fan-out). The
// agentId is the observed subagent's id; the daemon resolves it to the owning
// provider session's task and calls stopTask. Only observed subagents accept
// this. COMPAT(observedSubagents): added in v0.4.3. See projects/observed-subagents/observed-subagents.md.
export const AgentSubagentStopRequestMessageSchema = z.object({
  type: z.literal("agent.subagent.stop.request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const AgentSubagentStopResponseMessageSchema = z.object({
  type: z.literal("agent.subagent.stop.response"),
  payload: AgentActionResponsePayloadSchema,
});

// A background shell task launched by a provider's own Bash tool (Claude:
// run_in_background). Not an agent, not a subagent - a plain shell process
// the daemon tracks for the parent agent's Background Tasks track.
// COMPAT(backgroundShellTasks): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
export const BackgroundShellTaskInfoSchema = z.object({
  id: z.string(),
  parentAgentId: z.string(),
  provider: z.string(),
  command: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["running", "idle", "error", "closed"]),
  requiresAttention: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
});

// Pushed with the full current set of background shell tasks for a parent
// agent whenever any of them changes (start/progress/settle/clear) - same
// full-list reconciliation shape as TerminalsChangedSchema.
export const BackgroundShellTasksChangedSchema = z.object({
  type: z.literal("background_shell_tasks_changed"),
  payload: z.object({
    parentAgentId: z.string(),
    tasks: z.array(BackgroundShellTaskInfoSchema),
  }),
});

// Stop a running background shell task. The daemon resolves it to the owning
// provider session's task and calls stopTask, same as agent.subagent.stop.
export const AgentBackgroundTaskStopRequestMessageSchema = z.object({
  type: z.literal("agent.background_task.stop.request"),
  parentAgentId: z.string(),
  taskId: z.string(),
  requestId: z.string(),
});

export const AgentBackgroundTaskStopResponseMessageSchema = z.object({
  type: z.literal("agent.background_task.stop.response"),
  payload: AgentActionResponsePayloadSchema,
});

// Clear one or more terminal background shell tasks from the track. Still-live
// tasks are stopped best-effort first.
export const AgentBackgroundTaskClearRequestMessageSchema = z.object({
  type: z.literal("agent.background_task.clear.request"),
  parentAgentId: z.string(),
  taskIds: z.array(z.string()),
  requestId: z.string(),
});

export const AgentBackgroundTaskClearResponseMessageSchema = z.object({
  type: z.literal("agent.background_task.clear.response"),
  payload: AgentActionResponsePayloadSchema,
});

// ---------------------------------------------------------------------------
// Personality memory - the lessons a named personality accrues across sessions.
// See docs/agent-personalities.md § Memory.
// ---------------------------------------------------------------------------

// Switch a running agent to an Agent Personality (or clear with null). The
// daemon re-resolves the id against the roster + the agent's cwd provider
// snapshot and applies the full personality live - system prompt, identity
// (name/spinner), and brain (model/mode/effort) - restarting the provider query
// so the new prompt takes effect on the next turn. Providers that cannot apply
// a prompt mid-session reject. COMPAT(setAgentPersonality): added in v0.5.0;
// gate lives in features.setAgentPersonality.
export const AgentPersonalitySetRequestMessageSchema = z.object({
  type: z.literal("agent.personality.set.request"),
  agentId: z.string(),
  personalityId: z.string().nullable(),
  requestId: z.string(),
});

export const AgentPersonalitySetResponseMessageSchema = z.object({
  type: z.literal("agent.personality.set.response"),
  payload: AgentActionResponsePayloadSchema,
});

export const AgentRewindModeSchema = z.enum(["conversation", "files", "both"]);

export const AgentRewindRequestMessageSchema = z.object({
  type: z.literal("agent.rewind.request"),
  agentId: z.string(),
  messageId: z.string(),
  mode: AgentRewindModeSchema,
  requestId: z.string(),
});

export const AgentRewindResponseMessageSchema = z.object({
  type: z.literal("agent.rewind.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const UpdateAgentResponseMessageSchema = z.object({
  type: z.literal("update_agent_response"),
  payload: AgentActionResponsePayloadSchema,
});

export const ProjectRenameResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  accepted: z.boolean(),
  customName: z.string().nullable(),
  error: z.string().nullable(),
});

export const ProjectRenameResponseSchema = z.object({
  type: z.literal("project.rename.response"),
  payload: ProjectRenameResponsePayloadSchema,
});

export const ProjectRemoveResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  accepted: z.boolean(),
  removedWorkspaceIds: z.array(z.string()).default([]),
  error: z.string().nullable(),
});

export const ProjectRemoveResponseSchema = z.object({
  type: z.literal("project.remove.response"),
  payload: ProjectRemoveResponsePayloadSchema,
});

export const WorkspaceTitleSetResponsePayloadSchema = z.object({
  requestId: z.string(),
  workspaceId: z.string(),
  accepted: z.boolean(),
  title: z.string().nullable(),
  error: z.string().nullable(),
});

export const WorkspaceTitleSetResponseSchema = z.object({
  type: z.literal("workspace.title.set.response"),
  payload: WorkspaceTitleSetResponsePayloadSchema,
});

export const AgentWorkspaceTransferResponsePayloadSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  // Which workspace owns the chat now: the requested one when accepted, the one
  // it never left when refused. Lets a client correct its optimistic state from
  // the response alone.
  workspaceId: z.string().nullable(),
  accepted: z.boolean(),
  error: z.string().nullable(),
});

export const AgentWorkspaceTransferResponseMessageSchema = z.object({
  type: z.literal("agent.workspace.transfer.response"),
  payload: AgentWorkspaceTransferResponsePayloadSchema,
});

export const WorkspacePinSetResponsePayloadSchema = z.object({
  requestId: z.string(),
  workspaceId: z.string(),
  accepted: z.boolean(),
  pinnedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const WorkspacePinSetResponseSchema = z.object({
  type: z.literal("workspace.pin.set.response"),
  payload: WorkspacePinSetResponsePayloadSchema,
});

export const WorkspaceRecoveryStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recoverable"),
    workspaceId: z.string(),
    workspaceName: z.string(),
    action: z.string(),
    branch: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("unavailable"),
    workspaceId: z.string(),
    reason: z.string(),
    message: z.string(),
  }),
]);

export const WorkspaceRecoveryInspectResponseSchema = z.object({
  type: z.literal("workspace.recovery.inspect.response"),
  payload: z.object({
    requestId: z.string(),
    state: WorkspaceRecoveryStateSchema,
  }),
});

export const WorkspaceRecoveryRestoreResponseSchema = z.object({
  type: z.literal("workspace.recovery.restore.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const SetVoiceModeResponseMessageSchema = z.object({
  type: z.literal("set_voice_mode_response"),
  payload: z.object({
    requestId: z.string(),
    enabled: z.boolean(),
    agentId: z.string().nullable(),
    accepted: z.boolean(),
    error: z.string().nullable(),
    reasonCode: z.string().optional(),
    retryable: z.boolean().optional(),
    missingModelIds: z.array(z.string()).optional(),
  }),
});

export const AgentPermissionResponseMessageSchema = z.object({
  type: z.literal("agent_permission_response"),
  agentId: z.string(),
  requestId: z.string(),
  response: AgentPermissionResponseSchema,
});

const CheckoutErrorCodeSchema = z.enum([
  "NOT_GIT_REPO",
  "NOT_ALLOWED",
  "MERGE_CONFLICT",
  "UNKNOWN",
]);

const CheckoutErrorSchema = z.object({
  code: CheckoutErrorCodeSchema,
  message: z.string(),
});

const CheckoutDiffCompareSchema = z.object({
  mode: z.enum(["uncommitted", "base"]),
  baseRef: z.string().optional(),
  ignoreWhitespace: z.boolean().optional(),
});

export const CheckoutStatusRequestSchema = z.object({
  type: z.literal("checkout_status_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const SubscribeCheckoutDiffRequestSchema = z.object({
  type: z.literal("subscribe_checkout_diff_request"),
  subscriptionId: z.string(),
  cwd: z.string(),
  compare: CheckoutDiffCompareSchema,
  requestId: z.string(),
});

export const UnsubscribeCheckoutDiffRequestSchema = z.object({
  type: z.literal("unsubscribe_checkout_diff_request"),
  subscriptionId: z.string(),
});

export const CheckoutCommitRequestSchema = z.object({
  type: z.literal("checkout_commit_request"),
  cwd: z.string(),
  message: z.string().optional(),
  addAll: z.boolean().optional(),
  requestId: z.string(),
});

// ── Git file investigation (local git, no hosting provider) ─────────────────
// History / per-commit diff / blame / origin commit for one file or one line
// range within it. Everything below is plain local git: it works in a repo with
// no remote and no forge connection, and it is provider-neutral by construction
// (it inspects the repo, not an agent), so there is no per-provider rollout to
// look for. Gated by server_info.features.checkoutGitFileHistory.

// Commits that touched a file, newest first. Whole-file mode follows renames;
// passing startLine/endLine switches to `git log -L` for that range instead.
export const CheckoutGitFileHistoryRequestSchema = z.object({
  type: z.literal("checkout.git.get_file_history.request"),
  cwd: z.string(),
  // Repo-relative path, as the file is named today.
  path: z.string(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  // 1-based inclusive line range. Both or neither.
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  requestId: z.string(),
});

// What a single commit did to a single file, as a unified diff. `path` must be
// the file's name *at that commit* (history entries carry it) or the pathspec
// misses across a rename.
export const CheckoutGitFileCommitDiffRequestSchema = z.object({
  type: z.literal("checkout.git.get_file_commit_diff.request"),
  cwd: z.string(),
  path: z.string(),
  sha: z.string(),
  ignoreWhitespace: z.boolean().optional(),
  requestId: z.string(),
});

// One page of blame. Always paged - blaming a large file whole would block the
// daemon - so the client walks the file a page at a time.
export const CheckoutGitFileBlameRequestSchema = z.object({
  type: z.literal("checkout.git.get_file_blame.request"),
  cwd: z.string(),
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  lineCount: z.number().int().positive().optional(),
  // Blame at a specific commit instead of the working tree.
  sha: z.string().optional(),
  requestId: z.string(),
});

// The commit that first added the file ("who originally wrote this"), following
// renames so a moved file reports its true origin.
export const CheckoutGitFileOriginRequestSchema = z.object({
  type: z.literal("checkout.git.get_file_origin.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const CheckoutMergeRequestSchema = z.object({
  type: z.literal("checkout_merge_request"),
  cwd: z.string(),
  baseRef: z.string().optional(),
  strategy: z.enum(["merge", "squash"]).optional(),
  requireCleanTarget: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutMergeFromBaseRequestSchema = z.object({
  type: z.literal("checkout_merge_from_base_request"),
  cwd: z.string(),
  baseRef: z.string().optional(),
  requireCleanTarget: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutPullRequestSchema = z.object({
  type: z.literal("checkout_pull_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutPushRequestSchema = z.object({
  type: z.literal("checkout_push_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutRefreshRequestSchema = z.object({
  type: z.literal("checkout.refresh.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutGitFetchRequestSchema = z.object({
  type: z.literal("checkout.git.fetch.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutPrCreateRequestSchema = z.object({
  type: z.literal("checkout_pr_create_request"),
  cwd: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  baseRef: z.string().optional(),
  requestId: z.string(),
});

export const CheckoutPrMergeRequestSchema = z.object({
  type: z.literal("checkout_pr_merge_request"),
  cwd: z.string(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]),
  requestId: z.string(),
});

export const CheckoutForgeSetAutoMergeRequestSchema = z.object({
  type: z.literal("checkout.forge.set_auto_merge.request"),
  cwd: z.string(),
  enabled: z.boolean(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  requestId: z.string(),
});

// COMPAT(githubAutoMergeRpc): added in v0.1.106, remove after 2026-12-28 once
// all supported clients use checkout.forge.set_auto_merge.*.
export const CheckoutGithubSetAutoMergeRequestSchema = z.object({
  type: z.literal("checkout.github.set_auto_merge.request"),
  cwd: z.string(),
  enabled: z.boolean(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  requestId: z.string(),
});

const CheckoutCommitFileSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(["added", "modified", "deleted", "renamed"]).optional(),
});

const CheckoutCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authorDate: z.string(), // ISO 8601
  isOnRemote: z.boolean(), // false = local-only (unpushed)
  // COMPAT(commitBaseClassification): added in v0.2.0, remove optional after 2027-01-23.
  isOnBase: z.boolean().optional(),
  files: z.array(CheckoutCommitFileSchema),
});

export const CheckoutCommitsListRequestSchema = z.object({
  type: z.literal("checkout.commits.list.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutCommitFileDiffRequestSchema = z.object({
  type: z.literal("checkout.commits.file_diff.request"),
  cwd: z.string(),
  sha: z.string(),
  path: z.string(),
  requestId: z.string(),
});

const GitHubRepoSegmentSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);

const CheckoutCheckDetailsRequestPayloadSchema = z.object({
  cwd: z.string(),
  // GitHub addresses check runs by owner/name. GitLab resolves the project from
  // cwd and omits these GitHub-only single-segment fields.
  repoOwner: GitHubRepoSegmentSchema.optional(),
  repoName: GitHubRepoSegmentSchema.optional(),
  // Permanently optional: a check addressed only by workflowRunId (Gitea
  // Actions runs carry no check-run id) is fetchable. Callers send at least one
  // of checkRunId/workflowRunId; the gated forge RPC only reaches daemons that
  // understand this.
  checkRunId: z.number().int().positive().optional(),
  workflowRunId: z.number().int().positive().optional(),
  // Permanent forge-routing field, optional because only some forges need it:
  // GitLab routes check details to the MR's head pipeline; Gitea-family adapters
  // resolve the PR head SHA by number, including after merge/close. GitHub
  // ignores it.
  changeRequestNumber: z.number().int().positive().optional(),
  requestId: z.string(),
});

export const CheckoutForgeGetCheckDetailsRequestSchema =
  CheckoutCheckDetailsRequestPayloadSchema.extend({
    type: z.literal("checkout.forge.get_check_details.request"),
  });

// COMPAT(githubCheckDetailsRpc): added in v0.1.106, remove after 2026-12-28 once
// all supported clients use checkout.forge.get_check_details.*.
export const CheckoutGithubGetCheckDetailsRequestSchema =
  CheckoutCheckDetailsRequestPayloadSchema.extend({
    type: z.literal("checkout.github.get_check_details.request"),
  });

export const CheckoutPrStatusRequestSchema = z.object({
  type: z.literal("checkout_pr_status_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const PullRequestTimelineRequestSchema = z.object({
  type: z.literal("pull_request_timeline_request"),
  cwd: z.string(),
  prNumber: z.number(),
  repoOwner: z.string(),
  repoName: z.string(),
  requestId: z.string(),
});

export const ValidateBranchRequestSchema = z.object({
  type: z.literal("validate_branch_request"),
  cwd: z.string(),
  branchName: z.string(),
  requestId: z.string(),
});

export const CheckoutSwitchBranchRequestSchema = z.object({
  type: z.literal("checkout_switch_branch_request"),
  cwd: z.string(),
  branch: z.string(),
  requestId: z.string(),
});

export const CheckoutRenameBranchRequestSchema = z.object({
  type: z.literal("checkout.rename_branch.request"),
  cwd: z.string(),
  branch: z.string(),
  requestId: z.string(),
});

export const StashSaveRequestSchema = z.object({
  type: z.literal("stash_save_request"),
  cwd: z.string(),
  /** Branch name to tag the stash with for later identification. */
  branch: z.string().optional(),
  requestId: z.string(),
});

export const StashPopRequestSchema = z.object({
  type: z.literal("stash_pop_request"),
  cwd: z.string(),
  /** Zero-based index from stash_list_response. */
  stashIndex: z.number().int().min(0),
  requestId: z.string(),
});

export const StashListRequestSchema = z.object({
  type: z.literal("stash_list_request"),
  cwd: z.string(),
  /** If true, only return otto-created stashes. Default true. */
  ottoOnly: z.boolean().optional(),
  requestId: z.string(),
});

export const BranchSuggestionsRequestSchema = z.object({
  type: z.literal("branch_suggestions_request"),
  cwd: z.string(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  requestId: z.string(),
});

export const GitHubSearchItemSchema = z.object({
  kind: z.enum(["issue", "pr"]),
  forge: z.string().optional(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

export const ForgeSearchItemSchema = GitHubSearchItemSchema.extend({
  kind: z.enum(["issue", "change_request"]),
});

// COMPAT(githubSearchKind): added in v0.1.106, remove with the legacy
// github_search_request RPC after 2026-12-28.
export const ForgeSearchKindSchema = z.enum([
  "issue",
  "change_request",
  "github-issue",
  "github-pr",
  "pr",
]);

export const GitHubSearchKindSchema = ForgeSearchKindSchema;

export const ForgeSearchRequestSchema = z.object({
  type: z.literal("forge.search.request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(ForgeSearchKindSchema).optional(),
  requestId: z.string(),
});

// COMPAT(githubSearchRpc): added in v0.1.106, remove after 2026-12-28 once
// clients use forge.search.*.
export const GitHubSearchRequestSchema = z.object({
  type: z.literal("github_search_request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(GitHubSearchKindSchema).optional(),
  requestId: z.string(),
});

export const DirectorySuggestionsRequestSchema = z.object({
  type: z.literal("directory_suggestions_request"),
  query: z.string(),
  cwd: z.string().optional(),
  includeFiles: z.boolean().optional(),
  includeDirectories: z.boolean().optional(),
  matchMode: z.enum(["fuzzy", "suffix"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  requestId: z.string(),
});

export const OttoWorktreeListRequestSchema = z.object({
  type: z.literal("otto_worktree_list_request"),
  cwd: z.string().optional(),
  repoRoot: z.string().optional(),
  requestId: z.string(),
});

export const OttoWorktreeArchiveRequestSchema = z.object({
  type: z.literal("otto_worktree_archive_request"),
  worktreePath: z.string().optional(),
  repoRoot: z.string().optional(),
  branchName: z.string().optional(),
  // COMPAT(worktreeArchiveWorkspaceId): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
  // Explicit workspace record to archive. A directory can back multiple workspaces
  // (Model B), so resolving the target by cwd alone picks the wrong record. When
  // present the daemon archives this exact workspace; when absent it falls back to
  // resolving by worktreePath, preferring the worktree-kind record on a cwd tie.
  workspaceId: z.string().optional(),
  // COMPAT(worktreeArchiveScope): added in v0.1.97, drop the gate when floor >= v0.1.97.
  // Scope of the archive operation. "workspace" archives a single workspace record
  // (today's default UI behavior). "worktree" archives every active workspace whose
  // cwd resolves to the target directory, then removes the directory if it is
  // Otto-owned. Omitted/unknown values default to "workspace" for old-client safety.
  scope: z.enum(["workspace", "worktree"]).optional().default("workspace"),
  // COMPAT(worktreeDiskDeletion): added in v0.1.97, ignored as of v0.1.97
  // (disk removal derived from scope + last-reference + ownership); field
  // retained for wire parse-compat, drop when floor >= v0.1.97.
  deleteWorktreeFromDisk: z.boolean().optional().default(false),
  requestId: z.string(),
});

export const FirstAgentContextSchema = z.object({
  prompt: z.string().optional(),
  attachments: AgentAttachmentsSchema,
});

export const CreateOttoWorktreeRequestSchema = z.object({
  type: z.literal("create_otto_worktree_request"),
  cwd: z.string(),
  projectId: z.string().optional(),
  worktreeSlug: z.string().optional(),
  nameContext: z.string().optional(),
  attachments: AgentAttachmentsSchema.optional(),
  firstAgentContext: FirstAgentContextSchema.optional(),
  refName: z.string().min(1).optional(),
  action: z.enum(["branch-off", "checkout"]).optional(),
  checkoutSource: ChangeRequestCheckoutSourceSchema.optional(),
  // COMPAT(githubPrNumber): added in v0.1.106, remove after 2026-12-28 once
  // clients send checkoutSource: { kind: "change_request", forge, number }.
  githubPrNumber: z.number().int().positive().optional(),
  requestId: z.string(),
});

export const WorkspaceSetupStatusRequestSchema = z.object({
  type: z.literal("workspace_setup_status_request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

// COMPAT(desktopEditorBridge): added in v0.1.88, remove after 2026-12-03 once old clients no longer call daemon editor RPCs.
export const LegacyListAvailableEditorsRequestSchema = z.object({
  type: z.literal("list_available_editors_request"),
  requestId: z.string(),
});

export const LegacyOpenInEditorRequestSchema = z.object({
  type: z.literal("open_in_editor_request"),
  path: z.string(),
  editorId: z.string().trim().min(1),
  mode: z.enum(["open", "reveal"]).optional(),
  cwd: z.string().optional(),
  requestId: z.string(),
});

export const OpenProjectRequestSchema = z.object({
  type: z.literal("open_project_request"),
  // Path used only for workspace lookup/creation. Use the returned workspace.id for all subsequent references.
  cwd: z.string(),
  requestId: z.string(),
});

// Smallest shorthand repo path is "a/b": owner, slash, repository.
const MIN_REPOSITORY_PATH_LENGTH = 3;

export const ProjectAddRequestSchema = z.object({
  type: z.literal("project.add.request"),
  cwd: z.string(),
  requestId: z.string(),
});

// ── New project scaffolding ──────────────────────────────────────────────
// project.add takes a directory that already exists. Scaffolding is the other
// half: create the directory, optionally give it a git repo (fresh, or cloned
// from a remote), optionally create that remote on a connected hosting
// provider, then register the result as a project. One RPC rather than a
// client-driven sequence so a half-finished project can never be left behind by
// a dropped socket - the daemon owns the whole transaction.
// COMPAT(projectScaffold): added in v0.6.9. Gated by server_info.features.projectScaffold.

// Built-in .gitignore starters. Deliberately a short list of the ecosystems Otto
// itself works in - this is a convenience, not a mirror of github/gitignore. The
// wire field stays an open string so a newer daemon can add one without an older
// client's validator rejecting the message.
export const PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS = [
  "node",
  "python",
  "go",
  "rust",
  "java",
  "dotnet",
] as const;

export type ProjectScaffoldGitignoreTemplateId =
  (typeof PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS)[number];

// Where the working tree comes from.
export const ProjectScaffoldGitSchema = z.discriminatedUnion("kind", [
  // A plain directory. No repository is created.
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("init"),
    // Branch the fresh repo starts on. Absent means the daemon's git default.
    initialBranch: z.string().optional(),
    // Starter files written before the first commit.
    addReadme: z.boolean().optional(),
    // Identifier of a built-in .gitignore template (see PROJECT_SCAFFOLD_GITIGNORE_TEMPLATE_IDS).
    gitignoreTemplate: z.string().optional(),
    // Commit whatever starter files were written. Required for a push.
    initialCommit: z.boolean().optional(),
    // Create the repository on a hosting provider, wire it as `origin`, and push.
    // Requires the provider's createRepository capability.
    remote: z
      .object({
        providerId: GitHostingProviderIdWireSchema,
        // Account/organization/workspace to create under. Null means the
        // provider's default for the authenticated identity.
        owner: z.string().nullable(),
        name: z.string(),
        description: z.string().optional(),
        visibility: z.enum(["private", "public"]),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("clone"),
    // Any URL `git clone` accepts (https, ssh, scp-style).
    url: z.string(),
  }),
]);

export const ProjectScaffoldRequestSchema = z.object({
  type: z.literal("project.scaffold.request"),
  requestId: z.string(),
  // Existing directory that will contain the new project folder.
  parentDirectory: z.string(),
  // Single path segment created inside parentDirectory. For a clone this may be
  // omitted, in which case the daemon derives it from the repository URL.
  folderName: z.string().optional(),
  git: ProjectScaffoldGitSchema,
});

// Steps are reported in the order the daemon runs them. New daemons may add
// steps, so the wire form stays an open string and clients label unknown ids
// generically instead of dropping the progress message.
export const ProjectScaffoldStepIdSchema = z.string();

export const ProjectScaffoldStepStatusSchema = z.enum(["running", "done", "skipped", "failed"]);

export const ProjectScaffoldStepSchema = z.object({
  id: ProjectScaffoldStepIdSchema,
  status: ProjectScaffoldStepStatusSchema,
  detail: z.string().nullable(),
});

export const ProjectCreateDirectoryRequestSchema = z.object({
  type: z.literal("project.create_directory.request"),
  parentPath: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const GithubRepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameWithOwner: z.string().min(MIN_REPOSITORY_PATH_LENGTH),
  description: z.string().nullable(),
  visibility: z.enum(["public", "private", "internal"]),
  updatedAt: z.string(),
  cloneUrl: z.string().min(MIN_REPOSITORY_PATH_LENGTH),
});

export const WorkspaceGithubSearchRepositoriesRequestSchema = z.object({
  type: z.literal("workspace.github.search_repositories.request"),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  requestId: z.string(),
});

export const ProjectGithubCloneProtocolSchema = z.enum(["https", "ssh"]);

export const ProjectGithubCloneRequestSchema = z.object({
  type: z.literal("project.github.clone.request"),
  repo: z.string().trim().min(MIN_REPOSITORY_PATH_LENGTH),
  cloneProtocol: ProjectGithubCloneProtocolSchema.optional(),
  targetDirectory: z.string().trim().min(1),
  requestId: z.string(),
});

export const ArchiveWorkspaceRequestSchema = z.object({
  type: z.literal("archive_workspace_request"),
  workspaceId: z.string(),
  requestId: z.string(),
  // COMPAT(worktreeArchiveBranchCleanup): added in v0.6.7, drop the optional
  // gate when daemon floor >= v0.6.7. Absent means "keep" - the leftover local
  // branch is never touched (old-client behavior). "delete" asks the daemon to
  // remove the worktree's local branch after the backing directory is torn down
  // (only when this was the last reference to it and the branch is not checked
  // out elsewhere). Gated by server_info.features.worktreeArchiveBranchCleanup.
  branchDisposition: z.enum(["keep", "delete"]).optional(),
});

// Create a new workspace record. Unlike open_project, this never deduplicates by
// directory: it always produces a fresh workspace. The source discriminates
// between an existing local directory and a newly created otto worktree.
export const WorkspaceCreateRequestSchema = z.object({
  type: z.literal("workspace.create.request"),
  requestId: z.string(),
  // Optional user-set title applied to the created workspace.
  title: z.string().optional(),
  // Optional prompt context for workspace-level name/branch generation.
  firstAgentContext: FirstAgentContextSchema.optional(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("directory"),
      // Path of the existing checkout/directory to back the workspace.
      path: z.string(),
      projectId: z.string().optional(),
    }),
    z.object({
      kind: z.literal("worktree"),
      // The project whose repo the worktree is cut from.
      cwd: z.string().optional(),
      projectId: z.string().optional(),
      action: z.enum(["branch-off", "checkout"]).optional(),
      // Branch to check out for "checkout". For "branch-off" this is the BASE to
      // cut from, not the branch being created -- the new branch name comes from
      // worktreeSlug (see resolveWorktreeCreationIntent). Omit it to branch off
      // the repository default.
      refName: z.string().min(1).optional(),
      baseBranch: z.string().optional(),
      // New branch name for branch-off. The worktree path may use a different slug.
      branchName: z.string().min(1).optional(),
      checkoutSource: ChangeRequestCheckoutSourceSchema.optional(),
      // COMPAT(githubPrNumber): added in v0.1.106, remove after 2026-12-28 once
      // clients send checkoutSource.
      githubPrNumber: z.number().int().positive().optional(),
      worktreeSlug: z.string().optional(),
    }),
  ]),
});

// Re-attach a "left" Otto worktree as a live workspace. Two targets: revive an
// archived worktree workspace record in place (recreating its backing directory
// from the kept branch when it is gone), or bind a fresh workspace to an orphaned
// on-disk Otto worktree that no live workspace references.
// COMPAT(worktreeReattach): added in v0.6.7. Gated by server_info.features.worktreeReattach.
export const WorktreeReattachTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workspace"),
    workspaceId: z.string(),
  }),
  z.object({
    kind: z.literal("orphan"),
    worktreePath: z.string(),
    projectId: z.string().optional(),
  }),
]);

export const WorktreeReattachRequestSchema = z.object({
  type: z.literal("worktree.reattach.request"),
  requestId: z.string(),
  target: WorktreeReattachTargetSchema,
});

// List re-attachable Otto worktrees for a project/repo: archived worktree
// workspace records whose branch is kept, plus orphaned on-disk worktrees with no
// live workspace. Either projectId or a cwd inside the repo is required.
export const WorktreeReattachListRequestSchema = z.object({
  type: z.literal("worktree.reattach.list.request"),
  requestId: z.string(),
  projectId: z.string().optional(),
  cwd: z.string().optional(),
});

export const WorkspaceClearAttentionRequestSchema = z.object({
  type: z.literal("workspace.clear_attention.request"),
  workspaceId: z.union([z.string(), z.array(z.string())]),
  requestId: z.string(),
});

// Highlighted diff token schema
// Note: style can be a compound class name (e.g., "heading meta") from the syntax highlighter
const HighlightTokenSchema = z.object({
  text: z.string(),
  style: z.string().nullable(),
});

const DiffLineSchema = z.object({
  type: z.enum(["add", "remove", "context", "header"]),
  content: z.string(),
  tokens: z.array(HighlightTokenSchema).optional(),
});

const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(DiffLineSchema),
});

const ParsedDiffFileSchema = z.object({
  path: z.string(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(DiffHunkSchema),
  // Optional so older daemons remain wire-compatible. Whole snapshots are
  // size-bounded by the daemon and let Structural parse files, never isolated
  // patch hunks.
  beforeSource: z.string().optional(),
  afterSource: z.string().optional(),
  status: z.enum(["ok", "too_large", "binary"]).optional(),
});

const FileExplorerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number(),
  modifiedAt: z.string(),
});

const FileExplorerFileSchema = z.object({
  path: z.string(),
  kind: z.enum(["text", "image", "binary"]),
  encoding: z.enum(["utf-8", "base64", "none"]),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number(),
  modifiedAt: z.string(),
  // COMPAT(textEditor): added in v0.4.4 for editor buffers (text files on the
  // inline JSON read path only); old daemons omit both fields.
  eol: FileEolSchema.optional(),
  hash: z.string().optional(),
  revision: z.string().optional(),
});

const FileExplorerDirectorySchema = z.object({
  path: z.string(),
  entries: z.array(FileExplorerEntrySchema),
});

export const FileExplorerRequestSchema = z.object({
  type: z.literal("file_explorer_request"),
  cwd: z.string(),
  path: z.string().optional(),
  mode: z.enum(["list", "file"]),
  requestId: z.string(),
  acceptBinary: z.boolean().optional(),
});

export const FileVersionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    cwd: z.string(),
    path: z.string(),
    size: z.number().int().nonnegative(),
    modifiedAt: z.string(),
    revision: z.string().optional(),
  }),
  z.object({
    status: z.literal("missing"),
    cwd: z.string(),
    path: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    cwd: z.string(),
    path: z.string(),
    error: z.string(),
  }),
]);

export const FileSubscribeRequestSchema = z.object({
  type: z.literal("fs.file.subscribe.request"),
  cwd: z.string(),
  path: z.string(),
  subscriptionId: z.string(),
  requestId: z.string(),
});

export const FileUnsubscribeRequestSchema = z.object({
  type: z.literal("fs.file.unsubscribe.request"),
  subscriptionId: z.string(),
  requestId: z.string(),
});

export const FsFileWriteRequestSchema = z.object({
  type: z.literal("fs.file.write.request"),
  cwd: z.string(),
  path: z.string(),
  content: z.string(),
  expectedModifiedAt: z.string(),
  expectedRevision: z.string().optional(),
  requestId: z.string(),
});

/**
 * Write bytes to a workspace file.
 *
 * The counterpart to `fs.file.write`, which is text only: it LF-normalizes,
 * re-applies the file's detected EOL, and outright refuses to overwrite a file
 * whose current bytes look binary. None of that can carry a PDF, an image or
 * any other generated artifact, so those go through here instead - the bytes
 * land verbatim.
 *
 * Deliberately not a conditional write. Callers are producing a generated file
 * from a source they already hold, so there is no "the file changed under you"
 * to reconcile: either the caller means to replace what is there or it does
 * not, and `overwrite` says which. Keeping that explicit is what stops this
 * from being a clobber-any-path primitive.
 *
 * Workspace-bounded, like the create/delete/rename surface and unlike
 * `file.write`. `file.write` is unbounded because a tab may edit a file the
 * user opened from anywhere; putting new bytes at an arbitrary path on the host
 * is a different power and does not need to be that wide.
 *
 * The bytes themselves do not ride in this message. They follow it as
 * `FileTransfer` binary frames correlated on `requestId` - FileBegin, then
 * FileChunk, then FileEnd - the same transport `file.upload` uses. This request
 * is the metadata half: where the bytes go and how many of them to expect.
 * Everything here writes multi-megabyte files (a printed PDF, a dropped image),
 * and base64 in a JSON message costs a third again on the wire plus the whole
 * encoded string allocated on both sides and walked by the validator.
 */
export const FsFileWriteBinaryRequestSchema = z.object({
  type: z.literal("fs.file.write_binary.request"),
  cwd: z.string(),
  path: z.string(),
  /**
   * Byte length of the payload to follow. The daemon refuses a transfer that
   * overruns it and refuses one that ends short, so a truncated stream fails
   * loudly instead of landing a half file. Optional only because the base64
   * form below predates it and carries its own length.
   */
  size: z.number().int().nonnegative().optional(),
  /**
   * base64. Decoded and written as-is: no EOL translation, no re-encoding.
   *
   * COMPAT(binaryWriteBase64): added in v0.7.6, drop this field and its daemon
   * branch on 2027-02-02. Superseded by `size` plus file-transfer frames. The
   * daemon still reads it - a field we stopped sending is not a field we stop
   * accepting - and picks the branch from which of the two is present.
   */
  contentBase64: z.string().optional(),
  /**
   * Replace an existing file. Absent (the default) an existing target comes
   * back as `exists` and nothing is written.
   */
  overwrite: z.boolean().optional(),
  requestId: z.string(),
});

export const ProjectIconRequestSchema = z.object({
  type: z.literal("project_icon_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const FileDownloadTokenRequestSchema = z.object({
  type: z.literal("file_download_token_request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const FileUploadRequestSchema = z.object({
  type: z.literal("file.upload.request"),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  requestId: z.string(),
});

/**
 * Text-editor save. A conditional write: the request carries the client's
 * last-known file identity and the daemon refuses to clobber content it did
 * not hand out - a mismatch comes back as a typed conflict, never a write.
 */
export const FileWriteRequestSchema = z.object({
  type: z.literal("file.write.request"),
  cwd: z.string(),
  path: z.string(),
  // LF-normalized UTF-8 text; the daemon re-applies the file's detected EOL.
  content: z.string(),
  expectedModifiedAt: z.string(),
  expectedHash: z.string().optional(),
  // Set only by the deleted-file "save re-creates" flow; a missing target is
  // otherwise never an invitation to create one. When the file reappeared in
  // the meantime, the normal precondition check still applies.
  allowCreate: z.boolean().optional(),
  // EOL to apply when creating (there is no on-disk EOL to detect).
  eol: FileEolSchema.optional(),
  requestId: z.string(),
});

export const ClearAgentAttentionMessageSchema = z.object({
  type: z.literal("clear_agent_attention"),
  agentId: z.union([z.string(), z.array(z.string())]),
  requestId: z.string().optional(),
});

export const ClientHeartbeatMessageSchema = z.object({
  type: z.literal("client_heartbeat"),
  deviceType: z.enum(["web", "mobile"]),
  focusedAgentId: z.string().nullable(),
  // COMPAT(terminalFocusHeartbeat): added in v0.1.97, remove optional default after 2026-12-13 once old clients no longer send heartbeats without terminal focus.
  focusedTerminalId: z.string().nullable().optional().default(null),
  lastActivityAt: z.string(),
  appVisible: z.boolean(),
  appVisibilityChangedAt: z.string().optional(),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
  requestId: z.string(),
  clientSentAt: z.number().int().optional(),
});

const ListCommandsDraftConfigSchema = z.object({
  provider: AgentProviderSchema,
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
});

export const ListProviderFeaturesRequestMessageSchema = z.object({
  type: z.literal("list_provider_features_request"),
  draftConfig: ListCommandsDraftConfigSchema,
  requestId: z.string(),
});

export const ListCommandsRequestSchema = z.object({
  type: z.literal("list_commands_request"),
  agentId: z.string(),
  draftConfig: ListCommandsDraftConfigSchema.optional(),
  requestId: z.string(),
});

export const RegisterPushTokenMessageSchema = z.object({
  type: z.literal("register_push_token"),
  token: z.string(),
});

// ============================================================================
// Terminal Messages
// ============================================================================

export const ListTerminalsRequestSchema = z.object({
  type: z.literal("list_terminals_request"),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
  requestId: z.string(),
});

export const SubscribeTerminalsRequestSchema = z.object({
  type: z.literal("subscribe_terminals_request"),
  cwd: z.string(),
  workspaceId: z.string().optional(),
});

export const UnsubscribeTerminalsRequestSchema = z.object({
  type: z.literal("unsubscribe_terminals_request"),
  cwd: z.string(),
  workspaceId: z.string().optional(),
});

export const CreateTerminalRequestSchema = z.object({
  type: z.literal("create_terminal_request"),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  name: z.string().optional(),
  agentId: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  /** An embedded terminal renders inside another pane and never gets its own workspace tab. */
  presentation: z.enum(["embedded"]).optional(),
  /** Stable owner identity used to adopt an embedded terminal after a renderer reload. */
  presentationOwner: z.string().optional(),
  // Initial PTY size. Added in v0.1.107; the app no longer sends it (the estimate cache that fed
  // it was removed - the pane-focus resize claim sizes the PTY instead). Kept and honored
  // permanently: released v0.1.107 clients still send it, and programmatic callers may pass an
  // exact size. Daemons without it start at 80x24 and the first resize corrects that.
  size: z
    .object({
      rows: z.number().int().positive(),
      cols: z.number().int().positive(),
    })
    .optional(),
  requestId: z.string(),
});

export const RenameTerminalRequestSchema = z.object({
  type: z.literal("terminal.rename.request"),
  terminalId: z.string(),
  title: z.string(),
  // COMPAT(terminalTitleSettings): old daemons ignore this field and retain
  // their existing rename behavior.
  clear: z.boolean().optional(),
  requestId: z.string(),
});

export const StartWorkspaceScriptRequestSchema = z.object({
  type: z.literal("start_workspace_script_request"),
  workspaceId: z.string(),
  scriptName: z.string(),
  requestId: z.string(),
});

export const WorkspaceScriptListRequestSchema = z.object({
  type: z.literal("workspace.script.list.request"),
  workspaceId: z.string(),
  requestId: z.string(),
  /**
   * Also return the Scripts the workspace's own project files declare
   * (`package.json` scripts, and later Makefile targets, .NET launch profiles),
   * each tagged with the `source` it came from. Off by default so a client that
   * predates discovery gets exactly the otto.json list it asked for.
   * COMPAT(workspaceScriptDiscovery): added in v0.7.6.
   */
  includeDiscovered: z.boolean().optional().default(false),
});

export const WorkspaceScriptStartRequestSchema = z.object({
  type: z.literal("workspace.script.start.request"),
  workspaceId: z.string(),
  scriptName: z.string(),
  requestId: z.string(),
});

export const WorkspaceScriptStopRequestSchema = z.object({
  type: z.literal("workspace.script.stop.request"),
  workspaceId: z.string(),
  scriptName: z.string(),
  requestId: z.string(),
});

export const SubscribeTerminalRequestSchema = z.object({
  type: z.literal("subscribe_terminal_request"),
  terminalId: z.string(),
  requestId: z.string(),
  restore: z
    .object({
      mode: z.enum(["live", "visible-snapshot", "full-snapshot"]),
      scrollbackLines: z.number().int().nonnegative().optional(),
      size: z
        .object({
          rows: z.number().int().positive(),
          cols: z.number().int().positive(),
        })
        .optional(),
    })
    .optional(),
});

export const UnsubscribeTerminalRequestSchema = z.object({
  type: z.literal("unsubscribe_terminal_request"),
  terminalId: z.string(),
});

const TerminalClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string() }),
  z.object({ type: z.literal("resize"), rows: z.number(), cols: z.number() }),
  z.object({
    type: z.literal("mouse"),
    row: z.number(),
    col: z.number(),
    button: z.number(),
    action: z.enum(["down", "up", "move"]),
  }),
]);

export const TerminalInputSchema = z.object({
  type: z.literal("terminal_input"),
  terminalId: z.string(),
  message: TerminalClientMessageSchema,
});

export const KillTerminalRequestSchema = z.object({
  type: z.literal("kill_terminal_request"),
  terminalId: z.string(),
  requestId: z.string(),
});

export const CaptureTerminalRequestSchema = z.object({
  type: z.literal("capture_terminal_request"),
  terminalId: z.string(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  stripAnsi: z.boolean().default(true),
  requestId: z.string(),
});

export const HubExecutionAgentCreateRequestSchema = z.object({
  type: z.literal("hub.execution.agent.create.request"),
  requestId: z.string(),
  executionId: z.string(),
  provider: z.string(),
  cwd: z.string(),
  prompt: z.string(),
  workspaceId: z.string().optional(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  worktree: CreateAgentWorktreeTargetSchema.optional(),
});

export type HubExecutionAgentCreateRequest = z.infer<typeof HubExecutionAgentCreateRequestSchema>;

export const HubExecutionControlActionSchema = z.enum(["interrupt", "archive"]);
export type HubExecutionControlAction = z.infer<typeof HubExecutionControlActionSchema>;

export const HubExecutionControlRequestSchema = z.object({
  type: z.literal("hub.execution.control.request"),
  requestId: z.string(),
  executionId: z.string(),
  action: HubExecutionControlActionSchema,
});

export type HubExecutionControlRequest = z.infer<typeof HubExecutionControlRequestSchema>;

export const SessionInboundMessageSchema = z.discriminatedUnion("type", [
  HubExecutionAgentCreateRequestSchema,
  HubExecutionControlRequestSchema,
  BrowserAutomationExecuteResponseSchema,
  VoiceAudioChunkMessageSchema,
  AbortRequestMessageSchema,
  AudioPlayedMessageSchema,
  FetchAgentsRequestMessageSchema,
  FetchAgentHistoryRequestMessageSchema,
  FetchRecentProviderSessionsRequestMessageSchema,
  FetchWorkspacesRequestMessageSchema,
  ProjectListRequestMessageSchema,
  ProjectResolveWorkspaceForPathRequestSchema,
  FetchAgentRequestMessageSchema,
  DeleteAgentRequestMessageSchema,
  ArchiveAgentRequestMessageSchema,
  CloseItemsRequestMessageSchema,
  HistoryAgentsClearArchivedRequestSchema,
  HistoryAgentsStorageStatsRequestSchema,
  AttachmentsImagesStatsRequestSchema,
  AttachmentsImagesClearRequestSchema,
  BrainHostStatusRequestSchema,
  BrainHostStartRequestSchema,
  BrainHostStopRequestSchema,
  BrainHostRestartRequestSchema,
  BrainEvalsGetRequestSchema,
  BrainNetworkDiscoverRequestSchema,
  BrainModelsListRequestSchema,
  BrainRemoteConfigGetRequestSchema,
  BrainRemoteConfigPatchRequestSchema,
  BrainModelsScanRequestSchema,
  BrainCatalogListRequestSchema,
  BrainRuntimeListRequestSchema,
  BrainModelsPullRequestSchema,
  BrainRuntimeInstallRequestSchema,
  BrainRuntimeRemoveRequestSchema,
  BrainCalibrateRequestSchema,
  BrainSweepRequestSchema,
  BrainBenchRequestSchema,
  BrainJobsListRequestSchema,
  BrainJobsCancelRequestSchema,
  BrainHfSearchRequestSchema,
  BrainHfQuantsRequestSchema,
  BrainModelsAddRequestSchema,
  BrainModelsInventoryRequestSchema,
  BrainModelProfileGetRequestSchema,
  BrainModelProfileSetRequestSchema,
  BrainModelBudgetGetRequestSchema,
  BrainModelLoadRequestSchema,
  BrainModelUnloadRequestSchema,
  BrainModelDeleteRequestSchema,
  BrainModelComponentDeleteRequestSchema,
  BrainModelRenameRequestSchema,
  BrainModelRenameResetRequestSchema,
  BrainLogsTailRequestSchema,
  BrainLogsWatchRequestSchema,
  UpdateAgentRequestMessageSchema,
  ProjectRenameRequestSchema,
  KanbanProjectTargetSetRequestSchema,
  ProjectRemoveRequestSchema,
  ProjectLinksListRequestSchema,
  ProjectLinksSetRequestSchema,
  ProjectLinksUnsetRequestSchema,
  WorkspaceTitleSetRequestSchema,
  WorkspacePinSetRequestSchema,
  WorkspaceRecoveryInspectRequestSchema,
  WorkspaceRecoveryRestoreRequestSchema,
  SetVoiceModeMessageSchema,
  SendAgentMessageRequestSchema,
  WaitForFinishRequestSchema,
  DaemonGetStatusRequestSchema,
  DaemonGetPairingOfferRequestSchema,
  HubManagementDaemonConnectRequestSchema,
  HubManagementDaemonGetStatusRequestSchema,
  HubManagementDaemonDisconnectRequestSchema,
  DiagnosticsRequestSchema,
  GetDaemonConfigRequestMessageSchema,
  SetDaemonConfigRequestMessageSchema,
  ConnectorsListToolsRequestSchema,
  ConnectorsOauthAuthorizeRequestSchema,
  ConnectorsOauthDisconnectRequestSchema,
  CommunicationsGetOverviewRequestSchema,
  CommunicationsInboxGetHomeRequestSchema,
  CommunicationsInboxSearchRequestSchema,
  CommunicationsInboxSetFavoriteRequestSchema,
  CommunicationsInboxNotificationsAcknowledgeRequestSchema,
  CommunicationsInboxGetPresenceRequestSchema,
  CommunicationsInboxSetPresenceRequestSchema,
  CommunicationsInboxSetEnabledRequestSchema,
  CommunicationsInboxGetMessagesRequestSchema,
  CommunicationsInboxSendMessageRequestSchema,
  CommunicationsRoomGetRequestSchema,
  CommunicationsRoomThreadGetRequestSchema,
  CommunicationsRoomMessageSendRequestSchema,
  CommunicationsRoomReactionSetRequestSchema,
  MeetingsTranscriptsListRequestSchema,
  MeetingsTranscriptsCreateRequestSchema,
  MeetingsTranscriptsUpdateRequestSchema,
  MeetingsTranscriptsDeleteRequestSchema,
  IntegrationsAuthorizationGetOverviewRequestSchema,
  IntegrationsAuthorizationGetMethodsRequestSchema,
  IntegrationsAuthorizationStartBrowserRequestSchema,
  IntegrationsZoomStartAuthorizationRequestSchema,
  SpeechSettingsGetOptionsRequestSchema,
  SpeechTtsPreviewRequestSchema,
  SpeechTtsSpeakRequestSchema,
  SpeechTtsSpeakCancelRequestSchema,
  VisualizerVoiceCuesGenerateRequestSchema,
  AgentPersonalitiesGetStatsRequestSchema,
  AgentPersonalitiesGenerateProfileRequestSchema,
  ReadProjectConfigRequestMessageSchema,
  WriteProjectConfigRequestMessageSchema,
  DictationStreamStartMessageSchema,
  DictationStreamChunkMessageSchema,
  DictationStreamFinishMessageSchema,
  DictationStreamCancelMessageSchema,
  CreateAgentRequestMessageSchema,
  ListProviderModelsRequestMessageSchema,
  ListProviderModesRequestMessageSchema,
  ListProviderFeaturesRequestMessageSchema,
  ListAvailableProvidersRequestMessageSchema,
  GetProvidersSnapshotRequestMessageSchema,
  RefreshProvidersSnapshotRequestMessageSchema,
  ProviderDiagnosticRequestMessageSchema,
  ProviderUsageListRequestMessageSchema,
  StatsActivityGetRequestMessageSchema,
  ContextReportGetRequestMessageSchema,
  ContextPromptPreviewGetRequestMessageSchema,
  ProjectKnowledgeListRequestMessageSchema,
  ProjectKnowledgeGetRequestMessageSchema,
  ProjectKnowledgeCreateRequestMessageSchema,
  ProjectKnowledgeApplyRequestMessageSchema,
  ProjectKnowledgeStatusRequestMessageSchema,
  ProjectKnowledgeProjectApplyRequestMessageSchema,
  ProjectKnowledgeReferenceApplyRequestMessageSchema,
  ProjectKnowledgeRootApplyRequestMessageSchema,
  ProjectKnowledgeDeleteRequestMessageSchema,
  ContextEdgeConvertRequestMessageSchema,
  ContextFindingsFixRequestMessageSchema,
  PersonalityMemoryListRequestMessageSchema,
  PersonalityMemoryUpdateRequestMessageSchema,
  PersonalityMemoryTransferRequestMessageSchema,
  PersonalityMemoryStatsRequestMessageSchema,
  StatsActivityResetRequestMessageSchema,
  UsageLogGetRequestMessageSchema,
  AgentContextGetUsageRequestMessageSchema,
  ResumeAgentRequestMessageSchema,
  ImportAgentRequestMessageSchema,
  RefreshAgentRequestMessageSchema,
  CancelAgentRequestMessageSchema,
  ShutdownServerRequestMessageSchema,
  RestartServerRequestMessageSchema,
  DaemonUpdateRequestMessageSchema,
  FetchAgentTimelineRequestMessageSchema,
  ProviderSubagentListRequestMessageSchema,
  ProviderSubagentTimelineRequestMessageSchema,
  SetAgentTimelineSubscriptionRequestMessageSchema,
  AgentForkContextRequestMessageSchema,
  SetAgentModeRequestMessageSchema,
  SetAgentModelRequestMessageSchema,
  SetAgentThinkingRequestMessageSchema,
  SetAgentFeatureRequestMessageSchema,
  AgentDetachRequestMessageSchema,
  AgentWorkspaceTransferRequestMessageSchema,
  AgentSubagentStopRequestMessageSchema,
  AgentBackgroundTaskStopRequestMessageSchema,
  AgentBackgroundTaskClearRequestMessageSchema,
  TasksSuggestedStartRequestMessageSchema,
  TasksSuggestedDismissRequestMessageSchema,
  AgentPersonalitySetRequestMessageSchema,
  AgentRewindRequestMessageSchema,
  AgentQueueRemoveRequestMessageSchema,
  AgentQueueReorderRequestMessageSchema,
  AgentQueueClearRequestMessageSchema,
  AgentPermissionResponseMessageSchema,
  CheckoutStatusRequestSchema,
  SubscribeCheckoutDiffRequestSchema,
  UnsubscribeCheckoutDiffRequestSchema,
  CheckoutCommitRequestSchema,
  CheckoutGitCommitRequestSchema,
  CheckoutGitCommitAgentRequestSchema,
  CheckoutGitRollbackRequestSchema,
  CheckoutGitGetOperationLogRequestSchema,
  CheckoutGitFileHistoryRequestSchema,
  CheckoutGitFileCommitDiffRequestSchema,
  CheckoutGitFileBlameRequestSchema,
  CheckoutGitFileOriginRequestSchema,
  RunsGetSnapshotRequestSchema,
  RunsGateRespondRequestSchema,
  RunsCancelRequestSchema,
  RunsClearRequestSchema,
  RunsDeleteRequestSchema,
  RunsGraphsListRequestSchema,
  RunsGraphsSaveRequestSchema,
  RunsGraphsDeleteRequestSchema,
  RunsTemplatesListRequestSchema,
  RunsTemplatesSaveRequestSchema,
  RunsTemplatesDeleteRequestSchema,
  RunsStartRequestSchema,
  CheckoutMergeRequestSchema,
  CheckoutMergeFromBaseRequestSchema,
  CheckoutPullRequestSchema,
  CheckoutPushRequestSchema,
  CheckoutRefreshRequestSchema,
  CheckoutGitFetchRequestSchema,
  CheckoutPrCreateRequestSchema,
  CheckoutPrMergeRequestSchema,
  CheckoutForgeSetAutoMergeRequestSchema,
  CheckoutGithubSetAutoMergeRequestSchema,
  CheckoutCommitsListRequestSchema,
  CheckoutCommitFileDiffRequestSchema,
  CheckoutForgeGetCheckDetailsRequestSchema,
  CheckoutGithubGetCheckDetailsRequestSchema,
  PreviewListConfigRequestSchema,
  PreviewStartRequestSchema,
  PreviewBindTabRequestSchema,
  PreviewStopRequestSchema,
  CheckoutPrStatusRequestSchema,
  PullRequestTimelineRequestSchema,
  CheckoutSwitchBranchRequestSchema,
  CheckoutRenameBranchRequestSchema,
  StashSaveRequestSchema,
  StashPopRequestSchema,
  StashListRequestSchema,
  KanbanBoardsListRequestSchema,
  KanbanBoardGetRequestSchema,
  KanbanCardMoveRequestSchema,
  KanbanCardCreateRequestSchema,
  KanbanTaskLinkRequestSchema,
  ValidateBranchRequestSchema,
  BranchSuggestionsRequestSchema,
  ForgeSearchRequestSchema,
  GitHubSearchRequestSchema,
  HostingSearchRequestSchema,
  HostingAuthStatusRequestSchema,
  DirectorySuggestionsRequestSchema,
  OttoWorktreeListRequestSchema,
  OttoWorktreeArchiveRequestSchema,
  CreateOttoWorktreeRequestSchema,
  WorkspaceSetupStatusRequestSchema,
  LegacyListAvailableEditorsRequestSchema,
  LegacyOpenInEditorRequestSchema,
  OpenProjectRequestSchema,
  ProjectAddRequestSchema,
  ProjectScaffoldRequestSchema,
  HostingListRepositoriesRequestSchema,
  HostingListOwnersRequestSchema,
  ProjectCreateDirectoryRequestSchema,
  WorkspaceGithubSearchRepositoriesRequestSchema,
  ProjectGithubCloneRequestSchema,
  ArchiveWorkspaceRequestSchema,
  WorkspaceArchivePreflightRequestSchema,
  WorktreeBaseRefSetRequestSchema,
  WorktreeReattachListRequestSchema,
  WorktreeReattachRequestSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceClearAttentionRequestSchema,
  FileExplorerRequestSchema,
  FileSubscribeRequestSchema,
  FileUnsubscribeRequestSchema,
  FsFileWriteRequestSchema,
  FsFileWriteBinaryRequestSchema,
  ProjectIconRequestSchema,
  FileDownloadTokenRequestSchema,
  FileUploadRequestSchema,
  FileWriteRequestSchema,
  FileCreateRequestSchema,
  FileDeleteRequestSchema,
  FileRenameRequestSchema,
  FileRefineRequestSchema,
  FileWatchSubscribeRequestSchema,
  FileWatchUnsubscribeRequestSchema,
  FileSearchRequestSchema,
  FileReplaceRequestSchema,
  CodeListFilesRequestSchema,
  CodeSymbolsRequestSchema,
  CodeOutlineRequestSchema,
  CodeDefinitionRequestSchema,
  CodeDocumentSyncRequestSchema,
  CodeDocumentCloseRequestSchema,
  CodeHoverRequestSchema,
  CodeReferencesRequestSchema,
  CodeRenamePreviewRequestSchema,
  CodeRenameApplyRequestSchema,
  CodeRenameUndoRequestSchema,
  LspServersListRequestSchema,
  LspServerStopRequestSchema,
  CodeSolutionListRequestSchema,
  CodeSolutionGetTreeRequestSchema,
  CodeSolutionLoadProjectRequestSchema,
  ClearAgentAttentionMessageSchema,
  ClientHeartbeatMessageSchema,
  PingMessageSchema,
  ListCommandsRequestSchema,
  RegisterPushTokenMessageSchema,
  ListTerminalsRequestSchema,
  SubscribeTerminalsRequestSchema,
  UnsubscribeTerminalsRequestSchema,
  CreateTerminalRequestSchema,
  RenameTerminalRequestSchema,
  StartWorkspaceScriptRequestSchema,
  WorkspaceScriptListRequestSchema,
  WorkspaceScriptStartRequestSchema,
  WorkspaceScriptStopRequestSchema,
  SubscribeTerminalRequestSchema,
  UnsubscribeTerminalRequestSchema,
  TerminalInputSchema,
  KillTerminalRequestSchema,
  CaptureTerminalRequestSchema,
  TerminalCompatibilityDiagnosticRequestSchema,
  ChatCreateRequestSchema,
  ChatListRequestSchema,
  ChatInspectRequestSchema,
  ChatDeleteRequestSchema,
  ChatPostRequestSchema,
  ChatReadRequestSchema,
  ChatWaitRequestSchema,
  ScheduleCreateRequestSchema,
  ScheduleListRequestSchema,
  ScheduleInspectRequestSchema,
  ScheduleLogsRequestSchema,
  SchedulePauseRequestSchema,
  ScheduleResumeRequestSchema,
  ScheduleDeleteRequestSchema,
  ScheduleRunOnceRequestSchema,
  ScheduleUpdateRequestSchema,
  LoopRunRequestSchema,
  LoopListRequestSchema,
  LoopInspectRequestSchema,
  LoopLogsRequestSchema,
  LoopStopRequestSchema,
  // COMPAT(artifacts): added in v0.4.1, drop the gate when daemon floor >= v0.4.1.
  ArtifactListRequestSchema,
  ArtifactCreateRequestSchema,
  ArtifactUpdateRequestSchema,
  ArtifactRegenerateRequestSchema,
  ArtifactCancelRequestSchema,
  ArtifactDeleteRequestSchema,
  ArtifactStarRequestSchema,
  ArtifactGetContentRequestSchema,
]);

export type SessionInboundMessage = z.infer<typeof SessionInboundMessageSchema>;

// ============================================================================
// Session Outbound Messages (Session emits these)
// ============================================================================

export const ActivityLogPayloadSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  type: z.enum(["transcript", "assistant", "tool_call", "tool_result", "error", "system"]),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ActivityLogMessageSchema = z.object({
  type: z.literal("activity_log"),
  payload: ActivityLogPayloadSchema,
});

export const AssistantChunkMessageSchema = z.object({
  type: z.literal("assistant_chunk"),
  payload: z.object({
    chunk: z.string(),
  }),
});

export const AudioOutputMessageSchema = z.object({
  type: z.literal("audio_output"),
  payload: z.object({
    audio: z.string(), // base64 encoded
    format: z.string(),
    id: z.string(),
    isVoiceMode: z.boolean(), // Mode when audio was generated (for drift protection)
    groupId: z.string().optional(), // Logical utterance id
    chunkIndex: z.number().int().nonnegative().optional(),
    isLastChunk: z.boolean().optional(),
  }),
});

export const TranscriptionResultMessageSchema = z.object({
  type: z.literal("transcription_result"),
  payload: z.object({
    text: z.string(),
    language: z.string().optional(),
    duration: z.number().optional(),
    requestId: z.string(), // Echoed back from request for tracking
    avgLogprob: z.number().optional(),
    isLowConfidence: z.boolean().optional(),
    byteLength: z.number().optional(),
    format: z.string().optional(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const VoiceInputStateMessageSchema = z.object({
  type: z.literal("voice_input_state"),
  payload: z.object({
    isSpeaking: z.boolean(),
  }),
});

export const DictationStreamAckMessageSchema = z.object({
  type: z.literal("dictation_stream_ack"),
  payload: z.object({
    dictationId: z.string(),
    ackSeq: z.number().int(),
  }),
});

export const DictationStreamFinishAcceptedMessageSchema = z.object({
  type: z.literal("dictation_stream_finish_accepted"),
  payload: z.object({
    dictationId: z.string(),
    timeoutMs: z.number().int().positive(),
  }),
});

export const DictationStreamPartialMessageSchema = z.object({
  type: z.literal("dictation_stream_partial"),
  payload: z.object({
    dictationId: z.string(),
    text: z.string(),
  }),
});

export const DictationStreamFinalMessageSchema = z.object({
  type: z.literal("dictation_stream_final"),
  payload: z.object({
    dictationId: z.string(),
    text: z.string(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const DictationStreamErrorMessageSchema = z.object({
  type: z.literal("dictation_stream_error"),
  payload: z.object({
    dictationId: z.string(),
    error: z.string(),
    retryable: z.boolean(),
    reasonCode: z.string().optional(),
    missingModelIds: z.array(z.string()).optional(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const ServerCapabilityStateSchema = z.object({
  enabled: z.boolean(),
  reason: z.string(),
});

export const ServerVoiceCapabilitiesSchema = z.object({
  dictation: ServerCapabilityStateSchema,
  voice: ServerCapabilityStateSchema,
});

export const ServerCapabilitiesSchema = z
  .object({
    voice: ServerVoiceCapabilitiesSchema.optional(),
  })
  .passthrough();

const ServerInfoHostnameSchema = z.unknown().transform((value): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const ServerInfoVersionSchema = z.unknown().transform((value): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

const ServerCapabilitiesFromUnknownSchema = z
  .unknown()
  .optional()
  .transform((value): z.infer<typeof ServerCapabilitiesSchema> | undefined => {
    if (value === undefined) {
      return undefined;
    }
    const parsed = ServerCapabilitiesSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  });

export const ServerInfoStatusPayloadSchema = z
  .object({
    status: z.literal("server_info"),
    serverId: z.string().trim().min(1),
    hostname: ServerInfoHostnameSchema.optional(),
    version: ServerInfoVersionSchema.optional(),
    // The daemon's OS and detected interactive shells. Optional so older hosts
    // remain parseable; only Windows hosts advertise terminalShells.
    platform: z.string().optional(),
    terminalShells: z
      .array(
        z.object({
          id: z.enum(["command-prompt", "windows-powershell", "powershell-7"]),
          label: z.string(),
        }),
      )
      .optional(),
    // COMPAT(desktopManaged): added in v0.1.X, remove optional parsing after 2027-01-16.
    desktopManaged: z.boolean().optional(),
    capabilities: ServerCapabilitiesFromUnknownSchema.optional(),
    // COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
    features: z
      .object({
        providersSnapshot: z.boolean().optional(),
        // COMPAT(checkoutForgeSetAutoMerge): added in v0.1.106, remove old
        // checkoutGithubSetAutoMerge fallback after 2026-12-28.
        checkoutForgeSetAutoMerge: z.boolean().optional(),
        checkoutGithubSetAutoMerge: z.boolean().optional(),
        // COMPAT(githubCheckDetails): added in v0.1.92, remove gate after 2026-12-08.
        githubCheckDetails: z.boolean().optional(),
        // COMPAT(forgeCheckDetails): added in v0.1.106, remove githubCheckDetails fallback after 2026-12-28.
        forgeCheckDetails: z.boolean().optional(),
        // COMPAT(forgeSearch): added in v0.1.106, remove github_search fallback after 2026-12-28.
        forgeSearch: z.boolean().optional(),
        // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
        daemonStatusRpc: z.boolean().optional(),
        // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
        "terminal-restore-modes": z.boolean().optional(),
        // COMPAT(terminalCompatibilityDiagnostic): added in v0.8.9, remove gate after 2027-02-12.
        terminalCompatibilityDiagnostic: z.boolean().optional(),
        terminalEmbeddedPresentation: z.boolean().optional(),
        // COMPAT(terminalTitleSettings): added in v0.8.5, remove gate after 2027-02-07.
        terminalTitleSettings: z.boolean().optional(),
        // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
        rewind: z.boolean().optional(),
        // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
        checkoutRefresh: z.boolean().optional(),
        // COMPAT(gitFetchControl): added in v0.8.11, remove gate after 2027-02-14.
        gitFetchControl: z.boolean().optional(),
        // COMPAT(kanbanBoard): added in v0.8.11, drop the gate when floor >= v0.8.11.
        // The provider-agnostic Kanban board surface is present (kanban.*
        // RPCs + the /kanban screen).
        kanbanBoard: z.boolean().optional(),
        // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
        workspaceMultiplicity: z.boolean().optional(),
        // COMPAT(projectRemove): added in v0.1.97, drop the gate when floor >= v0.1.97.
        projectRemove: z.boolean().optional(),
        // COMPAT(projectAdd): added in v0.1.97, drop the gate when floor >= v0.1.97.
        projectAdd: z.boolean().optional(),
        // COMPAT(projectScaffold): added in v0.6.9, drop the gate when floor >= v0.6.9.
        // The daemon can create a project directory from scratch (mkdir, git
        // init/clone, optional remote creation) instead of only adopting one
        // that already exists. Without it the New project page offers the
        // open-an-existing-folder path only.
        projectScaffold: z.boolean().optional(),
        // COMPAT(worktreeRestore): added in v0.1.97, drop the gate when floor >= v0.1.97
        worktreeRestore: z.boolean().optional(),
        // COMPAT(workspaceRecovery): added in v0.1.105, remove after 2027-01-11 once daemon floor >= v0.1.105.
        workspaceRecovery: z.boolean().optional(),
        // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
        workspaceFileEditing: z.boolean().optional(),
        // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
        providerUsageList: z.boolean().optional(),
        // COMPAT(agentDetach): added in v0.1.98, remove gate after 2026-12-19 once daemon floor >= v0.1.98.
        agentDetach: z.boolean().optional(),
        // COMPAT(agentThinkingUpdate): added in v0.2.4, remove gate after 2027-01-28.
        agentThinkingUpdate: z.boolean().optional(),
        // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
        daemonDiagnostics: z.boolean().optional(),
        // COMPAT(daemonSelfUpdate): added in v0.1.93, remove gate after 2026-12-13.
        daemonSelfUpdate: z.boolean().optional(),
        // Daemon manages the local AI host (otto-brain) as a child: reports
        // brain.host.status, serves brain.host.start/stop/restart, exposes the
        // editable `brain` config block, and honors kill-on-shutdown. Without it
        // the Local brain host UI is hidden ("update the host").
        // COMPAT(brainControl): added in v0.7.5, remove gate after 2026-01-30 once daemon floor >= v0.7.5.
        brainControl: z.boolean().optional(),
        // The daemon persists and applies llama.cpp's `-lv` launch option for
        // the resident Brain runtime. Newer clients must hide this control on
        // older daemons, whose Brain config rejects the field.
        // COMPAT(brainRuntimeLogVerbosity): added in v0.8.10, drop the gate when daemon floor >= v0.8.10.
        brainRuntimeLogVerbosity: z.boolean().optional(),
        // Daemon streams the brain's live status/telemetry via
        // subscribe_brain_status + brain_status_changed, and serves brain.evals.get.
        // Separate from brainControl because status/eval watching can ship after
        // lifecycle control. Without it the Brain dashboard falls back to a
        // periodic brain.host.status poll (no live feed, no eval charts).
        // COMPAT(brainStatus): added in v0.7.5, remove gate after 2026-01-30 once daemon floor >= v0.7.5.
        brainStatus: z.boolean().optional(),
        // Daemon serves brain.network.discover: enumerates this host's bind
        // addresses and probes the local `tailscale` CLI, so the client can
        // offer a listen-host pick-list and auto-fill the tailscale TLS mode.
        // COMPAT(brainNetworkDiscovery): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
        brainNetworkDiscovery: z.boolean().optional(),
        // Daemon can point the brain at a remote host (brain.mode "remote"):
        // status/evals/config proxied from another Otto's brain, no local spawn.
        // COMPAT(brainRemote): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
        brainRemote: z.boolean().optional(),
        // Daemon manages the brain's models and runtimes by shelling out to the
        // otto-brain CLI: serves brain.models.scan / brain.catalog.list /
        // brain.runtime.list (reads) and starts brain.models.pull /
        // brain.runtime.install / brain.calibrate / brain.sweep / brain.bench as
        // tracked jobs polled via brain.jobs.list. Without it the Brain "Models"
        // and "Operations" sections are hidden ("update the host").
        // COMPAT(brainManage): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
        brainManage: z.boolean().optional(),
        // Daemon serves brain.hf.search / brain.hf.quants (reads) and starts
        // brain.models.add (download an arbitrary HF repo's quant) as a pull job.
        // Without it the Brain "Models" section hides the Hugging Face search box.
        // COMPAT(brainHfSearch): added in v0.7.5, remove gate after 2026-07-30 once daemon floor >= v0.7.5.
        brainHfSearch: z.boolean().optional(),
        // Daemon proxies the brain's own /__host/* management API: the joined
        // model inventory, per-model profiles, the VRAM budget, load/unload,
        // delete, and the log tail. Unlike brainManage (which shells out to the
        // CLI and is therefore local-only) these work against a remote brain too.
        // Without it the Brain page is not offered at all. Which of those the
        // brain on the far side actually serves is a separate question, answered
        // by `capabilities` on brain.host.status, because the daemon and the
        // brain version independently.
        // COMPAT(brainConsole): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
        brainConsole: z.boolean().optional(),
        // COMPAT(brainStatusPush): added in v0.8.3, drop the gate when daemon
        // floor >= v0.8.3. The daemon subscribes to the brain's own SSE status
        // stream and broadcasts `brain_status_changed`. Unlike the flags above
        // this is not a fixed daemon capability: it is true only while the
        // SELECTED brain also advertises `capabilities.events`, and the daemon
        // re-broadcasts server_info when that changes. A client that sees it
        // false keeps the explicit status poll.
        brainStatusPush: z.boolean().optional(),
        // COMPAT(brainLogPush): added in v0.8.10, drop the gate when daemon floor >= v0.8.10.
        brainLogPush: z.boolean().optional(),
        // COMPAT(brainLogWatch): added in v0.8.11, drop the gate when daemon
        // floor >= v0.8.11. The daemon serves `brain.logs.watch.request` and
        // pushes `brain_log_line_added` only to sockets that asked for it. A
        // client that sees this false must not advertise the matching client
        // capability: on an older daemon the feed is unconditional, and the
        // watch request it would rely on is unroutable.
        brainLogWatch: z.boolean().optional(),
        // COMPAT(agentForkContext): added in v0.1.102, remove gate after 2026-12-28.
        agentForkContext: z.boolean().optional(),
        // COMPAT(providerRemove): added in v0.1.105, drop the gate when daemon floor >= v0.1.105.
        providerRemove: z.boolean().optional(),
        // COMPAT(agentContextUsage): added in v0.3.4, drop the gate when daemon floor >= v0.3.4.
        agentContextUsage: z.boolean().optional(),
        // COMPAT(artifacts): added in v0.4.1, drop the gate when daemon floor >= v0.4.1.
        artifacts: z.boolean().optional(),
        // COMPAT(observedSubagents): added in v0.4.3, drop the gate when daemon floor >= v0.4.3.
        observedSubagents: z.boolean().optional(),
        // COMPAT(backgroundShellTasks): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        backgroundShellTasks: z.boolean().optional(),
        // COMPAT(retainedTranscripts): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Daemon retains schedule/artifact generation-agent chats for read-only
        // viewing after the run. See docs/safe-unattended.md.
        retainedTranscripts: z.boolean().optional(),
        // COMPAT(suggestedTasks): added in v0.5.6, drop the gate when daemon floor >= v0.5.6.
        suggestedTasks: z.boolean().optional(),
        // COMPAT(steerQueue): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        // Daemon owns a per-agent queue of steering messages, accepts
        // `delivery: "queue"` on send, reports `queuedMessages` on the agent
        // snapshot, and serves agent.queue.remove/clear. Without it the
        // composer keeps its own local queue - that is the pre-existing
        // behavior, not a degraded build of this feature.
        steerQueue: z.boolean().optional(),
        // Daemon serves agent.queue.reorder. Separate from `steerQueue`
        // because a daemon on 0.6.8 owns a queue but cannot re-order it;
        // without this the move controls are absent (the queue still works).
        // COMPAT(steerQueueReorder): added in v0.6.9, drop the gate when daemon floor >= v0.6.9.
        steerQueueReorder: z.boolean().optional(),
        // Daemon reports `cumulativeUsage` (the lifetime in/cached/out split
        // plus its own booked cost) on every agent snapshot, so a chat's total
        // spend can be summed and priced honestly. Without it the client shows
        // token totals only and no cost - NOT an estimated cost, which is the
        // behavior this feature exists to remove.
        // COMPAT(cumulativeUsage): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
        cumulativeUsage: z.boolean().optional(),
        // Daemon can resolve and evaluate the provider's context graph, serve
        // context.report.* and push context_report_changed. Without it the
        // client hides both the Context Management tab and the composer
        // warning entirely - there is no degraded client-side fallback, since
        // only the daemon can see the files a provider loads.
        // COMPAT(contextManagement): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
        contextManagement: z.boolean().optional(),
        // COMPAT(textEditor): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        textEditor: z.boolean().optional(),
        // Refine - the daemon can turn a pinned document plus an instruction
        // into a proposed rewrite (`file.refine.*`). Without it the Refine
        // entry is absent: there is no client-side substitute for a model, and
        // a degraded "open a chat instead" path is exactly the unreviewed edit
        // Refine exists to replace.
        // COMPAT(refine): added in v0.6.9, drop the gate when daemon floor >= v0.6.9.
        refine: z.boolean().optional(),
        // Personality memory - the daemon stores per-personality lessons, injects
        // them at spawn, and serves personality.memory.*. Without it the client
        // hides the Memory tab, the accrual indicator and the transfer-on-delete
        // choice: storage is daemon-side by definition, so there is nothing a
        // client-side fallback could read.
        // COMPAT(personalityMemory): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
        personalityMemory: z.boolean().optional(),
        // COMPAT(projectKnowledge): added in v0.8.5, drop the gate when daemon floor >= v0.8.5.
        projectKnowledge: z.boolean().optional(),
        // Script discovery - the daemon scans a workspace for the Scripts its
        // project files already declare (package.json scripts, and later
        // Makefile targets, .NET launch profiles) and serves them from
        // `workspace.script.list` with `includeDiscovered`. Without it the
        // Scripts dropdown shows only what otto.json declares, which is the
        // pre-existing behavior and not a degraded build of this feature: only
        // the daemon can read the workspace's files, so there is no client-side
        // scan to fall back to.
        // COMPAT(workspaceScriptDiscovery): added in v0.7.6, drop the gate when daemon floor >= v0.7.6.
        workspaceScriptDiscovery: z.boolean().optional(),
        // COMPAT(projectSearch): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        projectSearch: z.boolean().optional(),
        // COMPAT(codeIndex): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        codeIndex: z.boolean().optional(),
        // Language-server-backed definitions (`code.definition`, `code.document.*`).
        // Separate from `codeIndex`: that gate covers the ctags path, which stays as
        // the outline/fuzzy-finder source and the no-server fallback.
        // COMPAT(lsp): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        lsp: z.boolean().optional(),
        // The daemon answers `lsp.servers.list` host-wide, with no `cwd`. The settings
        // screen is a host screen: it lists every language server this machine knows how
        // to run and whether it can supply the binary, and it must not need a workspace
        // open to say so. An older daemon rejects a request with no `cwd`, so without the
        // flag the client says to update the host rather than showing an empty screen.
        // COMPAT(lspHostServers): added in v0.7.3, drop the gate when daemon floor >= v0.7.3.
        lspHostServers: z.boolean().optional(),
        // The Solution view - the daemon can discover solutions and serve
        // `code.solution.*`. Deliberately NOT implied by `lsp`: there is no
        // project-structure request in LSP, so this subsystem is independent of
        // language servers and of the C# row's on/off state. Without the flag the
        // client never shows the view switcher and never asks - there is no
        // client-side substitute for reading a solution, and a hand-parsed
        // half-tree is exactly the mistake this design exists to avoid.
        // COMPAT(solutionView): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        solutionView: z.boolean().optional(),
        // COMPAT(artifactsToolGroup): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
        artifactsToolGroup: z.boolean().optional(),
        // COMPAT(speechSettings): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
        speechSettings: z.boolean().optional(),
        // COMPAT(gitHostingProviders): added in v0.4.5, drop the gate when daemon floor >= v0.4.5.
        gitHostingProviders: z.boolean().optional(),
        // COMPAT(agentPersonalities): added in v0.5.0, drop the gate when daemon floor >= v0.5.0.
        agentPersonalities: z.boolean().optional(),
        // COMPAT(ttsPreview): added in v0.4.7, drop the gate when daemon floor >= v0.4.7.
        ttsPreview: z.boolean().optional(),
        // COMPAT(ttsSpeak): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
        // Host can stream a full message aloud on demand (per-message playback).
        ttsSpeak: z.boolean().optional(),
        // COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
        visualizerVoiceCues: z.boolean().optional(),
        // COMPAT(personalityProfile): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
        // Host can author a personality profile (the prompt prose) from a name,
        // roles, and spinner colors.
        personalityProfile: z.boolean().optional(),
        // COMPAT(setAgentPersonality): added in v0.5.0, drop the gate when daemon floor >= v0.5.0.
        setAgentPersonality: z.boolean().optional(),
        // COMPAT(checkoutGitCommit): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
        checkoutGitCommit: z.boolean().optional(),
        // COMPAT(checkoutGitCommitAgent): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
        checkoutGitCommitAgent: z.boolean().optional(),
        // COMPAT(checkoutGitRollback): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
        checkoutGitRollback: z.boolean().optional(),
        // COMPAT(checkoutGitLog): added in v0.5.1, drop the gate when daemon floor >= v0.5.1.
        checkoutGitLog: z.boolean().optional(),
        // Local-git file investigation: history, per-commit diff, blame, origin
        // commit - for a whole file or a line range. No forge connection needed
        // and no per-provider rollout; it is git, so every provider gets it at
        // once.
        // COMPAT(checkoutGitFileHistory): added in v0.6.6, drop the gate when daemon floor >= v0.6.6.
        checkoutGitFileHistory: z.boolean().optional(),
        // Set when the daemon can inspect a worktree's leftover branch before
        // archiving (workspace.archive.preflight.*) and delete it as part of the
        // archive (archive_workspace_request.branchDisposition). Without it the
        // client archives the worktree exactly as before and never offers to
        // remove the branch - no degraded client-side branch detection exists.
        // COMPAT(worktreeArchiveBranchCleanup): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
        worktreeArchiveBranchCleanup: z.boolean().optional(),
        // COMPAT(worktreeReattach): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
        worktreeReattach: z.boolean().optional(),
        // Set when the daemon can repoint a worktree's stored base branch
        // (worktree.baseRef.set.*). Without it the client renders the base as a
        // read-only "vs <base>" label - there is no client-side override, since only
        // the daemon can write the worktree's metadata.
        // COMPAT(worktreeDiffBase): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        worktreeDiffBase: z.boolean().optional(),
        // Set when the daemon stores the diff base *per branch*, which is what lets any git
        // checkout repoint it rather than only an Otto worktree - a plain checkout's gitdir is
        // shared by every branch in it, so a single stored base would bleed across branch
        // switches. Also gates parent-branch detection, the `origin/`-qualified pin, and the
        // re-detect action. Without it the client keeps the worktree-only picker.
        // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4, drop the gate when daemon floor >= v0.7.4.
        checkoutDiffBaseAnyRepo: z.boolean().optional(),
        // Set when the daemon persists the host-level hideMergeIntoBaseAction
        // workspace policy (read/written via the daemon config RPCs). Without
        // it the client hides the Workspaces toggle, since patching the field
        // on an old daemon would silently fail to stick.
        // COMPAT(hideMergeIntoBaseSetting): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
        hideMergeIntoBaseSetting: z.boolean().optional(),
        // COMPAT(agentTeams): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
        agentTeams: z.boolean().optional(),
        // COMPAT(modelTierOverrides): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
        modelTierOverrides: z.boolean().optional(),
        // COMPAT(savedProviderEndpoints): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
        savedProviderEndpoints: z.boolean().optional(),
        // COMPAT(agentOrchestration): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        agentOrchestration: z.boolean().optional(),
        // COMPAT(activityStats): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        activityStats: z.boolean().optional(),
        // COMPAT(runsClear): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        runsClear: z.boolean().optional(),
        // COMPAT(runsDelete): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        runsDelete: z.boolean().optional(),
        // COMPAT(runsDraftEdit): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
        // The daemon accepts `runs.start` with `draft: true` AND a `runId`,
        // re-saving that draft in place instead of minting a second one.
        runsDraftEdit: z.boolean().optional(),
        // COMPAT(orchestrationGraphs): added in v0.6.7, drop the gate when daemon floor >= v0.6.7.
        orchestrationGraphs: z.boolean().optional(),
        // COMPAT(projectLinks): added in v0.5.6, drop the gate when daemon floor >= v0.5.6.
        projectLinks: z.boolean().optional(),
        // COMPAT(fileOutsideWorkspace): added in v0.5.8, drop the gate when daemon floor >= v0.5.8.
        // Set when the daemon will serve single-file read/write/watch for paths
        // outside every known workspace (bounded only by OS filesystem
        // permissions). The client gates this behind an "edit anyway" warning;
        // an old daemon leaves the flag unset and out-of-project files are not offered.
        fileOutsideWorkspace: z.boolean().optional(),
        // COMPAT(promptSuggestions): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
        // Set when the daemon emits agent_stream `prompt_suggestion` events (native
        // Claude next-prompt predictions). The client gates the Settings toggle on
        // this; suggestions already degrade silently on an old daemon (no event).
        promptSuggestions: z.boolean().optional(),
        // COMPAT(rateLimitEvents): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
        // Set when the daemon emits agent_stream `rate_limit_updated` events (Claude
        // plan rate-limit status). Warnings degrade silently on an old daemon (no event).
        rateLimitEvents: z.boolean().optional(),
        // COMPAT(openaiCompatMaxToolRounds): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon honors the provider-level `maxToolRounds` override for
        // openai-compat agents. The client gates the Agents-tab control on this so an
        // old daemon (which silently ignores the field and keeps the fixed 50-round
        // cap) shows "Update the host" instead of a knob that does nothing.
        openaiCompatMaxToolRounds: z.boolean().optional(),
        // COMPAT(openaiCompatActionBreaker): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
        // Set when the daemon honors the provider-level `actionBreaker` config for
        // openai-compat agents (stops a repeatedly-failing identical action and
        // sends the model a repair prompt). The client gates the Agents-tab control
        // on this so an old daemon (which ignores the field) shows "Update the
        // host" instead of a switch that does nothing.
        openaiCompatActionBreaker: z.boolean().optional(),
        // COMPAT(openaiCompatMidSessionUpdates): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
        // Set when the daemon honors the provider-level `midSessionContextUpdates`
        // switch for openai-compat agents (whether the tool loop may add context,
        // today a subdirectory instruction file, after the conversation starts).
        // The client gates the Agents-tab control on this so an old daemon (which
        // ignores the field and always injects) shows "Update the host" instead of
        // a switch that does nothing.
        openaiCompatMidSessionUpdates: z.boolean().optional(),
        // COMPAT(mcpToolGroups): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon honors `mcp.toolGroups` - per-group gating of the
        // Otto tool catalog on the MCP (Claude) path. Old daemons register every
        // group regardless, so the client hides the categorized section instead
        // of showing category switches that do nothing.
        mcpToolGroups: z.boolean().optional(),
        // COMPAT(connectors): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
        // Set when the daemon persists and honors `connectors` - MCP servers
        // surfaced as named, toggle-able integrations with per-tool disable,
        // enforced today on the openai-compat path. Old daemons ignore the
        // section, so the client hides the Connectors settings entirely.
        connectors: z.boolean().optional(),
        // COMPAT(connectorOauth): added in v0.7.7, drop the gate when daemon floor >= v0.7.7.
        // Set when the daemon can run the OAuth authorization-code flow for a
        // connector and attach the resulting token to its MCP transport. Old
        // daemons have no broker and no way to hold a token, so the client hides
        // Connect / Disconnect and offers only the paste-a-token connectors.
        connectorOauth: z.boolean().optional(),
        // COMPAT(communications): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
        // The daemon owns the provider-neutral communications overview. An old
        // host must not receive a communications RPC from a newer frontend.
        communications: z.boolean().optional(),
        // COMPAT(communicationsChatHome): added in v0.8.11, remove gate after 2027-02-14.
        // A host that lacks this projection must not receive the detailed Chat
        // Home request from a newer frontend.
        communicationsChatHome: z.boolean().optional(),
        // COMPAT(communicationsInboxSearch): added in v0.8.11, remove gate after
        // 2027-02-15. A host without destination search must not receive its RPC.
        communicationsInboxSearch: z.boolean().optional(),
        // COMPAT(communicationsFavorites): added in v0.8.11, remove gate after
        // 2027-02-15. The host owns provider-native favorite reads and writes.
        communicationsFavorites: z.boolean().optional(),
        // COMPAT(communicationsPresence): added in v0.8.11, remove gate after 2027-02-14.
        // A host that lacks daemon-owned presence must not receive presence RPCs.
        communicationsPresence: z.boolean().optional(),
        // COMPAT(communicationsChatAvailability): added in v0.8.11, remove gate after 2027-02-14.
        // A host that lacks daemon-owned Chat availability must not receive its toggle RPC.
        communicationsChatAvailability: z.boolean().optional(),
        // COMPAT(communicationsPresenceChangeTiming): added in v0.8.11, remove gate after 2027-02-14.
        // The daemon publishes authoritative provider presence-change cooldowns.
        communicationsPresenceChangeTiming: z.boolean().optional(),
        // COMPAT(communicationsPresenceUpdates): added in v0.8.11, remove gate after 2027-02-14.
        // A capable client receives daemon-owned presence queue transitions and
        // cooldown updates without polling its popup.
        communicationsPresenceUpdates: z.boolean().optional(),
        // COMPAT(communicationsRooms): added in v0.8.11, remove gate after 2027-02-15.
        // A room carries thread and reaction semantics an older daemon cannot
        // safely emulate through the legacy flat inbox message RPCs.
        communicationsRooms: z.boolean().optional(),
        // COMPAT(communicationsRoomNotifications): added in v0.8.11, remove gate after 2027-02-15.
        // Acknowledgement mutates daemon-local state and older hosts do not know this RPC.
        communicationsRoomNotifications: z.boolean().optional(),
        // COMPAT(meetingTranscripts): added in v0.8.11, remove gate after 2027-02-13.
        meetingTranscripts: z.boolean().optional(),
        // COMPAT(integrationAuthorization): added in v0.8.11, drop the gate when daemon floor >= v0.8.11.
        // The daemon exposes secure-vault readiness and connection metadata for
        // reusable integration settings. Old hosts must not receive these RPCs.
        integrationAuthorization: z.boolean().optional(),
        // COMPAT(integrationAuthorizationBrowserFlow): added in v0.8.10, remove gate after 2027-02-14.
        // The daemon routes browser sign-in through registered, provider-neutral
        // drivers. Older hosts only understand provider-specific legacy RPCs.
        integrationAuthorizationBrowserFlow: z.boolean().optional(),
        // COMPAT(agentBehaviorToggles): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon persists `agentBehaviors.*` (promptSuggestions,
        // agentProgressSummaries, notifyOnFinishDefault). The reads are wired by
        // Claude-tier providers (WP-E); the client gates the toggle cards on this.
        agentBehaviorToggles: z.boolean().optional(),
        // COMPAT(todoReminders): added in v0.7.5, drop the gate when daemon floor >= v0.7.5.
        // Set when the daemon acts on `agentBehaviors.{todoNudge,todoReconcileOnIdle}` -
        // the provider-agnostic stale-todo nudge (next turn) and idle reconcile pass.
        // The client gates the task-list toggle cards on this so an old daemon never
        // shows switches that do nothing.
        todoReminders: z.boolean().optional(),
        // COMPAT(metadataGenerationEnabled): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon persists `metadataGeneration.{enabled,preferWriterPersonalities}`.
        // The generation path (WP-B) reads them; the client gates the toggle cards on this.
        metadataGenerationEnabled: z.boolean().optional(),
        // COMPAT(usageCostCategories): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon populates the per-category token/cost counters in
        // ActivityCounters (mainChat/generations/subagents/compaction + Claude
        // provider split + micro-USD cost). An old daemon leaves them all at 0,
        // so the client hides the Usage & Cost column's category grid rather than
        // presenting a column of zeros as if it were truthful accounting.
        usageCostCategories: z.boolean().optional(),
        // COMPAT(usageLog): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon serves the itemized usage ledger (usage.log.get).
        // The client gates the Metrics screen's "Log" tab on this; an old daemon
        // simply doesn't offer the tab.
        usageLog: z.boolean().optional(),
        // COMPAT(statsReset): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon handles stats.activity.reset (wipe all usage
        // counters + the itemized ledger). The client gates the Metrics screen's
        // "Reset" button on this; an old daemon simply doesn't offer it.
        statsReset: z.boolean().optional(),
        // COMPAT(historyDelete): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
        // Set when the daemon offers hard delete for chat records: per-row via
        // the existing `delete_agent_request`, and in bulk via
        // `history.agents.clear_archived`. Archive has always been a soft delete
        // with no counterpart; this is the counterpart. Deleting removes Otto's
        // record only - provider transcripts are never touched (see the
        // clear_archived schema). The client hides both affordances when this is
        // absent rather than shipping a degraded path.
        historyDelete: z.boolean().optional(),
        // COMPAT(fileMutations): added in v0.7.0, drop the gate when daemon floor >= v0.7.0.
        // Set when the daemon serves `file.create`, `file.delete` and
        // `file.rename` - creating, removing and moving entries, as opposed to
        // `file.write`, which only changes what is inside an existing file.
        // There is no client-side substitute (the client never touches the
        // filesystem), so an old daemon simply does not get the menu items.
        fileMutations: z.boolean().optional(),
        // COMPAT(binaryFileWrite): added in v0.7.6, drop the gate when daemon
        // floor >= v0.7.6. Set when the daemon serves
        // `fs.file.write_binary` - bytes to a workspace path, as opposed to
        // `fs.file.write`, which is text and refuses binary targets outright.
        // The client cannot write a workspace file itself on any platform, so
        // an old daemon simply does not offer the exports that produce bytes.
        binaryFileWrite: z.boolean().optional(),
        // COMPAT(attachmentStorage): added in v0.7.1, drop the gate when daemon floor >= v0.7.1.
        // Set when the daemon serves `attachments.images.get_stats` and
        // `attachments.images.clear` - the readout and reclaim for the images it
        // materializes on the agent's behalf. The client has no way to size or
        // clear a directory on the host, so an old daemon simply does not get
        // the daemon half of the Storage section; the app-side preview cache row
        // is local and always shown.
        attachmentStorage: z.boolean().optional(),
        // COMPAT(historyStorage): added in v0.7.2, drop the gate when daemon floor >= v0.7.2.
        historyStorage: z.boolean().optional(),
        // COMPAT(agentWorkspaceTransfer): added in v0.7.4, drop the gate when
        // daemon floor >= v0.7.4. Set when the daemon serves
        // `agent.workspace.transfer` - moving a chat to another workspace over
        // the same directory. The client cannot restamp ownership itself (it is
        // daemon state), so an old daemon simply does not get the menu item.
        agentWorkspaceTransfer: z.boolean().optional(),
        // COMPAT(agentForkContextCursor): added in v0.1.108, remove gate after 2027-01-14.
        agentForkContextCursor: z.boolean().optional(),
        // COMPAT(providerSubagents): added in v0.1.107, remove gate after 2027-01-12.
        providerSubagents: z.boolean().optional(),
        // COMPAT(workspacePinning): added in v0.1.107, remove gate after 2027-01-12.
        workspacePinning: z.boolean().optional(),
        // COMPAT(hubRelationship): added in v0.1.X, drop the gate when floor >= v0.1.X.
        hubRelationship: z.boolean().optional(),
        // COMPAT(projectGithubClone): added in v0.1.108, remove gate after 2027-01-15.
        projectGithubClone: z.boolean().optional(),
        // COMPAT(workspaceGithubRepositorySearch): added in v0.1.108, remove gate after 2027-01-15.
        workspaceGithubRepositorySearch: z.boolean().optional(),
        // COMPAT(projectCreateDirectory): added in v0.1.108, remove gate after 2027-01-15.
        projectCreateDirectory: z.boolean().optional(),
        // COMPAT(projectList): added in v0.2.4, drop the gate when floor >= v0.2.4.
        projectList: z.boolean().optional(),
        // COMPAT(commitsList): added in v0.1.110, remove gate after 2027-01-16.
        commitsList: z.boolean().optional(),
        // COMPAT(commitBaseClassification): added in v0.2.0, remove gate after 2027-01-23.
        commitBaseClassification: z.boolean().optional(),
        // COMPAT(providerRemoval): added in v0.1.105, drop the gate when floor >= v0.1.105.
        providerRemoval: z.boolean().optional(),
        // COMPAT(importSessionWorkspaceTarget): added in v0.1.110, remove gate after 2027-01-16.
        importSessionWorkspaceTarget: z.boolean().optional(),
        // COMPAT(forgeProviders): added in v0.1.106, drop the gate when daemon floor >= v0.1.106.
        // Daemon advertises pluggable non-GitHub forge support (the forge registry);
        // the client gates non-GitHub setup UI on it.
        forgeProviders: z.boolean().optional(),
        // COMPAT(selectiveAgentTimeline): added in v0.1.106, remove after 2027-01-12.
        selectiveAgentTimeline: z.boolean().optional(),
        // COMPAT(stableProjectIdentity): added in v0.1.109, remove gate after 2027-01-15.
        stableProjectIdentity: z.boolean().optional(),
        // COMPAT(workspaceScriptManagement): added in v0.1.105, remove gate after 2027-01-10.
        workspaceScriptManagement: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough()
  .transform((payload) => ({
    ...payload,
    hostname: payload.hostname ?? null,
    version: payload.version ?? null,
  }));

export const StatusMessageSchema = z.object({
  type: z.literal("status"),
  payload: z
    .object({
      status: z.string(),
    })
    .passthrough(), // Allow additional fields
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
  payload: z.object({
    requestId: z.string(),
    clientSentAt: z.number().int().optional(),
    serverReceivedAt: z.number().int(),
    serverSentAt: z.number().int(),
  }),
});

export const RpcErrorMessageSchema = z.object({
  type: z.literal("rpc_error"),
  payload: z.object({
    requestId: z.string(),
    requestType: z.string().optional(),
    error: z.string(),
    code: z.string().optional(),
  }),
});

const AgentStatusWithRequestSchema = z.object({
  agentId: z.string(),
  requestId: z.string(),
});

const AgentStatusWithTimelineSchema = AgentStatusWithRequestSchema.extend({
  timelineSize: z.number().optional(),
});

export const AgentCreatedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_created"),
    agent: AgentSnapshotPayloadSchema,
  })
  .extend(AgentStatusWithRequestSchema.shape);

export const AgentCreateFailedStatusPayloadSchema = z.object({
  status: z.literal("agent_create_failed"),
  requestId: z.string(),
  error: z.string(),
  errorCode: z.string().optional(),
});

export const AgentResumedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_resumed"),
    agent: AgentSnapshotPayloadSchema,
  })
  .extend(AgentStatusWithTimelineSchema.shape);

export const AgentRefreshedStatusPayloadSchema = z
  .object({
    status: z.literal("agent_refreshed"),
  })
  .extend(AgentStatusWithTimelineSchema.shape);

export const RestartRequestedStatusPayloadSchema = z.object({
  status: z.literal("restart_requested"),
  clientId: z.string(),
  reason: z.string().optional(),
  requestId: z.string(),
});

export const ShutdownRequestedStatusPayloadSchema = z.object({
  status: z.literal("shutdown_requested"),
  clientId: z.string(),
  requestId: z.string(),
});

export const DaemonConfigChangedStatusPayloadSchema = z
  .object({
    status: z.literal("daemon_config_changed"),
    config: MutableDaemonConfigSchema,
  })
  .passthrough();

export const KnownStatusPayloadSchema = z.discriminatedUnion("status", [
  BrainStatusChangedStatusPayloadSchema,
  BrainLogLineAddedStatusPayloadSchema,
  LspActivityChangedStatusPayloadSchema,
  LspDiagnosticsChangedStatusPayloadSchema,
  AgentCreatedStatusPayloadSchema,
  AgentCreateFailedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema,
  ShutdownRequestedStatusPayloadSchema,
  RestartRequestedStatusPayloadSchema,
  DaemonConfigChangedStatusPayloadSchema,
]);

export type KnownStatusPayload = z.infer<typeof KnownStatusPayloadSchema>;

export const ArtifactMessageSchema = z.object({
  type: z.literal("artifact"),
  payload: z.object({
    type: z.enum(["markdown", "diff", "image", "code"]),
    id: z.string(),
    title: z.string(),
    content: z.string(),
    isBase64: z.boolean(),
  }),
});

export const ProjectCheckoutLiteNotGitPayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(false),
    currentBranch: z.null(),
    remoteUrl: z.null(),
    worktreeRoot: z.null().optional(),
    isOttoOwnedWorktree: z.literal(false),
    mainRepoRoot: z.null(),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: null,
  }));

export const ProjectCheckoutLiteGitNonOttoPayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(true),
    currentBranch: z.string().nullable(),
    remoteUrl: z.string().nullable(),
    worktreeRoot: z.string().optional(),
    isOttoOwnedWorktree: z.literal(false),
    mainRepoRoot: z.string().nullable().optional().default(null),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: value.worktreeRoot ?? value.cwd,
  }));

export const ProjectCheckoutLiteGitOttoPayloadSchema = z
  .object({
    cwd: z.string(),
    isGit: z.literal(true),
    currentBranch: z.string().nullable(),
    remoteUrl: z.string().nullable(),
    worktreeRoot: z.string().optional(),
    isOttoOwnedWorktree: z.literal(true),
    mainRepoRoot: z.string(),
  })
  .transform((value) => ({
    ...value,
    worktreeRoot: value.worktreeRoot ?? value.cwd,
  }));

export const ProjectCheckoutLitePayloadSchema = z.union([
  ProjectCheckoutLiteNotGitPayloadSchema,
  ProjectCheckoutLiteGitNonOttoPayloadSchema,
  ProjectCheckoutLiteGitOttoPayloadSchema,
]);

export const ProjectPlacementPayloadSchema = z.object({
  projectKey: z.string(),
  projectName: z.string(),
  workspaceName: z.string().nullable().optional(),
  checkout: ProjectCheckoutLitePayloadSchema,
});

export const WorkspaceScriptLifecycleSchema = z.enum(["running", "stopped"]);
export const WorkspaceScriptHealthSchema = z.enum(["healthy", "unhealthy"]);

export const WorkspaceScriptSourcePayloadSchema = z.object({
  /** Stable provider id; also the prefix of every `scriptName` it produces. */
  id: z.string(),
  /** The tool half of the dropdown's group header, e.g. "npm" or "pnpm". */
  label: z.string(),
  /**
   * Repo-relative file the script was read from, e.g. "package.json".
   *
   * Plain-optional rather than defaulted, matching `label` and `command` on the
   * payload: absent means unknown. A discovery run knows the file, but the
   * descriptor's orphan path recovers a source from a qualified runtime name
   * alone (`npm:dev`) and has no discovery behind it to ask. A `.default(null)`
   * here would make the field required on the output type and force that path
   * to invent an answer it does not have.
   */
  file: z.string().nullable().optional(),
});

export const WorkspaceScriptPayloadSchema = z.object({
  /**
   * The launch/stop key, unique within a workspace. Otto's own otto.json
   * scripts use their bare name; a discovered one is qualified by its source
   * ("npm:build") so two sources offering "build" cannot collide in the
   * runtime store or the service-proxy hostname.
   */
  scriptName: z.string(),
  /**
   * What to show instead of `scriptName` - the name the project itself uses.
   * COMPAT(workspaceScriptDiscovery): added in v0.7.6; absent ⇒ show `scriptName`.
   */
  label: z.string().optional(),
  /**
   * Where this Script came from. Absent ⇒ declared in otto.json, which is the
   * only kind that existed before discovery and the only kind that may own a
   * service-proxy route.
   * COMPAT(workspaceScriptDiscovery): added in v0.7.6.
   */
  source: WorkspaceScriptSourcePayloadSchema.optional(),
  /**
   * The command the Script runs, for the row's subtitle. Left plain-optional
   * rather than defaulted so an existing payload that never carried a command
   * stays valid without gaining a field it has no answer for.
   * COMPAT(workspaceScriptDiscovery): added in v0.7.6; absent ⇒ no subtitle.
   */
  command: z.string().nullable().optional(),
  type: z.enum(["script", "service"]).optional().default("service"),
  hostname: z.string(),
  port: z.number().int().positive().nullable(),
  localProxyUrl: z.string().nullable().optional(),
  publicProxyUrl: z.string().nullable().optional(),
  proxyUrl: z.string().nullable().optional().default(null),
  lifecycle: WorkspaceScriptLifecycleSchema,
  health: WorkspaceScriptHealthSchema.nullable(),
  exitCode: z.number().nullable().optional().default(null),
  terminalId: z.string().nullable().optional().default(null),
});

const WorkspaceGitRuntimePayloadSchema = z
  .object({
    currentBranch: z.string().nullable().optional(),
    remoteUrl: z.string().nullable().optional(),
    isOttoOwnedWorktree: z.boolean().optional(),
    isDirty: z.boolean().nullable().optional(),
    // COMPAT(workspaceGitBaseRef): added in v0.8.7, remove after 2027-02-10.
    // The branch-history label is useful only when its comparison base is explicit.
    baseRef: z.string().nullable().optional(),
    aheadBehind: z
      .object({
        ahead: z.number(),
        behind: z.number(),
      })
      .nullable()
      .optional(),
    aheadOfOrigin: z.number().nullable().optional(),
    behindOfOrigin: z.number().nullable().optional(),
  })
  .optional()
  .nullable();

const WorkspaceGitHubRuntimePayloadSchema = z
  .object({
    featuresEnabled: z.boolean().optional(),
    pullRequest: z
      .object({
        number: z.number().optional(),
        url: z.string(),
        title: z.string(),
        state: z.string(),
        baseRefName: z.string(),
        headRefName: z.string(),
        isMerged: z.boolean(),
        isDraft: z.boolean().optional(),
        mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN").optional(),
        checks: z
          .array(
            z.object({
              name: z.string(),
              status: z.enum(["success", "failure", "pending", "skipped", "cancelled"]),
              url: z.string().nullable(),
              workflow: z.string().optional(),
              duration: z.string().optional(),
            }),
          )
          .optional(),
        checksStatus: z.enum(["none", "pending", "success", "failure"]).optional(),
        reviewDecision: z.enum(["approved", "changes_requested", "pending"]).nullable().optional(),
        repoOwner: z.string().optional(),
        repoName: z.string().optional(),
        github: z.unknown().optional(),
      })
      .nullable()
      .optional(),
    error: z
      .object({
        message: z.string(),
      })
      .nullable()
      .optional(),
    refreshedAt: z.string().nullable().optional(),
  })
  .optional()
  .nullable();

export const WorkspaceDescriptorPayloadSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    projectDisplayName: z.string(),
    // COMPAT(projectCustomName): added in v0.1.76, drop the optional gate when floor >= v0.1.76.
    // When the user has renamed a project, projectDisplayName carries the resolved
    // value (customName) and projectCustomName mirrors the raw override so the
    // settings UI can prefill its input and offer a "reset" action.
    projectCustomName: z.string().nullable().optional(),
    // The project's Kanban board target, so the Kanban screen can tell a
    // configured project from an unconfigured one without a round-trip.
    // COMPAT(projectKanbanTarget): added in v0.8.11, drop the optional gate when
    // floor >= v0.8.11.
    projectKanban: ProjectKanbanTargetSchema.nullable().optional(),
    projectRootPath: z.string(),
    workspaceDirectory: z.string().optional(),
    projectKind: z.enum(["git", "non_git", "directory"]),
    // COMPAT(workspaces): keep the legacy "directory" workspace kind parseable.
    // Persisted registries still carry it and there is no migration, so this
    // stays until a migration retires the kind rather than expiring on a date.
    workspaceKind: z.enum(["directory", "local_checkout", "checkout", "worktree"]),
    name: z.string(),
    // COMPAT(workspaceTitles): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
    // When the user has titled a workspace, `name` carries the resolved value
    // (title) and `title` mirrors the raw override so the rename UI can prefill
    // its input and offer a "reset to branch name" action. Null means the name
    // is derived from the branch/directory.
    title: z.string().nullable().optional(),
    // COMPAT(workspacePinning): added in v0.1.107, remove optional after 2027-01-12.
    pinnedAt: z.string().nullable().optional(),
    archivingAt: z.string().nullable().optional().default(null),
    status: WorkspaceStateBucketSchema,
    // Best-effort workspace status entry timestamp. Old daemons omit the
    // field; old clients treat missing and null equivalently. The transform
    // coerces a missing field to `null` so downstream code never has to
    // handle `undefined`.
    statusEnteredAt: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    activityAt: z.string().nullable(),
    diffStat: z
      .object({
        additions: z.number(),
        deletions: z.number(),
      })
      .nullable()
      .optional(),
    // COMPAT(workspaceWorkingTreeDiffStat): added in v0.8.7, remove after 2027-02-10.
    // `diffStat` is retained for older clients and means branch-versus-base.
    // This field is only the working tree relative to HEAD, so it clears on commit.
    workingTreeDiffStat: z
      .object({
        additions: z.number(),
        deletions: z.number(),
      })
      .nullable()
      .optional(),
    scripts: z.array(WorkspaceScriptPayloadSchema).default([]),
    gitRuntime: WorkspaceGitRuntimePayloadSchema,
    githubRuntime: WorkspaceGitHubRuntimePayloadSchema,
    // COMPAT(forge): added in v0.1.106, remove after 2026-12-27. The forge resolved
    // for this workspace, so the sidebar/hover-card render the right brand mark.
    // Old daemons omit it; absent means the client falls back to GitHub.
    forge: z.string().optional(),
    project: ProjectPlacementPayloadSchema.optional(),
  })
  .transform((workspace) => ({
    ...workspace,
    workspaceDirectory: workspace.workspaceDirectory ?? workspace.projectRootPath,
  }));

export const ArtifactUpdateMessageSchema = z.object({
  type: z.literal("artifact_update"),
  payload: z.object({
    artifact: ArtifactMetadataSchema,
  }),
});

export const AgentUpdateMessageSchema = z.object({
  type: z.literal("agent_update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      agent: AgentSnapshotPayloadSchema,
      project: ProjectPlacementPayloadSchema.nullable().optional(),
    }),
    z.object({
      kind: z.literal("remove"),
      agentId: z.string(),
    }),
  ]),
});

export const AgentStreamMessageSchema = z.object({
  type: z.literal("agent_stream"),
  payload: z.object({
    agentId: z.string(),
    event: AgentStreamEventPayloadSchema,
    timestamp: z.string(),
    // Present for timeline events. Maps 1:1 to canonical in-memory timeline rows.
    seq: z.number().int().nonnegative().optional(),
    epoch: z.string().optional(),
  }),
});

export const AgentStatusMessageSchema = z.object({
  type: z.literal("agent_status"),
  payload: z.object({
    agentId: z.string(),
    status: z.string(),
    info: AgentSnapshotPayloadSchema,
  }),
});

export const AgentListMessageSchema = z.object({
  type: z.literal("agent_list"),
  payload: z.object({
    agents: z.array(AgentSnapshotPayloadSchema),
  }),
});

const AgentDirectoryResponseEntrySchema = z.object({
  agent: AgentSnapshotPayloadSchema,
  project: ProjectPlacementPayloadSchema,
});

const AgentDirectoryPageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const FetchAgentsResponseMessageSchema = z.object({
  type: z.literal("fetch_agents_response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string().nullable().optional(),
    entries: z.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema,
  }),
});

export const FetchAgentHistoryResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_history_response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema,
  }),
});

export const FetchRecentProviderSessionsResponseMessageSchema = z.object({
  type: z.literal("fetch_recent_provider_sessions_response"),
  payload: z.object({
    requestId: z.string(),
    entries: z.array(RecentProviderSessionDescriptorPayloadSchema),
    filteredAlreadyImportedCount: z.number().int().nonnegative().optional(),
  }),
});

// COMPAT(workspaceProjects): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
// A project parent that has zero active workspaces. The sidebar renders the
// project row with a new-workspace child so projects persist after their last
// workspace is archived.
export const WorkspaceProjectDescriptorPayloadSchema = z.object({
  projectId: z.string(),
  // COMPAT(projectKey): added in v0.2.4 on 2026-07-28; remove optional after 2027-01-28.
  projectKey: z.string().optional(),
  projectDisplayName: z.string(),
  projectCustomName: z.string().nullable().optional(),
  // The project's Kanban board target. Rides on the project channel so the
  // Kanban screen can tell a configured project from an unconfigured one, and
  // so a project with no active workspaces still reports it.
  // COMPAT(projectKanbanTarget): added in v0.8.11, drop the optional gate when
  // floor >= v0.8.11.
  projectKanban: ProjectKanbanTargetSchema.nullable().optional(),
  projectRootPath: z.string(),
  projectKind: z.enum(["git", "non_git", "directory"]),
});

export const FetchWorkspacesResponseMessageSchema = z.object({
  type: z.literal("fetch_workspaces_response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string().nullable().optional(),
    entries: z.array(WorkspaceDescriptorPayloadSchema),
    // COMPAT(workspaceProjects): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
    // Project parents with no active workspaces. Old daemons omit it; old clients
    // ignore it. Only populated on the first page (no cursor).
    emptyProjects: z.array(WorkspaceProjectDescriptorPayloadSchema).optional().default([]),
    pageInfo: z.object({
      nextCursor: z.string().nullable(),
      prevCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  }),
});

export const WorkspaceUpdateMessageSchema = z.object({
  type: z.literal("workspace_update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      workspace: WorkspaceDescriptorPayloadSchema,
    }),
    z.object({
      kind: z.literal("remove"),
      id: z.string(),
      // COMPAT(workspaceProjects): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
      // When archiving this workspace leaves its project with no active
      // workspaces, the daemon includes the project parent so the sidebar keeps
      // rendering it without waiting for a full re-hydration. Old daemons omit
      // it; old clients ignore it and surface the project on their next
      // workspace fetch instead.
      emptyProject: WorkspaceProjectDescriptorPayloadSchema.optional(),
      // Project removal is represented on the existing workspace update channel
      // so old clients can still parse the message and ignore the extra field.
      removedProjectId: z.string().optional(),
    }),
  ]),
});

// A project's own metadata changed (today: the user renamed it). The workspace
// channel can only carry a project's name inside its workspaces' descriptors, so
// a project with no active workspaces had no live channel at all - its name only
// refreshed on the next full workspace fetch. This is the project-level channel:
// it fires whether or not the project currently has workspaces, and the daemon
// fans it out to every connected session because project metadata is host-global.
export const ProjectUpdatedNotificationSchema = z.object({
  type: z.literal("project.updated.notification"),
  payload: z.object({
    project: WorkspaceProjectDescriptorPayloadSchema,
    // False means the project has no active workspaces right now, so the client
    // keeps it in the empty-project bucket instead of expecting a workspace
    // descriptor to carry its name.
    hasActiveWorkspaces: z.boolean(),
  }),
});

export const ProjectUpdateMessageSchema = z.object({
  type: z.literal("project.update"),
  payload: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("upsert"), project: WorkspaceProjectDescriptorPayloadSchema }),
    z.object({ kind: z.literal("remove"), projectId: z.string() }),
  ]),
});

export const ProjectListResponseMessageSchema = z.object({
  type: z.literal("project.list.response"),
  payload: z.object({
    requestId: z.string(),
    projects: z.array(WorkspaceProjectDescriptorPayloadSchema),
  }),
});

export const ProjectResolveWorkspaceForPathResponseSchema = z.object({
  type: z.literal("project.resolveWorkspaceForPath.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string().nullable(),
  }),
});

export const ScriptStatusUpdateMessageSchema = z.object({
  type: z.literal("script_status_update"),
  payload: z.object({
    workspaceId: z.string(),
    scripts: z.array(WorkspaceScriptPayloadSchema),
  }),
});

export const WorkspaceSetupProgressMessageSchema = z.object({
  type: z.literal("workspace_setup_progress"),
  payload: z.object({
    workspaceId: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    detail: WorktreeSetupDetailPayloadSchema,
    error: z.string().nullable(),
  }),
});

export const WorkspaceSetupSnapshotSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  detail: WorktreeSetupDetailPayloadSchema,
  error: z.string().nullable(),
});

export const WorkspaceSetupStatusResponseMessageSchema = z.object({
  type: z.literal("workspace_setup_status_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    snapshot: WorkspaceSetupSnapshotSchema.nullable(),
  }),
});

export const OpenProjectResponseMessageSchema = z.object({
  type: z.literal("open_project_response"),
  payload: z.object({
    requestId: z.string(),
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
    // Unknown codes from newer daemons degrade to null; clients fall back to `error`.
    errorCode: z.enum(["directory_not_found"]).nullish().catch(null),
  }),
});

export const ProjectAddResponseSchema = z.object({
  type: z.literal("project.add.response"),
  payload: z.object({
    requestId: z.string(),
    project: WorkspaceProjectDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.enum(["directory_not_found"]).nullish().catch(null),
  }),
});

// COMPAT(projectScaffold): added in v0.6.9.
export const ProjectScaffoldResponseSchema = z.object({
  type: z.literal("project.scaffold.response"),
  payload: z.object({
    requestId: z.string(),
    // Registered project on success. Null whenever any step failed - the
    // daemon does not register a half-built directory.
    project: WorkspaceProjectDescriptorPayloadSchema.nullable(),
    // Absolute path of the created directory. Non-null even on a late failure
    // (e.g. push rejected) so the UI can tell the user what is on disk.
    path: z.string().nullable(),
    // Remote the repo was wired to, when one was created or cloned from.
    remoteUrl: z.string().nullable(),
    error: z.string().nullable(),
    // Unknown codes from newer daemons degrade to null; clients fall back to `error`.
    errorCode: z
      .enum([
        "parent_not_found",
        "invalid_name",
        "already_exists",
        "git_unavailable",
        "git_failed",
        "provider_unavailable",
        "remote_failed",
        "clone_failed",
        "register_failed",
      ])
      .nullish()
      .catch(null),
    // Terminal state of every step the daemon ran, in run order.
    steps: z.array(ProjectScaffoldStepSchema),
  }),
});

// Uncorrelated progress stream for an in-flight scaffold, keyed by the request's
// requestId. Purely advisory: the response carries the authoritative step list,
// so a client that ignores these still gets a correct result.
export const ProjectScaffoldProgressSchema = z.object({
  type: z.literal("project.scaffold.progress"),
  payload: z.object({
    requestId: z.string(),
    step: ProjectScaffoldStepIdSchema,
    status: ProjectScaffoldStepStatusSchema,
    detail: z.string().nullable(),
  }),
});

export const ProjectCreateDirectoryErrorCodeSchema = z.enum([
  "invalid_name",
  "parent_directory_not_found",
  "directory_exists",
  "permission_denied",
  "registration_failed",
  "filesystem_error",
]);

export const ProjectCreateDirectoryResponseSchema = z.object({
  type: z.literal("project.create_directory.response"),
  payload: z.object({
    requestId: z.string(),
    directoryPath: z.string().nullable(),
    project: WorkspaceProjectDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
    // Error codes are open-ended on the wire so older clients can still parse
    // responses after a newer daemon learns another failure reason.
    errorCode: z.string().nullable(),
  }),
});

export const WorkspaceGithubSearchRepositoriesResponseSchema = z.object({
  type: z.literal("workspace.github.search_repositories.response"),
  payload: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("success"),
      requestId: z.string(),
      repositories: z.array(GithubRepositorySchema),
      available: z.literal(true),
      error: z.null(),
    }),
    z.object({
      status: z.literal("unavailable"),
      requestId: z.string(),
      repositories: z.array(GithubRepositorySchema),
      reason: z.literal("gh_missing"),
      available: z.literal(false),
      error: z.string(),
    }),
    z.object({
      status: z.literal("unauthenticated"),
      requestId: z.string(),
      repositories: z.array(GithubRepositorySchema),
      available: z.literal(false),
      error: z.string(),
    }),
    z.object({
      status: z.literal("error"),
      requestId: z.string(),
      repositories: z.array(GithubRepositorySchema),
      available: z.literal(true),
      error: z.string(),
    }),
  ]),
});

export const ProjectGithubCloneResponseSchema = z.object({
  type: z.literal("project.github.clone.response"),
  payload: z.object({
    requestId: z.string(),
    repo: z.string().trim().min(MIN_REPOSITORY_PATH_LENGTH),
    checkoutPath: z.string().nullable(),
    project: WorkspaceProjectDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const StartWorkspaceScriptResponseMessageSchema = z.object({
  type: z.literal("start_workspace_script_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    scriptName: z.string(),
    terminalId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

const WorkspaceScriptOperationPayloadSchema = z.object({
  requestId: z.string(),
  workspaceId: z.string(),
  scriptName: z.string().optional(),
  script: WorkspaceScriptPayloadSchema.nullable().optional(),
  scripts: z.array(WorkspaceScriptPayloadSchema).optional(),
  error: z.string().nullable(),
});

export const WorkspaceScriptListResponseMessageSchema = z.object({
  type: z.literal("workspace.script.list.response"),
  payload: WorkspaceScriptOperationPayloadSchema,
});

export const WorkspaceScriptStartResponseMessageSchema = z.object({
  type: z.literal("workspace.script.start.response"),
  payload: WorkspaceScriptOperationPayloadSchema,
});

export const WorkspaceScriptStopResponseMessageSchema = z.object({
  type: z.literal("workspace.script.stop.response"),
  payload: WorkspaceScriptOperationPayloadSchema,
});

// COMPAT(desktopEditorBridge): added in v0.1.88, remove after 2026-12-03 once old clients no longer parse daemon editor RPC responses.
export const LegacyListAvailableEditorsResponseMessageSchema = z.object({
  type: z.literal("list_available_editors_response"),
  payload: z.object({
    requestId: z.string(),
    editors: z.array(
      z.object({
        id: z.string().trim().min(1),
        label: z.string(),
      }),
    ),
    error: z.string().nullable(),
  }),
});

export const LegacyOpenInEditorResponseMessageSchema = z.object({
  type: z.literal("open_in_editor_response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
  }),
});

export const ArchiveWorkspaceResponseMessageSchema = z.object({
  type: z.literal("archive_workspace_response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    archivedAt: z.string().nullable(),
    error: z.string().nullable(),
    // COMPAT(worktreeArchiveBranchCleanup): added in v0.6.7. The name of the
    // local branch the daemon deleted as part of this archive (when the request
    // asked for branchDisposition: "delete" and the branch was actually
    // removed), else null/absent. Old daemons omit it.
    deletedBranch: z.string().nullable().optional(),
  }),
});

// A re-attachable Otto worktree surfaced by worktree.reattach.list.
// COMPAT(worktreeReattach): added in v0.6.7.
export const WorktreeReattachCandidateSchema = z.object({
  // Present when an archived workspace record still backs this worktree; null for
  // an orphaned on-disk worktree with no record. The reattach request keys off
  // whichever identity is available.
  workspaceId: z.string().nullable(),
  worktreePath: z.string(),
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  // The worktree directory currently exists on disk. False means the record was
  // archived away and the directory must be recreated from the branch on reattach.
  directoryOnDisk: z.boolean(),
  // The workspace's human name when we have a record, else null.
  displayName: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

export const WorktreeReattachListResponseSchema = z.object({
  type: z.literal("worktree.reattach.list.response"),
  payload: z.object({
    requestId: z.string(),
    candidates: z.array(WorktreeReattachCandidateSchema),
    error: z.string().nullable(),
  }),
});

export const WorktreeReattachResponseSchema = z.object({
  type: z.literal("worktree.reattach.response"),
  payload: z.object({
    requestId: z.string(),
    // The revived/created workspace descriptor, or null on error.
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const FetchAgentResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_response"),
  payload: z.object({
    requestId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    project: ProjectPlacementPayloadSchema.nullable().optional(),
    error: z.string().nullable(),
  }),
});

const AgentTimelineSeqRangeSchema = z.object({
  startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative(),
});

export const AgentTimelineEntryPayloadSchema = z.object({
  provider: AgentProviderSchema,
  item: AgentTimelineItemPayloadSchema,
  timestamp: z.string(),
  seqStart: z.number().int().nonnegative(),
  seqEnd: z.number().int().nonnegative(),
  sourceSeqRanges: z.array(AgentTimelineSeqRangeSchema),
  collapsed: z.array(z.enum(["assistant_merge", "reasoning_merge", "tool_lifecycle"])),
});

export const FetchAgentTimelineResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    direction: z.enum(["tail", "before", "after"]),
    projection: z.enum(["projected", "canonical"]),
    epoch: z.string(),
    reset: z.boolean(),
    staleCursor: z.boolean(),
    gap: z.boolean(),
    window: z.object({
      minSeq: z.number().int().nonnegative(),
      maxSeq: z.number().int().nonnegative(),
      nextSeq: z.number().int().nonnegative(),
    }),
    startCursor: AgentTimelineCursorSchema.nullable(),
    endCursor: AgentTimelineCursorSchema.nullable(),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    entries: z.array(AgentTimelineEntryPayloadSchema),
    error: z.string().nullable(),
  }),
});

export const ProviderSubagentDescriptorPayloadSchema = z.object({
  id: z.string(),
  parentAgentId: z.string(),
  provider: AgentProviderSchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  toolCallId: z.string().nullable(),
  cwd: z.string().nullable().optional(),
});

export type ProviderSubagentDescriptorPayload = z.infer<
  typeof ProviderSubagentDescriptorPayloadSchema
>;

export const ProviderSubagentListResponseMessageSchema = z.object({
  type: z.literal("agent.provider_subagents.list.response"),
  payload: z.object({
    requestId: z.string(),
    parentAgentId: z.string(),
    subagents: z.array(ProviderSubagentDescriptorPayloadSchema),
    error: z.string().nullable(),
  }),
});

export const ProviderSubagentTimelineResponseMessageSchema = z.object({
  type: z.literal("agent.provider_subagents.timeline.get.response"),
  payload: z.object({
    requestId: z.string(),
    parentAgentId: z.string(),
    subagentId: z.string(),
    provider: AgentProviderSchema.nullable(),
    direction: z.enum(["tail", "before", "after"]),
    epoch: z.string(),
    reset: z.boolean(),
    staleCursor: z.boolean(),
    gap: z.boolean(),
    window: z.object({
      minSeq: z.number().int().nonnegative(),
      maxSeq: z.number().int().nonnegative(),
      nextSeq: z.number().int().nonnegative(),
    }),
    hasOlder: z.boolean(),
    hasNewer: z.boolean(),
    rows: z.array(
      z.object({
        item: AgentTimelineItemPayloadSchema,
        timestamp: z.string(),
        seq: z.number().int().nonnegative(),
      }),
    ),
    error: z.string().nullable(),
  }),
});

export const ProviderSubagentUpdateMessageSchema = z.object({
  type: z.literal("agent.provider_subagents.update"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      subagent: ProviderSubagentDescriptorPayloadSchema,
    }),
    z.object({
      kind: z.literal("timeline"),
      parentAgentId: z.string(),
      subagentId: z.string(),
      provider: AgentProviderSchema,
      item: AgentTimelineItemPayloadSchema,
      timestamp: z.string(),
      seq: z.number().int().nonnegative(),
      epoch: z.string(),
    }),
    z.object({
      kind: z.literal("remove"),
      parentAgentId: z.string(),
      subagentId: z.string(),
    }),
  ]),
});

export const SetAgentTimelineSubscriptionResponseMessageSchema = z.object({
  type: z.literal("agent.timeline.set_subscription.response"),
  payload: z.object({
    agentIds: z.array(z.string()),
    requestId: z.string(),
  }),
});

export const AgentAttentionRequiredMessageSchema = z.object({
  type: z.literal("agent_attention_required"),
  payload: z.object({
    agentId: z.string(),
    reason: z.enum(["finished", "error", "permission"]),
    timestamp: z.string(),
    shouldNotify: z.boolean(),
    notification: z
      .object({
        title: z.string(),
        body: z.string(),
        data: z.object({
          serverId: z.string(),
          workspaceId: z.string().optional(),
          agentId: z.string(),
          reason: z.enum(["finished", "error", "permission"]),
        }),
      })
      .optional(),
  }),
});

export const AgentForkContextResponseMessageSchema = z.object({
  type: z.literal("agent.fork_context.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    attachment: TextAttachmentSchema.nullable(),
    itemCount: z.number().int().nonnegative(),
    boundaryMessageId: z.string().nullable(),
    boundaryCursor: AgentTimelineCursorSchema.nullable().optional(),
    error: z.string().nullable(),
  }),
});

export const CancelAgentResponseMessageSchema = z.object({
  type: z.literal("cancel_agent_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    // Whether an in-flight run was actually interrupted. False when the agent
    // had nothing running (already finished, still initializing), so clients
    // can say "nothing to stop" instead of silently no-oping. Purely additive;
    // absent ⇒ unknown (old daemon). See docs/agent-lifecycle.md (Item 2).
    cancelled: z.boolean().optional(),
    error: z.string().nullable().optional(),
  }),
});

export const ClearAgentAttentionResponseMessageSchema = z.object({
  type: z.literal("clear_agent_attention_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string().or(z.array(z.string())),
    agents: z.array(AgentSnapshotPayloadSchema),
  }),
});

export const WorkspaceCreateResponseSchema = z.object({
  type: z.literal("workspace.create.response"),
  payload: z.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    setupTerminalId: z.string().nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
    requestId: z.string(),
  }),
});

export const WorkspaceClearAttentionResponseSchema = z.object({
  type: z.literal("workspace.clear_attention.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.union([z.string(), z.array(z.string())]),
    clearedAgentIds: z.array(z.string()),
    results: z.array(
      z.object({
        workspaceId: z.string(),
        clearedAgentIds: z.array(z.string()),
        success: z.boolean(),
        error: z.string().nullable(),
      }),
    ),
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const SendAgentMessageResponseMessageSchema = z.object({
  type: z.literal("send_agent_message_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
    // Set when the message was parked for the next turn rather than dispatched
    // (`delivery: "queue"` against a busy agent). `queuedMessageId` is the
    // entry's id in `AgentSnapshotPayload.queuedMessages` - the key the sender
    // uses to find its own entry again. Absent ⇒ dispatched now (or old daemon).
    // COMPAT(steerQueue): added in v0.6.8, drop the gate when floor >= v0.6.8.
    queued: z.boolean().optional(),
    queuedMessageId: z.string().optional(),
  }),
});

export const WaitForFinishResponseMessageSchema = z.object({
  type: z.literal("wait_for_finish_response"),
  payload: z.object({
    requestId: z.string(),
    status: z.enum(["idle", "error", "permission", "timeout"]),
    final: AgentSnapshotPayloadSchema.nullable(),
    error: z.string().nullable(),
    lastMessage: z.string().nullable(),
  }),
});

export const GetDaemonConfigResponseMessageSchema = z.object({
  type: z.literal("get_daemon_config_response"),
  payload: z
    .object({
      requestId: z.string(),
      config: MutableDaemonConfigSchema,
    })
    .passthrough(),
});

export const DaemonGetStatusResponseSchema = z.object({
  type: z.literal("daemon.get_status.response"),
  payload: z
    .object({
      requestId: z.string(),
      serverId: z.string(),
      version: z.string().nullable().optional(),
      pid: z.number(),
      nodePath: z.string(),
      startedAt: z.string().nullable().optional(),
      listen: z.string().nullable(),
      relay: z
        .object({
          enabled: z.boolean(),
          endpoint: z.string(),
          publicEndpoint: z.string(),
          useTls: z.boolean(),
          publicUseTls: z.boolean(),
        })
        .nullable()
        .optional(),
      providers: z.array(
        z.object({
          provider: z.string(),
          available: z.boolean(),
          error: z.string().nullable().optional(),
        }),
      ),
    })
    .passthrough(),
});

export const HubRelationshipStatusSchema = z.object({
  state: z.enum([
    "not_connected",
    "connecting",
    "connected",
    "reconnecting",
    "disconnecting",
    "revoked",
  ]),
  daemonId: z.string().nullable(),
  hubOrigin: z.string().nullable(),
  scopes: z.array(z.string()),
  connectedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export const HubManagementDaemonConnectResponseSchema = z.object({
  type: z.literal("hub.management.daemon.connect.response"),
  payload: z.object({ requestId: z.string(), status: HubRelationshipStatusSchema }),
});
export const HubManagementDaemonGetStatusResponseSchema = z.object({
  type: z.literal("hub.management.daemon.get_status.response"),
  payload: z.object({ requestId: z.string(), status: HubRelationshipStatusSchema }),
});
export const HubManagementDaemonDisconnectResponseSchema = z.object({
  type: z.literal("hub.management.daemon.disconnect.response"),
  payload: z.object({
    requestId: z.string(),
    status: HubRelationshipStatusSchema,
    warning: z.string().optional(),
  }),
});

export const DaemonGetPairingOfferResponseSchema = z.object({
  type: z.literal("daemon.get_pairing_offer.response"),
  payload: z
    .object({
      requestId: z.string(),
      url: z.string(),
      qr: z.string().nullable().optional(),
      relayEnabled: z.boolean(),
    })
    .passthrough(),
});

export const DiagnosticsResponseSchema = z.object({
  type: z.literal("diagnostics.response"),
  payload: z
    .object({
      requestId: z.string(),
      diagnostic: z.string(),
    })
    .passthrough(),
});

export const SetDaemonConfigResponseMessageSchema = z.object({
  type: z.literal("set_daemon_config_response"),
  payload: z
    .object({
      requestId: z.string(),
      config: MutableDaemonConfigSchema,
    })
    .passthrough(),
});

export const ReadProjectConfigResponseMessageSchema = z.object({
  type: z.literal("read_project_config_response"),
  // zod-aot 0.2.0 miscompiles boolean discriminators as string options
  // (`"true"`/`"false"`), so keep this sequential until upstream fixes it.
  payload: z.union([
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(true),
      config: OttoConfigRawSchema.nullable(),
      revision: OttoConfigRevisionSchema.nullable(),
    }),
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(false),
      error: ProjectConfigRpcErrorSchema,
    }),
  ]),
});

export const WriteProjectConfigResponseMessageSchema = z.object({
  type: z.literal("write_project_config_response"),
  // zod-aot 0.2.0 miscompiles boolean discriminators as string options
  // (`"true"`/`"false"`), so keep this sequential until upstream fixes it.
  payload: z.union([
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(true),
      config: OttoConfigRawSchema,
      revision: OttoConfigRevisionSchema,
    }),
    z.object({
      requestId: z.string(),
      repoRoot: z.string(),
      ok: z.literal(false),
      error: ProjectConfigRpcErrorSchema,
    }),
  ]),
});

export const AgentPermissionRequestMessageSchema = z.object({
  type: z.literal("agent_permission_request"),
  payload: z.object({
    agentId: z.string(),
    request: AgentPermissionRequestPayloadSchema,
  }),
});

export const AgentPermissionResolvedMessageSchema = z.object({
  type: z.literal("agent_permission_resolved"),
  payload: z.object({
    agentId: z.string(),
    requestId: z.string(),
    resolution: AgentPermissionResponseSchema,
  }),
});

export const AgentDeletedMessageSchema = z.object({
  type: z.literal("agent_deleted"),
  payload: z.object({
    agentId: z.string(),
    requestId: z.string(),
  }),
});

export const AgentArchivedMessageSchema = z.object({
  type: z.literal("agent_archived"),
  payload: z.object({
    agentId: z.string(),
    archivedAt: z.string(),
    requestId: z.string(),
  }),
});

const CloseItemsAgentResultSchema = z.object({
  agentId: z.string(),
  archivedAt: z.string(),
});

const CloseItemsTerminalResultSchema = z.object({
  terminalId: z.string(),
  success: z.boolean(),
});

export const CloseItemsResponseSchema = z.object({
  type: z.literal("close_items_response"),
  payload: z.object({
    agents: z.array(CloseItemsAgentResultSchema),
    terminals: z.array(CloseItemsTerminalResultSchema),
    requestId: z.string(),
  }),
});

const AheadBehindSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
});

const CheckoutStatusCommonSchema = z.object({
  cwd: z.string(),
  error: CheckoutErrorSchema.nullable(),
  requestId: z.string(),
  // Daemon clock (epoch ms) at which the git-tracking fields below were measured.
  // One writer stamps it, so clients can compare two payloads and drop an
  // out-of-order push instead of clobbering newer git state.
  // COMPAT(checkoutStatusGitStateAt): added in v0.6.8; absent from older daemons.
  // Drop the optional marker when floor >= v0.6.8 (target 2027-01-24).
  gitStateAt: z.number().optional(),
  // Where `baseRef` came from, so the base chip can label an inferred parent as a guess rather
  // than presenting it with the same authority as an explicit pick.
  // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4.
  baseSource: CheckoutBaseSourceSchema.optional(),
  // Whether this checkout can have its base repointed. True for any git checkout on a daemon
  // that stores the base per branch; older daemons only supported Otto worktrees, which the
  // client inferred from isOttoOwnedWorktree.
  // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4.
  isBaseEditable: z.boolean().optional(),
});

const CheckoutStatusNotGitSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(false),
  isOttoOwnedWorktree: z.literal(false),
  repoRoot: z.null(),
  currentBranch: z.null(),
  isDirty: z.null(),
  baseRef: z.null(),
  aheadBehind: z.null(),
  aheadOfOrigin: z.null(),
  behindOfOrigin: z.null(),
  hasRemote: z.boolean(),
  remoteUrl: z.null(),
});

const CheckoutStatusGitNonOttoSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(true),
  isOttoOwnedWorktree: z.literal(false),
  repoRoot: z.string(),
  mainRepoRoot: z.string().nullable().optional().default(null),
  currentBranch: z.string().nullable(),
  isDirty: z.boolean(),
  baseRef: z.string().nullable(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: z.number().nullable(),
  behindOfOrigin: z.number().nullable(),
  hasRemote: z.boolean(),
  remoteUrl: z.string().nullable(),
});

const CheckoutStatusGitOttoSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(true),
  isOttoOwnedWorktree: z.literal(true),
  repoRoot: z.string(),
  mainRepoRoot: z.string(),
  currentBranch: z.string().nullable(),
  isDirty: z.boolean(),
  baseRef: z.string(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: z.number().nullable(),
  behindOfOrigin: z.number().nullable(),
  hasRemote: z.boolean(),
  remoteUrl: z.string().nullable(),
});

export const CheckoutStatusResponseSchema = z.object({
  type: z.literal("checkout_status_response"),
  payload: z.union([
    CheckoutStatusNotGitSchema,
    CheckoutStatusGitNonOttoSchema,
    CheckoutStatusGitOttoSchema,
  ]),
});

const CheckoutPrGithubAutoMergeRequestSchema = z
  .object({
    enabledAt: z.string().nullable().optional().default(null),
    mergeMethod: z.string().nullable().optional().default(null),
    enabledBy: z.string().nullable().optional().default(null),
  })
  .nullable()
  .optional()
  .default(null);

const CheckoutPrGithubRepositoryPolicySchema = z
  .object({
    autoMergeAllowed: z.boolean().optional().default(false),
    mergeCommitAllowed: z.boolean().optional().default(false),
    squashMergeAllowed: z.boolean().optional().default(false),
    rebaseMergeAllowed: z.boolean().optional().default(false),
    viewerDefaultMergeMethod: z.string().nullable().optional().default(null),
  })
  .optional()
  .default({
    autoMergeAllowed: false,
    mergeCommitAllowed: false,
    squashMergeAllowed: false,
    rebaseMergeAllowed: false,
    viewerDefaultMergeMethod: null,
  });

const CheckoutPrGithubStatusObjectSchema = z.object({
  mergeStateStatus: z.string().nullable().optional().default(null),
  autoMergeRequest: CheckoutPrGithubAutoMergeRequestSchema,
  viewerCanEnableAutoMerge: z.boolean().optional().default(false),
  viewerCanDisableAutoMerge: z.boolean().optional().default(false),
  viewerCanMergeAsAdmin: z.boolean().optional().default(false),
  viewerCanUpdateBranch: z.boolean().optional().default(false),
  repository: CheckoutPrGithubRepositoryPolicySchema,
  isMergeQueueEnabled: z.boolean().optional().default(false),
  isInMergeQueue: z.boolean().optional().default(false),
});

const CheckoutPrGithubStatusSchema = CheckoutPrGithubStatusObjectSchema.optional();

// The open facts envelope for forge-specific PR facts. Permanent - non-GitHub
// forges deliver their native facts through it. The transitional piece is the
// `github` mirror above, which stays populated for clients predating this
// envelope; see COMPAT(forgeSpecific) in status-projection.ts for the shim.
//
// NOTE: `forgeSpecific.forge` is a FACTS-FAMILY tag, not the workspace brand id.
// The whole Gitea family (gitea, forgejo, codeberg) emits `forge: "gitea"` here
// because they share one facts shape, while the top-level `forge` above carries
// the specific brand. Validation of family-specific payloads happens at runtime
// in the consumer that knows that forge family.
const CheckoutPrForgeSpecificSchema = z.unknown().optional();

export const CheckoutPrStatusSchema = z.object({
  // COMPAT(forge): added in v0.1.106, remove the default after 2026-12-27 once daemon floor >= v0.1.106.
  forge: z.string().optional().default("github"),
  projectPath: z.string().optional(),
  number: z.number().optional(),
  url: z.string(),
  title: z.string(),
  state: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  isMerged: z.boolean(),
  isDraft: z.boolean().optional().default(false),
  mergeable: z
    .enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"])
    .catch("UNKNOWN")
    .optional()
    .default("UNKNOWN"),
  checks: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        url: z.string().nullable(),
        workflow: z.string().optional(),
        duration: z.string().optional(),
        checkRunId: z.number().optional(),
        workflowRunId: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
  checksStatus: z.string().optional(),
  reviewDecision: z.string().nullable().optional(),
  repoOwner: z.string().optional(),
  repoName: z.string().optional(),
  github: CheckoutPrGithubStatusSchema,
  // Provider-neutral per-PR hosting facts. Absent from old daemons; for
  // GitHub projects both this and the legacy `github` field are populated.
  //
  // NOT a shim, and deliberately untagged: this carries provider capabilities
  // alongside the Forge identity. They match for built-in hosts today, but the
  // provider remains the source of truth for hosting-specific capabilities.
  hosting: z
    .object({
      provider: GitHostingProviderIdWireSchema,
      bitbucket: z
        .object({
          mergeStrategiesAllowed: z.array(z.string()).optional().default([]),
          defaultMergeStrategy: z.string().nullable().optional().default(null),
          approvalCount: z.number().optional().default(0),
          changesRequestedCount: z.number().optional().default(0),
        })
        .optional(),
    })
    .optional(),
  forgeSpecific: CheckoutPrForgeSpecificSchema,
});

// Why a forge's PR/MR features are (un)available, so the client can offer the
// precise next step instead of a generic dead-end. Kept open on the wire so
// feature consumers can ignore values introduced by newer daemons.
export type ForgeAuthState =
  | "authenticated"
  | "unauthenticated"
  | "cli_missing"
  | "no_remote"
  | "error";

export const ForgeAuthStateSchema = z.unknown().optional();

const CheckoutPrStatusPayloadSchema = z.object({
  cwd: z.string(),
  status: CheckoutPrStatusSchema.nullable(),
  // Legacy GitHub-only flag. For non-GitHub providers new daemons send false
  // here (old clients then correctly show no GitHub features) and describe
  // the real provider in `hosting` below.
  githubFeaturesEnabled: z.boolean(),
  // Provider-neutral enablement. Present even when status is null so clients
  // can drive search/create-PR affordances for the workspace's provider.
  // Permanent so provider-specific capability decisions do not need to infer
  // behavior from the Forge presentation identity.
  hosting: z
    .object({
      provider: GitHostingProviderIdWireSchema,
      featuresEnabled: z.boolean(),
      capabilities: GitHostingCapabilitiesSchema.optional(),
    })
    .optional(),
  // COMPAT(forgeAuthState): added in v0.1.106, remove after 2026-12-27. Optional richer
  // signal that supersedes githubFeaturesEnabled. The legacy boolean stays for old clients
  // and may remain true for non-auth error payloads so old clients still show the error.
  // Drop the boolean once the daemon floor >= v0.1.106.
  authState: ForgeAuthStateSchema,
  // COMPAT(forge): added in v0.1.106, remove the default after 2026-12-27 once daemon floor >= v0.1.106.
  forge: z.string().optional().default("github"),
  error: CheckoutErrorSchema.nullable(),
  requestId: z.string(),
});

const CheckoutStatusUpdateMetadataSchema = z.object({
  prStatus: CheckoutPrStatusPayloadSchema.optional(),
  // True when the push refreshed only PR/check state (the hosting PR-status poll).
  // The git block on such a payload is an unrefreshed echo of the last snapshot,
  // so clients must apply `prStatus` and leave their git-tracking state alone.
  // COMPAT(checkoutStatusPrStatusOnly): added in v0.6.8; absent from older daemons.
  // Drop the default when floor >= v0.6.8 (target 2027-01-24).
  prStatusOnly: z.boolean().optional().default(false),
});

export const CheckoutStatusUpdateSchema = z.object({
  type: z.literal("checkout_status_update"),
  payload: z
    .union([
      CheckoutStatusNotGitSchema,
      CheckoutStatusGitNonOttoSchema,
      CheckoutStatusGitOttoSchema,
    ])
    .and(CheckoutStatusUpdateMetadataSchema),
});

const CheckoutDiffSubscriptionPayloadSchema = z.object({
  subscriptionId: z.string(),
  cwd: z.string(),
  files: z.array(ParsedDiffFileSchema),
  error: CheckoutErrorSchema.nullable(),
  // COMPAT(diffTooLarge): added in v0.2.4, keep optional until the daemon floor is v0.2.4.
  diffTooLarge: z.boolean().optional(),
});

export const SubscribeCheckoutDiffResponseSchema = z.object({
  type: z.literal("subscribe_checkout_diff_response"),
  payload: CheckoutDiffSubscriptionPayloadSchema.extend({
    requestId: z.string(),
  }),
});

export const CheckoutDiffUpdateSchema = z.object({
  type: z.literal("checkout_diff_update"),
  payload: CheckoutDiffSubscriptionPayloadSchema,
});

export const CheckoutCommitResponseSchema = z.object({
  type: z.literal("checkout_commit_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

// ── Git file investigation responses ────────────────────────────────────────

// A structured failure any of the four file-investigation RPCs can report. They
// are pure reads, so the failure modes are narrow: not a repo, path/revision
// rejected, or git itself refused.
export const CheckoutGitFileErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("not_git_repo"),
  }),
  z.object({
    kind: z.literal("invalid_path"),
    detail: z.string(),
  }),
  z.object({
    kind: z.literal("git_failed"),
    detail: z.string(),
  }),
]);

export const CheckoutGitFileHistoryResponseSchema = z.object({
  type: z.literal("checkout.git.get_file_history.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    entries: z.array(GitFileHistoryEntrySchema),
    hasMore: z.boolean(),
    error: CheckoutGitFileErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutGitFileCommitDiffResponseSchema = z.object({
  type: z.literal("checkout.git.get_file_commit_diff.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    sha: z.string(),
    diff: z.string(),
    // Highlighted/parsed form of the same diff, when it parsed cleanly.
    structured: z.array(ParsedDiffFileSchema).optional(),
    // The file's previous revision - the diff's left-hand side, and the honest
    // label for it. Absent when this revision created the file.
    previousSha: z.string().optional(),
    previousPath: z.string().optional(),
    truncated: z.boolean(),
    error: CheckoutGitFileErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutGitFileBlameResponseSchema = z.object({
  type: z.literal("checkout.git.get_file_blame.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    lines: z.array(GitBlameLineSchema),
    commits: z.array(GitBlameCommitSchema),
    startLine: z.number(),
    endLine: z.number(),
    reachedEndOfFile: z.boolean(),
    error: CheckoutGitFileErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutGitFileOriginResponseSchema = z.object({
  type: z.literal("checkout.git.get_file_origin.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    // Null when the file has no commit history (never committed, or a shallow
    // clone that does not reach its creation).
    entry: GitFileHistoryEntrySchema.nullable(),
    error: CheckoutGitFileErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutMergeResponseSchema = z.object({
  type: z.literal("checkout_merge_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutMergeFromBaseResponseSchema = z.object({
  type: z.literal("checkout_merge_from_base_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPullResponseSchema = z.object({
  type: z.literal("checkout_pull_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPushResponseSchema = z.object({
  type: z.literal("checkout_push_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRefreshResponseSchema = z.object({
  type: z.literal("checkout.refresh.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutGitFetchResponseSchema = z.object({
  type: z.literal("checkout.git.fetch.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrCreateResponseSchema = z.object({
  type: z.literal("checkout_pr_create_response"),
  payload: z.object({
    cwd: z.string(),
    url: z.string().nullable(),
    number: z.number().nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrMergeResponseSchema = z.object({
  type: z.literal("checkout_pr_merge_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutForgeSetAutoMergeResponseSchema = z.object({
  type: z.literal("checkout.forge.set_auto_merge.response"),
  payload: z.object({
    cwd: z.string(),
    enabled: z.boolean(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

// COMPAT(githubAutoMergeRpc): added in v0.1.106, remove after 2026-12-28 once
// all supported clients use checkout.forge.set_auto_merge.*.
export const CheckoutGithubSetAutoMergeResponseSchema = z.object({
  type: z.literal("checkout.github.set_auto_merge.response"),
  payload: z.object({
    cwd: z.string(),
    enabled: z.boolean(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutCommitsListResponseSchema = z.object({
  type: z.literal("checkout.commits.list.response"),
  payload: z.object({
    cwd: z.string(),
    baseRef: z.string().nullable(),
    commits: z.array(CheckoutCommitSchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutCommitFileDiffResponseSchema = z.object({
  type: z.literal("checkout.commits.file_diff.response"),
  payload: z.object({
    cwd: z.string(),
    sha: z.string(),
    path: z.string(),
    // null when the file is absent from the commit or carries no textual diff
    // (e.g. binary-only changes).
    file: ParsedDiffFileSchema.nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

const CheckoutGithubCheckAnnotationSchema = z.object({
  path: z.string().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  annotationLevel: z.string().optional(),
  message: z.string().optional(),
  title: z.string().optional(),
  rawDetails: z.string().optional(),
});

const CheckoutGithubCheckJobSchema = z.object({
  jobId: z.number(),
  name: z.string(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  logTail: z.string().optional(),
  logTruncated: z.boolean().optional(),
});

// Statuses stay open strings so future forge values cannot break parsing.
const CheckoutPipelineJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  stage: z.string(),
  status: z.string(),
  rawStatus: z.string(),
  url: z.string().nullable().optional().default(null),
  allowFailure: z.boolean().optional().default(false),
  durationSeconds: z.number().nullable().optional().default(null),
});

const CheckoutPipelineStageSchema = z.object({
  name: z.string(),
  status: z.string(),
  jobs: z.array(CheckoutPipelineJobSchema).optional().default([]),
});

const CheckoutPipelineSchema = z.object({
  id: z.number(),
  status: z.string(),
  rawStatus: z.string(),
  url: z.string().nullable().optional().default(null),
  ref: z.string().nullable().optional().default(null),
  sha: z.string().nullable().optional().default(null),
  stages: z.array(CheckoutPipelineStageSchema).optional().default([]),
});

export const CheckoutGithubCheckDetailsSchema = z.object({
  checkRunId: z.number(),
  workflowRunId: z.number().nullable().optional(),
  name: z.string(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  output: z
    .object({
      title: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  annotations: z.array(CheckoutGithubCheckAnnotationSchema).optional().default([]),
  failedJobs: z.array(CheckoutGithubCheckJobSchema).optional().default([]),
  truncated: z.boolean().optional().default(false),
  // No default: server CheckDetails keeps this optional and GitHub leaves it absent.
  pipeline: CheckoutPipelineSchema.nullable().optional(),
});

export const CheckoutCheckDetailsSchema = CheckoutGithubCheckDetailsSchema;

export const CheckoutForgeGetCheckDetailsResponseSchema = z.object({
  type: z.literal("checkout.forge.get_check_details.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    details: CheckoutCheckDetailsSchema.nullable().optional().default(null),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

// COMPAT(githubCheckDetailsRpc): added in v0.1.106, remove after 2026-12-28 once
// all supported clients use checkout.forge.get_check_details.*.
export const CheckoutGithubGetCheckDetailsResponseSchema = z.object({
  type: z.literal("checkout.github.get_check_details.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    details: CheckoutCheckDetailsSchema.nullable().optional().default(null),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrStatusResponseSchema = z.object({
  type: z.literal("checkout_pr_status_response"),
  payload: CheckoutPrStatusPayloadSchema,
});

const PullRequestTimelineKnownErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("not_found"),
    message: z.string().optional().default(""),
  }),
  z.object({
    kind: z.literal("forbidden"),
    message: z.string().optional().default(""),
  }),
  z.object({
    kind: z.literal("unknown"),
    message: z.string().optional().default(""),
  }),
]);

const PullRequestTimelineErrorSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "unknown", message: "" };
  }
  const error = value as Record<string, unknown>;
  if (error.kind === "not_found" || error.kind === "forbidden" || error.kind === "unknown") {
    return error;
  }
  return { ...error, kind: "unknown" };
}, PullRequestTimelineKnownErrorSchema);

const PullRequestTimelineReviewItemSchema = z.object({
  id: z.string().optional().default(""),
  kind: z.literal("review"),
  author: z.string().optional().default("unknown"),
  authorUrl: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  body: z.string().optional().default(""),
  createdAt: z.number().optional().default(0),
  url: z.string().optional().default(""),
  reviewState: z
    .enum(["approved", "changes_requested", "commented"])
    .optional()
    .default("commented"),
});

const PullRequestTimelineCommentItemSchema = z.object({
  id: z.string().optional().default(""),
  kind: z.literal("comment"),
  author: z.string().optional().default("unknown"),
  authorUrl: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  body: z.string().optional().default(""),
  createdAt: z.number().optional().default(0),
  url: z.string().optional().default(""),
  // GitHub review id this inline comment belongs to; lets clients nest review
  // threads under their parent review. Absent on issue comments and on
  // timelines from daemons that predate the field.
  reviewId: z.string().optional(),
  // Forge-neutral discussion/thread id this comment belongs to, independent of a
  // file position. GitLab maps its discussion id here so general (non-file)
  // reply chains group into one thread; file-position threads also carry it.
  // Absent on standalone comments and on timelines from daemons that predate it.
  threadId: z.string().optional(),
  // Forge-neutral resolution state for a thread that has no file position, e.g. a
  // GitLab general (non-file) discussion that is resolvable. File-position threads
  // carry their resolution under `location.isResolved` instead. Absent on ordinary
  // comments, on forges that expose no thread resolution, and on older timelines.
  threadIsResolved: z.boolean().optional(),
  location: z
    .object({
      path: z.string(),
      line: z.number().optional(),
      startLine: z.number().optional(),
      threadId: z.string().optional(),
      isResolved: z.boolean().optional(),
      isOutdated: z.boolean().optional(),
    })
    .optional(),
});

export const PullRequestTimelineItemSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const item = value as Record<string, unknown>;
    if (item.kind === "review" || item.kind === "comment") {
      return item;
    }
    return { ...item, kind: "comment" };
  },
  z.discriminatedUnion("kind", [
    PullRequestTimelineReviewItemSchema,
    PullRequestTimelineCommentItemSchema,
  ]),
);

export const PullRequestTimelineResponseSchema = z.object({
  type: z.literal("pull_request_timeline_response"),
  payload: z
    .object({
      cwd: z.string().optional().default(""),
      prNumber: z.number().nullable().optional().default(null),
      items: z.array(PullRequestTimelineItemSchema).optional().default([]),
      truncated: z.boolean().optional().default(false),
      error: PullRequestTimelineErrorSchema.nullable().optional().default(null),
      requestId: z.string().optional().default(""),
      githubFeaturesEnabled: z.boolean().optional().default(true),
      // COMPAT(forgeAuthState): added in v0.1.106, remove after 2026-12-27. Optional richer
      // signal that supersedes githubFeaturesEnabled, mirroring CheckoutPrStatusPayloadSchema.
      // Drop the boolean once the daemon floor >= v0.1.106.
      authState: ForgeAuthStateSchema,
    })
    .optional()
    .prefault({}),
});

export const CheckoutSwitchBranchResponseSchema = z.object({
  type: z.literal("checkout_switch_branch_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    branch: z.string(),
    source: z.enum(["local", "remote"]).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRenameBranchResponseSchema = z.object({
  type: z.literal("checkout.rename_branch.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    cwd: z.string(),
    currentBranch: z.string().nullable(),
    error: CheckoutErrorSchema.nullable(),
  }),
});

const StashEntrySchema = z.object({
  index: z.number().int().min(0),
  message: z.string(),
  branch: z.string().nullable(),
  isOtto: z.boolean(),
});

export const StashSaveResponseSchema = z.object({
  type: z.literal("stash_save_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const StashPopResponseSchema = z.object({
  type: z.literal("stash_pop_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const StashListResponseSchema = z.object({
  type: z.literal("stash_list_response"),
  payload: z.object({
    cwd: z.string(),
    entries: z.array(StashEntrySchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const ValidateBranchResponseSchema = z.object({
  type: z.literal("validate_branch_response"),
  payload: z.object({
    exists: z.boolean(),
    resolvedRef: z.string().nullable(),
    isRemote: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BranchSuggestionsResponseSchema = z.object({
  type: z.literal("branch_suggestions_response"),
  payload: z.object({
    branches: z.array(z.string()),
    branchDetails: z
      .array(
        z.object({
          name: z.string(),
          committerDate: z.number(),
          hasLocal: z.boolean().optional(),
          hasRemote: z.boolean().optional(),
          // True when the branch is checked out in another worktree, so a
          // direct `git checkout` of it would be rejected. Optional: absent on
          // older daemons, in which case pickers disable nothing (today's
          // behavior).
          checkedOutElsewhere: z.boolean().optional(),
        }),
      )
      .optional(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

const ForgeSearchResponsePayloadSchema = z.object({
  items: z.array(z.unknown()),
  authState: z.unknown().optional(),
  error: z.string().nullable(),
  requestId: z.string(),
});

const GitHubSearchResponsePayloadSchema = z.object({
  items: z.array(z.unknown()),
  featuresEnabled: z.boolean().optional(),
  authState: z.unknown().optional(),
  githubFeaturesEnabled: z.boolean().optional(),
  error: z.string().nullable(),
  requestId: z.string(),
});

export const ForgeSearchResponseSchema = z.object({
  type: z.literal("forge.search.response"),
  payload: ForgeSearchResponsePayloadSchema,
});

// COMPAT(githubSearchRpc): added in v0.1.106, remove after 2026-12-28 once
// clients use forge.search.*.
export const GitHubSearchResponseSchema = z.object({
  type: z.literal("github_search_response"),
  payload: GitHubSearchResponsePayloadSchema,
});

export const HostingSearchResponseSchema = z.object({
  type: z.literal("hosting.search.response"),
  payload: z.object({
    items: z.array(GitHubSearchItemSchema),
    provider: GitHostingProviderIdWireSchema,
    featuresEnabled: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const DirectorySuggestionsResponseSchema = z.object({
  type: z.literal("directory_suggestions_response"),
  payload: z.object({
    directories: z.array(z.string()),
    entries: z
      .array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      )
      .optional()
      .default([]),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

const OttoWorktreeSchema = z.object({
  worktreePath: z.string(),
  createdAt: z.string(),
  branchName: z.string().nullable().optional(),
  head: z.string().nullable().optional(),
});

export const OttoWorktreeListResponseSchema = z.object({
  type: z.literal("otto_worktree_list_response"),
  payload: z.object({
    worktrees: z.array(OttoWorktreeSchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const OttoWorktreeArchiveResponseSchema = z.object({
  type: z.literal("otto_worktree_archive_response"),
  payload: z.object({
    success: z.boolean(),
    removedAgents: z.array(z.string()).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CreateOttoWorktreeResponseSchema = z.object({
  type: z.literal("create_otto_worktree_response"),
  payload: z.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
    setupTerminalId: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileExplorerResponseSchema = z.object({
  type: z.literal("file_explorer_response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    mode: z.enum(["list", "file"]),
    directory: FileExplorerDirectorySchema.nullable(),
    file: FileExplorerFileSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileSubscribeResponseSchema = z.object({
  type: z.literal("fs.file.subscribe.response"),
  payload: z.object({
    subscriptionId: z.string(),
    initial: FileVersionSchema,
    requestId: z.string(),
  }),
});

export const FileUnsubscribeResponseSchema = z.object({
  type: z.literal("fs.file.unsubscribe.response"),
  payload: z.object({
    subscriptionId: z.string(),
    requestId: z.string(),
  }),
});

export const FsFileWriteResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("written"),
    modifiedAt: z.string(),
    size: z.number(),
    revision: z.string().optional(),
  }),
  z.object({ status: z.literal("conflict"), version: FileVersionSchema }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

export const FsFileWriteResponseSchema = z.object({
  type: z.literal("fs.file.write.response"),
  payload: z.object({
    result: FsFileWriteResultSchema,
    requestId: z.string(),
  }),
});

export const FsFileWriteBinaryResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("written"),
    modifiedAt: z.string(),
    size: z.number(),
  }),
  // The target is already there and the request did not ask to replace it.
  z.object({ status: z.literal("exists") }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

export const FsFileWriteBinaryResponseSchema = z.object({
  type: z.literal("fs.file.write_binary.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    result: FsFileWriteBinaryResultSchema,
    requestId: z.string(),
  }),
});

export const FileUpdateSchema = z.object({
  type: z.literal("fs.file.update"),
  payload: z.object({
    subscriptionId: z.string(),
    version: FileVersionSchema,
  }),
});

const ProjectIconSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
});

export const ProjectIconResponseSchema = z.object({
  type: z.literal("project_icon_response"),
  payload: z.object({
    cwd: z.string(),
    icon: ProjectIconSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileDownloadTokenResponseSchema = z.object({
  type: z.literal("file_download_token_response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    token: z.string().nullable(),
    fileName: z.string().nullable(),
    mimeType: z.string().nullable(),
    size: z.number().nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileUploadResponseSchema = z.object({
  type: z.literal("file.upload.response"),
  payload: z.object({
    requestId: z.string(),
    file: UploadedFileAttachmentSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const FileWriteResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    modifiedAt: z.string(),
    hash: z.string(),
    size: z.number(),
    eol: FileEolSchema,
  }),
  // The file on disk is not what the client last saw; nothing was written.
  // `content` carries the current disk text so the client can offer reload or
  // an informed overwrite (a second conditional write against this identity)
  // without another round-trip.
  z.object({
    status: z.literal("conflict"),
    modifiedAt: z.string(),
    hash: z.string(),
    content: z.string().optional(),
    eol: FileEolSchema.optional(),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
  }),
]);

export const FileWriteResponseSchema = z.object({
  type: z.literal("file.write.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    result: FileWriteResultSchema,
    requestId: z.string(),
  }),
});

export const ListProviderModelsResponseMessageSchema = z.object({
  type: z.literal("list_provider_models_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    models: z.array(AgentModelDefinitionSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

export const ListProviderModesResponseMessageSchema = z.object({
  type: z.literal("list_provider_modes_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    modes: z.array(AgentModeSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

export const ListProviderFeaturesResponseMessageSchema = z.object({
  type: z.literal("list_provider_features_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    features: z.array(AgentFeatureSchema).optional(),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

const ProviderAvailabilitySchema = z.object({
  provider: AgentProviderSchema,
  available: z.boolean(),
  error: z.string().nullable().optional(),
});

export const ListAvailableProvidersResponseSchema = z.object({
  type: z.literal("list_available_providers_response"),
  payload: z.object({
    providers: z.array(ProviderAvailabilitySchema),
    error: z.string().nullable().optional(),
    fetchedAt: z.string(),
    requestId: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const GetProvidersSnapshotResponseMessageSchema = z.object({
  type: z.literal("get_providers_snapshot_response"),
  payload: z.object({
    entries: z.array(ProviderSnapshotEntrySchema),
    generatedAt: z.string(),
    requestId: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const ProvidersSnapshotUpdateMessageSchema = z.object({
  type: z.literal("providers_snapshot_update"),
  payload: z.object({
    cwd: z.string().optional(),
    entries: z.array(ProviderSnapshotEntrySchema),
    generatedAt: z.string(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const RefreshProvidersSnapshotResponseMessageSchema = z.object({
  type: z.literal("refresh_providers_snapshot_response"),
  payload: z.object({
    requestId: z.string(),
    acknowledged: z.boolean(),
  }),
});

// COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
export const ProviderDiagnosticResponseMessageSchema = z.object({
  type: z.literal("provider_diagnostic_response"),
  payload: z.object({
    provider: AgentProviderSchema,
    diagnostic: z.string(),
    requestId: z.string(),
  }),
});

export const ProviderUsageToneSchema = z.enum(["default", "ok", "warning", "danger"]);
export const ProviderUsageStatusSchema = z.enum(["available", "unavailable", "error"]);

export const ProviderUsageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable().optional(),
  remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageBalanceSchema = z.object({
  id: z.string(),
  label: z.string(),
  used: z.number().nullable().optional(),
  remaining: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  unit: z.enum(["usd", "credits", "requests", "tokens"]),
  resetsAt: z.string().nullable().optional(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageDetailSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  tone: ProviderUsageToneSchema.optional(),
});

export const ProviderUsageSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  status: ProviderUsageStatusSchema,
  planLabel: z.string().nullable(),
  sourceLabel: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional(),
  nextRefreshAt: z.string().nullable().optional(),
  windows: z.array(ProviderUsageWindowSchema),
  balances: z.array(ProviderUsageBalanceSchema).optional(),
  details: z.array(ProviderUsageDetailSchema).optional(),
  error: z.string().nullable().optional(),
});

export const ProviderUsageListResponseMessageSchema = z.object({
  type: z.literal("provider.usage.list.response"),
  payload: z.object({
    requestId: z.string(),
    fetchedAt: z.string(),
    providers: z.array(ProviderUsageSchema),
  }),
});

const AgentSlashCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  kind: z.enum(["command", "skill"]).optional().catch("command"),
});

export const ListCommandsResponseSchema = z.object({
  type: z.literal("list_commands_response"),
  payload: z.object({
    agentId: z.string(),
    commands: z.array(AgentSlashCommandSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// ============================================================================
// Terminal Outbound Messages
// ============================================================================

const TerminalInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  title: z.string().optional(),
  activity: TerminalActivitySchema.nullable().optional(),
  presentation: z.enum(["embedded"]).optional(),
  presentationOwner: z.string().optional(),
});

export const TerminalCellSchema = z.object({
  char: z.string(),
  fg: z.number().optional(),
  bg: z.number().optional(),
  fgMode: z.number().optional(),
  bgMode: z.number().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  dim: z.boolean().optional(),
  inverse: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
});

export const TerminalCursorStyleSchema = z.enum(["block", "underline", "bar"]);

export const TerminalCursorSchema = z.object({
  row: z.number(),
  col: z.number(),
  hidden: z.boolean().optional(),
  style: TerminalCursorStyleSchema.optional(),
  blink: z.boolean().optional(),
});

export const TerminalStateSchema = z.object({
  rows: z.number(),
  cols: z.number(),
  grid: z.array(z.array(TerminalCellSchema)),
  scrollback: z.array(z.array(TerminalCellSchema)),
  cursor: TerminalCursorSchema,
  title: z.string().optional(),
  // Per-row soft-wrap flags aligned 1:1 with `grid` / `scrollback`. `true` means
  // the row continued onto the next row (xterm's GRID_LINE_WRAPPED equivalent),
  // so the client can re-wrap the logical line on resize instead of freezing it
  // at the snapshot width. Optional: only sent to clients that advertise the
  // `terminalReflowableSnapshot` capability, so old daemons/clients are unaffected.
  gridWrapped: z.array(z.boolean()).optional(),
  scrollbackWrapped: z.array(z.boolean()).optional(),
});

export const ListTerminalsResponseSchema = z.object({
  type: z.literal("list_terminals_response"),
  payload: z.object({
    cwd: z.string().optional(),
    terminals: z.array(TerminalInfoSchema.omit({ cwd: true })),
    requestId: z.string(),
  }),
});

export const TerminalsChangedSchema = z.object({
  type: z.literal("terminals_changed"),
  payload: z.object({
    cwd: z.string(),
    terminals: z.array(TerminalInfoSchema.omit({ cwd: true })),
  }),
});

export const CreateTerminalResponseSchema = z.object({
  type: z.literal("create_terminal_response"),
  payload: z.object({
    terminal: TerminalInfoSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const RenameTerminalResponseSchema = z.object({
  type: z.literal("terminal.rename.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const SubscribeTerminalResponseSchema = z.object({
  type: z.literal("subscribe_terminal_response"),
  payload: z.union([
    z.object({
      terminalId: z.string(),
      slot: z.number().int().min(0).max(255),
      error: z.null(),
      requestId: z.string(),
    }),
    z.object({
      terminalId: z.string(),
      error: z.string(),
      requestId: z.string(),
    }),
  ]),
});

export const KillTerminalResponseSchema = z.object({
  type: z.literal("kill_terminal_response"),
  payload: z.object({
    terminalId: z.string(),
    success: z.boolean(),
    requestId: z.string(),
  }),
});

export const CaptureTerminalResponseSchema = z.object({
  type: z.literal("capture_terminal_response"),
  payload: z.object({
    terminalId: z.string(),
    lines: z.array(z.string()),
    totalLines: z.number().int().nonnegative(),
    requestId: z.string(),
  }),
});

export const TerminalStreamExitSchema = z.object({
  type: z.literal("terminal_stream_exit"),
  payload: z.object({
    terminalId: z.string(),
  }),
});

export const TerminalAttentionRequiredSchema = z.object({
  type: z.literal("terminal_attention_required"),
  payload: z.object({
    serverId: z.string().optional(),
    terminalId: z.string(),
    cwd: z.string(),
    workspaceId: z.string().optional(),
    reason: z.enum(["finished", "needs_input"]),
    title: z.string(),
    body: z.string(),
    shouldNotify: z.boolean(),
  }),
});

export const DaemonUpdateResponseSchema = z.object({
  type: z.literal("daemon.update.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    error: z.string().nullable(),
    previousVersion: z.string().nullable(),
    newVersion: z.string().nullable(),
  }),
});

export type DaemonUpdateResponse = z.infer<typeof DaemonUpdateResponseSchema>;

export const DaemonUpdateProgressMessageSchema = z.object({
  type: z.literal("daemon.update.progress"),
  payload: z.object({
    requestId: z.string(),
    phase: z.enum(["starting", "downloading", "installing", "complete"]),
  }),
});

export const HubExecutionAgentCreateResponseSchema = z.object({
  type: z.literal("hub.execution.agent.create.response"),
  payload: z.object({
    requestId: z.string(),
    executionId: z.string(),
    agentId: z.string().nullable(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const HubExecutionControlResponseSchema = z.object({
  type: z.literal("hub.execution.control.response"),
  payload: z.object({
    requestId: z.string(),
    executionId: z.string(),
    action: HubExecutionControlActionSchema,
    success: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const HubExecutionAgentUpdateSchema = z.object({
  type: z.literal("hub.execution.agent.update"),
  payload: z.object({
    executionId: z.string(),
    agentId: z.string(),
    agent: AgentSnapshotPayloadSchema,
  }),
});

export const HubExecutionAgentStreamSchema = z.object({
  type: z.literal("hub.execution.agent.stream"),
  payload: z.object({
    executionId: z.string(),
    agentId: z.string(),
    event: AgentStreamEventPayloadSchema,
  }),
});

export type HubExecutionAgentCreateResponse = z.infer<typeof HubExecutionAgentCreateResponseSchema>;
export type HubExecutionControlResponse = z.infer<typeof HubExecutionControlResponseSchema>;
export type HubExecutionAgentUpdate = z.infer<typeof HubExecutionAgentUpdateSchema>;
export type HubExecutionAgentStream = z.infer<typeof HubExecutionAgentStreamSchema>;

export const HubExecutionOutboundMessageSchema = z.discriminatedUnion("type", [
  HubExecutionAgentCreateResponseSchema,
  HubExecutionControlResponseSchema,
  HubExecutionAgentUpdateSchema,
  HubExecutionAgentStreamSchema,
]);

export type HubExecutionOutboundMessage = z.infer<typeof HubExecutionOutboundMessageSchema>;

export class HubMessageCorrelationError extends Error {
  constructor(messageType: HubExecutionOutboundMessage["type"]) {
    super(`Hub message ${messageType} has mismatched agent correlation`);
    this.name = "HubMessageCorrelationError";
  }
}

export function parseHubExecutionOutboundMessage(value: unknown): HubExecutionOutboundMessage {
  const message = HubExecutionOutboundMessageSchema.parse(value);
  const payload = message.payload;
  if (
    "agent" in payload &&
    payload.agent !== null &&
    "agentId" in payload &&
    payload.agentId !== null &&
    payload.agent.id !== payload.agentId
  ) {
    throw new HubMessageCorrelationError(message.type);
  }
  return message;
}

export type DaemonUpdateProgressMessage = z.infer<typeof DaemonUpdateProgressMessageSchema>;

export const SessionOutboundMessageSchema = z.discriminatedUnion("type", [
  HubExecutionAgentCreateResponseSchema,
  HubExecutionControlResponseSchema,
  HubExecutionAgentUpdateSchema,
  HubExecutionAgentStreamSchema,
  BrowserAutomationExecuteRequestSchema,
  ActivityLogMessageSchema,
  AssistantChunkMessageSchema,
  AudioOutputMessageSchema,
  TranscriptionResultMessageSchema,
  VoiceInputStateMessageSchema,
  DictationStreamAckMessageSchema,
  DictationStreamFinishAcceptedMessageSchema,
  DictationStreamPartialMessageSchema,
  DictationStreamFinalMessageSchema,
  DictationStreamErrorMessageSchema,
  StatusMessageSchema,
  PongMessageSchema,
  RpcErrorMessageSchema,
  ArtifactMessageSchema,
  ArtifactUpdateMessageSchema,
  AgentUpdateMessageSchema,
  WorkspaceUpdateMessageSchema,
  ProjectUpdateMessageSchema,
  ProjectListResponseMessageSchema,
  ProjectResolveWorkspaceForPathResponseSchema,
  ScriptStatusUpdateMessageSchema,
  WorkspaceSetupProgressMessageSchema,
  WorkspaceSetupStatusResponseMessageSchema,
  AgentStreamMessageSchema,
  AgentStatusMessageSchema,
  FetchAgentsResponseMessageSchema,
  FetchAgentHistoryResponseMessageSchema,
  FetchRecentProviderSessionsResponseMessageSchema,
  FetchWorkspacesResponseMessageSchema,
  ProjectAddResponseSchema,
  ProjectScaffoldResponseSchema,
  ProjectScaffoldProgressSchema,
  ProjectCreateDirectoryResponseSchema,
  OpenProjectResponseMessageSchema,
  WorkspaceGithubSearchRepositoriesResponseSchema,
  ProjectGithubCloneResponseSchema,
  StartWorkspaceScriptResponseMessageSchema,
  WorkspaceScriptListResponseMessageSchema,
  WorkspaceScriptStartResponseMessageSchema,
  WorkspaceScriptStopResponseMessageSchema,
  LegacyListAvailableEditorsResponseMessageSchema,
  LegacyOpenInEditorResponseMessageSchema,
  ArchiveWorkspaceResponseMessageSchema,
  WorkspaceArchivePreflightResponseSchema,
  WorktreeBaseRefSetResponseSchema,
  WorktreeReattachListResponseSchema,
  WorktreeReattachResponseSchema,
  FetchAgentResponseMessageSchema,
  FetchAgentTimelineResponseMessageSchema,
  ProviderSubagentListResponseMessageSchema,
  ProviderSubagentTimelineResponseMessageSchema,
  ProviderSubagentUpdateMessageSchema,
  SetAgentTimelineSubscriptionResponseMessageSchema,
  AgentAttentionRequiredMessageSchema,
  AgentForkContextResponseMessageSchema,
  CancelAgentResponseMessageSchema,
  ClearAgentAttentionResponseMessageSchema,
  WorkspaceCreateResponseSchema,
  WorkspaceClearAttentionResponseSchema,
  SendAgentMessageResponseMessageSchema,
  SetVoiceModeResponseMessageSchema,
  DaemonGetStatusResponseSchema,
  DaemonGetPairingOfferResponseSchema,
  HubManagementDaemonConnectResponseSchema,
  HubManagementDaemonGetStatusResponseSchema,
  HubManagementDaemonDisconnectResponseSchema,
  DiagnosticsResponseSchema,
  GetDaemonConfigResponseMessageSchema,
  SetDaemonConfigResponseMessageSchema,
  ConnectorsListToolsResponseSchema,
  ConnectorsOauthAuthorizeResponseSchema,
  ConnectorsOauthDisconnectResponseSchema,
  ConnectorsOauthStatusMessageSchema,
  CommunicationsGetOverviewResponseSchema,
  CommunicationsInboxGetHomeResponseSchema,
  CommunicationsInboxSearchResponseSchema,
  CommunicationsInboxSetFavoriteResponseSchema,
  CommunicationsInboxNotificationsAcknowledgeResponseSchema,
  CommunicationsInboxGetPresenceResponseSchema,
  CommunicationsInboxPresenceChangedNotificationSchema,
  CommunicationsInboxSetPresenceResponseSchema,
  CommunicationsInboxSetEnabledResponseSchema,
  CommunicationsInboxGetMessagesResponseSchema,
  CommunicationsInboxSendMessageResponseSchema,
  CommunicationsRoomGetResponseSchema,
  CommunicationsRoomThreadGetResponseSchema,
  CommunicationsRoomMessageSendResponseSchema,
  CommunicationsRoomReactionSetResponseSchema,
  MeetingsTranscriptsListResponseSchema,
  MeetingsTranscriptsCreateResponseSchema,
  MeetingsTranscriptsUpdateResponseSchema,
  MeetingsTranscriptsDeleteResponseSchema,
  IntegrationsAuthorizationGetOverviewResponseSchema,
  IntegrationsAuthorizationGetMethodsResponseSchema,
  IntegrationsAuthorizationStartBrowserResponseSchema,
  IntegrationsZoomStartAuthorizationResponseSchema,
  SpeechSettingsGetOptionsResponseSchema,
  SpeechTtsPreviewResponseSchema,
  SpeechTtsSpeakResponseSchema,
  SpeechTtsSpeakCancelResponseSchema,
  VisualizerVoiceCuesGenerateResponseSchema,
  AgentPersonalitiesGetStatsResponseSchema,
  AgentPersonalitiesGenerateProfileResponseSchema,
  ReadProjectConfigResponseMessageSchema,
  WriteProjectConfigResponseMessageSchema,
  SetAgentModeResponseMessageSchema,
  SetAgentModelResponseMessageSchema,
  SetAgentThinkingResponseMessageSchema,
  SetAgentFeatureResponseMessageSchema,
  AgentDetachResponseMessageSchema,
  AgentWorkspaceTransferResponseMessageSchema,
  AgentQueueRemoveResponseMessageSchema,
  AgentQueueReorderResponseMessageSchema,
  AgentQueueClearResponseMessageSchema,
  AgentSubagentStopResponseMessageSchema,
  AgentBackgroundTaskStopResponseMessageSchema,
  AgentBackgroundTaskClearResponseMessageSchema,
  BackgroundShellTasksChangedSchema,
  TasksSuggestedStartResponseMessageSchema,
  TasksSuggestedDismissResponseMessageSchema,
  SuggestedTasksChangedSchema,
  ContextReportChangedSchema,
  AgentPersonalitySetResponseMessageSchema,
  AgentRewindResponseMessageSchema,
  UpdateAgentResponseMessageSchema,
  ProjectRenameResponseSchema,
  KanbanProjectTargetSetResponseSchema,
  ProjectUpdatedNotificationSchema,
  ProjectRemoveResponseSchema,
  ProjectLinksListResponseSchema,
  ProjectLinksSetResponseSchema,
  ProjectLinksUnsetResponseSchema,
  ProjectLinksChangedSchema,
  WorkspaceTitleSetResponseSchema,
  WorkspacePinSetResponseSchema,
  WorkspaceRecoveryInspectResponseSchema,
  WorkspaceRecoveryRestoreResponseSchema,
  WaitForFinishResponseMessageSchema,
  AgentPermissionRequestMessageSchema,
  AgentPermissionResolvedMessageSchema,
  AgentDeletedMessageSchema,
  HistoryAgentsClearArchivedResponseSchema,
  HistoryAgentsStorageStatsResponseSchema,
  AttachmentsImagesStatsResponseSchema,
  AttachmentsImagesClearResponseSchema,
  BrainHostStatusResponseSchema,
  BrainHostStartResponseSchema,
  BrainHostStopResponseSchema,
  BrainHostRestartResponseSchema,
  BrainEvalsGetResponseSchema,
  BrainNetworkDiscoverResponseSchema,
  BrainModelsListResponseSchema,
  BrainRemoteConfigGetResponseSchema,
  BrainRemoteConfigPatchResponseSchema,
  BrainModelsScanResponseSchema,
  BrainCatalogListResponseSchema,
  BrainRuntimeListResponseSchema,
  BrainModelsPullResponseSchema,
  BrainRuntimeInstallResponseSchema,
  BrainRuntimeRemoveResponseSchema,
  BrainCalibrateResponseSchema,
  BrainSweepResponseSchema,
  BrainBenchResponseSchema,
  BrainJobsListResponseSchema,
  BrainJobsCancelResponseSchema,
  BrainHfSearchResponseSchema,
  BrainHfQuantsResponseSchema,
  BrainModelsAddResponseSchema,
  BrainModelsInventoryResponseSchema,
  BrainModelProfileGetResponseSchema,
  BrainModelProfileSetResponseSchema,
  BrainModelBudgetGetResponseSchema,
  BrainModelLoadResponseSchema,
  BrainModelUnloadResponseSchema,
  BrainModelDeleteResponseSchema,
  BrainModelComponentDeleteResponseSchema,
  BrainModelRenameResponseSchema,
  BrainModelRenameResetResponseSchema,
  BrainLogsTailResponseSchema,
  BrainLogsWatchResponseSchema,
  AgentArchivedMessageSchema,
  CloseItemsResponseSchema,
  CheckoutStatusResponseSchema,
  CheckoutStatusUpdateSchema,
  SubscribeCheckoutDiffResponseSchema,
  CheckoutDiffUpdateSchema,
  CheckoutCommitResponseSchema,
  CheckoutGitCommitResponseSchema,
  CheckoutGitCommitAgentResponseSchema,
  CheckoutGitRollbackResponseSchema,
  CheckoutGitGetOperationLogResponseSchema,
  CheckoutGitLogAppendedNotificationSchema,
  CheckoutGitFileHistoryResponseSchema,
  CheckoutGitFileCommitDiffResponseSchema,
  CheckoutGitFileBlameResponseSchema,
  CheckoutGitFileOriginResponseSchema,
  RunsGetSnapshotResponseSchema,
  RunsUpdatedNotificationSchema,
  RunsGateRespondResponseSchema,
  RunsCancelResponseSchema,
  RunsClearResponseSchema,
  RunsDeleteResponseSchema,
  RunsClearedNotificationSchema,
  RunsGraphsListResponseSchema,
  RunsGraphsSaveResponseSchema,
  RunsGraphsDeleteResponseSchema,
  RunsGraphsChangedNotificationSchema,
  RunsTemplatesListResponseSchema,
  RunsTemplatesSaveResponseSchema,
  RunsTemplatesDeleteResponseSchema,
  RunsTemplatesChangedNotificationSchema,
  RunsStartResponseSchema,
  CheckoutMergeResponseSchema,
  CheckoutMergeFromBaseResponseSchema,
  CheckoutPullResponseSchema,
  CheckoutPushResponseSchema,
  CheckoutRefreshResponseSchema,
  CheckoutGitFetchResponseSchema,
  CheckoutPrCreateResponseSchema,
  CheckoutPrMergeResponseSchema,
  CheckoutForgeSetAutoMergeResponseSchema,
  CheckoutGithubSetAutoMergeResponseSchema,
  CheckoutCommitsListResponseSchema,
  CheckoutCommitFileDiffResponseSchema,
  CheckoutForgeGetCheckDetailsResponseSchema,
  CheckoutGithubGetCheckDetailsResponseSchema,
  PreviewListConfigResponseSchema,
  PreviewStartResponseSchema,
  PreviewBindTabResponseSchema,
  PreviewStopResponseSchema,
  CheckoutPrStatusResponseSchema,
  PullRequestTimelineResponseSchema,
  CheckoutSwitchBranchResponseSchema,
  CheckoutRenameBranchResponseSchema,
  StashSaveResponseSchema,
  StashPopResponseSchema,
  StashListResponseSchema,
  KanbanBoardsListResponseSchema,
  KanbanBoardGetResponseSchema,
  KanbanCardMoveResponseSchema,
  KanbanCardCreateResponseSchema,
  KanbanTaskLinkResponseSchema,
  ValidateBranchResponseSchema,
  BranchSuggestionsResponseSchema,
  ForgeSearchResponseSchema,
  GitHubSearchResponseSchema,
  HostingSearchResponseSchema,
  HostingAuthStatusResponseSchema,
  HostingListRepositoriesResponseSchema,
  HostingListOwnersResponseSchema,
  DirectorySuggestionsResponseSchema,
  OttoWorktreeListResponseSchema,
  OttoWorktreeArchiveResponseSchema,
  CreateOttoWorktreeResponseSchema,
  FileExplorerResponseSchema,
  FileSubscribeResponseSchema,
  FileUnsubscribeResponseSchema,
  FsFileWriteResponseSchema,
  FsFileWriteBinaryResponseSchema,
  FileUpdateSchema,
  ProjectIconResponseSchema,
  FileDownloadTokenResponseSchema,
  FileUploadResponseSchema,
  FileWriteResponseSchema,
  FileCreateResponseSchema,
  FileDeleteResponseSchema,
  FileRenameResponseSchema,
  FileRefineResponseSchema,
  FileWatchSubscribeResponseSchema,
  FileWatchUnsubscribeResponseSchema,
  FileWatchEventSchema,
  FileSearchResultEventSchema,
  FileSearchResponseSchema,
  FileReplaceResponseSchema,
  CodeListFilesResponseSchema,
  CodeSymbolsResponseSchema,
  CodeOutlineResponseSchema,
  CodeDefinitionResponseSchema,
  CodeDocumentSyncResponseSchema,
  CodeDocumentCloseResponseSchema,
  CodeHoverResponseSchema,
  CodeReferencesResponseSchema,
  CodeRenamePreviewResponseSchema,
  CodeRenameApplyResponseSchema,
  CodeRenameUndoResponseSchema,
  LspServersListResponseSchema,
  LspServerStopResponseSchema,
  CodeSolutionListResponseSchema,
  CodeSolutionGetTreeResponseSchema,
  CodeSolutionLoadProjectResponseSchema,
  ListProviderModelsResponseMessageSchema,
  ListProviderModesResponseMessageSchema,
  ListProviderFeaturesResponseMessageSchema,
  ListAvailableProvidersResponseSchema,
  GetProvidersSnapshotResponseMessageSchema,
  ProvidersSnapshotUpdateMessageSchema,
  RefreshProvidersSnapshotResponseMessageSchema,
  ProviderDiagnosticResponseMessageSchema,
  ProviderUsageListResponseMessageSchema,
  StatsActivityGetResponseMessageSchema,
  ContextReportGetResponseMessageSchema,
  ContextPromptPreviewGetResponseMessageSchema,
  ProjectKnowledgeListResponseMessageSchema,
  ProjectKnowledgeGetResponseMessageSchema,
  ProjectKnowledgeCreateResponseMessageSchema,
  ProjectKnowledgeApplyResponseMessageSchema,
  ProjectKnowledgeStatusResponseMessageSchema,
  ProjectKnowledgeProjectApplyResponseMessageSchema,
  ProjectKnowledgeReferenceApplyResponseMessageSchema,
  ProjectKnowledgeRootApplyResponseMessageSchema,
  ProjectKnowledgeDeleteResponseMessageSchema,
  ContextEdgeConvertResponseMessageSchema,
  ContextFindingsFixResponseMessageSchema,
  PersonalityMemoryListResponseMessageSchema,
  PersonalityMemoryUpdateResponseMessageSchema,
  PersonalityMemoryTransferResponseMessageSchema,
  PersonalityMemoryStatsResponseMessageSchema,
  StatsActivityResetResponseMessageSchema,
  UsageLogGetResponseMessageSchema,
  ActivityStatsChangedSchema,
  AgentContextGetUsageResponseMessageSchema,
  ListCommandsResponseSchema,
  ListTerminalsResponseSchema,
  TerminalsChangedSchema,
  CreateTerminalResponseSchema,
  RenameTerminalResponseSchema,
  SubscribeTerminalResponseSchema,
  KillTerminalResponseSchema,
  CaptureTerminalResponseSchema,
  TerminalCompatibilityDiagnosticResponseSchema,
  TerminalStreamExitSchema,
  TerminalAttentionRequiredSchema,
  ChatCreateResponseSchema,
  ChatListResponseSchema,
  ChatInspectResponseSchema,
  ChatDeleteResponseSchema,
  ChatPostResponseSchema,
  ChatReadResponseSchema,
  ChatWaitResponseSchema,
  ScheduleCreateResponseSchema,
  ScheduleListResponseSchema,
  ScheduleInspectResponseSchema,
  ScheduleLogsResponseSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeResponseSchema,
  ScheduleDeleteResponseSchema,
  ScheduleRunOnceResponseSchema,
  ScheduleUpdateResponseSchema,
  LoopRunResponseSchema,
  LoopListResponseSchema,
  LoopInspectResponseSchema,
  LoopLogsResponseSchema,
  LoopStopResponseSchema,
  DaemonUpdateProgressMessageSchema,
  DaemonUpdateResponseSchema,
  // COMPAT(artifacts): added in v0.4.1, drop the gate when daemon floor >= v0.4.1.
  ArtifactListResponseSchema,
  ArtifactCreateResponseSchema,
  ArtifactUpdateResponseSchema,
  ArtifactRegenerateResponseSchema,
  ArtifactCancelResponseSchema,
  ArtifactDeleteResponseSchema,
  ArtifactStarResponseSchema,
  ArtifactGetContentResponseSchema,
  ArtifactCreatedNotificationSchema,
  ArtifactUpdatedNotificationSchema,
  ArtifactDeletedNotificationSchema,
]);

export type SessionOutboundMessage = z.infer<typeof SessionOutboundMessageSchema>;

// Type exports for individual message types
export type ActivityLogMessage = z.infer<typeof ActivityLogMessageSchema>;
export type AssistantChunkMessage = z.infer<typeof AssistantChunkMessageSchema>;
export type AudioOutputMessage = z.infer<typeof AudioOutputMessageSchema>;
export type TranscriptionResultMessage = z.infer<typeof TranscriptionResultMessageSchema>;
export type StatusMessage = z.infer<typeof StatusMessageSchema>;
export type ServerCapabilityState = z.infer<typeof ServerCapabilityStateSchema>;
export type ServerVoiceCapabilities = z.infer<typeof ServerVoiceCapabilitiesSchema>;
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
export type ServerInfoStatusPayload = z.infer<typeof ServerInfoStatusPayloadSchema>;
export type RpcErrorMessage = z.infer<typeof RpcErrorMessageSchema>;
export type ArtifactMessage = z.infer<typeof ArtifactMessageSchema>;
export type AgentUpdateMessage = z.infer<typeof AgentUpdateMessageSchema>;
export type WorkspaceSetupProgressMessage = z.infer<typeof WorkspaceSetupProgressMessageSchema>;
export type WorkspaceSetupSnapshot = z.infer<typeof WorkspaceSetupSnapshotSchema>;
export type WorkspaceSetupStatusResponseMessage = z.infer<
  typeof WorkspaceSetupStatusResponseMessageSchema
>;
export type AgentStreamMessage = z.infer<typeof AgentStreamMessageSchema>;
export type AgentStatusMessage = z.infer<typeof AgentStatusMessageSchema>;
export type ProjectCheckoutLitePayload = z.infer<typeof ProjectCheckoutLitePayloadSchema>;
export type ProjectPlacementPayload = z.infer<typeof ProjectPlacementPayloadSchema>;
export type WorkspaceStateBucket = z.infer<typeof WorkspaceStateBucketSchema>;
export type WorkspaceDescriptorPayload = z.infer<typeof WorkspaceDescriptorPayloadSchema>;
export type WorktreeReattachTarget = z.infer<typeof WorktreeReattachTargetSchema>;
export type WorktreeReattachRequest = z.infer<typeof WorktreeReattachRequestSchema>;
export type WorktreeReattachListRequest = z.infer<typeof WorktreeReattachListRequestSchema>;
export type WorktreeReattachCandidate = z.infer<typeof WorktreeReattachCandidateSchema>;
export type WorktreeReattachListResponse = z.infer<typeof WorktreeReattachListResponseSchema>;
export type WorktreeReattachResponse = z.infer<typeof WorktreeReattachResponseSchema>;
export type WorkspaceProjectDescriptorPayload = z.infer<
  typeof WorkspaceProjectDescriptorPayloadSchema
>;
export type ProjectListResponseMessage = z.infer<typeof ProjectListResponseMessageSchema>;
export type WorkspaceScriptLifecycle = z.infer<typeof WorkspaceScriptLifecycleSchema>;
export type WorkspaceScriptHealth = z.infer<typeof WorkspaceScriptHealthSchema>;
export type WorkspaceScriptPayload = z.infer<typeof WorkspaceScriptPayloadSchema>;
export type FetchAgentsResponseMessage = z.infer<typeof FetchAgentsResponseMessageSchema>;
export type FetchAgentHistoryResponseMessage = z.infer<
  typeof FetchAgentHistoryResponseMessageSchema
>;
export type FetchRecentProviderSessionsResponseMessage = z.infer<
  typeof FetchRecentProviderSessionsResponseMessageSchema
>;
export type FetchWorkspacesResponseMessage = z.infer<typeof FetchWorkspacesResponseMessageSchema>;
export type ProjectAddResponse = z.infer<typeof ProjectAddResponseSchema>;
export type ProjectScaffoldResponse = z.infer<typeof ProjectScaffoldResponseSchema>;
export type ProjectScaffoldProgress = z.infer<typeof ProjectScaffoldProgressSchema>;
export type ProjectScaffoldStep = z.infer<typeof ProjectScaffoldStepSchema>;
export type ProjectScaffoldStepStatus = z.infer<typeof ProjectScaffoldStepStatusSchema>;
export type ProjectCreateDirectoryResponse = z.infer<typeof ProjectCreateDirectoryResponseSchema>;
export type ScriptStatusUpdateMessage = z.infer<typeof ScriptStatusUpdateMessageSchema>;
export type OpenProjectResponseMessage = z.infer<typeof OpenProjectResponseMessageSchema>;
export type WorkspaceGithubSearchRepositoriesResponse = z.infer<
  typeof WorkspaceGithubSearchRepositoriesResponseSchema
>;
export type GithubRepository = z.infer<typeof GithubRepositorySchema>;
export type ProjectGithubCloneResponse = z.infer<typeof ProjectGithubCloneResponseSchema>;
export type StartWorkspaceScriptResponseMessage = z.infer<
  typeof StartWorkspaceScriptResponseMessageSchema
>;
export type WorkspaceScriptListRequest = z.infer<typeof WorkspaceScriptListRequestSchema>;
export type WorkspaceScriptStartRequest = z.infer<typeof WorkspaceScriptStartRequestSchema>;
export type WorkspaceScriptStopRequest = z.infer<typeof WorkspaceScriptStopRequestSchema>;
export type WorkspaceScriptListResponseMessage = z.infer<
  typeof WorkspaceScriptListResponseMessageSchema
>;
export type WorkspaceScriptStartResponseMessage = z.infer<
  typeof WorkspaceScriptStartResponseMessageSchema
>;
export type WorkspaceScriptStopResponseMessage = z.infer<
  typeof WorkspaceScriptStopResponseMessageSchema
>;
export type LegacyListAvailableEditorsResponseMessage = z.infer<
  typeof LegacyListAvailableEditorsResponseMessageSchema
>;
export type LegacyOpenInEditorResponseMessage = z.infer<
  typeof LegacyOpenInEditorResponseMessageSchema
>;
export type ArchiveWorkspaceResponseMessage = z.infer<typeof ArchiveWorkspaceResponseMessageSchema>;
export type FetchAgentResponseMessage = z.infer<typeof FetchAgentResponseMessageSchema>;
export type FetchAgentTimelineResponseMessage = z.infer<
  typeof FetchAgentTimelineResponseMessageSchema
>;
export type AgentForkContextResponseMessage = z.infer<typeof AgentForkContextResponseMessageSchema>;
export type CancelAgentResponseMessage = z.infer<typeof CancelAgentResponseMessageSchema>;
export type SendAgentMessageResponseMessage = z.infer<typeof SendAgentMessageResponseMessageSchema>;
export type AgentPromptDelivery = NonNullable<SendAgentMessageRequest["delivery"]>;
export type SetVoiceModeResponseMessage = z.infer<typeof SetVoiceModeResponseMessageSchema>;
export type SetAgentModeResponseMessage = z.infer<typeof SetAgentModeResponseMessageSchema>;
export type SetAgentModelResponseMessage = z.infer<typeof SetAgentModelResponseMessageSchema>;
export type SetAgentThinkingResponseMessage = z.infer<typeof SetAgentThinkingResponseMessageSchema>;
export type SetAgentFeatureResponseMessage = z.infer<typeof SetAgentFeatureResponseMessageSchema>;
export type AgentDetachResponseMessage = z.infer<typeof AgentDetachResponseMessageSchema>;
export type AgentWorkspaceTransferResponseMessage = z.infer<
  typeof AgentWorkspaceTransferResponseMessageSchema
>;
export type AgentWorkspaceTransferResponsePayload = z.infer<
  typeof AgentWorkspaceTransferResponsePayloadSchema
>;
export type AgentPersonalitySetResponseMessage = z.infer<
  typeof AgentPersonalitySetResponseMessageSchema
>;
export type AgentSubagentStopResponseMessage = z.infer<
  typeof AgentSubagentStopResponseMessageSchema
>;
export type BackgroundShellTaskInfo = z.infer<typeof BackgroundShellTaskInfoSchema>;
export type BackgroundShellTasksChanged = z.infer<typeof BackgroundShellTasksChangedSchema>;
export type AgentBackgroundTaskStopResponseMessage = z.infer<
  typeof AgentBackgroundTaskStopResponseMessageSchema
>;
export type AgentBackgroundTaskClearResponseMessage = z.infer<
  typeof AgentBackgroundTaskClearResponseMessageSchema
>;
export type AgentRewindResponseMessage = z.infer<typeof AgentRewindResponseMessageSchema>;
export type UpdateAgentResponseMessage = z.infer<typeof UpdateAgentResponseMessageSchema>;
export type ProjectRenameResponse = z.infer<typeof ProjectRenameResponseSchema>;
export type ProjectUpdatedNotification = z.infer<typeof ProjectUpdatedNotificationSchema>;
export type ProjectUpdatedNotificationPayload = ProjectUpdatedNotification["payload"];
export type ProjectRemoveResponse = z.infer<typeof ProjectRemoveResponseSchema>;
export type WorkspaceTitleSetResponse = z.infer<typeof WorkspaceTitleSetResponseSchema>;
export type WorkspaceTitleSetResponsePayload = z.infer<
  typeof WorkspaceTitleSetResponsePayloadSchema
>;
export type WorkspacePinSetResponse = z.infer<typeof WorkspacePinSetResponseSchema>;
export type WorkspacePinSetResponsePayload = z.infer<typeof WorkspacePinSetResponsePayloadSchema>;
export type WorkspaceRecoveryState = z.infer<typeof WorkspaceRecoveryStateSchema>;
export type WorkspaceRecoveryInspectResponse = z.infer<
  typeof WorkspaceRecoveryInspectResponseSchema
>;
export type WorkspaceRecoveryRestoreResponse = z.infer<
  typeof WorkspaceRecoveryRestoreResponseSchema
>;
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponseSchema>;
export type ProjectRenameResponsePayload = z.infer<typeof ProjectRenameResponsePayloadSchema>;
export type ProjectRemoveResponsePayload = z.infer<typeof ProjectRemoveResponsePayloadSchema>;
export type WaitForFinishResponseMessage = z.infer<typeof WaitForFinishResponseMessageSchema>;
export type AgentPermissionRequestMessage = z.infer<typeof AgentPermissionRequestMessageSchema>;
export type AgentPermissionResolvedMessage = z.infer<typeof AgentPermissionResolvedMessageSchema>;
export type AgentDeletedMessage = z.infer<typeof AgentDeletedMessageSchema>;
export type ListProviderModelsResponseMessage = z.infer<
  typeof ListProviderModelsResponseMessageSchema
>;
export type ListProviderModesResponseMessage = z.infer<
  typeof ListProviderModesResponseMessageSchema
>;
export type ListProviderFeaturesResponseMessage = z.infer<
  typeof ListProviderFeaturesResponseMessageSchema
>;
export type ListAvailableProvidersResponse = z.infer<typeof ListAvailableProvidersResponseSchema>;
export type DaemonGetStatusResponse = z.infer<typeof DaemonGetStatusResponseSchema>;
export type DaemonGetPairingOfferResponse = z.infer<typeof DaemonGetPairingOfferResponseSchema>;
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;
export type GetProvidersSnapshotResponseMessage = z.infer<
  typeof GetProvidersSnapshotResponseMessageSchema
>;
export type ProvidersSnapshotUpdateMessage = z.infer<typeof ProvidersSnapshotUpdateMessageSchema>;
export type RefreshProvidersSnapshotResponseMessage = z.infer<
  typeof RefreshProvidersSnapshotResponseMessageSchema
>;
export type ProviderDiagnosticResponseMessage = z.infer<
  typeof ProviderDiagnosticResponseMessageSchema
>;
export type ProviderUsageTone = z.infer<typeof ProviderUsageToneSchema>;
export type ProviderUsageStatus = z.infer<typeof ProviderUsageStatusSchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type ProviderUsageWindow = z.infer<typeof ProviderUsageWindowSchema>;
export type ProviderUsageBalance = z.infer<typeof ProviderUsageBalanceSchema>;
export type ProviderUsageDetail = z.infer<typeof ProviderUsageDetailSchema>;
export type AgentRateLimitInfo = z.infer<typeof AgentRateLimitInfoSchema>;
export type ProviderUsageListResponseMessage = z.infer<
  typeof ProviderUsageListResponseMessageSchema
>;
export type ChatCreateResponse = z.infer<typeof ChatCreateResponseSchema>;
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;
export type ChatInspectResponse = z.infer<typeof ChatInspectResponseSchema>;
export type ChatDeleteResponse = z.infer<typeof ChatDeleteResponseSchema>;
export type ChatPostResponse = z.infer<typeof ChatPostResponseSchema>;
export type ChatReadResponse = z.infer<typeof ChatReadResponseSchema>;
export type ChatWaitResponse = z.infer<typeof ChatWaitResponseSchema>;
export type ScheduleCreateResponse = z.infer<typeof ScheduleCreateResponseSchema>;
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;
export type ScheduleInspectResponse = z.infer<typeof ScheduleInspectResponseSchema>;
export type ScheduleLogsResponse = z.infer<typeof ScheduleLogsResponseSchema>;
export type SchedulePauseResponse = z.infer<typeof SchedulePauseResponseSchema>;
export type ScheduleResumeResponse = z.infer<typeof ScheduleResumeResponseSchema>;
export type ScheduleDeleteResponse = z.infer<typeof ScheduleDeleteResponseSchema>;
export type ScheduleRunOnceResponse = z.infer<typeof ScheduleRunOnceResponseSchema>;
export type ScheduleUpdateResponse = z.infer<typeof ScheduleUpdateResponseSchema>;
export type LoopRunResponse = z.infer<typeof LoopRunResponseSchema>;
export type LoopListResponse = z.infer<typeof LoopListResponseSchema>;
export type LoopInspectResponse = z.infer<typeof LoopInspectResponseSchema>;
export type LoopLogsResponse = z.infer<typeof LoopLogsResponseSchema>;
export type LoopStopResponse = z.infer<typeof LoopStopResponseSchema>;

// Type exports for payload types
export type ActivityLogPayload = z.infer<typeof ActivityLogPayloadSchema>;

// Type exports for inbound message types
export type VoiceAudioChunkMessage = z.infer<typeof VoiceAudioChunkMessageSchema>;
export type FetchAgentsRequestMessage = z.infer<typeof FetchAgentsRequestMessageSchema>;
export type FetchAgentHistoryRequestMessage = z.infer<typeof FetchAgentHistoryRequestMessageSchema>;
export type FetchRecentProviderSessionsRequestMessage = z.infer<
  typeof FetchRecentProviderSessionsRequestMessageSchema
>;
export type FetchWorkspacesRequestMessage = z.infer<typeof FetchWorkspacesRequestMessageSchema>;
export type ProjectListRequestMessage = z.infer<typeof ProjectListRequestMessageSchema>;
export type ProjectResolveWorkspaceForPathRequest = z.infer<
  typeof ProjectResolveWorkspaceForPathRequestSchema
>;
export type FetchAgentRequestMessage = z.infer<typeof FetchAgentRequestMessageSchema>;
export type AgentForkContextRequestMessage = z.infer<typeof AgentForkContextRequestMessageSchema>;
export type SendAgentMessageRequest = z.infer<typeof SendAgentMessageRequestSchema>;
export type WaitForFinishRequest = z.infer<typeof WaitForFinishRequestSchema>;
export type DictationStreamStartMessage = z.infer<typeof DictationStreamStartMessageSchema>;
export type DictationStreamChunkMessage = z.infer<typeof DictationStreamChunkMessageSchema>;
export type DictationStreamFinishMessage = z.infer<typeof DictationStreamFinishMessageSchema>;
export type DictationStreamCancelMessage = z.infer<typeof DictationStreamCancelMessageSchema>;
export type CreateAgentRequestMessage = z.infer<typeof CreateAgentRequestMessageSchema>;
export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;
export type ForgeChangeRequestAttachment = z.infer<typeof ForgeChangeRequestAttachmentSchema>;
export type ForgeIssueAttachment = z.infer<typeof ForgeIssueAttachmentSchema>;
export type UploadedFileAttachment = z.infer<typeof UploadedFileAttachmentSchema>;
export type FirstAgentContext = z.infer<typeof FirstAgentContextSchema>;
export type ReviewAttachment = z.infer<typeof ReviewAttachmentSchema>;
export type ListProviderModelsRequestMessage = z.infer<
  typeof ListProviderModelsRequestMessageSchema
>;
export type ListProviderModesRequestMessage = z.infer<typeof ListProviderModesRequestMessageSchema>;
export type ListProviderFeaturesRequestMessage = z.infer<
  typeof ListProviderFeaturesRequestMessageSchema
>;
export type ListAvailableProvidersRequestMessage = z.infer<
  typeof ListAvailableProvidersRequestMessageSchema
>;
export type GetProvidersSnapshotRequestMessage = z.infer<
  typeof GetProvidersSnapshotRequestMessageSchema
>;
export type RefreshProvidersSnapshotRequestMessage = z.infer<
  typeof RefreshProvidersSnapshotRequestMessageSchema
>;
export type ProviderDiagnosticRequestMessage = z.infer<
  typeof ProviderDiagnosticRequestMessageSchema
>;
export type ChatCreateRequest = z.infer<typeof ChatCreateRequestSchema>;
export type ChatListRequest = z.infer<typeof ChatListRequestSchema>;
export type ChatInspectRequest = z.infer<typeof ChatInspectRequestSchema>;
export type ChatDeleteRequest = z.infer<typeof ChatDeleteRequestSchema>;
export type ChatPostRequest = z.infer<typeof ChatPostRequestSchema>;
export type ChatReadRequest = z.infer<typeof ChatReadRequestSchema>;
export type ChatWaitRequest = z.infer<typeof ChatWaitRequestSchema>;
export type ScheduleCreateRequest = z.infer<typeof ScheduleCreateRequestSchema>;
export type ScheduleListRequest = z.infer<typeof ScheduleListRequestSchema>;
export type ScheduleInspectRequest = z.infer<typeof ScheduleInspectRequestSchema>;
export type ScheduleLogsRequest = z.infer<typeof ScheduleLogsRequestSchema>;
export type SchedulePauseRequest = z.infer<typeof SchedulePauseRequestSchema>;
export type ScheduleResumeRequest = z.infer<typeof ScheduleResumeRequestSchema>;
export type ScheduleDeleteRequest = z.infer<typeof ScheduleDeleteRequestSchema>;
export type ScheduleRunOnceRequest = z.infer<typeof ScheduleRunOnceRequestSchema>;
export type ScheduleUpdateRequest = z.infer<typeof ScheduleUpdateRequestSchema>;
export type LoopRunRequest = z.infer<typeof LoopRunRequestSchema>;
export type LoopListRequest = z.infer<typeof LoopListRequestSchema>;
export type LoopInspectRequest = z.infer<typeof LoopInspectRequestSchema>;
export type LoopLogsRequest = z.infer<typeof LoopLogsRequestSchema>;
export type LoopStopRequest = z.infer<typeof LoopStopRequestSchema>;
export type ResumeAgentRequestMessage = z.infer<typeof ResumeAgentRequestMessageSchema>;
export type DeleteAgentRequestMessage = z.infer<typeof DeleteAgentRequestMessageSchema>;
export type UpdateAgentRequestMessage = z.infer<typeof UpdateAgentRequestMessageSchema>;
export type ProjectRenameRequest = z.infer<typeof ProjectRenameRequestSchema>;
export type ProjectRemoveRequest = z.infer<typeof ProjectRemoveRequestSchema>;
export type WorkspaceTitleSetRequest = z.infer<typeof WorkspaceTitleSetRequestSchema>;
export type WorkspacePinSetRequest = z.infer<typeof WorkspacePinSetRequestSchema>;
export type WorkspaceRecoveryInspectRequest = z.infer<typeof WorkspaceRecoveryInspectRequestSchema>;
export type WorkspaceRecoveryRestoreRequest = z.infer<typeof WorkspaceRecoveryRestoreRequestSchema>;
export type SetAgentModeRequestMessage = z.infer<typeof SetAgentModeRequestMessageSchema>;
export type SetAgentModelRequestMessage = z.infer<typeof SetAgentModelRequestMessageSchema>;
export type SetAgentThinkingRequestMessage = z.infer<typeof SetAgentThinkingRequestMessageSchema>;
export type SetAgentFeatureRequestMessage = z.infer<typeof SetAgentFeatureRequestMessageSchema>;
export type AgentDetachRequestMessage = z.infer<typeof AgentDetachRequestMessageSchema>;
export type AgentWorkspaceTransferRequestMessage = z.infer<
  typeof AgentWorkspaceTransferRequestMessageSchema
>;
export type AgentSubagentStopRequestMessage = z.infer<typeof AgentSubagentStopRequestMessageSchema>;
export type AgentBackgroundTaskStopRequestMessage = z.infer<
  typeof AgentBackgroundTaskStopRequestMessageSchema
>;
export type AgentBackgroundTaskClearRequestMessage = z.infer<
  typeof AgentBackgroundTaskClearRequestMessageSchema
>;
export type AgentPersonalitySetRequestMessage = z.infer<
  typeof AgentPersonalitySetRequestMessageSchema
>;
export type AgentPermissionResponseMessage = z.infer<typeof AgentPermissionResponseMessageSchema>;
export type CheckoutStatusRequest = z.infer<typeof CheckoutStatusRequestSchema>;
export type CheckoutStatusResponse = z.infer<typeof CheckoutStatusResponseSchema>;
export type CheckoutStatusUpdate = z.infer<typeof CheckoutStatusUpdateSchema>;
export type SubscribeCheckoutDiffRequest = z.infer<typeof SubscribeCheckoutDiffRequestSchema>;
export type UnsubscribeCheckoutDiffRequest = z.infer<typeof UnsubscribeCheckoutDiffRequestSchema>;
export type SubscribeCheckoutDiffResponse = z.infer<typeof SubscribeCheckoutDiffResponseSchema>;
export type CheckoutDiffUpdate = z.infer<typeof CheckoutDiffUpdateSchema>;
export type CheckoutCommitRequest = z.infer<typeof CheckoutCommitRequestSchema>;
export type CheckoutCommitResponse = z.infer<typeof CheckoutCommitResponseSchema>;
export type CheckoutGitFileError = z.infer<typeof CheckoutGitFileErrorSchema>;
export type CheckoutGitFileHistoryRequest = z.infer<typeof CheckoutGitFileHistoryRequestSchema>;
export type CheckoutGitFileHistoryResponse = z.infer<typeof CheckoutGitFileHistoryResponseSchema>;
export type CheckoutGitFileCommitDiffRequest = z.infer<
  typeof CheckoutGitFileCommitDiffRequestSchema
>;
export type CheckoutGitFileCommitDiffResponse = z.infer<
  typeof CheckoutGitFileCommitDiffResponseSchema
>;
export type CheckoutGitFileBlameRequest = z.infer<typeof CheckoutGitFileBlameRequestSchema>;
export type CheckoutGitFileBlameResponse = z.infer<typeof CheckoutGitFileBlameResponseSchema>;
export type CheckoutGitFileOriginRequest = z.infer<typeof CheckoutGitFileOriginRequestSchema>;
export type CheckoutGitFileOriginResponse = z.infer<typeof CheckoutGitFileOriginResponseSchema>;
export type CheckoutMergeRequest = z.infer<typeof CheckoutMergeRequestSchema>;
export type CheckoutMergeResponse = z.infer<typeof CheckoutMergeResponseSchema>;
export type CheckoutMergeFromBaseRequest = z.infer<typeof CheckoutMergeFromBaseRequestSchema>;
export type CheckoutMergeFromBaseResponse = z.infer<typeof CheckoutMergeFromBaseResponseSchema>;
export type CheckoutPullRequest = z.infer<typeof CheckoutPullRequestSchema>;
export type CheckoutPullResponse = z.infer<typeof CheckoutPullResponseSchema>;
export type CheckoutPushRequest = z.infer<typeof CheckoutPushRequestSchema>;
export type CheckoutPushResponse = z.infer<typeof CheckoutPushResponseSchema>;
export type CheckoutRefreshRequest = z.infer<typeof CheckoutRefreshRequestSchema>;
export type CheckoutRefreshResponse = z.infer<typeof CheckoutRefreshResponseSchema>;
export type CheckoutGitFetchRequest = z.infer<typeof CheckoutGitFetchRequestSchema>;
export type CheckoutGitFetchResponse = z.infer<typeof CheckoutGitFetchResponseSchema>;
export type CheckoutCommitFile = z.infer<typeof CheckoutCommitFileSchema>;
export type CheckoutCommit = z.infer<typeof CheckoutCommitSchema>;
export type CheckoutCommitsListRequest = z.infer<typeof CheckoutCommitsListRequestSchema>;
export type CheckoutCommitsListResponse = z.infer<typeof CheckoutCommitsListResponseSchema>;
export type CheckoutCommitFileDiffRequest = z.infer<typeof CheckoutCommitFileDiffRequestSchema>;
export type CheckoutCommitFileDiffResponse = z.infer<typeof CheckoutCommitFileDiffResponseSchema>;
export type ParsedDiffFile = z.infer<typeof ParsedDiffFileSchema>;
export type CheckoutPrCreateRequest = z.infer<typeof CheckoutPrCreateRequestSchema>;
export type CheckoutPrCreateResponse = z.infer<typeof CheckoutPrCreateResponseSchema>;
export type CheckoutPrMergeRequest = z.infer<typeof CheckoutPrMergeRequestSchema>;
export type CheckoutPrMergeResponse = z.infer<typeof CheckoutPrMergeResponseSchema>;
export type CheckoutPrMergeMethod = z.infer<typeof CheckoutPrMergeRequestSchema>["mergeMethod"];
export type CheckoutForgeSetAutoMergeRequest = z.infer<
  typeof CheckoutForgeSetAutoMergeRequestSchema
>;
export type CheckoutForgeSetAutoMergeResponse = z.infer<
  typeof CheckoutForgeSetAutoMergeResponseSchema
>;
export type CheckoutGithubSetAutoMergeRequest = z.infer<
  typeof CheckoutGithubSetAutoMergeRequestSchema
>;
export type CheckoutGithubSetAutoMergeResponse = z.infer<
  typeof CheckoutGithubSetAutoMergeResponseSchema
>;
export type CheckoutForgeGetCheckDetailsRequest = z.infer<
  typeof CheckoutForgeGetCheckDetailsRequestSchema
>;
export type CheckoutGithubGetCheckDetailsRequest = z.infer<
  typeof CheckoutGithubGetCheckDetailsRequestSchema
>;
export type CheckoutCheckDetails = z.infer<typeof CheckoutCheckDetailsSchema>;
export type CheckoutGithubCheckDetails = z.infer<typeof CheckoutGithubCheckDetailsSchema>;
export type CheckoutPipeline = z.infer<typeof CheckoutPipelineSchema>;
export type CheckoutPipelineStage = z.infer<typeof CheckoutPipelineStageSchema>;
export type CheckoutPipelineJob = z.infer<typeof CheckoutPipelineJobSchema>;
export type CheckoutForgeGetCheckDetailsResponse = z.infer<
  typeof CheckoutForgeGetCheckDetailsResponseSchema
>;
export type CheckoutGithubGetCheckDetailsResponse = z.infer<
  typeof CheckoutGithubGetCheckDetailsResponseSchema
>;
export type PullRequestMergeable = z.infer<typeof CheckoutPrStatusSchema>["mergeable"];
export type CheckoutPrStatusRequest = z.infer<typeof CheckoutPrStatusRequestSchema>;
export type CheckoutPrStatusResponse = z.infer<typeof CheckoutPrStatusResponseSchema>;
export type PullRequestTimelineRequest = z.infer<typeof PullRequestTimelineRequestSchema>;
export type PullRequestTimelineItem = z.infer<typeof PullRequestTimelineItemSchema>;
export type PullRequestTimelineResponse = z.infer<typeof PullRequestTimelineResponseSchema>;
export type CheckoutSwitchBranchRequest = z.infer<typeof CheckoutSwitchBranchRequestSchema>;
export type CheckoutSwitchBranchResponse = z.infer<typeof CheckoutSwitchBranchResponseSchema>;
export type CheckoutRenameBranchRequest = z.infer<typeof CheckoutRenameBranchRequestSchema>;
export type CheckoutRenameBranchResponse = z.infer<typeof CheckoutRenameBranchResponseSchema>;
export type StashSaveRequest = z.infer<typeof StashSaveRequestSchema>;
export type StashSaveResponse = z.infer<typeof StashSaveResponseSchema>;
export type StashPopRequest = z.infer<typeof StashPopRequestSchema>;
export type StashPopResponse = z.infer<typeof StashPopResponseSchema>;
export type StashListRequest = z.infer<typeof StashListRequestSchema>;
export type StashListResponse = z.infer<typeof StashListResponseSchema>;
export * from "./kanban.js";
export type StashEntry = z.infer<typeof StashEntrySchema>;
export type ValidateBranchRequest = z.infer<typeof ValidateBranchRequestSchema>;
export type ValidateBranchResponse = z.infer<typeof ValidateBranchResponseSchema>;
export type BranchSuggestionsRequest = z.infer<typeof BranchSuggestionsRequestSchema>;
export type BranchSuggestionsResponse = z.infer<typeof BranchSuggestionsResponseSchema>;
export type ForgeSearchItem = z.infer<typeof ForgeSearchItemSchema>;
export type ForgeSearchKind = "issue" | "change_request";
export type ForgeSearchRequest = z.infer<typeof ForgeSearchRequestSchema>;
export type ForgeSearchResponse = z.infer<typeof ForgeSearchResponseSchema>;
export type GitHubSearchItem = z.infer<typeof GitHubSearchItemSchema>;
export type GitHubSearchKind = z.infer<typeof GitHubSearchKindSchema>;
export type GitHubSearchRequest = z.infer<typeof GitHubSearchRequestSchema>;
export type GitHubSearchResponse = z.infer<typeof GitHubSearchResponseSchema>;
export type HostingSearchResponse = z.infer<typeof HostingSearchResponseSchema>;
export type CreateOttoWorktreeRequest = z.infer<typeof CreateOttoWorktreeRequestSchema>;
export type ChangeRequestCheckoutSource = z.infer<typeof ChangeRequestCheckoutSourceSchema>;
export type DirectorySuggestionsRequest = z.infer<typeof DirectorySuggestionsRequestSchema>;
export type DirectorySuggestionsResponse = z.infer<typeof DirectorySuggestionsResponseSchema>;
export type OttoWorktreeListRequest = z.infer<typeof OttoWorktreeListRequestSchema>;
export type OttoWorktreeListResponse = z.infer<typeof OttoWorktreeListResponseSchema>;
export type OttoWorktreeArchiveRequest = z.infer<typeof OttoWorktreeArchiveRequestSchema>;
export type OttoWorktreeArchiveResponse = z.infer<typeof OttoWorktreeArchiveResponseSchema>;
export type WorkspaceSetupStatusRequest = z.infer<typeof WorkspaceSetupStatusRequestSchema>;
export type LegacyListAvailableEditorsRequest = z.infer<
  typeof LegacyListAvailableEditorsRequestSchema
>;
export type LegacyOpenInEditorRequest = z.infer<typeof LegacyOpenInEditorRequestSchema>;
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;
export type ProjectAddRequest = z.infer<typeof ProjectAddRequestSchema>;
export type ProjectResolveWorkspaceForPathResponse = z.infer<
  typeof ProjectResolveWorkspaceForPathResponseSchema
>;
export type ProjectScaffoldRequest = z.infer<typeof ProjectScaffoldRequestSchema>;
export type ProjectScaffoldGit = z.infer<typeof ProjectScaffoldGitSchema>;
export type ProjectCreateDirectoryRequest = z.infer<typeof ProjectCreateDirectoryRequestSchema>;
export type ProjectCreateDirectoryErrorCode = z.infer<typeof ProjectCreateDirectoryErrorCodeSchema>;
export type WorkspaceGithubSearchRepositoriesRequest = z.infer<
  typeof WorkspaceGithubSearchRepositoriesRequestSchema
>;
export type ProjectGithubCloneRequest = z.infer<typeof ProjectGithubCloneRequestSchema>;
export type ProjectGithubCloneProtocol = z.infer<typeof ProjectGithubCloneProtocolSchema>;
export type ArchiveWorkspaceRequest = z.infer<typeof ArchiveWorkspaceRequestSchema>;
export type WorkspaceClearAttentionRequest = z.infer<typeof WorkspaceClearAttentionRequestSchema>;
export type FileExplorerRequest = z.infer<typeof FileExplorerRequestSchema>;
export type FileExplorerResponse = z.infer<typeof FileExplorerResponseSchema>;
export type FileVersion = z.infer<typeof FileVersionSchema>;
export type FileSubscribeRequest = z.infer<typeof FileSubscribeRequestSchema>;
export type FileSubscribeResponse = z.infer<typeof FileSubscribeResponseSchema>;
export type FileUnsubscribeRequest = z.infer<typeof FileUnsubscribeRequestSchema>;
export type FileUnsubscribeResponse = z.infer<typeof FileUnsubscribeResponseSchema>;
export type FsFileWriteRequest = z.infer<typeof FsFileWriteRequestSchema>;
export type FsFileWriteResponse = z.infer<typeof FsFileWriteResponseSchema>;
export type FsFileWriteResult = z.infer<typeof FsFileWriteResultSchema>;
export type FsFileWriteBinaryRequest = z.infer<typeof FsFileWriteBinaryRequestSchema>;
export type FsFileWriteBinaryResponse = z.infer<typeof FsFileWriteBinaryResponseSchema>;
export type FsFileWriteBinaryResult = z.infer<typeof FsFileWriteBinaryResultSchema>;
export type FileUpdate = z.infer<typeof FileUpdateSchema>;
export type ProjectIconRequest = z.infer<typeof ProjectIconRequestSchema>;
export type ProjectIconResponse = z.infer<typeof ProjectIconResponseSchema>;
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;
export type FileDownloadTokenRequest = z.infer<typeof FileDownloadTokenRequestSchema>;
export type FileDownloadTokenResponse = z.infer<typeof FileDownloadTokenResponseSchema>;
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;
export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;
export type FileWriteResponse = z.infer<typeof FileWriteResponseSchema>;
export type FileWriteResult = z.infer<typeof FileWriteResultSchema>;
export type RestartServerRequestMessage = z.infer<typeof RestartServerRequestMessageSchema>;
export type ShutdownServerRequestMessage = z.infer<typeof ShutdownServerRequestMessageSchema>;
export type ClearAgentAttentionMessage = z.infer<typeof ClearAgentAttentionMessageSchema>;
export type ClearAgentAttentionResponseMessage = z.infer<
  typeof ClearAgentAttentionResponseMessageSchema
>;
export type ClientHeartbeatMessage = z.infer<typeof ClientHeartbeatMessageSchema>;
export type ListCommandsRequest = z.infer<typeof ListCommandsRequestSchema>;
export type ListCommandsResponse = z.infer<typeof ListCommandsResponseSchema>;
export type RegisterPushTokenMessage = z.infer<typeof RegisterPushTokenMessageSchema>;

// Terminal message types
export type ListTerminalsRequest = z.infer<typeof ListTerminalsRequestSchema>;
export type ListTerminalsResponse = z.infer<typeof ListTerminalsResponseSchema>;
export type SubscribeTerminalsRequest = z.infer<typeof SubscribeTerminalsRequestSchema>;
export type UnsubscribeTerminalsRequest = z.infer<typeof UnsubscribeTerminalsRequestSchema>;
export type TerminalsChanged = z.infer<typeof TerminalsChangedSchema>;
export type CreateTerminalRequest = z.infer<typeof CreateTerminalRequestSchema>;
export type CreateTerminalResponse = z.infer<typeof CreateTerminalResponseSchema>;
export type RenameTerminalRequest = z.infer<typeof RenameTerminalRequestSchema>;
export type RenameTerminalResponse = z.infer<typeof RenameTerminalResponseSchema>;
export type StartWorkspaceScriptRequest = z.infer<typeof StartWorkspaceScriptRequestSchema>;
export type StartWorkspaceScriptResponse = z.infer<
  typeof StartWorkspaceScriptResponseMessageSchema
>;
export type SubscribeTerminalRequest = z.infer<typeof SubscribeTerminalRequestSchema>;
export type SubscribeTerminalResponse = z.infer<typeof SubscribeTerminalResponseSchema>;
export type UnsubscribeTerminalRequest = z.infer<typeof UnsubscribeTerminalRequestSchema>;
export type TerminalInput = z.infer<typeof TerminalInputSchema>;
export type TerminalCell = z.infer<typeof TerminalCellSchema>;
export type TerminalCursorStyle = z.infer<typeof TerminalCursorStyleSchema>;
export type TerminalCursor = z.infer<typeof TerminalCursorSchema>;
export type TerminalState = z.infer<typeof TerminalStateSchema>;
export type CloseItemsRequest = z.infer<typeof CloseItemsRequestMessageSchema>;
export type CloseItemsResponse = z.infer<typeof CloseItemsResponseSchema>;
export type KillTerminalRequest = z.infer<typeof KillTerminalRequestSchema>;
export type KillTerminalResponse = z.infer<typeof KillTerminalResponseSchema>;
export type CaptureTerminalRequest = z.infer<typeof CaptureTerminalRequestSchema>;
export type CaptureTerminalResponse = z.infer<typeof CaptureTerminalResponseSchema>;
export type TerminalStreamExit = z.infer<typeof TerminalStreamExitSchema>;

// ============================================================================
// WebSocket Level Messages (wraps session messages)
// ============================================================================

// WebSocket-only messages (not session messages)
export const WSPingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const WSPongMessageSchema = z.object({
  type: z.literal("pong"),
});

export const WSHelloMessageSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string().min(1),
  clientType: z.enum(["mobile", "browser", "cli", "mcp"]),
  protocolVersion: z.number().int(),
  appVersion: z.string().optional(),
  capabilities: z
    .object({
      voice: z.boolean().optional(),
      pushNotifications: z.boolean().optional(),
      [CLIENT_CAPS.reasoningMergeEnum]: z.boolean().optional(),
      [CLIENT_CAPS.selectiveAgentTimeline]: z.boolean().optional(),
      [CLIENT_CAPS.customModeIcons]: z.boolean().optional(),
      [CLIENT_CAPS.terminalReflowableSnapshot]: z.boolean().optional(),
      [CLIENT_CAPS.providerSubagents]: z.boolean().optional(),
      [CLIENT_CAPS.projectUpdates]: z.boolean().optional(),
      [CLIENT_CAPS.browserHost]: BrowserAutomationHostCapabilitySchema.optional(),
    })
    .passthrough()
    .optional(),
});

export const WSRecordingStateMessageSchema = z.object({
  type: z.literal("recording_state"),
  isRecording: z.boolean(),
});

// Wrapped session message
export const WSSessionInboundSchema = z.object({
  type: z.literal("session"),
  message: SessionInboundMessageSchema,
});

export const WSSessionOutboundSchema = z.object({
  type: z.literal("session"),
  message: SessionOutboundMessageSchema,
});

// Complete WebSocket message schemas
export const WSInboundMessageSchema = z.discriminatedUnion("type", [
  WSPingMessageSchema,
  WSHelloMessageSchema,
  WSRecordingStateMessageSchema,
  WSSessionInboundSchema,
]);

export const WSOutboundMessageSchema = z.discriminatedUnion("type", [
  WSPongMessageSchema,
  WSSessionOutboundSchema,
]);

export type WSInboundMessage = z.infer<typeof WSInboundMessageSchema>;
export type WSOutboundMessage = z.infer<typeof WSOutboundMessageSchema>;
export type WSHelloMessage = z.infer<typeof WSHelloMessageSchema>;

// ============================================================================
// Helper functions for message conversion
// ============================================================================

/**
 * Extract session message from WebSocket message
 * Returns null if message should be handled at WS level only
 */
export function extractSessionMessage(wsMsg: WSInboundMessage): SessionInboundMessage | null {
  if (wsMsg.type === "session") {
    return wsMsg.message;
  }
  // Ping and recording_state are WS-level only
  return null;
}

/**
 * Wrap session message in WebSocket envelope
 */
export function wrapSessionMessage(sessionMsg: SessionOutboundMessage): WSOutboundMessage {
  return {
    type: "session",
    message: sessionMsg,
  };
}

export function parseServerInfoStatusPayload(payload: unknown): ServerInfoStatusPayload | null {
  const parsed = ServerInfoStatusPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export * from "./brain.js";

export * from "./preview.js";

export * from "./meetings.js";

export * from "./personality-schemas.js";

// The Brain, Preview and Meetings schema modules own these, but messages.ts stays
// the public import surface for everything it ever exported.

export * from "./orchestration.js";

export * from "./integration-authorization.js";

export * from "./communications.js";

export * from "./context.js";

export * from "./code-intelligence.js";

export * from "./git-operations.js";

export * from "./project-knowledge.js";

export * from "./project-links.js";

export * from "./speech.js";

export * from "./refine.js";

export * from "./file-operations.js";

export * from "./agent-queue.js";

export * from "./usage-stats.js";

export * from "./storage.js";

export * from "./suggested-tasks.js";

export * from "./worktree-ops.js";

export * from "./terminal-compatibility.js";

export {
  MutableAgentBehaviorsConfigSchema,
  MutableLspConfigSchema,
  MutableDotnetSolutionConfigSchema,
  MutableGitHostingBitbucketCloudConfigSchema,
  MutableGitHostingAtlassianConfigSchema,
  MutableGitHostingProvidersConfigSchema,
  MutableGitHostingConfigSchema,
  MutableKanbanConfigSchema,
  MutableAgentPersonalitiesConfigSchema,
  MutableAgentPersonalitiesConfigPatchSchema,
  MutableAgentTeamsConfigSchema,
  MutableAgentTeamsConfigPatchSchema,
  MutableBrainTlsConfigSchema,
  MutableBrainRemoteConfigSchema,
  MutableBrainConfigSchema,
  MutableBrainTlsPatchSchema,
  MutableBrainRemotePatchSchema,
  MutableBrainListenPatchSchema,
  MutableBrainConfigPatchSchema,
  MutableGitFetchConfigSchema,
  DEFAULT_MUTABLE_BRAIN_CONFIG,
  DEFAULT_MUTABLE_GIT_FETCH_CONFIG,
  GIT_FETCH_INTERVAL_SECONDS,
} from "./daemon-config.js";
export type {
  MutableLspConfig,
  MutableDotnetSolutionConfig,
  MutableGitHostingConfig,
  MutableKanbanConfig,
  MutableBrainConfig,
} from "./daemon-config.js";
