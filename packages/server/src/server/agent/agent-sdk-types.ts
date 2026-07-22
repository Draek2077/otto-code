import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderNotice, ModelTier } from "@otto-code/protocol/agent-types";
import type {
  AgentAttachment,
  AgentContextUsage,
  AgentRateLimitInfo,
} from "@otto-code/protocol/messages";
import type { ProviderCompactionConfig } from "@otto-code/protocol/provider-config";
import type { OttoToolCatalog } from "./tools/types.js";
// Type-only import — erased at compile time, so the resolver ⇄ config-types
// cycle never exists at runtime.
import type { ResolvedPersonalitySnapshot } from "./agent-personalities.js";
import type { ResolvedTeamSnapshot } from "./agent-teams.js";

export type { AgentProviderNotice };
export type { AgentContextUsage };
export type { AgentRateLimitInfo };

export type AgentProvider = string;

export interface AgentMetadata {
  [key: string]: unknown;
}

/**
 * Stdio-based MCP server (spawns a subprocess).
 */
export interface McpStdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * HTTP-based MCP server.
 */
export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * SSE-based MCP server (Server-Sent Events over HTTP).
 */
export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * Canonical MCP server configuration.
 * Discriminated union by `type` field.
 * Each provider normalizes this to their expected format.
 */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

export interface AgentMode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  colorTier?: string;
  isUnattended?: boolean;
}

export type ProviderStatus = "ready" | "loading" | "error" | "unavailable";

export interface AgentModelDefinition {
  provider: AgentProvider;
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
  contextWindowMaxTokens?: number;
  thinkingOptions?: AgentSelectOption[];
  defaultThinkingOptionId?: string;
  /**
   * Capability tier stamped by the provider snapshot manager at ingest (user
   * override → shipped catalog, else undefined = "Unknown"). Mirrors the
   * protocol `AgentModelDefinition.tier`. Read by cheap-tier metadata-generation
   * routing to prefer the cheapest capable model. See model-tiers.ts.
   */
  tier?: ModelTier;
  /**
   * False when this model cannot run the provider's "auto" permission mode
   * (e.g. Claude's classifier-based Auto mode is unsupported on Haiku, and on
   * 4.6-era models without Anthropic API-key auth). Absent = supported or
   * unknown; clients only hide Auto on an explicit false.
   */
  supportsAutoMode?: boolean;
}

export interface AgentSelectOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
}

export function normalizeAgentModelDefinition(model: AgentModelDefinition): AgentModelDefinition {
  const defaultThinkingOptionId =
    model.defaultThinkingOptionId ?? model.thinkingOptions?.find((option) => option.isDefault)?.id;
  if (!defaultThinkingOptionId || defaultThinkingOptionId === model.defaultThinkingOptionId) {
    return model;
  }
  return { ...model, defaultThinkingOptionId };
}

export interface ProviderSnapshotEntry {
  provider: AgentProvider;
  status: ProviderStatus;
  enabled: boolean;
  error?: string;
  models?: AgentModelDefinition[];
  modes?: AgentMode[];
  fetchedAt?: string;
  label?: string;
  description?: string;
  defaultModeId?: string | null;
}

export interface AgentCreateConfigParent {
  provider: AgentProvider;
  modeId: string | null;
  isUnattended: boolean;
}

export interface ResolveAgentCreateConfigInput {
  provider: AgentProvider;
  requestedMode: string | undefined;
  featureValues: Record<string, unknown> | undefined;
  parent: AgentCreateConfigParent | null;
  unattended: boolean;
  availableModes: AgentMode[] | undefined;
  // The requested/default model for this create, when known. Lets a provider's
  // own resolveCreateConfig make model-aware decisions (e.g. Claude upgrading
  // the unattended target to `auto` when the model supports the classifier).
  model?: string | null;
  // Provider-computed model-aware override for the unattended coercion target;
  // see ResolveCreateAgentModeInput.preferredUnattendedModeId. The default
  // resolver forwards it; provider-specific resolvers set it.
  preferredUnattendedModeId?: string;
}

