import type { AgentAttachment } from "./messages.js";

export type AgentProvider = string;

export interface AgentMetadata {
  [key: string]: unknown;
}

export type AgentProviderNotice =
  | { type: "info"; message: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

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
}

export type ProviderStatus = "ready" | "loading" | "error" | "unavailable";

/**
 * A model's capability tier, used to bind personality "brains" provider-
 * agnostically (deep = flagship reasoning, standard = everyday, fast = cheap/
 * high-volume). Assigned by the daemon at ingest (catalog → name pattern), with
 * a user per-model override winning; see model-tiers.ts.
 */
export type ModelTier = "deep" | "standard" | "fast";

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
   * Capability tier, stamped by the daemon when it ingests the provider's model
   * list. Optional: absent from old daemons, and from models we can't classify
   * and the user hasn't tagged. Consumers fall back to their own inference.
   */
  tier?: ModelTier;
  /**
   * False when this model cannot run the provider's "auto" permission mode
   * (e.g. Claude's classifier-based Auto mode is unsupported on Haiku). Absent
   * = supported or unknown (including old daemons); clients only hide the Auto
   * option on an explicit false.
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
  source?: "builtin" | "custom";
  error?: string;
  models?: AgentModelDefinition[];
  modes?: AgentMode[];
  fetchedAt?: string;
  label?: string;
  description?: string;
  defaultModeId?: string | null;
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
}

/**
 * How the tokens currently occupying an agent's context window break down by
 * origin. Powers the visualizer's context ring/bar colored segments (the same
 * five categories the vendored render layer draws). Every field is optional and
 * a token count: a provider fills as many categories as it can attribute and
 * omits the rest, so richness degrades gracefully per provider - Claude
 * attributes the most; a provider that can attribute nothing omits the whole
 * object and consumers fall back to occupancy-only (no colored segments, the
 * pre-composition behavior). Counts are best-effort estimates, not billed usage;
 * they need not sum exactly to `contextWindowUsedTokens` (the consumer scales).
 */
export interface ContextComposition {
  /** System prompt + tool/function definitions - the fixed base cost. */
  systemPrompt?: number;
  /** User-authored input messages. */
  userMessages?: number;
  /** Tool results - file contents, search output, command output (usually the
   * largest and most volatile category). */
  toolResults?: number;
  /** The agent's own reasoning / thinking blocks. */
  reasoning?: number;
  /** Content returned by child / observed sub-agents. */
  subagentResults?: number;
}

/**
 * One provider-reported context-window category. `name` is a provider-supplied
 * *display label* ("Messages", "System prompt", "MCP tools") - deliberately an
 * OPEN-ENDED string and not an enum, so each provider reports the split it
 * actually has instead of being squeezed into categories it can't populate.
 *
 * Structurally identical to `AgentContextUsageCategory` on the pull path
 * (`agent.context.get_usage`, see messages.ts) *by design*: the two carry the
 * same accounting, one pushed on the agent snapshot and one pulled on demand.
 * Keep them in sync - a divergence here is how the context meter and the
 * visualizer would start disagreeing about the same agent.
 */
export interface AgentContextCategory {
  name: string;
  tokens: number;
  /** Deferred content (e.g. on-demand tool schemas) is not counted in the total. */
  isDeferred?: boolean;
}

export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  /**
   * Prompt tokens spent writing (not reading) the prompt cache this turn -
   * Anthropic's `cache_creation_input_tokens`, billed above normal input.
   * Disjoint from `inputTokens`/`cachedInputTokens`. Claude-specific today;
   * other providers omit it. Optional/additive.
   */
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
  /**
   * Best-effort breakdown of what fills the context window, by origin. Optional
   * and provider-graded (see {@link ContextComposition}); absent ⇒ the consumer
   * shows occupancy only. Added for the visualizer context ring/bar.
   */
  contextComposition?: ContextComposition;
  /**
   * The provider's OWN context-window split, with its own labels - the same
   * accounting the `agent.context.get_usage` RPC returns, pushed here on the
   * agent snapshot so stream/backfill consumers (the visualizer) read the very
   * numbers the context meter shows rather than a parallel estimate.
   *
   * Preferred over {@link ContextComposition} wherever present. The estimate
   * remains the coarse tier for providers that can't report a real split;
   * absence of both ⇒ occupancy only. Optional/additive: absence is the
   * graceful-degrade signal, so no capability flag is needed.
   */
  contextCategories?: AgentContextCategory[];
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
  // COMPAT(compactionFailedStatus): "failed" added in v0.4.3; see messages.ts.
  status: "loading" | "completed" | "failed";
  trigger?: "auto" | "manual";
  preTokens?: number;
  postTokens?: number;
}

