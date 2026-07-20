import { z } from "zod";
import { TerminalActivitySchema } from "./terminal-activity.js";
import { RunSchema } from "./orchestration.js";
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
import { McpServerConfigSchema, OTTO_TOOL_GROUPS } from "./provider-config.js";
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
import { GitHostingCapabilitiesSchema, GitHostingProviderIdWireSchema } from "./git-hosting.js";

export {
  GitHostingCapabilitiesSchema,
  GitHostingProviderIdSchema,
  GitHostingProviderIdWireSchema,
  isGitHostingProviderId,
  normalizeGitHostingProviderId,
  GIT_HOSTING_PROVIDER_IDS,
} from "./git-hosting.js";
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
    // over the cheap default tier. Default false — cheap-tier routing is the
    // default. Read by the generation routing (WP-B).
    preferWriterPersonalities: z.boolean().default(false),
  })
  .passthrough();

// Daemon-wide agent behavior toggles. Each maps to a Claude-tier capability;
// providers that can't honor a setting silently ignore it (WP-E wires the
// reads). All default true so a fresh host behaves exactly like today.
const MutableAgentBehaviorsConfigSchema = z
  .object({
    // Native next-prompt predictions (Claude prompt_suggestion stream events).
    promptSuggestions: z.boolean().default(true),
    // Agent-authored progress summaries emitted during a turn.
    agentProgressSummaries: z.boolean().default(true),
    // Default value of an agent's notifyOnFinish when the spawn path leaves it
    // unspecified (the current implicit default).
    notifyOnFinishDefault: z.boolean().default(true),
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

// Speech engine ids and model ids stay plain strings on the wire so adding an
// engine or model never breaks an older peer; the daemon validates values
// against its own catalog when applying a patch.
const MutableSpeechSttConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    language: z.string().optional(),
  })
  .passthrough();

const MutableSpeechTtsConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    // Voice name (e.g. "af_heart" for local Kokoro, "alloy" for OpenAI). The
    // daemon maps local voice names to sherpa speaker ids internally.
    voice: z.string().optional(),
    speed: z.number().optional(),
  })
  .passthrough();

const MutableSpeechDictationConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: MutableSpeechSttConfigSchema.optional(),
  })
  .passthrough();

const MutableSpeechVoiceModeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: MutableSpeechSttConfigSchema.optional(),
    tts: MutableSpeechTtsConfigSchema.optional(),
  })
  .passthrough();

// Credentials for the OpenAI speech engine. The key persists to config.json
// (providers.openai.apiKey) like provider env keys do, and is echoed back in
// get_daemon_config_response the same way provider connection keys are.
const MutableSpeechOpenAiConfigSchema = z
  .object({
    apiKey: z.string().optional(),
  })
  .passthrough();

export const MutableSpeechConfigSchema = z
  .object({
    dictation: MutableSpeechDictationConfigSchema.optional(),
    voiceMode: MutableSpeechVoiceModeConfigSchema.optional(),
    openai: MutableSpeechOpenAiConfigSchema.optional(),
  })
  .passthrough();

export type MutableSpeechConfig = z.infer<typeof MutableSpeechConfigSchema>;

// Host-level git hosting credentials, one set per provider. A workspace's
// provider is derived from its git remote (bitbucket.org → Bitbucket,
// github.com → GitHub), so credentials are configured once per host, not per
// project. Keys persist to $OTTO_HOME/config.json and are echoed in
// get_daemon_config_response the same way provider connection keys are.
const MutableGitHostingBitbucketCloudConfigSchema = z
  .object({
    // Atlassian account email + API token, sent as HTTP Basic auth.
    email: z.string().optional(),
    apiToken: z.string().optional(),
  })
  .passthrough();

const MutableGitHostingProvidersConfigSchema = z
  .object({
    bitbucketCloud: MutableGitHostingBitbucketCloudConfigSchema.optional(),
  })
  .passthrough();

export const MutableGitHostingConfigSchema = z
  .object({
    providers: MutableGitHostingProvidersConfigSchema.optional(),
  })
  .passthrough();

export type MutableGitHostingConfig = z.infer<typeof MutableGitHostingConfigSchema>;

// Canonical personality roles, in display order. Kept as an exported const so
// the daemon and app share one vocabulary, but the wire schema stores roles as
// plain strings (below) — adding a role later must never break an older peer's
// parsing. Consumers filter incoming role arrays to this known set. The retired
// "worker" role is mapped to "coder" on the way in (see LEGACY_ROLE_ALIASES in
// agent-personalities.ts) so personalities persisted before the split keep their
// role rather than silently losing it.
export const PERSONALITY_ROLES = [
  // Surfaces — the interactive / host-facing entry points.
  "chatter",
  "artificer",
  "scheduler",
  // Thinking workers — read-only, return structured findings, never edit.
  "researcher",
  "planner",
  "judger",
  "advisor",
  // Making workers — produce code, design, or short text.
  "coder",
  "designer",
  "writer",
  // Conductor — the sole role whose whole job is planning and driving a team.
  "orchestrator",
] as const;
export type PersonalityRole = (typeof PERSONALITY_ROLES)[number];

// Two glow colors for the personality's thinking spinner (BlobLoader glowA/glowB).
const AgentPersonalitySpinnerSchema = z
  .object({
    glowA: z.string().min(1),
    glowB: z.string().min(1),
  })
  .passthrough();

// A TTS voice for the personality's spoken identity. Stored self-describing —
// provider + model + voice name — because voice names are namespaced per TTS
// engine/model (the same speaker index maps to different names across models),
// so a bare name is ambiguous across hosts. All plain strings (like the speech
// config) for forward-compat. This is a soft binding: an unavailable voice
// degrades to the host default at playback time, it never takes the personality
// out of commission.
const AgentPersonalityVoiceSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();

// The three Visualizer lifecycle moments a personality voice-cue line can
// belong to. Protocol owns this vocabulary — the daemon's cue generator, the
// personality editor, and the Visualizer playback hook all import it from here.
export const CUE_MOMENTS = ["join", "thinking", "done"] as const;
export type CueMoment = (typeof CUE_MOMENTS)[number];

// Pre-generated (and user-editable) spoken "voice cue" lines for the personality
// — a few short variations for each of three Visualizer moments (its node joins
// the graph, first starts thinking, completes). Stored on the personality so
// they're deterministic and hand-tunable in the editor; the Visualizer reads
// them directly (no runtime generation). All groups optional/loose — a
// personality may have none, or only some. See docs/visualizer.md "Voice cues".
const AgentPersonalityVoiceCuesSchema = z
  .object({
    join: z.array(z.string()).optional(),
    thinking: z.array(z.string()).optional(),
    done: z.array(z.string()).optional(),
  })
  .passthrough();

export type AgentPersonalityVoiceCues = z.infer<typeof AgentPersonalityVoiceCuesSchema>;

// A named, reusable agent template stored per-host. `id` is the stable identity
// everything binds to; `name` is a freely-renamable label. Effort and roles are
// plain strings on the wire (like speech engine/model ids) so the daemon can
// grow the vocabulary without breaking old peers; the daemon validates them
// against its own catalog when applying a patch.
export const AgentPersonalitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    // Canonical effort level ("off".."max"); resolved to the bound model's
    // nearest advertised option at spawn.
    effortLevel: z.string().min(1).optional(),
    modeId: z.string().min(1).optional(),
    personalityPrompt: z.string().optional(),
    // Default true: the daemon-global appendSystemPrompt still stacks on top of
    // the personality prompt. False = the personality prompt stands alone.
    respectGlobalAppendPrompt: z.boolean().optional(),
    roles: z.array(z.string().min(1)).optional(),
    spinner: AgentPersonalitySpinnerSchema.optional(),
    voice: AgentPersonalityVoiceSchema.optional(),
    voiceCues: AgentPersonalityVoiceCuesSchema.optional(),
  })
  .passthrough();

export type AgentPersonality = z.infer<typeof AgentPersonalitySchema>;
export type AgentPersonalityVoice = z.infer<typeof AgentPersonalityVoiceSchema>;

const MutableAgentPersonalitiesConfigSchema = z
  .object({
    personalities: z.array(AgentPersonalitySchema).default([]),
  })
  .passthrough();

// Patch shape declared explicitly rather than via .partial(): partial() keeps
// the personalities .default([]), so a patch touching the section without an
// explicit personalities array would have an empty array injected and
// deep-merge would wipe the stored roster.
const MutableAgentPersonalitiesConfigPatchSchema = z
  .object({
    personalities: z.array(AgentPersonalitySchema).optional(),
  })
  .passthrough();

// A team's avatar. v1 ships only `color` (hex, validated at the editor like
// spinner colors); `imageId` is reserved for the future themed avatar set —
// when present it wins over color, and color stays the fallback so an old
// client that doesn't know `imageId` keeps rendering the swatch. Plain
// strings for forward compat.
const AgentTeamAvatarSchema = z
  .object({
    color: z.string().min(1).optional(),
    imageId: z.string().min(1).optional(),
  })
  .passthrough();

// A named, per-host grouping of agent personalities that acts as an operating
// template: which personalities are on deck, plus a shared team prompt stacked
// directly ahead of the member's personality prompt at spawn. `id` is the
// stable identity everything binds to; `name` is a freely-renamable label.
// `memberIds` bind personality ids (order = display order) — an entry pointing
// at a deleted personality is tolerated and ignored everywhere, then pruned on
// the next save of that team. Membership is many-to-many.
export const AgentTeamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    avatar: AgentTeamAvatarSchema.optional(),
    teamPrompt: z.string().optional(),
    memberIds: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export type AgentTeam = z.infer<typeof AgentTeamSchema>;
export type AgentTeamAvatar = z.infer<typeof AgentTeamAvatarSchema>;

const MutableAgentTeamsConfigSchema = z
  .object({
    teams: z.array(AgentTeamSchema).default([]),
    // The host's active team id; null/absent = no team active (exactly legacy
    // behavior). Host-scoped daemon config rather than device-local: the team
    // prompt is applied daemon-side at spawn, so headless spawns (MCP
    // create_agent, schedule runs) must see it, and a patch from any client
    // hot-reloads the switch to every connected client.
    activeTeamId: z.string().nullable().optional(),
  })
  .passthrough();

// Patch shape declared explicitly rather than via .partial(): partial() keeps
// the teams .default([]), so a patch that only touches activeTeamId would have
// an empty array injected and deep-merge would wipe the stored teams.
const MutableAgentTeamsConfigPatchSchema = z
  .object({
    teams: z.array(AgentTeamSchema).optional(),
    activeTeamId: z.string().nullable().optional(),
  })
  .passthrough();

export const ModelTierSchema: z.ZodType<ModelTier> = z.enum(["deep", "standard", "fast"]);

// A user's explicit tier tag for one model of one provider. The daemon stamps
// `model.tier` at ingest, preferring a matching override here over inference
// (see model-tiers.ts). Stored as an array (not a nested record) so a patch
// replaces it wholesale — that's how a tag gets cleared, since deep-merge can't
// delete a record key.
export const ModelTierOverrideSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    tier: ModelTierSchema,
  })
  .passthrough();