export interface ResolveAgentCreateConfigResult {
  modeId: string | undefined;
  featureValues: Record<string, unknown> | undefined;
}

export interface AgentCreateConfigUnattendedInput {
  modeId: string | null;
  config: AgentSessionConfig;
  features?: AgentFeature[];
  availableModes: AgentMode[];
}

export interface AgentFeatureToggle {
  type: "toggle";
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  value: boolean;
}

export interface AgentFeatureSelect {
  type: "select";
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  value: string | null;
  options: AgentSelectOption[];
}

export type AgentFeature = AgentFeatureToggle | AgentFeatureSelect;

export interface AgentCapabilityFlags {
  [capability: string]: boolean | undefined;
  supportsStreaming: boolean;
  supportsSessionPersistence: boolean;
  supportsSessionListing?: boolean;
  supportsDynamicModes: boolean;
  supportsMcpServers: boolean;
  supportsNativeOttoTools?: boolean;
  /**
   * The adapter honours `AgentSessionConfig.workspaceAccess` by actually
   * narrowing the tools it offers. Absent/false means it does not — and a graph
   * node asking for restricted access on such a seat is refused at compile
   * time rather than silently running with full access. Never set this true
   * without the enforcement to back it.
   */
  supportsWorkspaceAccess?: boolean;
  supportsReasoningStream: boolean;
  supportsToolInvocations: boolean;
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
}

export interface AgentPersistenceHandle {
  provider: AgentProvider;
  sessionId: string;
  /** Provider specific handle (Codex thread id, Claude resume token, etc). */
  nativeHandle?: string;
  metadata?: AgentMetadata;
}

export type AgentPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | AgentAttachment;

export type AgentPromptInput = string | AgentPromptContentBlock[];

export interface AgentRunOptions {
  outputSchema?: unknown;
  resumeFrom?: AgentPersistenceHandle;
  maxThinkingTokens?: number;
  messageId?: string;
}

/**
 * How the tokens occupying an agent's context window break down by origin.
 * Mirrors the protocol `ContextComposition` (packages/protocol/agent-types) —
 * this file keeps the server's own copy of the provider-facing types. Every
 * field is an optional best-effort token count; a provider fills what it can
 * attribute and omits the rest. Powers the visualizer context ring/bar.
 */
export interface ContextComposition {
  systemPrompt?: number;
  userMessages?: number;
  toolResults?: number;
  reasoning?: number;
  subagentResults?: number;
}

export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  /**
   * Prompt tokens spent writing (not reading) the prompt cache this turn —
   * Anthropic's `cache_creation_input_tokens`, billed at a premium over normal
   * input. Disjoint from `inputTokens`/`cachedInputTokens` (the three input
   * categories sum to total input). Claude-specific today; other providers omit
   * it. Additive/optional — a consumer that ignores it loses only cache-write
   * visibility. Powers WP-G's cost ledger.
   */
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
  contextComposition?: ContextComposition;
  /**
   * Server-internal only (WP-G): how much of this turn's billed input/output was
   * spent by the mid-turn auto-compaction summarizer, so the activity ledger can
   * break "compaction" out as its own cost category without double-counting.
   * WP-D folds the summarizer's spend into the turn's billed total; these two
   * fields report that folded-in slice so the manager can attribute it to
   * `compaction` and the remainder to `mainChat`/`subagent`. Deliberately NOT
   * projected to the wire (`sanitizeUsage` drops it) — the client reads
   * compaction from the daemon-computed counters, not from live usage.
   */
  compactionInputTokens?: number;
  compactionOutputTokens?: number;
}

export const TOOL_CALL_ICON_NAMES = [
  "wrench",
  "square_terminal",
  "eye",
  "pencil",
  "search",
  "bot",
  "sparkles",
  "brain",
  "mic_vocal",
] as const;

export type ToolCallIconName = (typeof TOOL_CALL_ICON_NAMES)[number];