export type AgentTimelineItem =
  | { type: "user_message"; text: string; messageId?: string; clientMessageId?: string }
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
  // run_in_background) changed lifecycle state. Not an AI subagent - a plain
  // shell process the daemon tracks for the Background Tasks track.
  | {
      type: "background_shell_task_updated";
      provider: AgentProvider;
      update: BackgroundShellTaskUpdate;
    };

export function getAgentStreamEventTurnId(event: AgentStreamEvent): string | undefined {
  return "turnId" in event ? event.turnId : undefined;
}

/**
 * A provider-managed subagent (Claude `Task` / ultracode fan-out) reported by a
 * provider so the daemon can promote it to a read-only, separately-watchable
 * "observed subagent". `key` is a provider-local stable identifier (Claude: the
 * Task tool_use id); the daemon namespaces it under the owning agent. See
 * projects/observed-subagents/observed-subagents.md.
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
  /**
   * True once this run is known to outlive an interrupt of the parent's turn -
   * the provider backgrounded it, so the parent's teardown does not take it
   * down. Sticky: the daemon keeps it set for the row's whole life, and
   * propagates it to nested rows (a child of a backgrounded run survives too).
   * Absent ⇒ foreground, i.e. the run dies with the turn that spawned it.
   *
   * Claude sets it for Workflow orchestration runs (always backgrounded) and
   * for a Task/Agent whose tool_result turned out to be a launch ack rather
   * than a final report. See docs/chat-lifecycle.md.
   */
  backgrounded?: boolean;
  /**
   * Tool invocations this subagent has made so far (cumulative). Neutral field
   * any provider can set; kept monotonic by the daemon so a status-only final
   * update can't drop the readout. Claude reads it from the SDK's per-task
   * `usage.tool_uses`. Absent ⇒ the row shows no count.
   */
  toolUseCount?: number;
  /**
   * The tool this subagent is running (or ran last) - the "spinning _on a 90s
   * Bash_" signal. Neutral field any provider can set; unlike the counters it is
   * NOT monotonic (latest wins) and the daemon drops it once the row goes
   * terminal. Claude reads it from `task_progress.last_tool_name`. Absent ⇒ the
   * row omits it; never guess a value.
   */
  currentTool?: string;
}

/**
 * A background shell task reported by a provider's own Bash tool (Claude:
 * `run_in_background`). `key` is a provider-local stable identifier (Claude:
 * the Bash tool_use id); the daemon namespaces it under the owning agent.
 * Unlike {@link ObservedSubagentUpdate} this has no transcript/pane - it's a
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
  usage?: AgentUsage;
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

// ── Workspace access ────────────────────────────────────────────────────────
// How much of its workspace one agent session may touch. Provider-neutral by
// intent: each adapter maps it onto whatever its own runtime enforces, and a
// provider that cannot enforce it must say so (AgentCapabilities) rather than
// accept the setting and ignore it.
//
// This is a *boundary*, not an instruction. "read" means the write tools are
// not offered, so there is no write to make - never a line of prompt asking the
// model to behave. A control a user relies on when deciding to run something
// unattended has to be true in exactly the cases where the model is confused.
export const WORKSPACE_ACCESS_LEVELS = ["none", "read", "write"] as const;
export type WorkspaceAccess = (typeof WORKSPACE_ACCESS_LEVELS)[number];

export function isWorkspaceAccess(value: unknown): value is WorkspaceAccess {
  return value === "none" || value === "read" || value === "write";
}

export interface AgentSessionConfig {
  provider: AgentProvider;
  cwd: string;
  /**
   * Provider-agnostic system/developer instruction string.
   * Mapped by each provider to its native instruction field.
   */
  systemPrompt?: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  title?: string | null;
  approvalPolicy?: string;
  sandboxMode?: string;
  /**
   * Ceiling on what this session may do to its workspace (see
   * WORKSPACE_ACCESS_LEVELS). Absent ⇒ "write", today's behaviour. Set by graph
   * nodes that declare an access level; each provider adapter narrows its own
   * tool surface to match.
   */
  workspaceAccess?: string;
  networkAccess?: boolean;
  webSearch?: boolean;
  extra?: {
    codex?: AgentMetadata;
    claude?: AgentMetadata;
  };
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   * They are used for ephemeral system tasks like commit/PR generation.
   */
  internal?: boolean;
}

export interface AgentRuntimeInfo {
  provider: AgentProvider;
  sessionId: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
  extra?: AgentMetadata;
}
