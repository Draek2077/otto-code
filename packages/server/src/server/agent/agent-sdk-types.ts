import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProviderNotice } from "@otto-code/protocol/agent-types";
import type { AgentAttachment, AgentContextUsage } from "@otto-code/protocol/messages";
import type { ProviderCompactionConfig } from "@otto-code/protocol/provider-config";
import type { OttoToolCatalog } from "./tools/types.js";
// Type-only import — erased at compile time, so the resolver ⇄ config-types
// cycle never exists at runtime.
import type { ResolvedPersonalitySnapshot } from "./agent-personalities.js";
import type { ResolvedTeamSnapshot } from "./agent-teams.js";

export type { AgentProviderNotice };
export type { AgentContextUsage };

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

export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
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
    }
  | { type: "turn_canceled"; provider: AgentProvider; reason: string; turnId?: string }
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
  sessionId?: string | null;
  subAgentType?: string;
  description?: string;
  status: "initializing" | "running" | "idle" | "error" | "closed";
  requiresAttention?: boolean;
  usage?: AgentUsage;
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

export interface AgentLaunchContext {
  agentId?: string;
  env?: Record<string, string>;
  /**
   * Runtime-only internal Otto tools. This must never be persisted into
   * AgentSessionConfig; providers may adapt it to their native tool surface.
   */
  ottoTools?: OttoToolCatalog;
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