export type ToolCallDetail =
  | {
      type: "shell";
      command: string;
      cwd?: string;
      output?: string;
      exitCode?: number | null;
    }
  | {
      type: "read";
      filePath: string;
      content?: string;
      offset?: number;
      limit?: number;
    }
  | {
      type: "edit";
      filePath: string;
      oldString?: string;
      newString?: string;
      unifiedDiff?: string;
    }
  | {
      type: "write";
      filePath: string;
      content?: string;
    }
  | {
      type: "search";
      query: string;
      toolName?: "search" | "grep" | "glob" | "web_search";
      content?: string;
      filePaths?: string[];
      webResults?: Array<{
        title: string;
        url: string;
      }>;
      annotations?: string[];
      numFiles?: number;
      numMatches?: number;
      durationMs?: number;
      durationSeconds?: number;
      truncated?: boolean;
      mode?: "content" | "files_with_matches" | "count";
    }
  | {
      type: "fetch";
      url: string;
      prompt?: string;
      result?: string;
      code?: number;
      codeText?: string;
      bytes?: number;
      durationMs?: number;
    }
  | {
      type: "worktree_setup";
      worktreePath: string;
      branchName: string;
      log: string;
      commands: Array<{
        index: number;
        command: string;
        cwd: string;
        log: string;
        status: "running" | "completed" | "failed";
        exitCode: number | null;
        durationMs?: number;
      }>;
      truncated?: boolean;
    }
  | {
      type: "sub_agent";
      subAgentType?: string;
      description?: string;
      childSessionId?: string;
      log: string;
      actions?: Array<{
        index: number;
        toolName: string;
        summary?: string;
      }>;
    }
  | {
      type: "plain_text";
      label?: string;
      text?: string;
      icon?: ToolCallIconName;
    }
  | {
      type: "plan";
      text: string;
    }
  | {
      type: "unknown";
      input: unknown;
      output: unknown;
    };

interface ToolCallBase {
  [key: string]: unknown;
  type: "tool_call";
  callId: string;
  name: string;
  detail: ToolCallDetail;
  metadata?: Record<string, unknown>;
}

type ToolCallRunningTimelineItem = ToolCallBase & {
  status: "running";
  error: null;
};

type ToolCallCompletedTimelineItem = ToolCallBase & {
  status: "completed";
  error: null;
};

type ToolCallFailedTimelineItem = ToolCallBase & {
  status: "failed";
  error: unknown;
};

type ToolCallCanceledTimelineItem = ToolCallBase & {
  status: "canceled";
  error: null;
};

export type ToolCallTimelineItem =
  | ToolCallRunningTimelineItem
  | ToolCallCompletedTimelineItem
  | ToolCallFailedTimelineItem
  | ToolCallCanceledTimelineItem;