export type ModelTierOverride = z.infer<typeof ModelTierOverrideSchema>;

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
    browserTools: MutableBrowserToolsConfigSchema.default({ enabled: false }),
    // Daemon-wide agent behavior toggles (Claude-tier capabilities). Defaults to
    // all-on so a new client parsing an old daemon's config sees today's behavior.
    agentBehaviors: MutableAgentBehaviorsConfigSchema.default({
      promptSuggestions: true,
      agentProgressSummaries: true,
      notifyOnFinishDefault: true,
    }),
    providers: z.record(z.string(), MutableDaemonProviderConfigSchema).default({}),
    metadataGeneration: MutableMetadataGenerationConfigSchema.default({
      providers: [],
      enabled: true,
      preferWriterPersonalities: false,
    }),
    autoArchiveAfterMerge: z.boolean().default(false),
    enableTerminalAgentHooks: z.boolean().default(false),
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
  })
  .passthrough();

export const MutableDaemonConfigPatchSchema = z
  .object({
    mcp: MutableDaemonConfigSchema.shape.mcp.partial().optional(),
    browserTools: MutableBrowserToolsConfigSchema.partial().optional(),
    // Gated by server_info features.agentBehaviorToggles; patches deep-merge.
    agentBehaviors: MutableAgentBehaviorsConfigSchema.partial().optional(),
    // A null entry removes the provider's config entirely (custom provider
    // uninstall). Gated by server_info features.providerRemove — old daemons
    // reject null values.
    providers: z
      .record(z.string(), MutableDaemonProviderConfigSchema.partial().passthrough().nullable())
      .optional(),
    metadataGeneration: MutableMetadataGenerationConfigSchema.partial().optional(),
    autoArchiveAfterMerge: z.boolean().optional(),
    enableTerminalAgentHooks: z.boolean().optional(),
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
  // Open set — display code falls back to a generic label for unknown values.
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
    // loading row — exactly their pre-"failed" behavior, so no gate is needed.
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
  // for the subagents-track cost readout — the only currency that works for
  // cost-less local models. Observed subagents source it from the provider's
  // per-task usage.total_tokens (already cumulative-per-subagent). Purely
  // additive; absent ⇒ no readout. Old clients ignore it.
  // See docs/agent-lifecycle.md (Item 3).
  cumulativeTokens: z.number().optional(),
  lastError: z.string().optional(),
  title: z.string().nullable(),
  labels: z.record(z.string(), z.string()).default({}),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  providerUnavailable: z.boolean().optional(),
  // Attendability. "observed" marks a provider-managed subagent (Claude Task /
  // ultracode fan-out) that the user can watch but not prompt or reconfigure —
  // the daemon refuses attended operations and the client renders it read-only.
  // COMPAT(observedSubagents): added in v0.4.3; absent ⇒ "attended". Drop the
  // gate when daemon floor >= v0.4.3. See projects/observed-subagents/observed-subagents.md.
  attend: z.enum(["attended", "observed"]).optional(),
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

// An unordered pair of linked projects. The daemon stores the pair in a
// canonical order, but clients treat it as undirected: a link between A and B
// permits opening files across both projects. See the gated-multi-root project.
export const ProjectLinkSchema = z.object({
  projectAId: z.string(),
  projectBId: z.string(),
});

export const ProjectLinksListRequestSchema = z.object({
  type: z.literal("project.links.list.request"),
  requestId: z.string(),
});

export const ProjectLinksSetRequestSchema = z.object({
  type: z.literal("project.links.set.request"),
  // Order is irrelevant; the daemon canonicalizes. Linking is idempotent.
  projectId: z.string(),
  otherProjectId: z.string(),
  requestId: z.string(),
});

export const ProjectLinksUnsetRequestSchema = z.object({
  type: z.literal("project.links.unset.request"),
  projectId: z.string(),
  otherProjectId: z.string(),
  requestId: z.string(),
});

export const WorkspaceTitleSetRequestSchema = z.object({
  type: z.literal("workspace.title.set.request"),
  workspaceId: z.string(),
  // Null or empty string clears the title and reverts to the derived name.
  title: z.string().nullable(),
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

export const GitHubIssueAttachmentSchema = z.object({
  type: z.literal("github_issue"),
  mimeType: z.literal("application/github-issue"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
});

// Provider-neutral successors to github_pr/github_issue. New clients send
// these when server_info features.gitHostingProviders is set; the github_*
// kinds remain accepted forever (protocol contract) and are still what a new
// client sends to an old daemon for GitHub projects.
export const HostingPrAttachmentSchema = z.object({
  type: z.literal("hosting_pr"),
  mimeType: z.literal("application/otto-hosting-pr"),
  provider: GitHostingProviderIdWireSchema,
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

export const HostingIssueAttachmentSchema = z.object({
  type: z.literal("hosting_issue"),
  mimeType: z.literal("application/otto-hosting-issue"),
  provider: GitHostingProviderIdWireSchema,
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
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

export const SpeechSettingsGetOptionsRequestSchema = z.object({
  type: z.literal("speech.settings.get_options.request"),
  requestId: z.string(),
});

// One-shot "read this text aloud with this voice" for the voice-preview button.
// The voice binding is soft, matching personality-voice semantics: an
// unavailable voice degrades to the host default at synthesis time, and an
// absent voice uses the host default. Synthesis runs on the host's active TTS
// provider (there is no per-request provider switch); model/provider are hints.
export const SpeechTtsPreviewRequestSchema = z.object({
  type: z.literal("speech.tts.preview.request"),
  requestId: z.string(),
  text: z.string(),
  voice: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      name: z.string(),
    })
    .passthrough()
    .optional(),
});

// COMPAT(visualizerVoiceCues): added in v0.6.3; gate lives in
// features.visualizerVoiceCues. Author short spoken "cue" lines for a
// personality — a handful of variations each for three Visualizer moments
// (join / thinking / done) — via the Writer mini-task chain, flavored by the
// persona's `name` + `prompt`. The persona is passed inline (not a stored id)
// so the personality editor can generate for an unsaved draft too; the result
// is stored on the personality (`voiceCues`) and edited there, so this is an
// editor-time action, not a runtime one. `cwd` scopes provider resolution to a
// workspace; omitted falls back to any resolvable one.
export const VisualizerVoiceCuesGenerateRequestSchema = z.object({
  type: z.literal("visualizer.voiceCues.generate.request"),
  requestId: z.string(),
  name: z.string(),
  prompt: z.string().optional(),
  cwd: z.string().optional(),
  // The persona's roles (e.g. "researcher", "coder") so the writer can flavor
  // the lines to what the agent does. Permissive strings to match the stored
  // personality shape (forward-compatible with roles this daemon predates).
  roles: z.array(z.string().min(1)).optional(),
  // When present, author only this one moment's lines (a focused single-moment
  // prompt) and return only that group. The editor issues one request per
  // moment so it can show generation progress and keep the moments distinct.
  // Omitted → author all three at once (the original all-in-one path, still
  // used by older clients).
  moment: z.enum(CUE_MOMENTS).optional(),
});

export const AgentPersonalitiesGetStatsRequestSchema = z.object({
  type: z.literal("agentPersonalities.get_stats.request"),
  requestId: z.string(),
});

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
  // voice, prompt) onto the agent — the brain (provider/model/mode/effort) still
  // comes from `config`, so hand-deviations in the picker keep the identity.
  // COMPAT(agentPersonalities): added in v0.5.0; gate lives in features.agentPersonalities.
  personality: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  workspaceId: z.string().optional(),
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

// Daemon-wide "fun stats" counters — see docs/data-model.md ActivityStatsStore.
// Every field defaults to 0 so old and new daemons/clients stay compatible as
// counters are added later.
export const ActivityCountersSchema = z.object({
  messagesSent: z.number().default(0),
  messagesReceived: z.number().default(0),
  tokensSent: z.number().default(0),
  tokensReceived: z.number().default(0),
  agentsCreated: z.number().default(0),
  runsOrchestrated: z.number().default(0),
  subagentsInvoked: z.number().default(0),
  backgroundTasksInvoked: z.number().default(0),
  thoughts: z.number().default(0),
  toolsCalled: z.number().default(0),
  artifactsCreated: z.number().default(0),
  schedulesExecuted: z.number().default(0),
  // Usage & cost accounting (WP-G). Additive/defaulted like every counter above,
  // so old daemons emit 0 and old clients drop the unknown leaves. "In"/"Out"
  // are token totals; *CostMicroUsd are integer micro-USD (usd*1e6) to stay
  // summable — populated only for turns reporting a real provider cost (Claude).
  // The client detects whether the daemon actually populates these via
  // features.usageCostCategories (see below).
  costMicroUsd: z.number().default(0),
  mainChatTokensIn: z.number().default(0),
  mainChatTokensOut: z.number().default(0),
  mainChatCostMicroUsd: z.number().default(0),
  generationsTokensIn: z.number().default(0),
  generationsTokensOut: z.number().default(0),
  generationsCostMicroUsd: z.number().default(0),
  subagentTokensIn: z.number().default(0),
  subagentTokensOut: z.number().default(0),
  subagentCostMicroUsd: z.number().default(0),
  compactionTokensIn: z.number().default(0),
  compactionTokensOut: z.number().default(0),
  claudeTokensIn: z.number().default(0),
  claudeTokensOut: z.number().default(0),
});

export const StatsActivityGetRequestMessageSchema = z.object({
  type: z.literal("stats.activity.get.request"),
  requestId: z.string(),
});

export const StatsActivityGetResponseMessageSchema = z.object({
  type: z.literal("stats.activity.get.response"),
  payload: z.object({
    requestId: z.string(),
    today: ActivityCountersSchema,
    yesterday: ActivityCountersSchema,
    last7Days: ActivityCountersSchema,
    last30Days: ActivityCountersSchema,
    allTime: ActivityCountersSchema,
  }),
});

// Daemon-wide "activity counters moved" ping — broadcast to every client,
// coalesced at the daemon (at most once every few seconds) so bursts of
// increments don't get chatty. Carries no payload: clients re-fetch the
// rollups via stats.activity.get. Purely additive — old clients drop the
// unknown type with a warning, and against old daemons (which never send it)
// the stats screen degrades to today's focus/manual refresh. Rides the
// existing activityStats capability; no new feature flag needed because no
// client behavior depends on detecting it.
export const ActivityStatsChangedSchema = z.object({
  type: z.literal("activity_stats_changed"),
});

// One itemized row of the usage ledger — a single token/cost-bearing activity
// (a chat turn, a sub-agent turn, or a background generation). The aggregate
// ActivityCounters above are the rollup of this same event stream; the ledger is
// the scrollable detail behind the tiles (usage-ledger project). `kind` and
// `provider` are plain strings (not enums) so an OLD client still parses a NEW
// daemon that emits a kind it hasn't heard of — it renders it generically rather
// than failing the whole message. All token/cost leaves default to 0.
export const UsageEventSchema = z.object({
  /** Stable unique id for the row (daemon-generated). */
  id: z.string(),
  /** Epoch milliseconds when the activity was recorded. */
  at: z.number(),
  /** "chat" | "subagent" | "generation" today; open for future kinds. */
  kind: z.string(),
  /** Finer label within the kind (e.g. a generation's purpose, a sub-agent name). */
  subtype: z.string().optional(),
  /** Agent provider id (e.g. "claude", an openai-compat endpoint id). */
  provider: z.string(),
  /** Model id/name if known at the increment site. */
  model: z.string().optional(),
  /** input + cached + cache-creation tokens (same "in" split the counters use). */
  tokensIn: z.number().default(0),
  /**
   * The portion of `tokensIn` served from the provider prompt cache (cache-read),
   * billed at a fraction of fresh input. The fresh (full-rate) portion is
   * `tokensIn - cachedTokensIn`. Absent when the provider reports no cache reads
   * (e.g. openai-compat endpoints with no caching), which reads as all-fresh.
   */
  cachedTokensIn: z.number().optional(),
  /** output tokens. */
  tokensOut: z.number().default(0),
  /** Real provider spend in integer micro-USD (usd*1e6); 0 for token-only providers. */
  costMicroUsd: z.number().default(0),
  /** Mid-turn compaction slice folded into this turn's usage, if any (token-only). */
  compactionTokensIn: z.number().optional(),
  compactionTokensOut: z.number().optional(),
  /** The agent this activity belonged to, for tracing back to the chat. */
  agentId: z.string().optional(),
  /**
   * How many model round-trips this row aggregates. A chat row is one query, but
   * a sub-agent row covers a whole delegated task that internally ran many
   * rounds — and each round re-reads the growing context, so `cachedTokensIn` is
   * cumulative cache-READS, not a cache size. Surfacing the count is what makes a
   * large cached figure legible instead of looking like a bug. Absent when the
   * provider doesn't report it.
   */
  rounds: z.number().optional(),
  /**
   * Sub-agent rows only — the spawn-tree identity that lets the Log group rows
   * the way a human reads the run (chat turn → its sub-agents → their
   * sub-agents) instead of by settle time, which async sub-agents crossing turn
   * boundaries makes wrong. `startedAt` is when the sub-agent was first
   * observed (epoch ms; a row belongs to the turn that spawned it, not the turn
   * it happened to settle in), `subagentKey` is its stable observed key, and
   * `parentSubagentKey` is the spawning sub-agent's key — absent for depth-1
   * sub-agents spawned by the chat itself.
   */
  startedAt: z.number().optional(),
  subagentKey: z.string().optional(),
  parentSubagentKey: z.string().optional(),
});

export const UsageLogGetRequestMessageSchema = z.object({
  type: z.literal("usage.log.get.request"),
  requestId: z.string(),
  /** Max rows to return (daemon clamps). Newest-first. */
  limit: z.number().optional(),
  /** Cursor: return only rows strictly older than this epoch-ms (for "load more"). */
  before: z.number().optional(),
});

export const UsageLogGetResponseMessageSchema = z.object({
  type: z.literal("usage.log.get.response"),
  payload: z.object({
    requestId: z.string(),
    /** Newest-first page of ledger rows. */
    events: z.array(UsageEventSchema).default([]),
    /** True when older rows exist beyond this page (paginate with `before`). */
    hasMore: z.boolean().default(false),
  }),
});

// Wipe every daemon-wide usage counter AND the itemized usage ledger back to
// zero — the "Reset" action on the Metrics screen. One RPC clears both sinks
// (the day-bucketed ActivityStatsStore and the UsageLogStore) so the tiles and
// the Log tab start fresh together. Gated behind features.statsReset so an old
// daemon (no handler) never receives a request the client thinks it can send.
export const StatsActivityResetRequestMessageSchema = z.object({
  type: z.literal("stats.activity.reset.request"),
  requestId: z.string(),
});

export const StatsActivityResetResponseMessageSchema = z.object({
  type: z.literal("stats.activity.reset.response"),
  payload: z.object({
    requestId: z.string(),
  }),
});

export const AgentContextGetUsageRequestMessageSchema = z.object({
  type: z.literal("agent.context.get_usage.request"),
  agentId: z.string(),
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

export const AgentForkContextRequestMessageSchema = z.object({
  type: z.literal("agent.fork_context.request"),
  agentId: z.string(),
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
// run_in_background). Not an agent, not a subagent — a plain shell process
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
// agent whenever any of them changes (start/progress/settle/clear) — same
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

// A suggested task an agent surfaced via the `spawn_task` tool (Claude Desktop
// parity). Renders as a chip in the parent agent's session; the user starts it
// (new worktree / local / this session) or dismisses it. The `prompt` is
// deliberately NOT part of this wire shape — it stays server-side and is only
// used when the task is started ("not shown directly" in Claude Desktop).
// COMPAT(suggestedTasks): added in v0.5.6, drop the gate when daemon floor >= v0.5.6.
export const SuggestedTaskStateSchema = z.enum(["pending", "started", "dismissed"]);

export const SuggestedTaskInfoSchema = z.object({
  taskId: z.string(),
  parentAgentId: z.string(),
  title: z.string(),
  tldr: z.string(),
  cwd: z.string().optional(),
  state: SuggestedTaskStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Pushed with the full current set of pending suggested tasks for a parent
// agent whenever any of them changes (spawn/start/dismiss) — same full-list
// reconciliation shape as BackgroundShellTasksChangedSchema.
export const SuggestedTasksChangedSchema = z.object({
  type: z.literal("suggested_tasks_changed"),
  payload: z.object({
    parentAgentId: z.string(),
    tasks: z.array(SuggestedTaskInfoSchema),
  }),
});

// Context Management — the daemon's accounting of everything a provider sends
// before the user types (see projects/context-management/context-management.md).
//
// Two distinctions carry the whole feature and must not be collapsed on the
// wire: an `import` edge is inlined into the request while a `reference` edge
// costs only its link text, and `costClass` separates weight that rides every
// request from weight that loads only when the agent touches an area.
//
// All numbers are estimates (chars/4) and `confidence` says how much to trust
// the file set: `exact` when Otto composed the payload itself, `convention`
// when resolved from a provider's documented layout, `unverified` for
// subprocess-owned agents we cannot see into.
// COMPAT(contextManagement): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
export const ContextScopeSchema = z.enum([
  "enterprise",
  "global",
  "project",
  "local",
  "subdirectory",
  "runtime",
]);

export const ContextCategorySchema = z.enum([
  "context_files",
  "memory_index",
  "skills_roster",
  "mcp_tools",
  "otto_injected",
  "system_prompt",
]);

export const ContextCostClassSchema = z.enum(["fixed", "conditional", "referenced"]);

export const ContextSeveritySchema = z.enum(["ok", "notice", "warn", "critical"]);

export const ContextConfidenceSchema = z.enum(["exact", "convention", "unverified"]);

export const ContextFindingKindSchema = z.enum([
  "dead_import",
  "dead_reference",
  "duplicate_across_scope",
  "duplicate_within_file",
  "oversized_memory_entry",
  "import_cycle",
  "depth_capped",
]);

export const ContextRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
});

export const ContextFindingSchema = z.object({
  kind: ContextFindingKindSchema,
  message: z.string(),
  range: ContextRangeSchema.optional(),
  relatedNodeIds: z.array(z.string()).optional(),
});

export const ContextNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  relPath: z.string(),
  scope: ContextScopeSchema,
  category: ContextCategorySchema,
  costClass: ContextCostClassSchema,
  bytes: z.number(),
  estTokens: z.number(),
  // Extra parents that also reach this node. The node is listed and counted
  // exactly once; these render as a dimmed "also imported by" chip.
  alsoImportedByNodeIds: z.array(z.string()),
  findings: z.array(ContextFindingSchema),
});

export const ContextEdgeSchema = z.object({
  fromNodeId: z.string(),
  // Null when the target could not be resolved — pairs with a dead_* finding.
  toNodeId: z.string().nullable(),
  kind: z.enum(["import", "reference"]),
  rawTarget: z.string(),
  // Byte range of the whole reference token in the parent file, which is what
  // makes "Always load" <-> "Link only" a single-span edit.
  range: ContextRangeSchema,
});

export const ContextCategoryTotalSchema = z.object({
  category: ContextCategorySchema,
  estTokens: z.number(),
  sharePercent: z.number(),
  severity: ContextSeveritySchema,
});

export const ContextReportSchema = z.object({
  workspaceId: z.string(),
  provider: z.string(),
  // The window the report was evaluated against — from the active model, or
  // the client's what-if picker. Severity is meaningless without it.
  windowTokens: z.number(),
  scannedAt: z.string(),
  confidence: ContextConfidenceSchema,
  supported: z.boolean(),
  supportsImports: z.boolean(),
  nodes: z.array(ContextNodeSchema),
  edges: z.array(ContextEdgeSchema),
  categoryTotals: z.array(ContextCategoryTotalSchema),
  fixedTotal: z.number(),
  conditionalTotal: z.number(),
  referencedTotal: z.number(),
  workingRoom: z.number(),
  aggregateSeverity: ContextSeveritySchema,
  findings: z.array(ContextFindingSchema),
});

// Pushed with the full current report whenever a watched context file changes.
// Full-report reconciliation, same idiom as suggested_tasks_changed.
export const ContextReportChangedSchema = z.object({
  type: z.literal("context_report_changed"),
  payload: z.object({
    workspaceId: z.string(),
    report: ContextReportSchema.nullable(),
  }),
});

// `provider` and `windowTokens` are the what-if pickers: omitted means "the
// active agent's provider and its model's real window".
export const ContextReportGetRequestMessageSchema = z.object({
  type: z.literal("context.report.get.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  provider: z.string().optional(),
  windowTokens: z.number().optional(),
});

export const ContextReportGetResponseMessageSchema = z.object({
  type: z.literal("context.report.get.response"),
  payload: z.object({
    requestId: z.string(),
    report: ContextReportSchema.nullable(),
  }),
});

// Converts one edge between "always loaded" and "link only". Server-side
// because the parent file may live outside the workspace root.
export const ContextEdgeConvertRequestMessageSchema = z.object({
  type: z.literal("context.edge.convert.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  // The parent file holding the reference — its `ContextNode.path`, not its
  // id: ids are case-folded on Windows and are not safe to write through.
  filePath: z.string(),
  rawTarget: z.string(),
  range: ContextRangeSchema,
  target: z.enum(["import", "reference"]),
});

export const ContextEdgeConvertResponseMessageSchema = z.object({
  type: z.literal("context.edge.convert.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

// Aggregate outcome for a start/dismiss over one or more tasks. `succeeded`/
// `failed` count the tasks acted on so the client can report "Started 3 tasks";
// `error` collects any per-task failure messages (the failed tasks' chips stay).
const SuggestedTaskActionResponsePayloadSchema = z.object({
  requestId: z.string(),
  parentAgentId: z.string(),
  accepted: z.boolean(),
  succeeded: z.number(),
  failed: z.number(),
  error: z.string().nullable(),
});

// Start one or more suggested tasks, applying the SAME mode to each — no
// combining. Four modes, only `subagent` links the new agent to the parent:
//  - `new_chat`:   a fresh independent agent in its own tab, same repo/cwd, NO
//                  parent link — survives the parent's cancel/archive.
//  - `subagent`:   a bound child agent that shows in the parent's Subagents
//                  track and archive-cascades with it.
//  - `worktree`:   an independent agent on a new git worktree (auto branch-off),
//                  isolated workspace — also unlinked from the parent.
//  - `in_session`: steers the parent agent with the task prompt (no new agent).
// The daemon resolves the parent agent's brain (provider/model/personality) so a
// started task continues the suggesting agent.
export const TasksSuggestedStartModeSchema = z.enum([
  "new_chat",
  "subagent",
  "worktree",
  "in_session",
]);

export const TasksSuggestedStartRequestMessageSchema = z.object({
  type: z.literal("tasks.suggested.start.request"),
  parentAgentId: z.string(),
  taskIds: z.array(z.string()),
  mode: TasksSuggestedStartModeSchema,
  requestId: z.string(),
});

export const TasksSuggestedStartResponseMessageSchema = z.object({
  type: z.literal("tasks.suggested.start.response"),
  payload: SuggestedTaskActionResponsePayloadSchema,
});

export const TasksSuggestedDismissRequestMessageSchema = z.object({
  type: z.literal("tasks.suggested.dismiss.request"),
  parentAgentId: z.string(),
  taskIds: z.array(z.string()),
  requestId: z.string(),
});

export const TasksSuggestedDismissResponseMessageSchema = z.object({
  type: z.literal("tasks.suggested.dismiss.response"),
  payload: SuggestedTaskActionResponsePayloadSchema,
});

// Switch a running agent to an Agent Personality (or clear with null). The
// daemon re-resolves the id against the roster + the agent's cwd provider
// snapshot and applies the full personality live — system prompt, identity
// (name/spinner), and brain (model/mode/effort) — restarting the provider query
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

export const ProjectLinksListResponsePayloadSchema = z.object({
  requestId: z.string(),
  links: z.array(ProjectLinkSchema).default([]),
  error: z.string().nullable(),
});

export const ProjectLinksListResponseSchema = z.object({
  type: z.literal("project.links.list.response"),
  payload: ProjectLinksListResponsePayloadSchema,
});

export const ProjectLinksMutationResponsePayloadSchema = z.object({
  requestId: z.string(),
  accepted: z.boolean(),
  // The full link set after the mutation, so the client refreshes in one hop.
  links: z.array(ProjectLinkSchema).default([]),
  error: z.string().nullable(),
});

export const ProjectLinksSetResponseSchema = z.object({
  type: z.literal("project.links.set.response"),
  payload: ProjectLinksMutationResponsePayloadSchema,
});

export const ProjectLinksUnsetResponseSchema = z.object({
  type: z.literal("project.links.unset.response"),
  payload: ProjectLinksMutationResponsePayloadSchema,
});

// Pushed to the session whenever the link set changes (mutation or cascade on
// project removal) so open UIs re-evaluate cross-project access without polling.
export const ProjectLinksChangedPayloadSchema = z.object({
  links: z.array(ProjectLinkSchema).default([]),
});

export const ProjectLinksChangedSchema = z.object({
  type: z.literal("project.links.changed"),
  payload: ProjectLinksChangedPayloadSchema,
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

// One entry in a git operation log (the "Git Commit"/"Git Push" log panes).
// `seq` is a per-(cwd, operation) monotonic counter used for client-side
// dedup between backfill and live pushes.
export const GitOperationLogEntrySchema = z.object({
  seq: z.number(),
  timestamp: z.string(),
  level: z.enum(["info", "output", "error"]),
  text: z.string(),
});

// Backfill for a git operation log pane. `operation` is an open string on the
// wire ("commit" | "pull" | "push" today) so newly watchable operations don't
// break old peers. Gated by server_info.features.checkoutGitLog.
export const CheckoutGitGetOperationLogRequestSchema = z.object({
  type: z.literal("checkout.git.get_operation_log.request"),
  cwd: z.string(),
  operation: z.string(),
  requestId: z.string(),
});

export const CheckoutGitGetOperationLogResponseSchema = z.object({
  type: z.literal("checkout.git.get_operation_log.response"),
  payload: z.object({
    cwd: z.string(),
    operation: z.string(),
    entries: z.array(GitOperationLogEntrySchema),
    requestId: z.string(),
  }),
});

// Live append notification, broadcast to connected clients while a watched git
// operation runs. Carries only the appended entries; `seq` orders them against
// the backfill.
export const CheckoutGitLogAppendedNotificationSchema = z.object({
  type: z.literal("checkout.git.log_appended.notification"),
  payload: z.object({
    cwd: z.string(),
    operation: z.string(),
    entries: z.array(GitOperationLogEntrySchema),
  }),
});

// ── Orchestration runs (agent-orchestration) ────────────────────────────────
// Daemon-owned multi-agent Run projection + control. Gated by
// server_info.features.agentOrchestration. See projects/agent-orchestration.
export const RunsGetSnapshotRequestSchema = z.object({
  type: z.literal("runs.get_snapshot.request"),
  requestId: z.string(),
});
export const RunsGetSnapshotResponseSchema = z.object({
  type: z.literal("runs.get_snapshot.response"),
  payload: z.object({
    runs: z.array(RunSchema),
    requestId: z.string(),
  }),
});

// Single-run push, broadcast on every phase/status change. Clients merge by id.
export const RunsUpdatedNotificationSchema = z.object({
  type: z.literal("runs.updated.notification"),
  payload: z.object({
    run: RunSchema,
  }),
});

// Answer an attended run's `gate` phase (approve or reject, with an optional
// note). `accepted` is false when the run wasn't awaiting a gate.
export const RunsGateRespondRequestSchema = z.object({
  type: z.literal("runs.gate_respond.request"),
  runId: z.string(),
  phaseId: z.string(),
  approved: z.boolean(),
  note: z.string().optional(),
  requestId: z.string(),
});
export const RunsGateRespondResponseSchema = z.object({
  type: z.literal("runs.gate_respond.response"),
  payload: z.object({
    runId: z.string(),
    accepted: z.boolean(),
    requestId: z.string(),
  }),
});

export const RunsCancelRequestSchema = z.object({
  type: z.literal("runs.cancel.request"),
  runId: z.string(),
  requestId: z.string(),
});
export const RunsCancelResponseSchema = z.object({
  type: z.literal("runs.cancel.response"),
  payload: z.object({
    runId: z.string(),
    canceled: z.boolean(),
    requestId: z.string(),
  }),
});

// Delete every finished (done/failed/canceled) run from disk and memory.
// Active/paused runs are left untouched. Gated by
// server_info.features.runsClear.
export const RunsClearRequestSchema = z.object({
  type: z.literal("runs.clear.request"),
  requestId: z.string(),
});
export const RunsClearResponseSchema = z.object({
  type: z.literal("runs.clear.response"),
  payload: z.object({
    runIds: z.array(z.string()),
    requestId: z.string(),
  }),
});

// Broadcast to every connected client (including the requester) so all
// caches drop the same runs, mirroring runs.updated.notification's upsert.
export const RunsClearedNotificationSchema = z.object({
  type: z.literal("runs.cleared.notification"),
  payload: z.object({
    runIds: z.array(z.string()),
  }),
});

export type RunsGetSnapshotRequest = z.infer<typeof RunsGetSnapshotRequestSchema>;
export type RunsGetSnapshotResponse = z.infer<typeof RunsGetSnapshotResponseSchema>;
export type RunsUpdatedNotification = z.infer<typeof RunsUpdatedNotificationSchema>;
export type RunsGateRespondRequest = z.infer<typeof RunsGateRespondRequestSchema>;
export type RunsGateRespondResponse = z.infer<typeof RunsGateRespondResponseSchema>;
export type RunsCancelRequest = z.infer<typeof RunsCancelRequestSchema>;
export type RunsCancelResponse = z.infer<typeof RunsCancelResponseSchema>;
export type RunsClearRequest = z.infer<typeof RunsClearRequestSchema>;
export type RunsClearResponse = z.infer<typeof RunsClearResponseSchema>;
export type RunsClearedNotification = z.infer<typeof RunsClearedNotificationSchema>;

// Namespaced successor to checkout_commit_request: per-file selection and
// structured errors. Gated by server_info.features.checkoutGitCommit; the flat
// RPC stays accepted for old clients.
export const CheckoutGitCommitRequestSchema = z.object({
  type: z.literal("checkout.git.commit.request"),
  cwd: z.string(),
  message: z.string(),
  // Repo-relative paths to stage and commit. Only these paths land in the
  // commit, even if other changes are already staged.
  paths: z.array(z.string()),
  // Set after the user confirms committing while agents are running in this
  // workspace; without it the daemon refuses with kind "agents_running".
  allowWithRunningAgents: z.boolean().optional(),
  requestId: z.string(),
});

// Resolve which agent the daemon would use to author a commit message for this
// checkout (the "writer" role) so the client can name it in a confirmation
// before running the AI-authored commit. A pure query — it never commits. Gated
// by server_info.features.checkoutGitCommitAgent.
export const CheckoutGitCommitAgentRequestSchema = z.object({
  type: z.literal("checkout.git.commit_agent.request"),
  cwd: z.string(),
  requestId: z.string(),
});

// Discard uncommitted working-tree changes for specific repo-relative paths
// (restore tracked files from HEAD, delete newly-added files). Gated by
// server_info.features.checkoutGitRollback.
export const CheckoutGitRollbackRequestSchema = z.object({
  type: z.literal("checkout.git.rollback.request"),
  cwd: z.string(),
  // Repo-relative paths whose uncommitted changes should be discarded.
  paths: z.array(z.string()),
  // Set after the user confirms rolling back while agents are running in this
  // workspace; without it the daemon refuses with kind "agents_running", since
  // discarding a live agent's uncommitted edits mid-run can destroy its work.
  allowWithRunningAgents: z.boolean().optional(),
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

export const CheckoutGithubSetAutoMergeRequestSchema = z.object({
  type: z.literal("checkout.github.set_auto_merge.request"),
  cwd: z.string(),
  enabled: z.boolean(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  requestId: z.string(),
});

const GitHubRepoSegmentSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);

export const CheckoutGithubGetCheckDetailsRequestSchema = z.object({
  type: z.literal("checkout.github.get_check_details.request"),
  cwd: z.string(),
  repoOwner: GitHubRepoSegmentSchema,
  repoName: GitHubRepoSegmentSchema,
  checkRunId: z.number().int().positive(),
  workflowRunId: z.number().int().positive().optional(),
  requestId: z.string(),
});

export const CheckoutPrStatusRequestSchema = z.object({
  type: z.literal("checkout_pr_status_request"),
  cwd: z.string(),
  requestId: z.string(),
});

/**
 * UI-initiated preview RPCs (the Preview toolbar button), distinct from the
 * agent-facing preview_* tools in packages/server/src/server/preview/preview-tools.ts.
 * Both sides drive the same DevServerManager; only the caller differs.
 */
export const PreviewListConfigRequestSchema = z.object({
  type: z.literal("preview.list_config.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const PreviewStartRequestSchema = z.object({
  type: z.literal("preview.start.request"),
  cwd: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const PreviewBindTabRequestSchema = z.object({
  type: z.literal("preview.bind_tab.request"),
  serverId: z.string(),
  browserId: z.string(),
  requestId: z.string(),
});

export const PreviewStopRequestSchema = z.object({
  type: z.literal("preview.stop.request"),
  serverId: z.string(),
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
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

export const GitHubSearchKindSchema = z.enum(["github-issue", "github-pr"]);

export const GitHubSearchRequestSchema = z.object({
  type: z.literal("github_search_request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(GitHubSearchKindSchema).optional(),
  requestId: z.string(),
});

// Provider-neutral successor to github_search_request. Resolves the project's
// configured hosting provider from cwd. Gated by server_info
// features.gitHostingProviders.
export const HostingSearchKindSchema = z.enum(["issue", "pr"]);

export const HostingSearchRequestSchema = z.object({
  type: z.literal("hosting.search.request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(HostingSearchKindSchema).optional(),
  requestId: z.string(),
});

// Reports whether a host-level provider's credentials are valid — drives the
// connection-status row in the host Git providers settings section.
export const HostingAuthStatusRequestSchema = z.object({
  type: z.literal("hosting.auth_status.request"),
  provider: GitHostingProviderIdWireSchema,
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

export const ProjectAddRequestSchema = z.object({
  type: z.literal("project.add.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const ArchiveWorkspaceRequestSchema = z.object({
  type: z.literal("archive_workspace_request"),
  workspaceId: z.string(),
  requestId: z.string(),
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
      // Target branch name for checkout, or new branch name for branch-off.
      refName: z.string().min(1).optional(),
      baseBranch: z.string().optional(),
      githubPrNumber: z.number().int().positive().optional(),
      worktreeSlug: z.string().optional(),
    }),
  ]),
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
  status: z.enum(["ok", "too_large", "binary"]).optional(),
});

const FileExplorerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number(),
  modifiedAt: z.string(),
});

export const FileEolSchema = z.enum(["lf", "crlf"]);

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
 * not hand out — a mismatch comes back as a typed conflict, never a write.
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

// Subscriptions exist only for paths open in tabs; the daemon cleans them up
// when the session ends.
export const FileWatchSubscribeRequestSchema = z.object({
  type: z.literal("file.watch.subscribe.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const FileWatchUnsubscribeRequestSchema = z.object({
  type: z.literal("file.watch.unsubscribe.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

// ctags-style navigation (no LSP). All three are daemon RPCs so the client
// never touches the filesystem; the symbol index is name-based and honest.
export const CodeListFilesRequestSchema = z.object({
  type: z.literal("code.list_files.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CodeSymbolsRequestSchema = z.object({
  type: z.literal("code.symbols.request"),
  cwd: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const CodeOutlineRequestSchema = z.object({
  type: z.literal("code.outline.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

/**
 * Project-wide search ("Find in Files" semantics: explicit search, not
 * per-keystroke). Results stream as file.search.result events correlated by
 * searchId (= this requestId); a new search from the same session supersedes
 * any in-flight one.
 */
export const FileSearchRequestSchema = z.object({
  type: z.literal("file.search.request"),
  cwd: z.string(),
  query: z.string(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regexp: z.boolean().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
  requestId: z.string(),
});

const FileReplaceMatchSchema = z.object({
  /** 1-based line number. */
  line: z.number().int().positive(),
  /** 1-based character column of the match start. */
  column: z.number().int().positive(),
  /** Match length in characters. */
  length: z.number().int().nonnegative(),
});

/**
 * Preview-first project replace. Each file carries the hash the preview was
 * built against — files changed since are skipped and reported, never
 * corrupted. The replacement string is literal (no capture references in v1).
 */
export const FileReplaceRequestSchema = z.object({
  type: z.literal("file.replace.request"),
  cwd: z.string(),
  replacement: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      expectedHash: z.string(),
      matches: z.array(FileReplaceMatchSchema),
    }),
  ),
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
  requestId: z.string(),
});

export const RenameTerminalRequestSchema = z.object({
  type: z.literal("terminal.rename.request"),
  terminalId: z.string(),
  title: z.string(),
  requestId: z.string(),
});

export const StartWorkspaceScriptRequestSchema = z.object({
  type: z.literal("start_workspace_script_request"),
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

export const SessionInboundMessageSchema = z.discriminatedUnion("type", [
  BrowserAutomationExecuteResponseSchema,
  VoiceAudioChunkMessageSchema,
  AbortRequestMessageSchema,
  AudioPlayedMessageSchema,
  FetchAgentsRequestMessageSchema,
  FetchAgentHistoryRequestMessageSchema,
  FetchRecentProviderSessionsRequestMessageSchema,
  FetchWorkspacesRequestMessageSchema,
  FetchAgentRequestMessageSchema,
  DeleteAgentRequestMessageSchema,
  ArchiveAgentRequestMessageSchema,
  CloseItemsRequestMessageSchema,
  UpdateAgentRequestMessageSchema,
  ProjectRenameRequestSchema,
  ProjectRemoveRequestSchema,
  ProjectLinksListRequestSchema,
  ProjectLinksSetRequestSchema,
  ProjectLinksUnsetRequestSchema,
  WorkspaceTitleSetRequestSchema,
  SetVoiceModeMessageSchema,
  SendAgentMessageRequestSchema,
  WaitForFinishRequestSchema,
  DaemonGetStatusRequestSchema,
  DaemonGetPairingOfferRequestSchema,
  DiagnosticsRequestSchema,
  GetDaemonConfigRequestMessageSchema,
  SetDaemonConfigRequestMessageSchema,
  SpeechSettingsGetOptionsRequestSchema,
  SpeechTtsPreviewRequestSchema,
  VisualizerVoiceCuesGenerateRequestSchema,
  AgentPersonalitiesGetStatsRequestSchema,
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
  ContextEdgeConvertRequestMessageSchema,
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
  AgentForkContextRequestMessageSchema,
  SetAgentModeRequestMessageSchema,
  SetAgentModelRequestMessageSchema,
  SetAgentThinkingRequestMessageSchema,
  SetAgentFeatureRequestMessageSchema,
  AgentDetachRequestMessageSchema,
  AgentSubagentStopRequestMessageSchema,
  AgentBackgroundTaskStopRequestMessageSchema,
  AgentBackgroundTaskClearRequestMessageSchema,
  TasksSuggestedStartRequestMessageSchema,
  TasksSuggestedDismissRequestMessageSchema,
  AgentPersonalitySetRequestMessageSchema,
  AgentRewindRequestMessageSchema,
  AgentPermissionResponseMessageSchema,
  CheckoutStatusRequestSchema,
  SubscribeCheckoutDiffRequestSchema,
  UnsubscribeCheckoutDiffRequestSchema,
  CheckoutCommitRequestSchema,
  CheckoutGitCommitRequestSchema,
  CheckoutGitCommitAgentRequestSchema,
  CheckoutGitRollbackRequestSchema,
  CheckoutGitGetOperationLogRequestSchema,
  RunsGetSnapshotRequestSchema,
  RunsGateRespondRequestSchema,
  RunsCancelRequestSchema,
  RunsClearRequestSchema,
  CheckoutMergeRequestSchema,
  CheckoutMergeFromBaseRequestSchema,
  CheckoutPullRequestSchema,
  CheckoutPushRequestSchema,
  CheckoutRefreshRequestSchema,
  CheckoutPrCreateRequestSchema,
  CheckoutPrMergeRequestSchema,
  CheckoutGithubSetAutoMergeRequestSchema,
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
  ValidateBranchRequestSchema,
  BranchSuggestionsRequestSchema,
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
  ArchiveWorkspaceRequestSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceClearAttentionRequestSchema,
  FileExplorerRequestSchema,
  ProjectIconRequestSchema,
  FileDownloadTokenRequestSchema,
  FileUploadRequestSchema,
  FileWriteRequestSchema,
  FileWatchSubscribeRequestSchema,
  FileWatchUnsubscribeRequestSchema,
  FileSearchRequestSchema,
  FileReplaceRequestSchema,
  CodeListFilesRequestSchema,
  CodeSymbolsRequestSchema,
  CodeOutlineRequestSchema,
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
  SubscribeTerminalRequestSchema,
  UnsubscribeTerminalRequestSchema,
  TerminalInputSchema,
  KillTerminalRequestSchema,
  CaptureTerminalRequestSchema,
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
    capabilities: ServerCapabilitiesFromUnknownSchema.optional(),
    // COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
    features: z
      .object({
        providersSnapshot: z.boolean().optional(),
        checkoutGithubSetAutoMerge: z.boolean().optional(),
        // COMPAT(githubCheckDetails): added in v0.1.92, remove gate after 2026-12-08.
        githubCheckDetails: z.boolean().optional(),
        // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
        daemonStatusRpc: z.boolean().optional(),
        // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
        "terminal-restore-modes": z.boolean().optional(),
        // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
        rewind: z.boolean().optional(),
        // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
        checkoutRefresh: z.boolean().optional(),
        // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
        workspaceMultiplicity: z.boolean().optional(),
        // COMPAT(projectRemove): added in v0.1.97, drop the gate when floor >= v0.1.97.
        projectRemove: z.boolean().optional(),
        // COMPAT(projectAdd): added in v0.1.97, drop the gate when floor >= v0.1.97.
        projectAdd: z.boolean().optional(),
        // COMPAT(worktreeRestore): added in v0.1.97, drop the gate when floor >= v0.1.97
        worktreeRestore: z.boolean().optional(),
        // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
        providerUsageList: z.boolean().optional(),
        // COMPAT(agentDetach): added in v0.1.98, remove gate after 2026-12-19 once daemon floor >= v0.1.98.
        agentDetach: z.boolean().optional(),
        // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
        daemonDiagnostics: z.boolean().optional(),
        // COMPAT(daemonSelfUpdate): added in v0.1.93, remove gate after 2026-12-13.
        daemonSelfUpdate: z.boolean().optional(),
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
        // Daemon can resolve and evaluate the provider's context graph, serve
        // context.report.* and push context_report_changed. Without it the
        // client hides both the Context Management tab and the composer
        // warning entirely — there is no degraded client-side fallback, since
        // only the daemon can see the files a provider loads.
        // COMPAT(contextManagement): added in v0.6.5, drop the gate when daemon floor >= v0.6.5.
        contextManagement: z.boolean().optional(),
        // COMPAT(textEditor): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        textEditor: z.boolean().optional(),
        // COMPAT(projectSearch): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        projectSearch: z.boolean().optional(),
        // COMPAT(codeIndex): added in v0.4.4, drop the gate when daemon floor >= v0.4.4.
        codeIndex: z.boolean().optional(),
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
        // COMPAT(visualizerVoiceCues): added in v0.6.3, drop the gate when daemon floor >= v0.6.3.
        visualizerVoiceCues: z.boolean().optional(),
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
        // COMPAT(agentTeams): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
        agentTeams: z.boolean().optional(),
        // COMPAT(modelTierOverrides): added in v0.5.2, drop the gate when daemon floor >= v0.5.2.
        modelTierOverrides: z.boolean().optional(),
        // COMPAT(agentOrchestration): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        agentOrchestration: z.boolean().optional(),
        // COMPAT(activityStats): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        activityStats: z.boolean().optional(),
        // COMPAT(runsClear): added in v0.5.3, drop the gate when daemon floor >= v0.5.3.
        runsClear: z.boolean().optional(),
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
        // COMPAT(mcpToolGroups): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon honors `mcp.toolGroups` — per-group gating of the
        // Otto tool catalog on the MCP (Claude) path. Old daemons register every
        // group regardless, so the client hides the categorized section instead
        // of showing category switches that do nothing.
        mcpToolGroups: z.boolean().optional(),
        // COMPAT(agentBehaviorToggles): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
        // Set when the daemon persists `agentBehaviors.*` (promptSuggestions,
        // agentProgressSummaries, notifyOnFinishDefault). The reads are wired by
        // Claude-tier providers (WP-E); the client gates the toggle cards on this.
        agentBehaviorToggles: z.boolean().optional(),
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

export const WorkspaceScriptPayloadSchema = z.object({
  scriptName: z.string(),
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
    projectRootPath: z.string(),
    workspaceDirectory: z.string().optional(),
    projectKind: z.enum(["git", "non_git", "directory"]),
    // COMPAT(workspaces): keep legacy directory workspace kind parseable.
    workspaceKind: z.enum(["directory", "local_checkout", "checkout", "worktree"]),
    name: z.string(),
    // COMPAT(workspaceTitles): added in v0.1.97, drop the optional gate when floor >= v0.1.97.
    // When the user has titled a workspace, `name` carries the resolved value
    // (title) and `title` mirrors the raw override so the rename UI can prefill
    // its input and offer a "reset to branch name" action. Null means the name
    // is derived from the branch/directory.
    title: z.string().nullable().optional(),
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
    scripts: z.array(WorkspaceScriptPayloadSchema).default([]),
    gitRuntime: WorkspaceGitRuntimePayloadSchema,
    githubRuntime: WorkspaceGitHubRuntimePayloadSchema,
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
  projectDisplayName: z.string(),
  projectCustomName: z.string().nullable().optional(),
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

export const AgentForkContextResponseMessageSchema = z.object({
  type: z.literal("agent.fork_context.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    attachment: TextAttachmentSchema.nullable(),
    itemCount: z.number().int().nonnegative(),
    boundaryMessageId: z.string().nullable(),
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

const SpeechEngineOptionSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
});

const LocalSpeechSttModelOptionSchema = z.object({
  id: z.string(),
  // Short display name (e.g. "Parakeet v2 (English)"); older daemons omit it
  // and clients fall back to the id.
  label: z.string().optional(),
  description: z.string(),
});

const LocalSpeechTtsModelOptionSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string(),
  voices: z.array(z.string()),
  defaultVoice: z.string(),
});

export const SpeechSettingsGetOptionsResponseSchema = z.object({
  type: z.literal("speech.settings.get_options.response"),
  payload: z
    .object({
      requestId: z.string(),
      options: z.object({
        sttEngines: z.array(SpeechEngineOptionSchema),
        ttsEngines: z.array(SpeechEngineOptionSchema),
        local: z.object({
          sttModels: z.array(LocalSpeechSttModelOptionSchema),
          ttsModels: z.array(LocalSpeechTtsModelOptionSchema),
        }),
        openai: z.object({
          configured: z.boolean(),
          sttModels: z.array(z.string()),
          ttsModels: z.array(z.string()),
          ttsVoices: z.array(z.string()),
        }),
      }),
    })
    .passthrough(),
});

export type SpeechSettingsOptions = z.infer<
  typeof SpeechSettingsGetOptionsResponseSchema
>["payload"]["options"];

export const SpeechTtsPreviewResponseSchema = z.object({
  type: z.literal("speech.tts.preview.response"),
  payload: z
    .object({
      requestId: z.string(),
      // base64-encoded audio bytes; absent when synthesis failed (see error).
      audio: z.string().optional(),
      // Media type carrying the sample rate, e.g. "audio/pcm;rate=24000",
      // so the client audio engine plays it back at the correct pitch.
      format: z.string().optional(),
      // Human-readable failure reason when audio could not be produced.
      error: z.string().optional(),
    })
    .passthrough(),
});

export type SpeechTtsPreviewResult = z.infer<typeof SpeechTtsPreviewResponseSchema>["payload"];

export const VisualizerVoiceCuesGenerateResponseSchema = z.object({
  type: z.literal("visualizer.voiceCues.generate.response"),
  payload: z
    .object({
      requestId: z.string(),
      // Absent when generation failed (see error) or no writer/provider
      // resolves on this host. Reuses the stored-cues shape.
      cues: AgentPersonalityVoiceCuesSchema.optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});

export type VisualizerVoiceCuesResult = z.infer<
  typeof VisualizerVoiceCuesGenerateResponseSchema
>["payload"];

export const AgentPersonalitiesGetStatsResponseSchema = z.object({
  type: z.literal("agentPersonalities.get_stats.response"),
  payload: z
    .object({
      requestId: z.string(),
      // Per-personality spawn counts, keyed by personality id.
      stats: z.record(z.string(), z.number()),
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

const CheckoutPrGithubStatusSchema = z
  .object({
    mergeStateStatus: z.string().nullable().optional().default(null),
    autoMergeRequest: CheckoutPrGithubAutoMergeRequestSchema,
    viewerCanEnableAutoMerge: z.boolean().optional().default(false),
    viewerCanDisableAutoMerge: z.boolean().optional().default(false),
    viewerCanMergeAsAdmin: z.boolean().optional().default(false),
    viewerCanUpdateBranch: z.boolean().optional().default(false),
    repository: CheckoutPrGithubRepositoryPolicySchema,
    isMergeQueueEnabled: z.boolean().optional().default(false),
    isInMergeQueue: z.boolean().optional().default(false),
  })
  .optional();

export const CheckoutPrStatusSchema = z.object({
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
});

const CheckoutPrStatusPayloadSchema = z.object({
  cwd: z.string(),
  status: CheckoutPrStatusSchema.nullable(),
  // Legacy GitHub-only flag. For non-GitHub providers new daemons send false
  // here (old clients then correctly show no GitHub features) and describe
  // the real provider in `hosting` below.
  githubFeaturesEnabled: z.boolean(),
  // Provider-neutral enablement. Present even when status is null so clients
  // can drive search/create-PR affordances for the workspace's provider.
  hosting: z
    .object({
      provider: GitHostingProviderIdWireSchema,
      featuresEnabled: z.boolean(),
      capabilities: GitHostingCapabilitiesSchema.optional(),
    })
    .optional(),
  error: CheckoutErrorSchema.nullable(),
  requestId: z.string(),
});

const CheckoutStatusUpdateMetadataSchema = z.object({
  prStatus: CheckoutPrStatusPayloadSchema.optional(),
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

const CheckoutGitCommitRunningAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
});

export const CheckoutGitCommitErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agents_running"),
    agents: z.array(CheckoutGitCommitRunningAgentSchema),
  }),
  z.object({
    kind: z.literal("identity_missing"),
    missingName: z.boolean(),
    missingEmail: z.boolean(),
  }),
  z.object({
    kind: z.literal("hook_failed"),
    output: z.string(),
    exitCode: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("signing_failed"),
    detail: z.string(),
  }),
  z.object({
    kind: z.literal("nothing_to_commit"),
  }),
  z.object({
    kind: z.literal("git_failed"),
    detail: z.string(),
  }),
]);

export const CheckoutGitCommitResponseSchema = z.object({
  type: z.literal("checkout.git.commit.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    commitSha: z.string().nullable(),
    error: CheckoutGitCommitErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

// The agent the daemon resolved to author a commit message. "personality" when
// an available role-matched Agent Personality wins the mini-task routing (its
// name plus the bound provider/model); "provider" when a bare provider/model is
// used instead; "none" when nothing is configured to run the task, in which case
// the client refuses the AI commit rather than falling back to placeholder text.
export const CommitMessageAgentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("personality"),
    personalityId: z.string(),
    personalityName: z.string(),
    provider: z.string(),
    providerLabel: z.string(),
    model: z.string().nullable(),
    modelLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("provider"),
    provider: z.string(),
    providerLabel: z.string(),
    model: z.string().nullable(),
    modelLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);

export const CheckoutGitCommitAgentResponseSchema = z.object({
  type: z.literal("checkout.git.commit_agent.response"),
  payload: z.object({
    cwd: z.string(),
    agent: CommitMessageAgentSchema,
    requestId: z.string(),
  }),
});

export const CheckoutGitRollbackErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("nothing_to_rollback"),
  }),
  z.object({
    kind: z.literal("git_failed"),
    detail: z.string(),
  }),
  // Refused because agents are running in this workspace; discarding their
  // uncommitted edits mid-run risks destroying work. The client re-sends with
  // allowWithRunningAgents after confirming, mirroring the commit flow.
  z.object({
    kind: z.literal("agents_running"),
    agents: z.array(CheckoutGitCommitRunningAgentSchema),
  }),
]);

export const CheckoutGitRollbackResponseSchema = z.object({
  type: z.literal("checkout.git.rollback.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    // Repo-relative paths whose changes were discarded.
    rolledBackPaths: z.array(z.string()),
    error: CheckoutGitRollbackErrorSchema.nullable(),
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

export const PreviewConfiguredServerSchema = z.object({
  name: z.string(),
  port: z.number().int().positive(),
});

export const PreviewServerStatusSchema = z.enum(["starting", "running", "exited"]);

export const PreviewRunningServerSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  url: z.string(),
  port: z.number().int().positive(),
  status: PreviewServerStatusSchema,
});

export const PreviewListConfigResponseSchema = z.object({
  type: z.literal("preview.list_config.response"),
  payload: z.object({
    cwd: z.string(),
    configured: z.boolean(),
    servers: z.array(PreviewConfiguredServerSchema),
    runningServers: z.array(PreviewRunningServerSchema).optional(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Preview servers the daemon did not spawn (port-probed from launch.json, e.g.
// a dev server the user started by hand) are addressed by an "ext:<port>" id.
// Stopping one tree-kills whatever process owns the port, so bulk cleanup paths
// must skip external servers and only explicit user action may stop them.
export const EXTERNAL_PREVIEW_SERVER_ID_PREFIX = "ext:";

export function isExternalPreviewServerId(serverId: string): boolean {
  return serverId.startsWith(EXTERNAL_PREVIEW_SERVER_ID_PREFIX);
}

export const PreviewServerSummaryPayloadSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  url: z.string(),
  port: z.number().int().positive(),
  status: z.enum(["starting", "running", "exited"]),
  boundBrowserId: z.string().nullable(),
});

export const PreviewStartResponseSchema = z.object({
  type: z.literal("preview.start.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    server: PreviewServerSummaryPayloadSchema.nullable(),
    reused: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const PreviewBindTabResponseSchema = z.object({
  type: z.literal("preview.bind_tab.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const PreviewStopResponseSchema = z.object({
  type: z.literal("preview.stop.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
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
});

export const CheckoutGithubGetCheckDetailsResponseSchema = z.object({
  type: z.literal("checkout.github.get_check_details.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    details: CheckoutGithubCheckDetailsSchema.nullable().optional().default(null),
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

export const GitHubSearchResponseSchema = z.object({
  type: z.literal("github_search_response"),
  payload: z.object({
    items: z.array(GitHubSearchItemSchema),
    githubFeaturesEnabled: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
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

export const HostingAuthStatusResponseSchema = z.object({
  type: z.literal("hosting.auth_status.response"),
  payload: z.object({
    provider: GitHostingProviderIdWireSchema,
    authenticated: z.boolean(),
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

export const FileWatchSubscribeResponseSchema = z.object({
  type: z.literal("file.watch.subscribe.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileWatchUnsubscribeResponseSchema = z.object({
  type: z.literal("file.watch.unsubscribe.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    ok: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeListFilesResponseSchema = z.object({
  type: z.literal("code.list_files.response"),
  payload: z.object({
    cwd: z.string(),
    files: z.array(z.string()),
    truncated: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeSymbolKindSchema = z.enum(["function", "class", "type", "variable", "property"]);

export const CodeSymbolLocationSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: CodeSymbolKindSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const CodeSymbolsResponseSchema = z.object({
  type: z.literal("code.symbols.response"),
  payload: z.object({
    cwd: z.string(),
    name: z.string(),
    locations: z.array(CodeSymbolLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const CodeOutlineResponseSchema = z.object({
  type: z.literal("code.outline.response"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    symbols: z.array(CodeSymbolLocationSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const FileSearchMatchSchema = z.object({
  /** 1-based line number. */
  line: z.number().int().positive(),
  /** 1-based character column of the match start within the full line. */
  column: z.number().int().positive(),
  /** Match length in characters. */
  length: z.number().int().nonnegative(),
  /** Display line (possibly truncated around the match). */
  lineText: z.string(),
  /** 0-based offset of the match within lineText. */
  previewStart: z.number().int().nonnegative(),
});

// One event per file with matches, streamed while the scan runs.
export const FileSearchResultEventSchema = z.object({
  type: z.literal("file.search.result"),
  payload: z.object({
    cwd: z.string(),
    searchId: z.string(),
    path: z.string(),
    /** File content hash at match time — the replace precondition. */
    hash: z.string(),
    matches: z.array(FileSearchMatchSchema),
  }),
});

export const FileSearchResponseSchema = z.object({
  type: z.literal("file.search.response"),
  payload: z.object({
    cwd: z.string(),
    status: z.enum(["completed", "truncated", "superseded", "error"]),
    error: z.string().nullable(),
    fileCount: z.number(),
    matchCount: z.number(),
    requestId: z.string(),
  }),
});

export const FileReplaceFileResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    path: z.string(),
    replacedCount: z.number(),
    modifiedAt: z.string(),
    hash: z.string(),
  }),
  // The file changed since the preview; nothing was written to it.
  z.object({
    status: z.literal("skipped"),
    path: z.string(),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("error"),
    path: z.string(),
    message: z.string(),
  }),
]);

export const FileReplaceResponseSchema = z.object({
  type: z.literal("file.replace.response"),
  payload: z.object({
    cwd: z.string(),
    results: z.array(FileReplaceFileResultSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

// Pushed to subscribers when a watched file changes under the editor. Carries
// the fresh disk identity (null when the file is gone) so clients can ignore
// echoes of their own saves; content is re-read on demand.
export const FileWatchEventSchema = z.object({
  type: z.literal("file.watch.event"),
  payload: z.object({
    cwd: z.string(),
    path: z.string(),
    change: z.enum(["changed", "deleted", "recreated"]),
    modifiedAt: z.string().nullable(),
    hash: z.string().nullable(),
    size: z.number().nullable(),
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

export const AgentContextUsageCategorySchema = z.object({
  /** Provider-supplied display label, e.g. "Messages", "System prompt". Not translated. */
  name: z.string(),
  tokens: z.number(),
  /** Deferred content (e.g. on-demand tool schemas) is not counted in totalTokens. */
  isDeferred: z.boolean().optional(),
});

export const AgentContextUsageSchema = z.object({
  categories: z.array(AgentContextUsageCategorySchema),
  totalTokens: z.number(),
  maxTokens: z.number(),
});

export const AgentContextGetUsageResponseMessageSchema = z.object({
  type: z.literal("agent.context.get_usage.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    /** Null when the agent's provider cannot report a context breakdown. */
    usage: AgentContextUsageSchema.nullable(),
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

export type DaemonUpdateProgressMessage = z.infer<typeof DaemonUpdateProgressMessageSchema>;

export const SessionOutboundMessageSchema = z.discriminatedUnion("type", [
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
  OpenProjectResponseMessageSchema,
  StartWorkspaceScriptResponseMessageSchema,
  LegacyListAvailableEditorsResponseMessageSchema,
  LegacyOpenInEditorResponseMessageSchema,
  ArchiveWorkspaceResponseMessageSchema,
  FetchAgentResponseMessageSchema,
  FetchAgentTimelineResponseMessageSchema,
  AgentForkContextResponseMessageSchema,
  CancelAgentResponseMessageSchema,
  ClearAgentAttentionResponseMessageSchema,
  WorkspaceCreateResponseSchema,
  WorkspaceClearAttentionResponseSchema,
  SendAgentMessageResponseMessageSchema,
  SetVoiceModeResponseMessageSchema,
  DaemonGetStatusResponseSchema,
  DaemonGetPairingOfferResponseSchema,
  DiagnosticsResponseSchema,
  GetDaemonConfigResponseMessageSchema,
  SetDaemonConfigResponseMessageSchema,
  SpeechSettingsGetOptionsResponseSchema,
  SpeechTtsPreviewResponseSchema,
  VisualizerVoiceCuesGenerateResponseSchema,
  AgentPersonalitiesGetStatsResponseSchema,
  ReadProjectConfigResponseMessageSchema,
  WriteProjectConfigResponseMessageSchema,
  SetAgentModeResponseMessageSchema,
  SetAgentModelResponseMessageSchema,
  SetAgentThinkingResponseMessageSchema,
  SetAgentFeatureResponseMessageSchema,
  AgentDetachResponseMessageSchema,
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
  ProjectRemoveResponseSchema,
  ProjectLinksListResponseSchema,
  ProjectLinksSetResponseSchema,
  ProjectLinksUnsetResponseSchema,
  ProjectLinksChangedSchema,
  WorkspaceTitleSetResponseSchema,
  WaitForFinishResponseMessageSchema,
  AgentPermissionRequestMessageSchema,
  AgentPermissionResolvedMessageSchema,
  AgentDeletedMessageSchema,
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
  RunsGetSnapshotResponseSchema,
  RunsUpdatedNotificationSchema,
  RunsGateRespondResponseSchema,
  RunsCancelResponseSchema,
  RunsClearResponseSchema,
  RunsClearedNotificationSchema,
  CheckoutMergeResponseSchema,
  CheckoutMergeFromBaseResponseSchema,
  CheckoutPullResponseSchema,
  CheckoutPushResponseSchema,
  CheckoutRefreshResponseSchema,
  CheckoutPrCreateResponseSchema,
  CheckoutPrMergeResponseSchema,
  CheckoutGithubSetAutoMergeResponseSchema,
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
  ValidateBranchResponseSchema,
  BranchSuggestionsResponseSchema,
  GitHubSearchResponseSchema,
  HostingSearchResponseSchema,
  HostingAuthStatusResponseSchema,
  DirectorySuggestionsResponseSchema,
  OttoWorktreeListResponseSchema,
  OttoWorktreeArchiveResponseSchema,
  CreateOttoWorktreeResponseSchema,
  FileExplorerResponseSchema,
  ProjectIconResponseSchema,
  FileDownloadTokenResponseSchema,
  FileUploadResponseSchema,
  FileWriteResponseSchema,
  FileWatchSubscribeResponseSchema,
  FileWatchUnsubscribeResponseSchema,
  FileWatchEventSchema,
  FileSearchResultEventSchema,
  FileSearchResponseSchema,
  FileReplaceResponseSchema,
  CodeListFilesResponseSchema,
  CodeSymbolsResponseSchema,
  CodeOutlineResponseSchema,
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
  ContextEdgeConvertResponseMessageSchema,
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
export type WorkspaceProjectDescriptorPayload = z.infer<
  typeof WorkspaceProjectDescriptorPayloadSchema
>;
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
export type ScriptStatusUpdateMessage = z.infer<typeof ScriptStatusUpdateMessageSchema>;
export type OpenProjectResponseMessage = z.infer<typeof OpenProjectResponseMessageSchema>;
export type StartWorkspaceScriptResponseMessage = z.infer<
  typeof StartWorkspaceScriptResponseMessageSchema
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
export type SetVoiceModeResponseMessage = z.infer<typeof SetVoiceModeResponseMessageSchema>;
export type SetAgentModeResponseMessage = z.infer<typeof SetAgentModeResponseMessageSchema>;
export type SetAgentModelResponseMessage = z.infer<typeof SetAgentModelResponseMessageSchema>;
export type SetAgentThinkingResponseMessage = z.infer<typeof SetAgentThinkingResponseMessageSchema>;
export type SetAgentFeatureResponseMessage = z.infer<typeof SetAgentFeatureResponseMessageSchema>;
export type AgentDetachResponseMessage = z.infer<typeof AgentDetachResponseMessageSchema>;
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
export type SuggestedTaskInfo = z.infer<typeof SuggestedTaskInfoSchema>;
export type SuggestedTaskState = z.infer<typeof SuggestedTaskStateSchema>;
export type SuggestedTasksChanged = z.infer<typeof SuggestedTasksChangedSchema>;
export type ContextScope = z.infer<typeof ContextScopeSchema>;
export type ContextCategory = z.infer<typeof ContextCategorySchema>;
export type ContextCostClass = z.infer<typeof ContextCostClassSchema>;
export type ContextSeverity = z.infer<typeof ContextSeveritySchema>;
export type ContextConfidence = z.infer<typeof ContextConfidenceSchema>;
export type ContextFinding = z.infer<typeof ContextFindingSchema>;
export type ContextNode = z.infer<typeof ContextNodeSchema>;
export type ContextEdge = z.infer<typeof ContextEdgeSchema>;
export type ContextCategoryTotal = z.infer<typeof ContextCategoryTotalSchema>;
export type ContextReport = z.infer<typeof ContextReportSchema>;
export type ContextReportChanged = z.infer<typeof ContextReportChangedSchema>;
export type TasksSuggestedStartMode = z.infer<typeof TasksSuggestedStartModeSchema>;
export type TasksSuggestedStartResponseMessage = z.infer<
  typeof TasksSuggestedStartResponseMessageSchema
>;
export type TasksSuggestedDismissResponseMessage = z.infer<
  typeof TasksSuggestedDismissResponseMessageSchema
>;
export type AgentRewindResponseMessage = z.infer<typeof AgentRewindResponseMessageSchema>;
export type UpdateAgentResponseMessage = z.infer<typeof UpdateAgentResponseMessageSchema>;
export type ProjectRenameResponse = z.infer<typeof ProjectRenameResponseSchema>;
export type ProjectRemoveResponse = z.infer<typeof ProjectRemoveResponseSchema>;
export type ProjectLink = z.infer<typeof ProjectLinkSchema>;
export type ProjectLinksListResponse = z.infer<typeof ProjectLinksListResponseSchema>;
export type ProjectLinksListResponsePayload = z.infer<typeof ProjectLinksListResponsePayloadSchema>;
export type ProjectLinksSetResponse = z.infer<typeof ProjectLinksSetResponseSchema>;
export type ProjectLinksUnsetResponse = z.infer<typeof ProjectLinksUnsetResponseSchema>;
export type ProjectLinksMutationResponsePayload = z.infer<
  typeof ProjectLinksMutationResponsePayloadSchema
>;
export type ProjectLinksChanged = z.infer<typeof ProjectLinksChangedSchema>;
export type WorkspaceTitleSetResponse = z.infer<typeof WorkspaceTitleSetResponseSchema>;
export type WorkspaceTitleSetResponsePayload = z.infer<
  typeof WorkspaceTitleSetResponsePayloadSchema
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
export type AgentContextUsageCategory = z.infer<typeof AgentContextUsageCategorySchema>;
export type AgentContextUsage = z.infer<typeof AgentContextUsageSchema>;
export type AgentRateLimitInfo = z.infer<typeof AgentRateLimitInfoSchema>;
export type AgentContextGetUsageResponseMessage = z.infer<
  typeof AgentContextGetUsageResponseMessageSchema
>;
export type ProviderUsageListResponseMessage = z.infer<
  typeof ProviderUsageListResponseMessageSchema
>;
export type ActivityCounters = z.infer<typeof ActivityCountersSchema>;
export type StatsActivityGetResponseMessage = z.infer<typeof StatsActivityGetResponseMessageSchema>;
export type ContextReportGetResponseMessage = z.infer<typeof ContextReportGetResponseMessageSchema>;
export type ContextEdgeConvertResponseMessage = z.infer<
  typeof ContextEdgeConvertResponseMessageSchema
>;
export type StatsActivityResetRequestMessage = z.infer<
  typeof StatsActivityResetRequestMessageSchema
>;
export type StatsActivityResetResponseMessage = z.infer<
  typeof StatsActivityResetResponseMessageSchema
>;
export type ActivityStatsChanged = z.infer<typeof ActivityStatsChangedSchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type UsageLogGetRequestMessage = z.infer<typeof UsageLogGetRequestMessageSchema>;
export type UsageLogGetResponseMessage = z.infer<typeof UsageLogGetResponseMessageSchema>;
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
export type ProjectLinksListRequest = z.infer<typeof ProjectLinksListRequestSchema>;
export type ProjectLinksSetRequest = z.infer<typeof ProjectLinksSetRequestSchema>;
export type ProjectLinksUnsetRequest = z.infer<typeof ProjectLinksUnsetRequestSchema>;
export type WorkspaceTitleSetRequest = z.infer<typeof WorkspaceTitleSetRequestSchema>;
export type SetAgentModeRequestMessage = z.infer<typeof SetAgentModeRequestMessageSchema>;
export type SetAgentModelRequestMessage = z.infer<typeof SetAgentModelRequestMessageSchema>;
export type SetAgentThinkingRequestMessage = z.infer<typeof SetAgentThinkingRequestMessageSchema>;
export type SetAgentFeatureRequestMessage = z.infer<typeof SetAgentFeatureRequestMessageSchema>;
export type AgentDetachRequestMessage = z.infer<typeof AgentDetachRequestMessageSchema>;
export type AgentSubagentStopRequestMessage = z.infer<typeof AgentSubagentStopRequestMessageSchema>;
export type AgentBackgroundTaskStopRequestMessage = z.infer<
  typeof AgentBackgroundTaskStopRequestMessageSchema
>;
export type AgentBackgroundTaskClearRequestMessage = z.infer<
  typeof AgentBackgroundTaskClearRequestMessageSchema
>;
export type TasksSuggestedStartRequestMessage = z.infer<
  typeof TasksSuggestedStartRequestMessageSchema
>;
export type TasksSuggestedDismissRequestMessage = z.infer<
  typeof TasksSuggestedDismissRequestMessageSchema
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
export type CheckoutGitCommitRequest = z.infer<typeof CheckoutGitCommitRequestSchema>;
export type CheckoutGitCommitResponse = z.infer<typeof CheckoutGitCommitResponseSchema>;
export type CheckoutGitCommitError = z.infer<typeof CheckoutGitCommitErrorSchema>;
export type CheckoutGitCommitAgentRequest = z.infer<typeof CheckoutGitCommitAgentRequestSchema>;
export type CheckoutGitCommitAgentResponse = z.infer<typeof CheckoutGitCommitAgentResponseSchema>;
export type CommitMessageAgent = z.infer<typeof CommitMessageAgentSchema>;
export type CheckoutGitRollbackRequest = z.infer<typeof CheckoutGitRollbackRequestSchema>;
export type CheckoutGitRollbackResponse = z.infer<typeof CheckoutGitRollbackResponseSchema>;
export type CheckoutGitRollbackError = z.infer<typeof CheckoutGitRollbackErrorSchema>;
export type GitOperationLogEntry = z.infer<typeof GitOperationLogEntrySchema>;
export type CheckoutGitGetOperationLogRequest = z.infer<
  typeof CheckoutGitGetOperationLogRequestSchema
>;
export type CheckoutGitGetOperationLogResponse = z.infer<
  typeof CheckoutGitGetOperationLogResponseSchema
>;
export type CheckoutGitLogAppendedNotification = z.infer<
  typeof CheckoutGitLogAppendedNotificationSchema
>;
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
export type CheckoutPrCreateRequest = z.infer<typeof CheckoutPrCreateRequestSchema>;
export type CheckoutPrCreateResponse = z.infer<typeof CheckoutPrCreateResponseSchema>;
export type CheckoutPrMergeRequest = z.infer<typeof CheckoutPrMergeRequestSchema>;
export type CheckoutPrMergeResponse = z.infer<typeof CheckoutPrMergeResponseSchema>;
export type CheckoutPrMergeMethod = z.infer<typeof CheckoutPrMergeRequestSchema>["mergeMethod"];
export type CheckoutGithubSetAutoMergeRequest = z.infer<
  typeof CheckoutGithubSetAutoMergeRequestSchema
>;
export type CheckoutGithubSetAutoMergeResponse = z.infer<
  typeof CheckoutGithubSetAutoMergeResponseSchema
>;
export type CheckoutGithubGetCheckDetailsRequest = z.infer<
  typeof CheckoutGithubGetCheckDetailsRequestSchema
>;
export type PreviewListConfigRequest = z.infer<typeof PreviewListConfigRequestSchema>;
export type PreviewConfiguredServer = z.infer<typeof PreviewConfiguredServerSchema>;
export type PreviewRunningServer = z.infer<typeof PreviewRunningServerSchema>;
export type PreviewServerStatus = z.infer<typeof PreviewServerStatusSchema>;
export type PreviewListConfigResponse = z.infer<typeof PreviewListConfigResponseSchema>;
export type PreviewStartRequest = z.infer<typeof PreviewStartRequestSchema>;
export type PreviewServerSummaryPayload = z.infer<typeof PreviewServerSummaryPayloadSchema>;
export type PreviewStartResponse = z.infer<typeof PreviewStartResponseSchema>;
export type PreviewBindTabRequest = z.infer<typeof PreviewBindTabRequestSchema>;
export type PreviewBindTabResponse = z.infer<typeof PreviewBindTabResponseSchema>;
export type PreviewStopRequest = z.infer<typeof PreviewStopRequestSchema>;
export type PreviewStopResponse = z.infer<typeof PreviewStopResponseSchema>;
export type CheckoutGithubCheckDetails = z.infer<typeof CheckoutGithubCheckDetailsSchema>;
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
export type StashEntry = z.infer<typeof StashEntrySchema>;
export type ValidateBranchRequest = z.infer<typeof ValidateBranchRequestSchema>;
export type ValidateBranchResponse = z.infer<typeof ValidateBranchResponseSchema>;
export type BranchSuggestionsRequest = z.infer<typeof BranchSuggestionsRequestSchema>;
export type BranchSuggestionsResponse = z.infer<typeof BranchSuggestionsResponseSchema>;
export type GitHubSearchItem = z.infer<typeof GitHubSearchItemSchema>;
export type GitHubSearchKind = z.infer<typeof GitHubSearchKindSchema>;
export type GitHubSearchRequest = z.infer<typeof GitHubSearchRequestSchema>;
export type GitHubSearchResponse = z.infer<typeof GitHubSearchResponseSchema>;
export type { GitHostingProviderId, GitHostingCapabilities } from "./git-hosting.js";
export type HostingSearchKind = z.infer<typeof HostingSearchKindSchema>;
export type HostingSearchRequest = z.infer<typeof HostingSearchRequestSchema>;
export type HostingSearchResponse = z.infer<typeof HostingSearchResponseSchema>;
export type HostingAuthStatusRequest = z.infer<typeof HostingAuthStatusRequestSchema>;
export type HostingAuthStatusResponse = z.infer<typeof HostingAuthStatusResponseSchema>;
export type HostingPrAttachment = z.infer<typeof HostingPrAttachmentSchema>;
export type HostingIssueAttachment = z.infer<typeof HostingIssueAttachmentSchema>;
export type CreateOttoWorktreeRequest = z.infer<typeof CreateOttoWorktreeRequestSchema>;
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
export type ArchiveWorkspaceRequest = z.infer<typeof ArchiveWorkspaceRequestSchema>;
export type WorkspaceClearAttentionRequest = z.infer<typeof WorkspaceClearAttentionRequestSchema>;
export type FileExplorerRequest = z.infer<typeof FileExplorerRequestSchema>;
export type FileExplorerResponse = z.infer<typeof FileExplorerResponseSchema>;
export type ProjectIconRequest = z.infer<typeof ProjectIconRequestSchema>;
export type ProjectIconResponse = z.infer<typeof ProjectIconResponseSchema>;
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;
export type FileDownloadTokenRequest = z.infer<typeof FileDownloadTokenRequestSchema>;
export type FileDownloadTokenResponse = z.infer<typeof FileDownloadTokenResponseSchema>;
export type FileUploadRequest = z.infer<typeof FileUploadRequestSchema>;
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;
export type FileEol = z.infer<typeof FileEolSchema>;
export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;
export type FileWriteResponse = z.infer<typeof FileWriteResponseSchema>;
export type FileWriteResult = z.infer<typeof FileWriteResultSchema>;
export type FileWatchSubscribeRequest = z.infer<typeof FileWatchSubscribeRequestSchema>;
export type FileWatchUnsubscribeRequest = z.infer<typeof FileWatchUnsubscribeRequestSchema>;
export type FileWatchEvent = z.infer<typeof FileWatchEventSchema>;
export type FileWatchEventPayload = FileWatchEvent["payload"];
export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;
export type FileSearchMatch = z.infer<typeof FileSearchMatchSchema>;
export type FileSearchResultEvent = z.infer<typeof FileSearchResultEventSchema>;
export type FileSearchResultPayload = FileSearchResultEvent["payload"];
export type FileSearchResponse = z.infer<typeof FileSearchResponseSchema>;
export type FileSearchSummary = FileSearchResponse["payload"];
export type FileReplaceRequest = z.infer<typeof FileReplaceRequestSchema>;
export type FileReplaceResponse = z.infer<typeof FileReplaceResponseSchema>;
export type FileReplaceFileResult = z.infer<typeof FileReplaceFileResultSchema>;
export type CodeListFilesRequest = z.infer<typeof CodeListFilesRequestSchema>;
export type CodeListFilesResponse = z.infer<typeof CodeListFilesResponseSchema>;
export type CodeSymbolsRequest = z.infer<typeof CodeSymbolsRequestSchema>;
export type CodeSymbolsResponse = z.infer<typeof CodeSymbolsResponseSchema>;
export type CodeOutlineRequest = z.infer<typeof CodeOutlineRequestSchema>;
export type CodeOutlineResponse = z.infer<typeof CodeOutlineResponseSchema>;
export type CodeSymbolLocation = z.infer<typeof CodeSymbolLocationSchema>;
export type CodeSymbolKind = z.infer<typeof CodeSymbolKindSchema>;
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
      [CLIENT_CAPS.customModeIcons]: z.boolean().optional(),
      [CLIENT_CAPS.terminalReflowableSnapshot]: z.boolean().optional(),
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