export interface CompactionTimelineItem {
  [key: string]: unknown;
  type: "compaction";
  // COMPAT(compactionFailedStatus): "failed" added in v0.4.3; see protocol messages.ts.
  status: "loading" | "completed" | "failed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export type AgentTimelineItem =
  | { type: "user_message"; text: string; messageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | ToolCallTimelineItem
  | { type: "todo"; items: { text: string; completed: boolean }[] }
  | { type: "error"; message: string }
  | CompactionTimelineItem;

export type AgentStreamEvent =
  | { type: "thread_started"; sessionId: string; provider: AgentProvider }
  | { type: "turn_started"; provider: AgentProvider; turnId?: string }
  | { type: "turn_completed"; provider: AgentProvider; usage?: AgentUsage; turnId?: string }
  | { type: "usage_updated"; provider: AgentProvider; usage: AgentUsage; turnId?: string }
  | {
      type: "mode_changed";
      provider: AgentProvider;
      currentModeId: string | null;
      availableModes: AgentMode[];
    }
  | { type: "model_changed"; provider: AgentProvider; runtimeInfo: AgentRuntimeInfo }
  | {
      type: "thinking_option_changed";
      provider: AgentProvider;
      thinkingOptionId: string | null;
    }
  | {
      type: "turn_failed";
      provider: AgentProvider;
      error: string;
      code?: string;
      diagnostic?: string;
      turnId?: string;
      // Provider-reported spend up to the point of failure, when known. Fed into
      // the same token accounting as turn_completed so retry storms aren't
      // invisible. Optional — providers that can't attribute partial-turn usage
      // omit it. (WP-D)
      usage?: AgentUsage;
    }
  | {
      type: "turn_canceled";
      provider: AgentProvider;
      reason: string;
      turnId?: string;
      // Spend accrued before the interrupt, when the provider can report it. See
      // the turn_failed note above. (WP-D)
      usage?: AgentUsage;
    }
  | {
      type: "timeline";
      item: AgentTimelineItem;
      provider: AgentProvider;
      turnId?: string;
      timestamp?: string;
    }
  | {
      type: "permission_requested";
      provider: AgentProvider;
      request: AgentPermissionRequest;
      turnId?: string;
    }
  | {
      type: "permission_resolved";
      provider: AgentProvider;
      requestId: string;
      resolution: AgentPermissionResponse;
      turnId?: string;
    }
  | {
      type: "attention_required";
      provider: AgentProvider;
      reason: "finished" | "error" | "permission";
      timestamp: string;
    }
  // A predicted next-user-prompt suggestion, emitted after a turn completes.
  // Transient: the app shows the latest as composer ghost text and clears it when
  // the next turn starts. Not persisted to the timeline.
  | {
      type: "prompt_suggestion";
      provider: AgentProvider;
      suggestion: string;
    }
  // Provider-reported plan rate-limit status (e.g. Claude claude.ai plan
  // windows). Transient client state: the app shows a suppressible warning
  // strip near the composer. Deduped provider-side so it only fires when the
  // meaningful fields change. Not persisted to the timeline.
  | {
      type: "rate_limit_updated";
      provider: AgentProvider;
      info: AgentRateLimitInfo;
    }
  // A provider-managed subagent's lifecycle changed. The daemon materializes it
  // as a read-only "observed subagent" agent record. See projects/observed-subagents/observed-subagents.md.
  | {
      type: "observed_subagent_updated";
      provider: AgentProvider;
      update: ObservedSubagentUpdate;
    }
  // A timeline item belonging to a provider-managed subagent, routed by the
  // daemon to the observed subagent's own timeline (keyed by `key`).
  | {
      type: "observed_subagent_timeline";
      provider: AgentProvider;
      key: string;
      item: AgentTimelineItem;
      turnId?: string;
      timestamp?: string;
    }
  // A background shell task launched by the provider's own Bash tool (Claude:
  // run_in_background) changed lifecycle state. Not an AI subagent — a plain
  // shell process the daemon tracks for the Background Tasks track.
  | {
      type: "background_shell_task_updated";
      provider: AgentProvider;
      update: BackgroundShellTaskUpdate;
    };

/**
 * A provider-managed subagent (Claude `Task` / ultracode fan-out) reported by a
 * provider so the daemon can promote it to a read-only "observed subagent".
 * `key` is a provider-local stable identifier (Claude: the Task tool_use id);
 * the daemon namespaces it under the owning agent. See projects/observed-subagents/observed-subagents.md.
 */
export interface ObservedSubagentUpdate {
  key: string;
  /** Provider task id, used to stop the subagent (Claude: `task_id`). */
  taskId?: string;
  /**
   * Key of ANOTHER observed subagent this one was spawned by (nested fan-out:
   * a subagent's own Task call, recognized from its tool_use appearing inside
   * that subagent's sidechain). The daemon parents the row to that observed
   * row instead of the owning agent, so trees render as trees. Absent = a
   * direct child of the owning agent.
   */
  parentKey?: string;
  sessionId?: string | null;
  subAgentType?: string;
  description?: string;
  status: "initializing" | "running" | "idle" | "error" | "closed";
  requiresAttention?: boolean;
  usage?: AgentUsage;
  // The model this subagent actually ran on (e.g. "claude-haiku-4-5-…"). A
  // subagent can run a DIFFERENT, cheaper model than its parent, so this is
  // required to price its usage correctly — never assume the parent's model. A
  // neutral field any provider sets; the owning provider prices it (Claude reads
  // it from the subagent's frames). Optional/additive.
  model?: string;
  // Model round-trips this subagent has made so far (cumulative, like `usage`).
  // A neutral field any provider can set; it makes the row's cumulative
  // cache-read figure legible ("622k cached · 10 rounds"). Optional/additive.
  usageRounds?: number;
  // Cumulative token total for this subagent's run so far, from the provider's
  // per-task usage (Claude: task_progress/task_notification `usage.total_tokens`,
  // which is already cumulative-per-subagent). Honest cost for the track readout.
  // See docs/agent-lifecycle.md (Item 3).
  cumulativeTokens?: number;
}

/**
 * A background shell task reported by a provider's own Bash tool (Claude:
 * `run_in_background`). `key` is a provider-local stable identifier (Claude:
 * the Bash tool_use id); the daemon namespaces it under the owning agent.
 * Unlike {@link ObservedSubagentUpdate} this has no transcript/pane — it's a
 * plain status row (command, status, elapsed) in the Background Tasks track.
 */
export interface BackgroundShellTaskUpdate {
  key: string;
  /** Provider task id, used to stop the task (Claude: `task_id`). */
  taskId?: string;
  command?: string;
  description?: string;
  status: "running" | "idle" | "error" | "closed";
  requiresAttention?: boolean;
}

export function getAgentStreamEventTurnId(event: AgentStreamEvent): string | undefined {
  return "turnId" in event ? event.turnId : undefined;
}

export type AgentPermissionRequestKind = "tool" | "plan" | "question" | "mode" | "other";

export type AgentPermissionUpdate = AgentMetadata;

export interface AgentPermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
  intent?: "implement" | "implement_resume" | "dismiss";
}

export interface AgentPermissionRequest {
  id: string;
  provider: AgentProvider;
  name: string;
  kind: AgentPermissionRequestKind;
  title?: string;
  description?: string;
  input?: AgentMetadata;
  detail?: ToolCallDetail;
  suggestions?: AgentPermissionUpdate[];
  actions?: AgentPermissionAction[];
  metadata?: AgentMetadata;
}

export type AgentPermissionResponse =
  | {
      behavior: "allow";
      selectedActionId?: string;
      updatedInput?: AgentMetadata;
      updatedPermissions?: AgentPermissionUpdate[];
    }
  | {
      behavior: "deny";
      selectedActionId?: string;
      message?: string;
      interrupt?: boolean;
    };

export interface AgentRunResult {
  sessionId: string;
  finalText: string;
  usage?: AgentUsage;
  timeline: AgentTimelineItem[];
  canceled?: boolean;
}

export interface AgentRuntimeInfo {
  provider: AgentProvider;
  sessionId: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
  extra?: AgentMetadata;
}

export type AgentSlashCommandKind = "command" | "skill";

/**
 * Represents a slash command available in an agent session.
 * Commands are executed by sending them as prompts with / prefix.
 */
export interface AgentSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: AgentSlashCommandKind;
}

export interface ListImportableSessionsOptions {
  limit?: number;
  /**
   * Optional cwd hint. Providers that can cheaply pre-filter importable
   * sessions by working directory should do so before doing expensive work.
   */
  cwd?: string;
}

export interface ImportableProviderSession {
  providerHandleId: string;
  cwd: string;
  title: string | null;
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  lastActivityAt: Date;
}

export interface ImportProviderSessionInput {
  providerHandleId: string;
  cwd: string;
}

export interface ImportProviderSessionContext {
  config: AgentSessionConfig;
  storedConfig: AgentSessionConfig;
  launchContext?: AgentLaunchContext;
}

export interface ImportedTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

export interface ImportedProviderSession {
  session: AgentSession;
  config: AgentSessionConfig;
  persistence: AgentPersistenceHandle;
  timeline: ImportedTimelineEntry[];
}

export interface AgentSessionConfig {
  provider: AgentProvider;
  cwd: string;
  /**
   * Provider-agnostic system/developer instruction string.
   * Mapped by each provider to its native instruction field.
   */
  systemPrompt?: string;
  /**
   * Daemon-level instructions appended at runtime. This is deliberately not
   * persisted into agent config so daemon setting changes apply cleanly.
   */
  daemonAppendSystemPrompt?: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  title?: string | null;
  approvalPolicy?: string;
  sandboxMode?: string;
  /**
   * Ceiling on what this session may do to its workspace: "none" | "read" |
   * "write" (absent ⇒ "write", today's behaviour). Set by graph nodes that
   * declare an access level; every adapter that advertises
   * `supportsWorkspaceAccess` narrows its own tool surface to match. See
   * agent/workspace-access.ts.
   */
  workspaceAccess?: string;
  networkAccess?: boolean;
  webSearch?: boolean;
  extra?: {
    codex?: AgentMetadata;
    claude?: Partial<ClaudeAgentOptions>;
  };
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Frozen personality resolution captured at spawn when the agent was created
   * from an Agent Personality. Everything the agent needs to keep the
   * personality's identity (spinner, voice, roles) and honor its prompt
   * composition (`respectGlobalAppendPrompt`) lives here. Editing the personality
   * later never mutates this; it only changes through an explicit
   * agent.personality.set switch (AgentManager.setAgentPersonality), which
   * re-resolves a roster personality and replaces the snapshot wholesale.
   */
  personalitySnapshot?: ResolvedPersonalitySnapshot;
  /**
   * Frozen active-team resolution captured at spawn when the spawning
   * personality was a member of the host's active Agent Team. Same lifecycle
   * as personalitySnapshot: switching or editing teams never mutates a running
   * agent — the born team is frozen identity, and a live personality switch
   * recomposes the prompt against THIS snapshot's teamPrompt, not the current
   * active team. Absent on raw spawns and non-member personality spawns.
   */
  teamSnapshot?: ResolvedTeamSnapshot;
  /**
   * Marks a run created for unattended execution (schedules, loops, artifact
   * refreshes, unattended-parent spawns — anyone passing `createAgent(...,
   * unattended: true)`). This is a creation-time signal, NOT derived from the
   * permission mode: an attended user chatting in Claude auto mode still wants
   * the prompt. The daemon's guardrail deny-responder keys off this flag to
   * auto-deny permission escalations that would otherwise stall a run nobody is
   * watching. See docs/safe-unattended.md (Phase 2).
   */
  unattended?: boolean;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   * They are used for ephemeral system tasks like commit/PR generation.
   */
  internal?: boolean;
  /**
   * Observable agents still forward their live `agent_stream` events to
   * clients even when `internal` — used for internal work a user may want to
   * watch live (e.g. artifact generation). Unlike a non-internal agent, an
   * observable-internal agent stays out of listings/sidebar (its `agent_state`
   * is still filtered); only its message/tool stream is forwarded, and only to
   * a client that has explicitly opened its timeline. Non-observable internal
   * agents (branch-name/git-metadata generators) stay fully silent.
   */
  observable?: boolean;
}

/**
 * The prompt-side half of a live personality switch, computed by the manager
 * (which owns the daemon-global append text) and applied wholesale by the
 * provider session. All three fields are absolute new values, not patches —
 * `undefined` means "clear". Clearing the personality passes all-undefined
 * except a restored `daemonAppendSystemPrompt`.
 */
export interface AgentPersonalityUpdate {
  personalitySnapshot: ResolvedPersonalitySnapshot | undefined;
  systemPrompt: string | undefined;
  daemonAppendSystemPrompt: string | undefined;
}

/**
 * Fully-resolved daemon-wide agent behavior toggles (Claude is the reference
 * tier). Every field is a concrete boolean — the daemon config carries these
 * as optional-with-default, and the manager resolves "absent/undefined = on"
 * before handing them to a session. Providers that cannot honor a given
 * behavior simply ignore it (no-op, no error) per the provider-parity rule.
 * See docs and projects/token-cost-fixes/wp-e-behavior-toggles.md.
 */
export interface AgentBehaviorSettings {
  /** Emit predicted next-user-prompt suggestions after each turn (Claude). */
  promptSuggestions: boolean;
  /** Emit periodic AI progress summaries for observed subagents (Claude). */
  agentProgressSummaries: boolean;
  /** Default for agent-to-agent create/send finish notifications (Otto tools). */
  notifyOnFinishDefault: boolean;
}

export interface AgentLaunchContext {
  agentId?: string;
  env?: Record<string, string>;
  /**
   * Runtime-only internal Otto tools. This must never be persisted into
   * AgentSessionConfig; providers may adapt it to their native tool surface.
   */
  ottoTools?: OttoToolCatalog;
  /**
   * Resolved daemon-wide behavior toggles for this launch. Runtime-only (never
   * persisted); providers that don't support a behavior ignore it.
   */
  agentBehaviors?: AgentBehaviorSettings;
}

export interface AgentCreateSessionOptions {
  /**
   * Whether the provider should leave a durable native session behind.
   * Defaults to true. Providers that cannot honor false should no-op.
   */
  persistSession?: boolean;
}

/**
 * Returned by respondToPermission when the permission resolution requires
 * a follow-up turn (e.g. Codex plan approval → implementation).
 */
export interface AgentPermissionResult {
  followUpPrompt?: AgentPromptInput;
}

export interface AgentSession {
  readonly provider: AgentProvider;
  readonly id: string | null;
  readonly capabilities: AgentCapabilityFlags;
  readonly features?: AgentFeature[];
  run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
  startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{ turnId: string }>;
  subscribe(callback: (event: AgentStreamEvent) => void): () => void;
  streamHistory(): AsyncGenerator<AgentStreamEvent>;
  getRuntimeInfo(): Promise<AgentRuntimeInfo>;
  getAvailableModes(): Promise<AgentMode[]>;
  getCurrentMode(): Promise<string | null>;
  setMode(modeId: string): Promise<void | AgentProviderNotice>;
  getPendingPermissions(): AgentPermissionRequest[];
  respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void>;
  describePersistence(): AgentPersistenceHandle | null;
  interrupt(): Promise<void>;
  /**
   * Stop a provider-managed subagent task by its provider task id (Claude:
   * `query.stopTask`). Present only on providers that surface observed
   * subagents. See projects/observed-subagents/observed-subagents.md.
   */
  stopTask?(taskId: string): Promise<void>;
  close(): Promise<void>;
  listCommands?(): Promise<AgentSlashCommand[]>;
  /**
   * Per-category context window breakdown (system prompt, tools, messages, …).
   * Resolves null when the provider has no live handle to report from.
   */
  getContextUsage?(): Promise<AgentContextUsage | null>;
  setModel?(modelId: string | null): Promise<void>;
  setThinkingOption?(thinkingOptionId: string | null): Promise<void | AgentProviderNotice>;
  setFeature?(featureId: string, value: unknown): Promise<void>;
  /**
   * Live-switch the session's personality prompt fields (see
   * AgentPersonalityUpdate). Present only on providers that can apply a new
   * system prompt to a running conversation — Claude recreates its query on the
   * next turn, openai-compat rebuilds its leading system message. Brain fields
   * (model/mode/effort) are applied separately via the existing setters; the
   * manager sequences both halves. Absence ⇒ the manager rejects
   * agent.personality.set for this provider.
   */
  applyPersonality?(update: AgentPersonalityUpdate): Promise<void | AgentProviderNotice>;
  /**
   * Apply updated provider-level compaction defaults to a live session
   * (providers whose conversation the daemon owns). Returns true when the
   * effective settings changed so the manager knows to re-emit agent state.
   */
  applyCompactionConfig?(compaction: ProviderCompactionConfig | null): boolean;
  /**
   * Apply the updated provider-level max-tool-rounds override to a live session
   * (providers whose tool loop the daemon owns). Returns true when the effective
   * bound changed so the manager knows to re-emit agent state.
   */
  applyMaxToolRounds?(maxToolRounds: number | null): boolean;
  revertConversation?(input: { messageId: string }): Promise<void>;
  revertFiles?(input: { messageId: string }): Promise<void>;
  revertBoth?(input: { messageId: string }): Promise<void>;
  /**
   * Out-of-band prompt handler. When non-null, the manager runs the returned
   * handler instead of allocating a turn. The handler emits stream events
   * directly via the provided `emit` callback, which routes through the
   * manager's persistence + broadcast pipeline. The active foreground turn
   * (if any) is left untouched, so this is how mid-turn side-effect commands
   * (e.g. /goal pause) reach the provider without canceling the running turn.
   */
  tryHandleOutOfBand?(prompt: AgentPromptInput): {
    run(ctx: { emit: (event: AgentStreamEvent) => void }): Promise<void>;
  } | null;
}

/**
 * Input for a one-shot, tool-less text completion used by the internal
 * metadata-generation path (chat titles, branch/workspace names, commit/PR
 * text, voice cues, run summaries). The prompt is fully self-contained — it
 * carries its own contract and JSON-schema instructions and explicitly forbids
 * tool use — so this deliberately bypasses the full agent session: no Otto tool
 * catalog, no MCP mount, and (on Claude) no `claude_code` preset or
 * CLAUDE.md/settingSources. That is the whole point: a title costs a few
 * hundred tokens instead of the 15–25K a full spawn carries.
 */
export interface AgentBareCompletionOptions {
  cwd: string;
  prompt: string;
  model?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * Result of a tool-less metadata generation (WP-G). `text` is the completion the
 * callers consume; `usage` is the spend the provider reported for the call, so
 * the manager can record it into the activity ledger under the "generations"
 * cost category — these bare completions bypass the turn path entirely (WP-B),
 * so without capturing usage here their spend is invisible to accounting.
 * Providers that cannot report usage omit it (tokens simply go uncounted, never
 * erroring).
 */
export interface AgentBareCompletionResult {
  text: string;
  usage?: AgentUsage;
}

export type FetchCatalogOptions =
  | {
      scope: "global";
      force: boolean;
      timeoutMs?: number;
    }
  | {
      scope: "workspace";
      cwd: string;
      force: boolean;
      timeoutMs?: number;
    };

export interface ProviderCatalog {
  models: AgentModelDefinition[];
  modes: AgentMode[];
}

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;
  createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession>;
  resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession>;
  /**
   * Discover models and modes together. Implementations may use one upstream
   * process, separate upstream calls, static modes, or private helpers; callers
   * outside the provider do not get separate runtime model/mode probes.
   * The registry is responsible for merging configured model overrides.
   */
  fetchCatalog(options: FetchCatalogOptions): Promise<ProviderCatalog>;
  /**
   * One-shot, tool-less structured-text completion for internal metadata
   * generation. Bypasses `createSession` entirely — no agent lifecycle, no tool
   * catalog, no MCP, no `claude_code` preset/CLAUDE.md. Providers that cannot do
   * a tool-less completion omit this; the generation fallback ladder then skips
   * them without erroring (parity is preserved by falling through, not by
   * forcing every provider to implement it). See AgentBareCompletionOptions.
   */
  generateBareCompletion?(options: AgentBareCompletionOptions): Promise<AgentBareCompletionResult>;
  resolveCreateConfig?(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
  isCreateConfigUnattended?(input: AgentCreateConfigUnattendedInput): boolean;
  listCommands?(config: AgentSessionConfig): Promise<AgentSlashCommand[]>;
  listFeatures?(config: AgentSessionConfig): Promise<AgentFeature[]>;
  listImportableSessions?(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]>;
  importSession?(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ): Promise<ImportedProviderSession>;
  /**
   * Check if this provider is available (CLI binary is installed).
   * Returns true if available, false otherwise.
   */
  isAvailable(): Promise<boolean>;
  getDiagnostic?(): Promise<{ diagnostic: string }>;
  /**
   * Archive a persisted session in the native provider (best-effort).
   * Called when Otto archives an agent so the provider's own UI reflects the same state.
   */
  archiveNativeSession?(handle: AgentPersistenceHandle): Promise<void>;
  /**
   * Unarchive a persisted session in the native provider.
   * Called before Otto clears its archived flag so provider resume can succeed.
   */
  unarchiveNativeSession?(handle: AgentPersistenceHandle): Promise<void>;
  /**
   * Release any provider-owned resources held by this client (background
   * processes, sockets, cached subprocesses, etc.). Called when the daemon
   * shuts down. Must be idempotent.
   */
  shutdown?(): Promise<void>;
}
