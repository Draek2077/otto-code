import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@otto-code/protocol/agent-lifecycle";
import {
  getParentAgentIdFromLabels,
  isDelegatedAgent,
  PARENT_AGENT_ID_LABEL,
} from "@otto-code/protocol/agent-labels";
import {
  normalizePersonalityRoles,
  OTTO_WORK_VOCABULARY_DIRECTIVE,
} from "@otto-code/protocol/agent-profiles";
import type { ResolvedProfileSnapshot } from "./agent-profiles.js";
import { composeTeamAndPersonalityPrompt } from "./agent-teams.js";
import { deltaAgentUsage } from "./subagent-usage.js";
import { normalizeWidgetTimelineItem } from "../widget/widget-timeline.js";
import {
  accumulateLifetimeUsage,
  toTurnSpend,
  type AgentLifetimeUsage,
  type TurnUsageWatermark,
} from "./turn-usage.js";
import type {
  ProviderActionBreakerConfig,
  ProviderCompactionConfig,
} from "@otto-code/protocol/provider-config";
import {
  STALL_GUARD_DEFAULT_THRESHOLD,
  STALL_GUARD_MAX_THRESHOLD,
  STALL_GUARD_MIN_THRESHOLD,
} from "@otto-code/protocol/provider-config";
import type { Logger } from "pino";
import { z } from "zod";
import type { TerminalManager } from "../../terminal/terminal-manager.js";

import {
  getAgentStreamEventTurnId,
  type AgentBareCompletionOptions,
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentBehaviorSettings,
  type AgentCreateSessionOptions,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentSlashCommand,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentPersistenceHandle,
  type AgentPersonalityUpdate,
  type AgentProviderNotice,
  type AgentPromptInput,
  type AgentProvider,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentSession,
  type AgentSessionConfig,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type ToolCallTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
  type ImportedTimelineEntry,
  type ImportableProviderSession,
  type ListImportableSessionsOptions,
  type ObservedSubagentUpdate,
  type BackgroundShellTaskUpdate,
} from "./agent-sdk-types.js";
import type {
  AgentSnapshotPayload,
  BackgroundShellTaskInfo,
  SuggestedTaskInfo,
  SuggestedTaskState,
  TasksSuggestedStartMode,
} from "../messages.js";
import {
  deriveObservedSubagentTitle,
  observedUpdateHasTitleSource,
  toAgentPayload,
  toObservedSubagentPayload,
} from "./agent-projections.js";
import type {
  RetainedTranscriptOwner,
  RetainedTranscriptStore,
} from "./retained-transcript-store.js";
import { RetainedTimelineResidency } from "./retained-timeline-residency.js";
import { buildArchivedAgentRecord, type ArchivedStoredAgentRecord } from "./agent-archive.js";
import type { StoredAgentRecord, AgentStorage } from "./agent-storage.js";
import type {
  ActivityCounterField,
  ActivityIncrementFn,
} from "../activity-stats/activity-stats-store.js";
import type { UsageEvent } from "@otto-code/protocol/messages";
import {
  InMemoryAgentTimelineStore,
  type SeedAgentTimelineOptions,
} from "./agent-timeline-store.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";
import { estimateContextComposition } from "./context-composition.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";
import {
  AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
  AgentStreamCoalescer,
} from "./agent-stream-coalescer.js";
import {
  AgentRunState,
  type ForegroundTurnWaiter,
  type PendingForegroundRun,
} from "./agent-run-state.js";
import {
  createSteerQueueEntry,
  mergeSteerQueueBatch,
  moveSteerQueueEntry,
  takeNextSteerQueueBatch,
  type SteerQueueEntry,
} from "./steer-queue-state.js";
import { getAgentProviderDefinition } from "@otto-code/protocol/provider-manifest";
import { resolveModelPickExitModeId } from "./model-pick-mode.js";
import { invokeRewindCapability, type RewindMode } from "./rewind/rewind.js";
import { formatSystemNotificationPrompt, isSystemInjectedEnvelope } from "./agent-prompt.js";
import { normalizeClientMessageId } from "../client-message-id.js";
import {
  appendTodoNudgeToPrompt,
  buildTodoReconcileMessage,
  findLatestTodoItem,
  isStaleTodoList,
  stripTrailingTodoNudge,
  todoListSignature,
} from "./todo-reminders.js";
import {
  buildStallInterruptMessage,
  classifyTimelineItem,
  createStallGuardState,
  hasStalled,
  latchStallGuard,
  observeStallSignal,
  type StallGuardState,
} from "./agent-stall-guard.js";
import { unwrapSpokenInput } from "../voice-config.js";
import { stripInternalOttoMcpServer, withRuntimeOttoMcpServer } from "./runtime-mcp-config.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import type { OttoToolCatalogFactory } from "./tools/types.js";
import type { AgentOwner } from "./agent-owner.js";
import {
  ProviderSubagentStore,
  type ProviderSubagentDescriptor,
  type ProviderSubagentStoreEvent,
} from "./provider-subagents/store.js";

const RELOAD_SESSION_CLOSE_TIMEOUT_MS = 3_000;
const INTERRUPT_SESSION_TIMEOUT_MS = 2_000;
// Bound at module load so it survives a later vi.useFakeTimers(): close yields one
// event-loop turn, and a faked setImmediate never fires unless the test advances
// timers - which it cannot, because it is awaiting the close that is doing the
// yielding. Capturing the real one keeps the yield honest under both clocks.
const yieldEventLoopTurn = setImmediate;
const STORED_AGENT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

type TimeoutResult = "completed" | "timed_out";

export class AgentRunCancellationError extends Error {
  constructor(agentId: string, action: "reload" | "replace" | "rewind" | "stop") {
    super(
      `Cannot ${action} agent ${agentId} because its active run cancellation was not acknowledged`,
    );
    this.name = "AgentRunCancellationError";
  }
}

export type AgentRunCancellationResult =
  | { status: "not_running" }
  | { status: "settled" }
  | { status: "refused" };

export class AgentManagerShuttingDownError extends Error {
  constructor() {
    super("Agent manager is shutting down");
    this.name = "AgentManagerShuttingDownError";
  }
}

interface PreparedSessionConfig {
  storedConfig: AgentSessionConfig;
  launchConfig: AgentSessionConfig;
}

interface NormalizeConfigOptions {
  resolveDefaultModel?: boolean;
  /**
   * Launch env, passed on to the provider's `resolveDefaultModeId`. Some
   * providers pick a different default mode depending on how they are hosted
   * (Claude on Bedrock, for instance), which the static manifest cannot express.
   */
  env?: Record<string, string>;
}

interface TimeoutOptions {
  operation: Promise<void>;
  timeoutMs: number;
  onLateError?: (error: unknown) => void;
}

function formatProviderList(providers: readonly string[]): string {
  return providers.length > 0 ? providers.join(", ") : "none";
}

// Resolve the daemon-wide behavior toggles from their optional config shape.
// Mirrors the persist-layer rule (daemon-config-store.readAgentBehaviors): a
// field is on unless it is explicitly `false`, so absent/undefined preserves
// today's all-on behavior.
function resolveAgentBehaviorSettings(
  behaviors:
    | {
        promptSuggestions?: boolean;
        agentProgressSummaries?: boolean;
        notifyOnFinishDefault?: boolean;
        todoNudge?: boolean;
        todoReconcileOnIdle?: boolean;
        stallGuardThreshold?: number;
      }
    | undefined,
): AgentBehaviorSettings {
  return {
    promptSuggestions: behaviors?.promptSuggestions !== false,
    agentProgressSummaries: behaviors?.agentProgressSummaries !== false,
    notifyOnFinishDefault: behaviors?.notifyOnFinishDefault !== false,
    todoNudge: behaviors?.todoNudge !== false,
    todoReconcileOnIdle: behaviors?.todoReconcileOnIdle !== false,
    stallGuardThreshold: resolveStallGuardThreshold(behaviors?.stallGuardThreshold),
  };
}

/**
 * Clamp the stall-guard threshold into [MIN, MAX], keeping 0 (disabled) as an
 * explicit escape hatch. A hand-edited config can turn the guard off outright
 * but cannot set it to a hair trigger. Missing or non-finite values fall back
 * to the default rather than silently disabling the guard.
 */
function resolveStallGuardThreshold(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STALL_GUARD_DEFAULT_THRESHOLD;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return 0;
  }
  return Math.min(STALL_GUARD_MAX_THRESHOLD, Math.max(STALL_GUARD_MIN_THRESHOLD, rounded));
}

function buildStoredAgentConfig(record: StoredAgentRecord): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider: record.provider,
    cwd: record.cwd,
  };
  if (!record.config) {
    return config;
  }
  if (record.config.modeId != null) config.modeId = record.config.modeId;
  if (record.config.model != null) config.model = record.config.model;
  if (record.config.thinkingOptionId != null) {
    config.thinkingOptionId = record.config.thinkingOptionId;
  }
  if (record.config.featureValues != null) {
    config.featureValues = record.config.featureValues;
  }
  if (record.config.extra != null) config.extra = record.config.extra;
  if (record.config.systemPrompt != null) {
    config.systemPrompt = record.config.systemPrompt;
  }
  if (record.config.mcpServers != null) config.mcpServers = record.config.mcpServers;
  if (record.config.profileSnapshot != null) {
    // Storage keeps roles as a loose string array; normalize back to the known
    // PersonalityRole set on the way in.
    config.profileSnapshot = {
      ...record.config.profileSnapshot,
      roles: normalizePersonalityRoles(record.config.profileSnapshot.roles),
    };
  }
  if (record.config.teamSnapshot != null) {
    config.teamSnapshot = record.config.teamSnapshot;
  }
  return stripInternalOttoMcpServer(config);
}

export { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus };
export type {
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineWindow,
} from "./agent-timeline-store-types.js";

export type AgentManagerEvent =
  | { type: "agent_state"; agent: ManagedAgent }
  // A synthetic snapshot for an observed subagent (no ManagedAgent runtime).
  // Forwarded to clients like a normal agent update. See projects/observed-subagents/observed-subagents.md.
  | { type: "observed_agent_state"; payload: AgentSnapshotPayload }
  // Paseo's provider-reported subagents. Distinct from Otto's observed
  // subagents above: those are registry projections Otto synthesizes, these are
  // the provider telling us about children it spawned itself.
  | { type: "provider_subagent"; event: ProviderSubagentStoreEvent }
  // The full current set of background shell tasks for a parent agent
  // changed. Not Agent-shaped - forwarded to clients as background_shell_tasks_changed.
  | {
      type: "background_shell_task_state";
      parentAgentId: string;
      tasks: BackgroundShellTaskInfo[];
    }
  // The full current set of pending suggested tasks for a parent agent changed
  // (spawn/start/dismiss). Not Agent-shaped - forwarded to clients as
  // suggested_tasks_changed.
  | {
      type: "suggested_task_state";
      parentAgentId: string;
      tasks: SuggestedTaskInfo[];
    }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEvent;
      seq?: number;
      epoch?: string;
      timestamp?: string;
    };

export type AgentSubscriber = (event: AgentManagerEvent) => void;

export interface SubscribeOptions {
  agentId?: string;
  replayState?: boolean;
}

interface HydrateTimelineOptions {
  force?: boolean;
  /**
   * A thunk when the answer can still change: a second loader can ask for the
   * timeline to be broadcast while history is already streaming, and it upgrades
   * the shared options the running hydration reads. A plain boolean pins the
   * value taken before that upgrade, so the running hydration never saw it.
   */
  broadcast?: boolean | (() => boolean);
}

function shouldBroadcastHydration(broadcast: HydrateTimelineOptions["broadcast"]): boolean {
  return typeof broadcast === "function" ? broadcast() : broadcast === true;
}

export type ImportablePersistedAgentQueryOptions = ListImportableSessionsOptions & {
  /**
   * When set, only providers in this set are scanned, in addition to the
   * built-in importable allowlist + enabled + non-derived rules.
   */
  providerFilter?: Set<string>;
};

export interface ManagedImportableProviderSession extends ImportableProviderSession {
  provider: AgentProvider;
}

export type AgentAttentionCallback = (params: {
  agentId: string;
  provider: AgentProvider;
  reason: "finished" | "error" | "permission";
}) => void;

/** `/compact` only changes the conversation's internal context. It is not an
 * assistant reply and must not create an unread/notification completion. */
function isCompactCommand(prompt: AgentPromptInput): boolean {
  return typeof prompt === "string" && /^\/compact(?:\s|$)/i.test(prompt.trim());
}

export type AgentArchivedCallback = (agentId: string) => Promise<void> | void;

export interface ProviderAvailability {
  provider: AgentProvider;
  available: boolean;
  error: string | null;
}

interface AgentManagerRescueTimeouts {
  reloadSessionCloseMs?: number;
  interruptSessionMs?: number;
}

interface ProviderEnabledFlag {
  enabled: boolean;
  derivedFromProviderId?: string | null;
  /**
   * Provider-level compaction config for daemon-hosted conversations.
   * Undefined = caller didn't resolve it (leave live sessions untouched);
   * null = resolved as unset.
   */
  compaction?: ProviderCompactionConfig | null;
  /**
   * Provider-level max-tool-rounds override for daemon-hosted providers.
   * Undefined = caller didn't resolve it (leave live sessions untouched);
   * null = resolved as unset (built-in default).
   */
  maxToolRounds?: number | null;
  /**
   * Provider-level action circuit-breaker config for daemon-hosted providers.
   * Undefined = caller didn't resolve it (leave live sessions untouched);
   * null = resolved as unset (disabled).
   */
  actionBreaker?: ProviderActionBreakerConfig | null;
}
type ProviderEnabledMap = Partial<Record<AgentProvider, ProviderEnabledFlag>>;
type ProviderClientMap = Partial<Record<AgentProvider, AgentClient>>;

export interface CreateAgentOptions {
  labels?: Record<string, string>;
  initialPrompt?: string;
  env?: Record<string, string>;
  persistSession?: boolean;
  initialTitle?: string | null;
  // undefined is an explicit decision: the agent never appears in the sidebar.
  workspaceId: string | undefined;
  owner?: AgentOwner;
}

export interface AgentManagerOptions {
  clients?: ProviderClientMap;
  providerDefinitions?: ProviderEnabledMap;
  idFactory?: () => string;
  registry?: AgentStorage;
  onAgentAttention?: AgentAttentionCallback;
  /**
   * True when a connected client reports it is looking straight at this agent.
   * Attention is an unread signal, so it is never raised for a chat somebody
   * already has open; otherwise the badge flashes on and is cleared a round trip
   * later. Wired to live client presence in bootstrap. Absent means "nobody is
   * watching", which preserves the old always-raise behaviour.
   */
  isAgentActivelyWatched?: (agentId: string) => boolean;
  onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  /**
   * Fires once per agent spawned with a bound personality (fire-and-forget
   * usage telemetry). Lives at the createAgent choke point so composer, MCP
   * create_chat, and scheduled chat starts all count.
   */
  onPersonalitySpawn?: (personalityId: string) => void;
  /**
   * Resolves a personality's accrued lessons into the brief injected at spawn,
   * or null when there is nothing to inject (no lessons, switch off, feature
   * unwired). Called from prepareSessionConfig - the one point every spawn,
   * resume and refresh path already funnels through - so memory is re-read on
   * every resume and no caller has to thread it.
   * See docs/agent-personalities.md § Memory (Injection).
   */
  resolvePersonalityMemoryBrief?: (params: {
    personalityId: string;
    personalityName: string;
    cwd: string | undefined;
  }) => Promise<string | null>;
  /**
   * Resolves the compact active-page project knowledge catalog. Called from the
   * shared spawn/resume/refresh choke point so every provider discovers the
   * same repository knowledge before its first task turn.
   */
  resolveProjectKnowledgeBrief?: (params: { cwd: string | undefined }) => Promise<string | null>;
  /**
   * Resolves the workspace's `AGENTS.md` chain (with its `@import` graph
   * inlined) into prompt-ready text, for providers whose request Otto composes
   * itself. Injected rather than done inline because resolving the project root
   * is a git question, and the agent manager has no business asking it.
   */
  resolveInstructionFiles?: (params: { cwd: string | undefined }) => Promise<string | null>;
  /** Fun-stats counters - see packages/server/src/server/activity-stats. */
  onActivity?: ActivityIncrementFn;
  /**
   * Itemized usage ledger row for one token/cost-bearing activity (usage-ledger
   * project). Emitted from the same chokepoint as {@link onActivity}: the counters
   * are the rollup of this event stream. Fire-and-forget.
   */
  onUsageEvent?: (event: UsageEvent) => void;
  durableTimelineStore?: AgentTimelineStore;
  retainedTranscripts?: RetainedTranscriptStore;
  terminalManager?: TerminalManager | null;
  mcpBaseUrl?: string;
  mcpAuthToken?: string;
  ottoToolsEnabled?: boolean;
  ottoToolCatalogFactory?: OttoToolCatalogFactory;
  appendSystemPrompt?: string;
  /**
   * Initial daemon-wide agent behavior toggles (undefined fields = on). Hot
   * reloaded via setAgentBehaviors from the daemon config store.
   */
  agentBehaviors?: {
    promptSuggestions?: boolean;
    agentProgressSummaries?: boolean;
    notifyOnFinishDefault?: boolean;
    todoNudge?: boolean;
    todoReconcileOnIdle?: boolean;
    stallGuardThreshold?: number;
  };
  agentStreamCoalesceWindowMs?: number;
  rescueTimeouts?: AgentManagerRescueTimeouts;
  logger: Logger;
}

export interface WaitForAgentOptions {
  signal?: AbortSignal;
  waitForActive?: boolean;
}

export interface WaitForAgentResult {
  status: AgentLifecycleStatus;
  permission: AgentPermissionRequest | null;
  lastMessage: string | null;
}

export interface WaitForAgentStartOptions {
  signal?: AbortSignal;
}

type AttentionState =
  | { requiresAttention: false }
  | {
      requiresAttention: true;
      attentionReason: "finished" | "error" | "permission";
      attentionTimestamp: Date;
    };

function resolveInitialAttention(input: AttentionState | undefined): AttentionState {
  if (input == null || !input.requiresAttention) {
    return { requiresAttention: false };
  }
  return {
    requiresAttention: true,
    attentionReason: input.attentionReason,
    attentionTimestamp: new Date(input.attentionTimestamp),
  };
}

interface ObservedSubagentDerivedState {
  title: string;
  titleFrozen: boolean;
  cumulativeTokens?: number;
  // Latest full usage split (in/out/cache) reported for this subagent. Carried
  // forward when a later update omits it (e.g. a run-state reconcile that only
  // refreshes the scalar total) so the ledger never loses the real breakdown.
  lastUsage?: AgentUsage;
  // The subagent's own model (may differ from the parent's). Sticky once seen.
  model?: string;
  // Cumulative model round-trips reported for this subagent; monotonic like
  // cumulativeTokens so a final update without it can't drop the count.
  usageRounds?: number;
  // Tool invocations so far; monotonic like cumulativeTokens.
  toolUseCount?: number;
  // The tool the subagent is running (or ran last). Deliberately NOT monotonic:
  // it tracks the LATEST tool, sticks when an update omits it (so a scalar-only
  // progress update doesn't blank it), and is dropped by the projection once the
  // row is terminal. See docs/chat-lifecycle.md (the subagents track).
  currentTool?: string;
  // Latches true once the provider reports this run as surviving an interrupt of
  // the parent's turn (backgrounded Task/Agent, Workflow run). One-way on
  // purpose: a run that has been backgrounded never becomes foreground again,
  // and a later status-only update must not drop the flag.
  backgrounded?: boolean;
}

/**
 * Derive the frozen label + monotonic token total for an observed subagent from
 * its prior registry state and the incoming update. The title freezes at the
 * first update carrying a real name source (task_started's subAgentType) so
 * later progress summaries never mutate it; the token total never decreases.
 * See docs/agent-lifecycle.md (Items 3 + 4).
 */
function resolveObservedSubagentDerivedState(
  existing: ObservedSubagentDerivedState | undefined,
  update: ObservedSubagentUpdate,
): ObservedSubagentDerivedState {
  const shouldFreeze = !existing?.titleFrozen && observedUpdateHasTitleSource(update);
  const title = shouldFreeze
    ? deriveObservedSubagentTitle(update)
    : (existing?.title ?? deriveObservedSubagentTitle(update));
  return {
    title,
    titleFrozen: existing?.titleFrozen || shouldFreeze,
    ...resolveObservedSubagentCarriedState(existing, update),
  };
}

/**
 * The accounting + liveness figures an observed subagent carries forward across
 * updates. Counters take the running maximum; the rest take the newest value the
 * update actually carried, so a scalar-only refresh (a run-state reconcile, a
 * status-only settle) can never blank what an earlier frame established.
 */
function resolveObservedSubagentCarriedState(
  existing: ObservedSubagentDerivedState | undefined,
  update: ObservedSubagentUpdate,
): Omit<ObservedSubagentDerivedState, "title" | "titleFrozen"> {
  const cumulativeTokens = monotonicCount(update.cumulativeTokens, existing?.cumulativeTokens);
  const lastUsage = update.usage ?? existing?.lastUsage;
  const model = update.model ?? existing?.model;
  const usageRounds = monotonicCount(update.usageRounds, existing?.usageRounds);
  const toolUseCount = monotonicCount(update.toolUseCount, existing?.toolUseCount);
  // Not monotonic, unlike the counters: the LATEST tool is the point. The
  // projection is what drops it once the row is terminal.
  const currentTool = update.currentTool ?? existing?.currentTool;
  // Latching, not "newest wins": once a run is backgrounded it stays that way.
  const backgrounded = update.backgrounded || existing?.backgrounded ? true : undefined;
  return {
    ...(cumulativeTokens !== undefined ? { cumulativeTokens } : {}),
    ...(lastUsage !== undefined ? { lastUsage } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(usageRounds !== undefined ? { usageRounds } : {}),
    ...(toolUseCount !== undefined ? { toolUseCount } : {}),
    ...(currentTool !== undefined ? { currentTool } : {}),
    ...(backgrounded !== undefined ? { backgrounded } : {}),
  };
}

/**
 * Carry a monotonic non-decreasing counter (cumulative tokens, model rounds)
 * across observed-subagent updates: a fresh value only ever raises the running
 * figure, and an update that omits it keeps what we had - so a final
 * status-only notification can never drop the readout.
 */
function monotonicCount(
  update: number | undefined,
  existing: number | undefined,
): number | undefined {
  return typeof update === "number" && Number.isFinite(update)
    ? Math.max(existing ?? 0, update)
    : existing;
}

/**
 * What an observed subagent has already contributed to the itemized ledger, so
 * a later settle records only the increment above it. `rounds` is the model
 * round-trip count at the time of that write.
 */
interface RecordedSubagentLedger {
  usage: AgentUsage;
  rounds: number;
}

/** An observed subagent's run has ended once it reports a terminal status. */
function isTerminalObservedSubagentStatus(status: ObservedSubagentUpdate["status"]): boolean {
  return status === "idle" || status === "error" || status === "closed";
}

/**
 * The optional observed-subagent fields the registry record and the emitted
 * payload input carry identically (parentKey + the resolved token/usage/model
 * accounting + the liveness counters). Built once and spread into both so
 * onObservedSubagentUpdated doesn't repeat the same presence checks twice.
 */
interface ObservedSubagentOptionalFields {
  parentKey?: string;
  cumulativeTokens?: number;
  lastUsage?: AgentUsage;
  model?: string;
  usageRounds?: number;
  toolUseCount?: number;
  currentTool?: string;
  backgrounded?: boolean;
}

function observedSubagentOptionalFields(
  input: ObservedSubagentOptionalFields,
): ObservedSubagentOptionalFields {
  return {
    ...(input.parentKey ? { parentKey: input.parentKey } : {}),
    ...(input.cumulativeTokens !== undefined ? { cumulativeTokens: input.cumulativeTokens } : {}),
    ...(input.lastUsage !== undefined ? { lastUsage: input.lastUsage } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.usageRounds !== undefined ? { usageRounds: input.usageRounds } : {}),
    ...(input.toolUseCount !== undefined ? { toolUseCount: input.toolUseCount } : {}),
    ...(input.currentTool !== undefined ? { currentTool: input.currentTool } : {}),
    ...(input.backgrounded ? { backgrounded: true } : {}),
  };
}

/**
 * Assemble the itemized ledger row for one recorded activity. Optional fields
 * attach only when meaningful: the cache-read slice so the ledger can show
 * fresh vs. cached (a Claude turn is mostly cache-read; the "in" total alone
 * overstates fresh send by ~10x - fresh derives client-side as tokensIn −
 * cached), and the sub-agent spawn-tree identity fields.
 */
function buildUsageLedgerEvent(input: {
  kind: string;
  meta: {
    provider: AgentProvider;
    agentId?: string;
    model?: string;
    subtype?: string;
    rounds?: number;
    startedAt?: number;
    subagentKey?: string;
    parentSubagentKey?: string;
  };
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  compactionIn: number;
  compactionOut: number;
}): UsageEvent {
  const { meta } = input;
  const event: UsageEvent = {
    id: randomUUID(),
    at: Date.now(),
    kind: input.kind,
    provider: meta.provider,
    tokensIn: input.inputTokens,
    tokensOut: input.outputTokens,
    costMicroUsd: input.costMicroUsd,
  };
  if (input.cachedInputTokens > 0) event.cachedTokensIn = input.cachedInputTokens;
  if (meta.subtype) event.subtype = meta.subtype;
  if (meta.rounds) event.rounds = meta.rounds;
  if (meta.model) event.model = meta.model;
  if (meta.agentId) event.agentId = meta.agentId;
  if (meta.startedAt !== undefined) event.startedAt = meta.startedAt;
  if (meta.subagentKey) event.subagentKey = meta.subagentKey;
  if (meta.parentSubagentKey) event.parentSubagentKey = meta.parentSubagentKey;
  if (input.compactionIn > 0) event.compactionTokensIn = input.compactionIn;
  if (input.compactionOut > 0) event.compactionTokensOut = input.compactionOut;
  return event;
}

interface BackgroundShellTaskEntry {
  parentAgentId: string;
  taskId?: string;
  provider: AgentProvider;
  command?: string;
  description?: string;
  status: "running" | "idle" | "error" | "closed";
  requiresAttention?: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// A suggested task a chat surfaced via the `suggest_task` tool. The `prompt` is
// held here (never sent to clients) and used verbatim when the user starts the
// task. Resolved (started/dismissed) entries are retained so `dismiss_task` and
// the start RPC stay idempotent, but are filtered out of the emitted list so the
// chip disappears on resolution - same "terminal entries leave the wire" rule as
// backgroundShellTasks.
interface SuggestedTaskEntry {
  id: string;
  parentAgentId: string;
  title: string;
  prompt: string;
  tldr: string;
  cwd?: string;
  state: SuggestedTaskState;
  createdAt: string;
  updatedAt: string;
  startMode?: TasksSuggestedStartMode;
  startedAgentId?: string;
  dismissReason?: string;
}

export interface SpawnSuggestedTaskInput {
  parentAgentId: string;
  title: string;
  prompt: string;
  tldr: string;
  cwd?: string;
}

export interface DismissSuggestedTaskResult {
  found: boolean;
  dismissed: boolean;
  state?: SuggestedTaskState;
}

/**
 * Merge a background_shell_task_updated event onto the existing registry
 * entry (or create one). Split out of onBackgroundShellTaskUpdated to keep
 * that method's cyclomatic complexity down - the provider only ever sends
 * fresher values, so a new field wins when present, otherwise the existing
 * value carries forward.
 */
function mergeBackgroundShellTaskEntry(input: {
  parentAgentId: string;
  provider: AgentProvider;
  createdAt: string;
  existing: BackgroundShellTaskEntry | undefined;
  update: BackgroundShellTaskUpdate;
}): BackgroundShellTaskEntry {
  const { parentAgentId, provider, createdAt, existing, update } = input;
  const command = update.command ?? existing?.command;
  const description = update.description ?? existing?.description;
  const requiresAttention = update.requiresAttention ?? existing?.requiresAttention;
  return {
    parentAgentId,
    taskId: update.taskId ?? existing?.taskId,
    provider,
    ...(command ? { command } : {}),
    ...(description ? { description } : {}),
    status: update.status,
    ...(requiresAttention !== undefined ? { requiresAttention } : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
    ...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
  };
}

type ProjectionStreamEvent = Extract<
  AgentStreamEvent,
  {
    type:
      | "observed_subagent_updated"
      | "observed_subagent_timeline"
      | "background_shell_task_updated";
  }
>;

// Narrows to the subagent/background-task projection events dispatchStreamEventByType
// routes to dispatchProjectionStreamEvent instead of its main switch - kept as a
// standalone predicate (own complexity budget) rather than an inline `||` chain.
function isProjectionStreamEvent(event: AgentStreamEvent): event is ProjectionStreamEvent {
  return (
    event.type === "observed_subagent_updated" ||
    event.type === "observed_subagent_timeline" ||
    event.type === "background_shell_task_updated"
  );
}

/** Sum of a single turn's spend - undefined when the provider reported nothing. */
function sumTurnUsageTokens(usage: AgentUsage | undefined): number | undefined {
  if (!usage) {
    return undefined;
  }
  const total =
    (usage.inputTokens ?? 0) +
    (usage.cachedInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.outputTokens ?? 0);
  return total > 0 ? total : undefined;
}

/**
 * Roll a completed turn's usage into the agent's lifetime token total - the
 * same rollup native agents (any provider, any spawn path) and observed
 * subagents (resolveObservedSubagentDerivedState above) both feed into the
 * identical wire field, so the subagent track shows every row the same way.
 *
 * Plain addition, with no per-provider branch: `usage` here is always THIS
 * TURN's spend because `recordTurnUsage` runs a cumulative reporter (Pi's whole
 * stat block, OpenCode's cost) through `toTurnSpend` first. Normalizing once at
 * the boundary is what keeps every downstream sink - this total, the activity
 * counters, the itemized ledger - from having to know which providers report a
 * running total. See turn-usage.ts.
 */
function accumulateAgentTokens(
  existing: number | undefined,
  usage: AgentUsage | undefined,
): number | undefined {
  const turnTokens = sumTurnUsageTokens(usage);
  if (turnTokens === undefined) {
    return existing;
  }
  return (existing ?? 0) + turnTokens;
}

/**
 * The activity counters each usage category writes to (WP-G). Kept as a table so
 * recordUsageActivity stays branch-light. Compaction is handled inline (it has no
 * real cost) and the provider split (claudeTokens*) is applied separately.
 */
const USAGE_CATEGORY_FIELDS: Record<
  "mainChat" | "generations" | "subagent",
  { in: ActivityCounterField; out: ActivityCounterField; cost: ActivityCounterField }
> = {
  mainChat: {
    in: "mainChatTokensIn",
    out: "mainChatTokensOut",
    cost: "mainChatCostMicroUsd",
  },
  generations: {
    in: "generationsTokensIn",
    out: "generationsTokensOut",
    cost: "generationsCostMicroUsd",
  },
  subagent: {
    in: "subagentTokensIn",
    out: "subagentTokensOut",
    cost: "subagentCostMicroUsd",
  },
};

/** The itemized-ledger `kind` each aggregate category maps to (usage-ledger). */
const USAGE_CATEGORY_KIND: Record<"mainChat" | "generations" | "subagent", string> = {
  mainChat: "chat",
  generations: "generation",
  subagent: "subagent",
};

/**
 * Convert a real provider dollar cost to an integer count of micro-USD (usd*1e6),
 * the summable form stored in the activity counters (WP-G). Non-positive or
 * non-finite costs (or providers that report none) contribute 0.
 */
function usdToMicroUsd(usd: number | undefined): number {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    return 0;
  }
  return Math.round(usd * 1_000_000);
}

interface StreamEventFlags {
  shouldDispatchEvent: boolean;
  shouldNotifyWaiters: boolean;
}

interface HandleStreamEventOptions {
  fromHistory?: boolean;
}

interface ManagedAgentBase {
  id: string;
  provider: AgentProvider;
  cwd: string;
  /**
   * Workspace this agent belongs to, stamped at creation. Independent of cwd:
   * cwd answers "where does it run", workspaceId answers "which workspace owns it".
   * Null/undefined for legacy agents created before ownership stamping.
   */
  workspaceId?: string;
  owner?: AgentOwner;
  capabilities: AgentCapabilityFlags;
  config: AgentSessionConfig;
  runtimeInfo?: AgentRuntimeInfo;
  createdAt: Date;
  updatedAt: Date;
  availableModes: AgentMode[];
  features?: AgentFeature[];
  currentModeId: string | null;
  pendingPermissions: Map<string, AgentPermissionRequest>;
  bufferedPermissionResolutions: Map<
    string,
    Extract<AgentStreamEvent, { type: "permission_resolved" }>
  >;
  inFlightPermissionResponses: Set<string>;
  pendingReplacement: boolean;
  /**
   * Steering messages parked for delivery as this agent's next turn
   * (`delivery: "queue"`). FIFO; drained in `finalizeForegroundTurn` before the
   * agent is allowed to go idle. Ephemeral by design - a queued nudge is about
   * the run in progress, so it does not survive a daemon restart.
   */
  steerQueue: SteerQueueEntry[];
  /**
   * Mirrors `pendingReplacement` for the queue drain: held true from the moment
   * `finalizeForegroundTurn` decides to drain until the next turn's
   * `streamAgent` takes over, so the row never flickers idle→running between
   * queued turns and a message sent in that window is buffered rather than
   * raced into a second concurrent turn.
   */
  pendingSteerDrain: boolean;
  /**
   * Set when a cancel (the composer's stop button, ESC, `cancel_chat`) lands
   * while messages are queued. Stop means stop, so the cancelled turn's
   * finalize must not drain the queue into a fresh turn - but the entries
   * survive, so the Queue track still shows them and the user can edit or send
   * them when ready. Cleared the moment the next run starts, after which the
   * queue drains normally again.
   *
   * Optional so existing `ManagedAgent` fixtures stay valid.
   */
  steerQueueHeld?: boolean;
  persistence: AgentPersistenceHandle | null;
  historyPrimed: boolean;
  lastUserMessageAt: Date | null;
  lastUsage?: AgentUsage;
  /**
   * Lifetime token total for this agent, tracked the same way regardless of
   * how it was started (create_chat, personality/team chat, schedule fire,
   * or Run orchestration) or which provider runs it. See
   * `accumulateAgentTokens` for the per-provider rollup rule. Ephemeral like
   * `lastUsage` - not persisted, resets on daemon restart.
   */
  cumulativeTokens?: number;
  /**
   * The same lifetime spend as `cumulativeTokens`, kept as the REAL in / cached
   * / cache-write / out split plus the provider's own booked cost, so a cache
   * read is never priced as fresh input and no surface has to guess a rate.
   * `costUsd` is the cost actually booked (residual-adjusted for a parent), so
   * parent + Σ descendants is exact by construction. Ephemeral like
   * `cumulativeTokens`. See turn-usage.ts.
   */
  cumulativeUsage?: AgentLifetimeUsage;
  /**
   * Watermark for providers that report a running session total instead of
   * this turn's spend (Pi's whole stat block, OpenCode's cost). Lets
   * `recordTurnUsage` difference them once so every downstream total is plain
   * addition. Unused for per-turn providers. See turn-usage.ts.
   */
  usageWatermark?: TurnUsageWatermark;
  /**
   * Sub-chats-track liveness for a native child chat (create_chat and the
   * other spawn paths): cumulative tool invocations and the tool it is running
   * or ran last, both derived from its own timeline because there is no provider
   * task report to read (observed rows get theirs from the provider - see
   * ObservedSubagentUpdate). Only maintained for agents that are somebody's
   * child, so main chats pay nothing. Ephemeral like `cumulativeTokens`.
   * See recordNativeSubagentToolActivity and docs/chat-lifecycle.md.
   */
  toolUseCount?: number;
  currentTool?: string;
  /**
   * Tool-call ids already counted, so a call's running → completed transitions
   * count once. Lives beside the counter it guards.
   */
  countedToolCallIds?: Set<string>;
  /**
   * Tool-emission stall guard: consecutive assistant messages that neither
   * called a tool nor handed back to the user. Purely structural, spans turns,
   * reset by any tool call or real user prompt. Ephemeral like the counters
   * above. See agent-stall-guard.ts.
   */
  stallGuard?: StallGuardState;
  lastError?: string;
  attention: AttentionState;
  foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
  finalizedForegroundTurnIds: Set<string>;
  unsubscribeSession: (() => void) | null;
  /**
   * True when this agent was created for an unattended run (schedule/loop/
   * artifact refresh, unattended-parent spawn - `createAgent(..., unattended:
   * true)`). Creation-time signal, NOT derived from the permission mode. The
   * guardrail deny-responder (onStreamPermissionRequested) uses it to auto-deny
   * permission escalations instead of stalling on a prompt nobody can answer.
   * See docs/safe-unattended.md (Phase 2).
   */
  unattended?: boolean;
  /**
   * Count of permission escalations the guardrail deny-responder auto-denied on
   * this (unattended) agent, plus when the last one happened. Queryable hook a
   * later phase uses to surface "this run hit a guardrail and may need
   * attention". See docs/safe-unattended.md (Phase 3).
   */
  guardrailDenials?: number;
  lastGuardrailDenialAt?: string;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   */
  internal?: boolean;
  /**
   * Observable internal agents still forward their live `agent_stream` events
   * to global subscribers (clients) so a user can watch them - e.g. artifact
   * generation. `agent_state` stays filtered, so they don't appear in the
   * sidebar. See AgentSessionConfig.observable.
   */
  observable?: boolean;
  /**
   * User-defined labels for categorizing agents (e.g., { surface: "workspace" }).
   */
  labels: Record<string, string>;
}

type ManagedAgentWithSession = ManagedAgentBase & {
  session: AgentSession;
};

type ManagedAgentInitializing = ManagedAgentWithSession & {
  lifecycle: "initializing";
  activeForegroundTurnId: null;
};

type ManagedAgentIdle = ManagedAgentWithSession & {
  lifecycle: "idle";
  activeForegroundTurnId: null;
};

type ManagedAgentRunning = ManagedAgentWithSession & {
  lifecycle: "running";
  activeForegroundTurnId: string | null;
};

type ManagedAgentError = ManagedAgentWithSession & {
  lifecycle: "error";
  activeForegroundTurnId: null;
  lastError: string;
};

type ManagedAgentClosed = ManagedAgentBase & {
  lifecycle: "closed";
  session: null;
  activeForegroundTurnId: null;
};

export type ManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError
  | ManagedAgentClosed;

export interface AgentMetricsSnapshot {
  total: number;
  subscriptionCount: number;
  byLifecycle: Record<string, number>;
  withActiveForegroundTurn: number;
  timelineStats: {
    totalItems: number;
    maxItemsPerAgent: number;
  };
}

type ActiveManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError;

type LiveManagedAgent = ActiveManagedAgent;
type AgentLabelPatch = Record<string, string | null>;

interface WriteLabelsResult {
  record: StoredAgentRecord | null;
  live: boolean;
}

interface AgentMetadataPatch {
  title?: string;
  labels?: AgentLabelPatch;
}

const SYSTEM_ERROR_PREFIX = "[System Error]";
const CONTEXT_SIZE_ERROR_MESSAGE =
  "The request exceeds the model's context size. Try starting a new chat or increasing the model's context size.";

function isContextSizeError(message: string): boolean {
  return /"type"\s*:\s*"exceed_context_size_error"/.test(message);
}

function attachPersistenceCwd(
  handle: AgentPersistenceHandle | null,
  cwd: string,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }
  return {
    ...handle,
    metadata: {
      ...handle.metadata,
      cwd,
    },
  };
}

interface SubscriptionRecord {
  callback: AgentSubscriber;
  agentId: string | null;
}

const BUSY_STATUSES: Set<AgentLifecycleStatus> = new Set(["initializing", "running"]);
const AgentIdSchema = z.guid();

function isAgentBusy(status: AgentLifecycleStatus): boolean {
  return BUSY_STATUSES.has(status);
}

function isTurnTerminalEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

function abortMessage(reason: unknown, fallbackMessage: string): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return fallbackMessage;
}

function createAbortError(signal: AbortSignal | undefined, fallbackMessage: string): Error {
  const message = abortMessage(signal?.reason, fallbackMessage);
  return Object.assign(new Error(message), { name: "AbortError" });
}

function validateAgentId(agentId: string, source: string): string {
  const result = AgentIdSchema.safeParse(agentId);
  if (!result.success) {
    throw new Error(`${source}: agentId must be a UUID`);
  }
  return result.data;
}

function applyLabelPatch(
  labels: Record<string, string>,
  patch: AgentLabelPatch,
): Record<string, string> {
  const nextLabels = { ...labels };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete nextLabels[key];
    } else {
      nextLabels[key] = value;
    }
  }
  return nextLabels;
}

function buildExplicitTimelineSeedForRegister(
  now: Date,
  options:
    | {
        timeline?: AgentTimelineItem[];
        timelineRows?: AgentTimelineRow[];
        timelineNextSeq?: number;
        createdAt?: Date;
        updatedAt?: Date;
      }
    | undefined,
): SeedAgentTimelineOptions | null {
  const hasTimeline = Boolean(options?.timeline?.length);
  const hasTimelineRows = Boolean(options?.timelineRows?.length);
  const hasTimelineNextSeq = options?.timelineNextSeq !== undefined;
  if (!hasTimeline && !hasTimelineRows && !hasTimelineNextSeq) {
    return null;
  }
  return {
    items: options?.timeline,
    rows: options?.timelineRows,
    nextSeq: options?.timelineNextSeq,
    timestamp: (options?.updatedAt ?? options?.createdAt ?? now).toISOString(),
  };
}

/**
 * Strip the voice `<spoken-input>` scaffolding from a `user_message` so the chat
 * shows the words the user spoke, not the markup the model was fed (see
 * `wrapSpokenInput`). Display-only and provider-agnostic: applied at the
 * timeline chokepoint so every surface (chat, copy, rewind prefill, title, CLI)
 * gets the clean text. The wrapped prompt was already delivered to the provider
 * for the live turn; this only shapes Otto's own timeline projection. Idempotent
 * and a no-op for every non-spoken message.
 */
function normalizeUserMessageForDisplay(item: AgentTimelineItem): AgentTimelineItem {
  if (item.type !== "user_message") {
    return item;
  }
  // Strip the passive todo nudge Otto appended for the model, then unwrap voice
  // scaffolding. Both are display-only and idempotent (see stripTrailingTodoNudge
  // and unwrapSpokenInput); the provider already received the full prompt.
  const cleaned = unwrapSpokenInput(stripTrailingTodoNudge(item.text));
  if (cleaned === item.text) {
    return item;
  }
  return { ...item, text: cleaned };
}

/**
 * The single display-normalization pass for timeline items. Both steps are
 * idempotent, which matters: the chokepoint normalizes on the way to the stream
 * AND the store re-normalizes on append, and history import runs it again on
 * replay.
 */
function normalizeTimelineItemForDisplay(item: AgentTimelineItem): AgentTimelineItem {
  return normalizeWidgetTimelineItem(normalizeUserMessageForDisplay(item));
}

function buildImportedTimelineRows(entries: readonly ImportedTimelineEntry[]): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (const entry of entries) {
    if (entry.item.type === "user_message" && isSystemInjectedEnvelope(entry.item.text)) {
      continue;
    }
    rows.push({
      seq: rows.length + 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      // Hydration builds rows directly instead of going through
      // recordTimeline, so it has to bound for itself. Provider history is
      // exactly where an unbounded output arrives in bulk.
      item: limitAgentTimelineItemContent(normalizeTimelineItemForDisplay(entry.item)),
    });
  }
  return rows;
}

function resolveImportedAgentTitle(
  config: AgentSessionConfig,
  timelineRows: readonly AgentTimelineRow[],
): string | null {
  const initialPrompt = getFirstUserMessageTextFromRows(timelineRows);
  if (!initialPrompt) {
    return null;
  }
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: config.title,
    initialPrompt,
  });
  return explicitTitle ?? provisionalTitle ?? null;
}

function getFirstUserMessageTextFromRows(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

// Whether a retained-transcript row represents work the agent actually did,
// versus just its seed prompt. Used to decide if a failed scheduled run has
// enough substance to reveal its workspace (see docs/safe-unattended.md).
function isRetainedContentItem(item: AgentTimelineItem): boolean {
  return (
    item.type === "assistant_message" ||
    item.type === "reasoning" ||
    item.type === "tool_call" ||
    item.type === "todo"
  );
}

export class AgentManager {
  private readonly clients = new Map<AgentProvider, AgentClient>();
  private readonly providerEnabled = new Map<AgentProvider, boolean>();
  private readonly agents = new Map<string, LiveManagedAgent>();
  private readonly timelineStore = new InMemoryAgentTimelineStore();
  private readonly agentsAwaitingInitialSnapshotPersist = new Set<string>();
  private readonly sessionEventTails = new Map<string, Promise<void>>();
  private readonly foregroundRuns = new AgentRunState();
  private readonly subscribers = new Set<SubscriptionRecord>();
  private readonly idFactory: () => string;
  private readonly registry?: AgentStorage;
  private readonly durableTimelineStore?: AgentTimelineStore;
  // Retained transcripts of internal generation agents (schedule / artifact),
  // keyed by generation agent id. Captured at run end before closeAgent so the
  // chat survives the internal agent's teardown, and served back through the
  // normal fetch_agent / fetch_agent_timeline paths for a read-only viewer. See
  // docs/safe-unattended.md. Optional: absent on hosts that don't wire it.
  private readonly retainedTranscripts?: RetainedTranscriptStore;
  // Ids whose retained rows have been seeded into the in-memory timeline store
  // so fetchTimeline can serve them like an observed subagent (no ManagedAgent,
  // no requireAgent throw). LRU-capped: nothing signals that a viewer closed a
  // retained transcript, so residency is bounded instead of released.
  private readonly retainedTimelines = new RetainedTimelineResidency();
  // Paseo's provider-subagent projection, keyed by parent agent id.
  private readonly providerSubagents = new ProviderSubagentStore();
  private readonly inFlightAgentCloses = new Map<string, Promise<void>>();
  private readonly previousStatuses = new Map<string, AgentLifecycleStatus>();
  // Signature of the last stale todo list we fired an idle reconcile pass for,
  // per agent. Guards against a nag loop: an unchanged stale list (the agent
  // explained why rows stay open) never re-fires. See todo-reminders.ts and the
  // agentBehaviors.todoReconcileOnIdle toggle.
  private readonly lastReconciledTodoSignature = new Map<string, string>();
  // Owning-chat agent id -> sum of its observed sub-agents' priced cost (micro-USD)
  // not yet backed out of the parent. Provider-agnostic de-inflation: whenever a
  // provider reports a WHOLE-TREE cost on the parent turn (parent + in-process
  // sub-agents) while its parent-turn tokens are parent-only, the parent row is
  // priced as the RESIDUAL (tree cost − Σ sub-agent) to avoid double-counting
  // sub-agent spend. The provider prices each sub-agent (on the sub-agent's own
  // model) into update.usage.totalCostUsd; this sink just sums and subtracts.
  // Claude is the reference (its `total_cost_usd` is whole-tree). Accumulated as
  // each sub-agent settles, drained at the parent's next turn. See [[subagent-real-accounting]].
  private readonly pendingSubagentCostMicroUsdByParent = new Map<string, number>();
  // Observed subagents (Claude Task / ultracode fan-out): id -> resolution info
  // for the stop RPC. These are ephemeral projections, not ManagedAgents. See
  // projects/observed-subagents/observed-subagents.md.
  private readonly observedSubagents = new Map<
    string,
    {
      parentAgentId: string;
      taskId?: string;
      // Nested fan-out: key of the observed subagent that spawned this one
      // (see ObservedSubagentUpdate.parentKey). Remembered on first sight so
      // every payload keeps the tree-shaped parent label even when a later
      // update omits it. The registry's parentAgentId stays the OWNING agent
      // (stop/archive resolve the provider session through it).
      parentKey?: string;
      provider: AgentProvider;
      createdAt: string;
      // Frozen row label. Set once from the first named update (task_started)
      // and never mutated by later progress summaries - a row is a tab label,
      // not the agent's latest output. See docs/agent-lifecycle.md (Item 4).
      title: string;
      titleFrozen: boolean;
      // Highest cumulative token total seen from the provider's per-task usage.
      // Kept monotonic so a final notification without usage can't drop the
      // readout. See docs/agent-lifecycle.md (Item 3).
      cumulativeTokens?: number;
      // Latest full usage split (in/out/cache) + the subagent's own model, both
      // carried forward across updates so the ledger prices this row on its real
      // per-frame numbers even when the final update omits them. See
      // [[subagent-real-accounting]].
      lastUsage?: AgentUsage;
      model?: string;
      // Cumulative model round-trips reported for this subagent, remembered so a
      // later status-only update (which omits it) can still attribute the count.
      usageRounds?: number;
      // Liveness signals for the track row: cumulative tool invocations (kept
      // monotonic) and the tool this subagent is running or ran last (latest
      // wins, sticky across updates that omit it, dropped by the projection once
      // the row is terminal). Both provider-reported through the neutral
      // ObservedSubagentUpdate; a provider that can't report them leaves the
      // row's readout absent rather than wrong.
      // See docs/chat-lifecycle.md (the subagents track).
      toolUseCount?: number;
      currentTool?: string;
      // True when this run survives an interrupt of the owning chat's turn
      // (backgrounded Task/Agent, Workflow run, or anything nested under one).
      // Latched by resolveObservedSubagentCarriedState and inherited from the
      // parent row below. Read by the client so its interrupt warning only
      // counts work an interrupt actually stops. See docs/chat-lifecycle.md.
      backgrounded?: boolean;
      // Watermark of what has already been written to the itemized ledger. Each
      // time the subagent settles, only the DELTA above this is recorded - so a
      // duplicate terminal update writes nothing, while a genuine second stream
      // (a continued/steered subagent, or a late frame raising its totals) gets
      // its own row instead of being dropped. One row per stream, mirroring the
      // "one query, one row" rule chats follow.
      recorded?: RecordedSubagentLedger;
      // Set when the user archives the row. The entry is retired, not deleted:
      // a late provider update (final task_notification after an archive-while-
      // running) must not resurrect the row, so every subsequent emission keeps
      // carrying this stamp. See docs/agent-lifecycle.md (Items 2 + 6).
      archivedAt?: string;
      lastPayload?: AgentSnapshotPayload;
    }
  >();
  // Background shell tasks (Claude Bash tool run_in_background): id -> current
  // state for the Background Tasks track. Not AI subagents - plain shell
  // processes, so unlike observedSubagents there's no Agent-shaped payload;
  // the daemon pushes the full per-parent list on every change.
  private readonly backgroundShellTasks = new Map<string, BackgroundShellTaskEntry>();
  // Suggested tasks (suggest_task chips): taskId -> current state, keyed globally.
  // Pushed as the full per-parent pending list on every change.
  private readonly suggestedTasks = new Map<string, SuggestedTaskEntry>();
  // Synchronous reservation for in-flight suggested-task starts: a start awaits
  // multi-second agent/worktree creation before flipping state to "started", so
  // a second concurrent start.request for the same id would pass the pending
  // gate too. Ids claimed here are rejected until the start resolves or fails.
  private readonly startingSuggestedTaskIds = new Set<string>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly agentRegistrationTasks = new Set<Promise<void>>();
  private readonly agentStreamCoalescer: AgentStreamCoalescer;
  private mcpBaseUrl: string | null;
  private readonly mcpAuthToken: string | null;
  private ottoToolsEnabled = true;
  private ottoToolCatalogFactory: OttoToolCatalogFactory | null = null;
  private appendSystemPrompt: string;
  // Resolved daemon-wide behavior toggles (Claude tier). Hot-reloaded via
  // setAgentBehaviors; injected into each launch via buildLaunchContext and
  // read by the Otto tools for the notify-on-finish default.
  private agentBehaviors: AgentBehaviorSettings;
  private onAgentAttention?: AgentAttentionCallback;
  /** Foreground turns whose idle transition is intentionally silent. */
  private readonly silentCompletionTurnIds = new Map<string, string>();
  private isAgentActivelyWatched?: (agentId: string) => boolean;
  private onAgentArchived?: AgentArchivedCallback;
  private onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  private onPersonalitySpawn?: (personalityId: string) => void;
  private resolvePersonalityMemoryBrief?: AgentManagerOptions["resolvePersonalityMemoryBrief"];
  private resolveProjectKnowledgeBrief?: AgentManagerOptions["resolveProjectKnowledgeBrief"];
  private resolveInstructionFiles?: AgentManagerOptions["resolveInstructionFiles"];
  private onActivity?: ActivityIncrementFn;
  private onUsageEvent?: (event: UsageEvent) => void;
  private logger: Logger;
  private readonly rescueTimeouts: Required<AgentManagerRescueTimeouts>;
  private acceptingAgentRegistrations = true;

  constructor(options: AgentManagerOptions) {
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.registry = options.registry;
    this.durableTimelineStore = options.durableTimelineStore;
    this.retainedTranscripts = options.retainedTranscripts;
    this.onAgentAttention = options.onAgentAttention;
    this.isAgentActivelyWatched = options.isAgentActivelyWatched;
    this.onWorkspaceStateMayHaveChanged = options.onWorkspaceStateMayHaveChanged;
    this.onPersonalitySpawn = options.onPersonalitySpawn;
    this.resolvePersonalityMemoryBrief = options.resolvePersonalityMemoryBrief;
    this.resolveProjectKnowledgeBrief = options.resolveProjectKnowledgeBrief;
    this.resolveInstructionFiles = options.resolveInstructionFiles;
    this.onActivity = options.onActivity;
    this.onUsageEvent = options.onUsageEvent;
    this.mcpBaseUrl = options.mcpBaseUrl ?? null;
    this.mcpAuthToken = options.mcpAuthToken ?? null;
    this.configureOttoTools(options);
    this.appendSystemPrompt = options.appendSystemPrompt ?? "";
    this.agentBehaviors = resolveAgentBehaviorSettings(options.agentBehaviors);
    this.logger = options.logger.child({ module: "agent", component: "agent-manager" });
    this.rescueTimeouts = {
      reloadSessionCloseMs:
        options.rescueTimeouts?.reloadSessionCloseMs ?? RELOAD_SESSION_CLOSE_TIMEOUT_MS,
      interruptSessionMs:
        options.rescueTimeouts?.interruptSessionMs ?? INTERRUPT_SESSION_TIMEOUT_MS,
    };
    this.agentStreamCoalescer = new AgentStreamCoalescer({
      windowMs: options.agentStreamCoalesceWindowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
      timers: { setTimeout, clearTimeout },
      onFlush: ({ agentId, item, provider, turnId }) => {
        const event = this.recordAndDispatchTimelineItem(agentId, item, provider, turnId);
        this.notifyForegroundTurnWaiters(agentId, event);
        // Assistant messages and tool calls are coalescable, so this flush - not
        // onStreamTimelineEvent - is where the live ones land. The guard has to
        // watch both paths to see the whole stream.
        this.observeStallGuard(agentId, item);
      },
    });
    this.updateProviderRegistry({
      providerDefinitions: options.providerDefinitions ?? {},
      clients: options.clients ?? {},
    });
  }

  private configureOttoTools(options: AgentManagerOptions): void {
    this.ottoToolsEnabled = options.ottoToolsEnabled ?? true;
    this.ottoToolCatalogFactory = options.ottoToolCatalogFactory ?? null;
  }

  registerClient(provider: AgentProvider, client: AgentClient): void {
    this.clients.set(provider, client);
  }

  updateProviderRegistry(input: {
    providerDefinitions: ProviderEnabledMap;
    clients: ProviderClientMap;
  }): void {
    for (const [provider, definition] of Object.entries(input.providerDefinitions)) {
      if (definition) {
        this.providerEnabled.set(provider, definition.enabled);
      }
    }
    for (const [provider, client] of Object.entries(input.clients)) {
      if (client) {
        this.clients.set(provider, client);
      }
    }
    // A registry update is the whole picture, not a patch. Providers the new
    // one omits are dropped: without this, removing a provider from daemon
    // config left it registered and still creatable until the next restart.
    // Registration only ever arrives through here, so the incoming map is
    // authoritative.
    for (const provider of this.clients.keys()) {
      if (!input.clients[provider]) {
        this.clients.delete(provider);
        this.providerEnabled.delete(provider);
      }
    }
    // Live sessions absorb provider-level compaction edits (default level,
    // hidden selector), the max-tool-rounds override, and the action circuit
    // breaker so open chats reflect settings changes immediately.
    for (const agent of this.agents.values()) {
      if (this.applyProviderDefinition(agent, input.providerDefinitions)) {
        this.emitState(agent);
      }
    }
  }

  /**
   * Push the updated provider-level settings onto one agent's live session.
   * Returns true when any of the session's effective settings changed, so the
   * caller knows to re-emit agent state.
   */
  private applyProviderDefinition(
    agent: LiveManagedAgent,
    providerDefinitions: ProviderEnabledMap,
  ): boolean {
    const definition = providerDefinitions[agent.provider];
    if (!definition) return false;
    let changed = false;
    if (agent.session?.applyCompactionConfig && definition.compaction !== undefined) {
      changed = agent.session.applyCompactionConfig(definition.compaction) || changed;
    }
    if (agent.session?.applyMaxToolRounds && definition.maxToolRounds !== undefined) {
      changed = agent.session.applyMaxToolRounds(definition.maxToolRounds) || changed;
    }
    if (agent.session?.applyActionBreaker && definition.actionBreaker !== undefined) {
      changed = agent.session.applyActionBreaker(definition.actionBreaker) || changed;
    }
    return changed;
  }

  getRegisteredProviderIds(): AgentProvider[] {
    return Array.from(this.clients.keys());
  }

  setAgentAttentionCallback(callback: AgentAttentionCallback): void {
    this.onAgentAttention = callback;
  }

  /**
   * Late-bound because client presence lives in the websocket server, which is
   * constructed after the agent manager.
   */
  setAgentActivelyWatchedProbe(probe: (agentId: string) => boolean): void {
    this.isAgentActivelyWatched = probe;
  }

  setAgentArchivedCallback(callback: AgentArchivedCallback): void {
    this.onAgentArchived = callback;
  }

  setMcpBaseUrl(url: string | null): void {
    this.mcpBaseUrl = url;
  }

  prepareForShutdown(): void {
    this.acceptingAgentRegistrations = false;
  }

  setOttoToolsEnabled(enabled: boolean): void {
    this.ottoToolsEnabled = enabled;
  }

  setOttoToolCatalogFactory(factory: OttoToolCatalogFactory | null): void {
    this.ottoToolCatalogFactory = factory;
  }

  /**
   * Capability token the daemon's own MCP clients must present to the Agent MCP
   * endpoint when a daemon password is configured. Read by the per-client
   * session to authenticate its own MCP connection. Stays in the daemon - never
   * sent to remote clients.
   */
  getMcpAuthToken(): string | null {
    return this.mcpAuthToken;
  }

  setAppendSystemPrompt(prompt: string | null | undefined): void {
    this.appendSystemPrompt = prompt ?? "";
  }

  /**
   * Hot-reload the daemon-wide agent behavior toggles. New/resumed agents pick
   * up the change on their next launch (values are injected via
   * buildLaunchContext); the notify-on-finish default is read live per tool
   * call. Accepts the raw partial config shape - absent/undefined fields resolve
   * to "on".
   */
  setAgentBehaviors(
    behaviors:
      | {
          promptSuggestions?: boolean;
          agentProgressSummaries?: boolean;
          notifyOnFinishDefault?: boolean;
          todoNudge?: boolean;
          todoReconcileOnIdle?: boolean;
          stallGuardThreshold?: number;
        }
      | undefined,
  ): void {
    this.agentBehaviors = resolveAgentBehaviorSettings(behaviors);
  }

  /** Resolved daemon-wide behavior toggles (read by the Otto tool catalog). */
  getAgentBehaviors(): AgentBehaviorSettings {
    return this.agentBehaviors;
  }

  public getMetricsSnapshot(): AgentMetricsSnapshot {
    const byLifecycle: Record<string, number> = {};
    let withActiveForegroundTurn = 0;
    let totalItems = 0;
    let maxItemsPerAgent = 0;

    for (const agent of this.agents.values()) {
      byLifecycle[agent.lifecycle] = (byLifecycle[agent.lifecycle] ?? 0) + 1;

      if (agent.activeForegroundTurnId !== null) {
        withActiveForegroundTurn++;
      }

      if (!this.timelineStore.has(agent.id)) {
        continue;
      }

      const len = this.timelineStore.getItems(agent.id).length;
      totalItems += len;
      if (len > maxItemsPerAgent) {
        maxItemsPerAgent = len;
      }
    }

    return {
      total: this.agents.size,
      subscriptionCount: this.subscribers.size,
      byLifecycle,
      withActiveForegroundTurn,
      timelineStats: {
        totalItems,
        maxItemsPerAgent,
      },
    };
  }

  private touchUpdatedAt(agent: ManagedAgent): Date {
    const nowMs = Date.now();
    const previousMs = agent.updatedAt.getTime();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    const next = new Date(nextMs);
    agent.updatedAt = next;
    return next;
  }

  private nextStoredUpdatedAt(record: StoredAgentRecord): string {
    const previousMs = Date.parse(record.updatedAt);
    const nowMs = Date.now();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    return new Date(nextMs).toISOString();
  }

  hasInFlightRun(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    return (
      agent.lifecycle === "running" ||
      Boolean(agent.activeForegroundTurnId) ||
      this.foregroundRuns.hasPendingRun(agentId)
    );
  }

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    const targetAgentId =
      options?.agentId == null ? null : validateAgentId(options.agentId, "subscribe");
    const record: SubscriptionRecord = {
      callback,
      agentId: targetAgentId,
    };
    this.subscribers.add(record);

    if (options?.replayState !== false) {
      if (record.agentId) {
        const agent = this.agents.get(record.agentId);
        if (agent) {
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      } else {
        // For global subscribers, skip internal agents during replay
        for (const agent of this.agents.values()) {
          if (agent.internal) {
            continue;
          }
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      }
    }

    return () => {
      this.subscribers.delete(record);
    };
  }

  listAgents(): ManagedAgent[] {
    return Array.from(this.agents.values())
      .filter((agent) => !agent.internal)
      .map((agent) => Object.assign({}, agent));
  }

  async listImportableSessions(
    options?: ImportablePersistedAgentQueryOptions,
  ): Promise<ManagedImportableProviderSession[]> {
    const providerEntries = Array.from(this.clients.entries()).filter(
      ([provider, client]) =>
        client.capabilities.supportsSessionListing &&
        !!client.listImportableSessions &&
        this.isProviderImportable(provider, options?.providerFilter),
    );
    const sessionLists = await Promise.all(
      providerEntries.map(async ([provider, client]) => {
        try {
          return (
            await client.listImportableSessions!({
              limit: options?.limit,
              cwd: options?.cwd,
            })
          ).map((session) => Object.assign(session, { provider }));
        } catch (error) {
          this.logger.warn(
            { err: error, provider },
            "Failed to list importable sessions for provider",
          );
          return [];
        }
      }),
    );
    const sessions: ManagedImportableProviderSession[] = sessionLists.flat();

    const limit = options?.limit ?? 20;
    return sessions
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
      .slice(0, limit);
  }

  private isProviderImportable(
    provider: AgentProvider,
    providerFilter: Set<string> | undefined,
  ): boolean {
    if (this.providerEnabled.get(provider) === false) {
      return false;
    }
    if (providerFilter && !providerFilter.has(provider)) {
      return false;
    }
    return true;
  }

  async listProviderAvailability(): Promise<ProviderAvailability[]> {
    return Promise.all(
      Array.from(this.clients.keys()).map((provider) => this.getProviderAvailability(provider)),
    );
  }

  /**
   * What a provider's adapter can do, or null if no client is registered for
   * it. Callers that must refuse rather than degrade (a graph node declaring
   * restricted workspace access, say) read this before spawning.
   */
  getProviderCapabilities(provider: AgentProvider): AgentCapabilityFlags | null {
    return this.clients.get(provider)?.capabilities ?? null;
  }

  /**
   * The preset and tool schemas one live agent will actually send, for Context
   * Management. Null when the agent has no session yet, or when its provider
   * composes the request in a subprocess and cannot report it.
   */
  describeAgentContextPayload(
    agentId: string,
  ): { systemPromptText: string; mcpToolsText: string } | null {
    const agent = this.agents.get(agentId);
    if (!agent || !("session" in agent)) return null;
    return agent.session.describeContextPayload?.() ?? null;
  }

  async getProviderAvailability(provider: AgentProvider): Promise<ProviderAvailability> {
    const client = this.clients.get(provider);
    if (!client) {
      return {
        provider,
        available: false,
        error: `No client registered for provider '${provider}'`,
      };
    }

    try {
      const available = await client.isAvailable();
      return {
        provider,
        available,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, provider }, "Failed to check provider availability");
      return {
        provider,
        available: false,
        error: message,
      };
    }
  }

  async listDraftCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
    const client = this.requireClient(normalizedConfig.provider);
    if (!normalizedConfig.model) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    if (client.listCommands) {
      return await client.listCommands(normalizedConfig);
    }

    const session = await client.createSession(normalizedConfig);
    try {
      if (!session.listCommands) {
        throw new Error(
          `Provider '${normalizedConfig.provider}' does not support listing commands`,
        );
      }
      return await session.listCommands();
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: normalizedConfig.provider },
          "Failed to close draft command listing session",
        );
      }
    }
  }

  async listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
    const client = this.requireClient(normalizedConfig.provider);
    if (!normalizedConfig.model) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    if (client.listFeatures) {
      return await client.listFeatures(normalizedConfig);
    }

    const session = await client.createSession(normalizedConfig);
    try {
      return session.features ?? [];
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: normalizedConfig.provider },
          "Failed to close draft feature listing session",
        );
      }
    }
  }

  getAgent(id: string): ManagedAgent | null {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : null;
  }

  getTimeline(id: string): AgentTimelineItem[] {
    if (this.observedSubagents.has(id)) {
      this.ensureObservedTimelineState(id);
    } else {
      this.requireAgent(id);
    }
    return this.timelineStore.getItems(id);
  }

  /**
   * Attach an estimated context-window composition (derived from the agent's
   * own timeline) to a usage reading, powering the visualizer's context ring/bar
   * segments. Real daemon-side accounting, provider-neutral (see
   * context-composition.ts). Skipped when the provider already supplied a
   * composition directly, or the timeline isn't available yet. This scans the
   * whole timeline - call it at turn boundaries, not on every streaming delta
   * (see `carryContextComposition`).
   */
  private withContextComposition(
    agentId: string,
    usage: AgentUsage | undefined,
  ): AgentUsage | undefined {
    if (!usage || usage.contextComposition || !this.timelineStore.has(agentId)) {
      return usage;
    }
    const composition = estimateContextComposition(this.timelineStore.getItems(agentId));
    return composition ? { ...usage, contextComposition: composition } : usage;
  }

  /**
   * Per-delta path: carry the previous reading's composition onto a fresh usage
   * event so the ring's segments stay put between turns instead of blinking off
   * on every streaming `usage_updated` (recomputing each delta would rescan the
   * whole timeline). The total occupancy still updates live; the composition
   * refreshes at the next turn boundary via `withContextComposition`.
   */
  private carryContextComposition(previous: AgentUsage | undefined, usage: AgentUsage): AgentUsage {
    let carried = usage;
    if (!carried.contextComposition && previous?.contextComposition) {
      carried = { ...carried, contextComposition: previous.contextComposition };
    }
    // The authoritative split is refreshed asynchronously at turn boundaries
    // (see `refreshContextCategories`), so a mid-turn `usage_updated` would
    // otherwise drop it and blink the ring's real labels back to the estimate.
    if (!carried.contextCategories && previous?.contextCategories) {
      carried = { ...carried, contextCategories: previous.contextCategories };
    }
    return carried;
  }

  /**
   * Refresh the agent's context split from the PROVIDER's own accounting - the
   * same `getContextUsage()` the `agent.context.get_usage` RPC serves, so the
   * context meter and the visualizer never show two different answers for one
   * agent. Providers that don't implement it keep the coarse timeline estimate
   * (`withContextComposition`); this simply doesn't fire for them.
   *
   * Deliberately fire-and-forget: a turn must never be held up (or failed) by a
   * display read. It re-emits state when the reading actually lands, so the
   * snapshot carries it to stream and backfill consumers alike.
   */
  private refreshContextCategories(agent: ManagedAgent): void {
    const session = agent.session;
    if (!session?.getContextUsage) {
      return;
    }
    void (async () => {
      try {
        const usage = await session.getContextUsage?.();
        // A live handle is required to answer; null just means "can't report
        // right now", which must not clobber a previous good reading.
        if (!usage || usage.categories.length === 0) {
          return;
        }
        // The agent may have been closed/replaced while the read was in flight.
        if (this.agents.get(agent.id) !== agent) {
          return;
        }
        agent.lastUsage = { ...agent.lastUsage, contextCategories: usage.categories };
        this.emitState(agent);
      } catch (error) {
        this.logger.debug(
          { err: error, agentId: agent.id },
          "agent.manager.context_categories.refresh_failed",
        );
      }
    })();
  }

  async getTimelineRows(id: string): Promise<AgentTimelineRow[]> {
    if (this.observedSubagents.has(id)) {
      this.ensureObservedTimelineState(id);
    } else {
      this.requireAgent(id);
    }
    if (this.durableTimelineStore) {
      return await this.durableTimelineStore.getCommittedRows(id);
    }
    return this.timelineStore.getRows(id);
  }

  fetchTimeline(id: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    if (this.observedSubagents.has(id)) {
      this.ensureObservedTimelineState(id);
    } else if (this.retainedTimelines.has(id)) {
      // Retained transcript already seeded into the in-memory store (via
      // ensureRetainedTranscriptLoaded); serve it without a ManagedAgent, and
      // count the read as use so an open viewer is not the one evicted.
      this.retainTimeline(id);
    } else {
      this.requireAgent(id);
    }
    return this.timelineStore.fetch(id, options);
  }

  /**
   * Snapshot a finishing internal generation agent's chat so it survives the
   * agent's teardown. Called by the schedule / artifact services right before
   * closeAgent, while the agent and its in-memory timeline are still live.
   * Returns whether the run produced any content (assistant/tool/reasoning
   * activity beyond its seed prompt), which the schedule runner uses to decide
   * whether a failed run's workspace is worth revealing. No-op (returns false)
   * when no retained-transcript store is wired. See docs/safe-unattended.md.
   */
  async captureRetainedTranscript(
    agentId: string,
    owner: RetainedTranscriptOwner,
    options?: { title?: string | null },
  ): Promise<{ hasContent: boolean }> {
    if (!this.retainedTranscripts) {
      return { hasContent: false };
    }
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { hasContent: false };
    }
    const rows = this.timelineStore.has(agentId) ? this.timelineStore.getRows(agentId) : [];
    const hasContent = rows.some((row) => isRetainedContentItem(row.item));
    try {
      await this.retainedTranscripts.save({
        version: 1,
        agentId,
        owner,
        capturedAt: new Date().toISOString(),
        payload: toAgentPayload(agent, { title: options?.title ?? agent.config.title ?? null }),
        rows,
        hasContent,
      });
    } catch (error) {
      this.logger.warn({ err: error, agentId, owner }, "Failed to capture retained transcript");
    }
    return { hasContent };
  }

  /** Agent payload of a retained transcript, or null when the id has none. */
  async getRetainedTranscriptPayload(agentId: string): Promise<AgentSnapshotPayload | null> {
    const record = await this.retainedTranscripts?.get(agentId);
    return record?.payload ?? null;
  }

  /**
   * Load a retained transcript's rows into the in-memory timeline store so a
   * subsequent fetchTimeline serves them (idempotent). Returns true when the id
   * is a retained transcript, false otherwise - the caller falls back to the
   * normal live/persisted agent path.
   */
  async ensureRetainedTranscriptLoaded(agentId: string): Promise<boolean> {
    const record = await this.retainedTranscripts?.get(agentId);
    if (!record) {
      return false;
    }
    if (!this.timelineStore.has(agentId)) {
      this.timelineStore.initialize(agentId, { rows: record.rows });
    }
    this.retainTimeline(agentId);
    return true;
  }

  // Residency bookkeeping for retained transcripts: mark this one in use and
  // drop the rows of whatever fell out of the LRU. Evicted ids reload from disk
  // on the next fetch, so this costs a re-read, never the transcript.
  private retainTimeline(agentId: string): void {
    for (const evictedId of this.retainedTimelines.retain(agentId)) {
      this.timelineStore.delete(evictedId);
    }
  }

  /** Drop every retained transcript produced by one artifact/schedule. */
  async deleteRetainedTranscriptsForOwner(owner: RetainedTranscriptOwner): Promise<void> {
    await this.retainedTranscripts?.deleteForOwner(owner);
  }

  /**
   * Observed subagents are ephemeral registry projections with no ManagedAgent,
   * so nothing runs the normal agent-registration path that seeds the timeline
   * store - without this, every observed timeline append/fetch throws
   * "Unknown agent" and the subagent's transcript is silently lost (no live
   * stream, no backfill). See projects/observed-subagents/observed-subagents.md.
   */
  private ensureObservedTimelineState(id: string): void {
    if (!this.timelineStore.has(id)) {
      this.timelineStore.initialize(id, { timestamp: new Date().toISOString() });
    }
  }

  /**
   * Last emitted snapshot for an observed subagent, or null when the id is not
   * an observed subagent. Lets read paths (timeline fetch) serve observed rows
   * that have no ManagedAgent or stored record. See projects/observed-subagents/observed-subagents.md.
   */
  getObservedSubagentPayload(id: string): AgentSnapshotPayload | null {
    return this.observedSubagents.get(id)?.lastPayload ?? null;
  }

  /**
   * Last emitted snapshots for every observed subagent in the registry.
   * Observed rows otherwise reach clients only as live pushes - without this
   * feeding the agent-list fetch, a client that (re)connects mid-run has no
   * way to learn about running subagents until the provider's next task event,
   * so a page refresh left the subagents track and the visualizer blind to
   * in-flight children. See projects/observed-subagents/observed-subagents.md.
   */
  listObservedSubagentPayloads(): AgentSnapshotPayload[] {
    const payloads: AgentSnapshotPayload[] = [];
    for (const entry of this.observedSubagents.values()) {
      if (entry.lastPayload) {
        payloads.push({ ...entry.lastPayload });
      }
    }
    return payloads;
  }

  subscriptionCount(): number {
    return this.subscribers.size;
  }

  listProviderSubagents(parentAgentId: string): ProviderSubagentDescriptor[] {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.list(parentAgentId);
  }

  listProviderSubagentActivity(): ProviderSubagentDescriptor[] {
    const publicParentIds = new Set(
      Array.from(this.agents.values())
        .filter((agent) => !agent.internal)
        .map((agent) => agent.id),
    );
    return this.providerSubagents
      .listAll()
      .filter((subagent) => publicParentIds.has(subagent.parentAgentId));
  }

  getProviderSubagent(
    parentAgentId: string,
    subagentId: string,
  ): ProviderSubagentDescriptor | null {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.get(parentAgentId, subagentId);
  }

  fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): AgentTimelineFetchResult {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.fetchTimeline(parentAgentId, subagentId, options);
  }

  /**
   * Drop everything retained for an agent id: its committed timeline and any
   * provider-subagent projection hanging off it.
   */
  async deleteAgentState(agentId: string): Promise<void> {
    this.discardRetainedAgentState(agentId);
    await this.deleteCommittedTimeline(agentId);
  }

  private discardRetainedAgentState(agentId: string): void {
    this.timelineStore.delete(agentId);
    for (const event of this.providerSubagents.deleteParent(agentId)) {
      this.dispatch({ type: "provider_subagent", event });
    }
  }

  private requirePublicAgent(id: string): LiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.internal) {
      throw new Error(`Unknown agent '${agent.id}'`);
    }
    return agent;
  }

  createAgent(
    config: AgentSessionConfig,
    agentId: string | undefined,
    options: CreateAgentOptions,
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(this.createAgentInternal(config, agentId, options));
  }

  /**
   * Run a single tool-less provider completion for the internal
   * metadata-generation path (chat titles, branch/workspace names, commit/PR
   * text, voice cues, run summaries). This deliberately does NOT go through
   * createAgent → runAgent → closeAgent: no agent lifecycle, no
   * prepareSessionConfig/buildLaunchContext (which inject the Otto tool catalog
   * + MCP with no internal-agent exemption), and on Claude no `claude_code`
   * preset or CLAUDE.md. The prompt is self-contained, so a title costs a few
   * hundred tokens instead of the 15–25K a full spawn carries.
   *
   * Providers without a `generateBareCompletion` throw here; the structured
   * generation fallback ladder catches that and moves to the next provider, so
   * a provider that can't do a tool-less completion falls through instead of
   * erroring the whole generation.
   */
  async generateBareCompletion(
    config: AgentSessionConfig,
    prompt: string,
    // Optional finer label for the ledger row (e.g. "auto-title", "commit").
    // Callers may omit it; the row then reads as a generic generation.
    subtype?: string,
  ): Promise<string> {
    const normalized = await this.normalizeConfig(config, { resolveDefaultModel: true });
    this.requireEnabledProvider(normalized.provider);
    const client = await this.requireAvailableClient({ provider: normalized.provider });
    if (!client.generateBareCompletion) {
      throw new Error(`Provider '${normalized.provider}' does not support tool-less completion`);
    }
    const options: AgentBareCompletionOptions = {
      cwd: normalized.cwd,
      prompt,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.thinkingOptionId ? { thinkingOptionId: normalized.thinkingOptionId } : {}),
      ...(normalized.systemPrompt ? { systemPrompt: normalized.systemPrompt } : {}),
    };
    const result = await client.generateBareCompletion(options);
    // These bare completions bypass the turn path (WP-B), so their spend is
    // invisible to onStreamTurnCompleted's token counting. Record it here under
    // the "generations" category so the headline generation cost isn't zero. (WP-G)
    this.recordUsageActivity(result.usage, {
      category: "generations",
      provider: normalized.provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(subtype ? { subtype } : {}),
    });
    return result.text;
  }

  private async createAgentInternal(
    config: AgentSessionConfig,
    agentId: string | undefined,
    options: CreateAgentOptions,
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "createAgent");
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      config,
      resolvedAgentId,
      options?.env,
    );
    this.requireEnabledProvider(storedConfig.provider);
    const client = await this.requireAvailableClient({
      provider: storedConfig.provider,
    });
    const launchContext = await this.buildLaunchContext(
      resolvedAgentId,
      client,
      storedConfig.cwd,
      options?.env,
    );
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const createOptions = this.buildCreateSessionOptions(options);
    const session = await client.createSession(providerLaunchConfig, launchContext, createOptions);
    const managed = this.registerSession(session, storedConfig, resolvedAgentId, {
      labels: options.labels,
      initialTitle: options.initialTitle,
      workspaceId: options.workspaceId,
      ...(options.owner ? { owner: options.owner } : {}),
    });
    const spawnedPersonalityId = storedConfig.profileSnapshot?.profileId;
    if (spawnedPersonalityId) {
      this.onPersonalitySpawn?.(spawnedPersonalityId);
    }
    this.onActivity?.("agentsCreated");
    if (options.labels?.[PARENT_AGENT_ID_LABEL]) {
      this.onActivity?.("subagentsInvoked");
    }
    return managed;
  }

  private buildCreateSessionOptions(options?: {
    persistSession?: boolean;
  }): AgentCreateSessionOptions | undefined {
    return options?.persistSession === undefined
      ? undefined
      : { persistSession: options.persistSession };
  }

  // Reconstruct an agent from provider persistence. Callers should explicitly
  // hydrate timeline history after resume.
  resumeAgentFromPersistence(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      workspaceId?: string;
      /** Paseo: history loading is read-only for archived native sessions. */
      purpose?: "interactive" | "history";
    },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.resumeAgentFromPersistenceInternal(handle, overrides, agentId, options),
    );
  }

  private async resumeAgentFromPersistenceInternal(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      workspaceId?: string;
      /** Paseo: history loading is read-only for archived native sessions. */
      purpose?: "interactive" | "history";
    },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(
      agentId ?? this.idFactory(),
      "resumeAgentFromPersistence",
    );
    const metadata = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
    const mergedConfig = {
      ...metadata,
      ...overrides,
      provider: handle.provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      mergedConfig,
      resolvedAgentId,
    );

    const client = this.requireClient(handle.provider);
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${handle.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    // The purpose reaches the provider. Resuming an archived agent just to read
    // its history is not the same as resuming it to work in, and a provider that
    // cannot tell the difference does the full interactive setup for a session
    // nobody is going to type into.
    const session = await client.resumeSession(
      handle,
      providerLaunchConfig,
      launchContext,
      options?.purpose ? { purpose: options.purpose } : undefined,
    );
    return this.registerSession(session, storedConfig, resolvedAgentId, options);
  }

  importProviderSession(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    labels?: Record<string, string>;
  }): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(this.importProviderSessionInternal(input));
  }

  private async importProviderSessionInternal(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    labels?: Record<string, string>;
  }): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(this.idFactory(), "importProviderSession");
    this.requireEnabledProvider(input.provider);

    const client = await this.requireAvailableClient({ provider: input.provider });
    if (!client.importSession) {
      throw new Error(`Provider '${input.provider}' does not support importing sessions`);
    }

    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      {
        provider: input.provider,
        cwd: input.cwd,
      },
      resolvedAgentId,
    );
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const imported = await client.importSession(
      {
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
      },
      { config: providerLaunchConfig, storedConfig, launchContext },
    );
    let handedToRegistration = false;
    try {
      const importedConfig = await this.normalizeConfig(
        stripInternalOttoMcpServer(imported.config),
      );
      const timelineRows = buildImportedTimelineRows(imported.timeline);
      const initialTitle = resolveImportedAgentTitle(importedConfig, timelineRows);

      handedToRegistration = true;
      const registered = await this.registerSession(
        imported.session,
        importedConfig,
        resolvedAgentId,
        {
          labels: input.labels,
          workspaceId: input.workspaceId,
          timelineRows,
          timelineNextSeq: timelineRows.length + 1,
          persistence: imported.persistence,
          historyPrimed: true,
          initialTitle,
          publishWhenReady: true,
        },
      );
      // The provider reports the imported thread's children alongside its
      // timeline. Applied after registration so the parent exists to hang them
      // off; without this an imported session arrives with an empty subagent
      // rail even though the thread had children.
      for (const event of imported.providerSubagentEvents ?? []) {
        this.dispatch({
          type: "provider_subagent",
          event: this.providerSubagents.apply(resolvedAgentId, event.provider, event.event),
        });
      }
      return registered;
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(imported.session);
      }
    }
  }

  // Hot-reload an active agent session with config overrides. By default the
  // in-memory timeline is preserved (used for voice-mode toggles and similar
  // config swaps). When `rehydrateFromDisk` is set, the timeline is wiped so a
  // new epoch is minted and provider history is re-streamed - this is what the
  // user-facing "Reload agent" action wants when the on-disk session was
  // mutated outside Otto.
  reloadAgentSession(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.reloadAgentSessionInternal(agentId, overrides, options),
    );
  }

  private async reloadAgentSessionInternal(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    let existing = this.requireSessionAgent(agentId);
    if (this.hasInFlightRun(agentId)) {
      await this.cancelAgentRun(agentId);
      existing = this.requireSessionAgent(agentId);
    }
    const rehydrateFromDisk = options?.rehydrateFromDisk ?? false;
    const preservedHistoryPrimed = existing.historyPrimed;
    const preservedLastUsage = existing.lastUsage;
    const preservedLastError = existing.lastError;
    const preservedAttention = existing.attention;
    const handle = existing.persistence;
    const provider = handle?.provider ?? existing.provider;
    const client = this.requireClient(provider);
    const refreshConfig = {
      ...existing.config,
      ...overrides,
      provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(refreshConfig, agentId);
    const launchContext = await this.buildLaunchContext(agentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);

    const session = handle
      ? await client.resumeSession(handle, providerLaunchConfig, launchContext)
      : await client.createSession(providerLaunchConfig, launchContext);

    let handedToRegistration = false;
    try {
      this.assertAcceptingAgentRegistrations();

      const closedExisting = this.prepareAgentForClosure(existing, "agent reloaded");
      try {
        await this.persistSnapshot(closedExisting);
      } finally {
        await this.closeReloadedSession(existing.session, agentId);
      }

      if (rehydrateFromDisk) {
        // Wipe both durable and in-memory timeline so registerSession mints a
        // new epoch and hydrateTimelineFromProvider re-streams the freshly read
        // provider history into an empty timeline.
        await this.deleteCommittedTimeline(agentId);
        this.timelineStore.delete(agentId);
        // The provider children are part of that same replaced state. Leaving
        // them behind carries children of the previous session across a reload
        // whose whole point is to re-read from disk.
        for (const removal of this.providerSubagents.deleteParent(agentId)) {
          this.dispatch({ type: "provider_subagent", event: removal });
        }
      }

      // Preserve existing labels and timeline during reload.
      handedToRegistration = true;
      return this.registerSession(session, storedConfig, agentId, {
        labels: existing.labels,
        workspaceId: existing.workspaceId,
        ...(existing.owner ? { owner: existing.owner } : {}),
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        lastUserMessageAt: existing.lastUserMessageAt,
        historyPrimed: rehydrateFromDisk ? false : preservedHistoryPrimed,
        lastUsage: preservedLastUsage,
        lastError: preservedLastError,
        attention: preservedAttention,
      });
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(session);
      }
    }
  }

  private async closeReloadedSession(session: AgentSession, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.close(),
        timeoutMs: this.rescueTimeouts.reloadSessionCloseMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Previous session close failed after refresh timeout",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.reloadSessionCloseMs },
          "Timed out closing previous session during refresh",
        );
      }
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "Failed to close previous session during refresh");
    }
  }

  private async waitWithTimeout(options: TimeoutOptions): Promise<TimeoutResult> {
    let didTimeOut = false;
    let timer: NodeJS.Timeout | null = null;
    const operation = options.operation
      .then((): TimeoutResult => "completed")
      .catch((error) => {
        if (didTimeOut) {
          options.onLateError?.(error);
          return "timed_out" as const;
        }
        throw error;
      });

    try {
      return await Promise.race([
        operation,
        new Promise<TimeoutResult>((resolvePromise) => {
          timer = setTimeout(() => {
            didTimeOut = true;
            resolvePromise("timed_out");
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  closeAgent(agentId: string): Promise<void> {
    const existing = this.inFlightAgentCloses.get(agentId);
    if (existing) {
      return existing;
    }

    const close = this.closeAgentRuntime(agentId);
    this.inFlightAgentCloses.set(agentId, close);
    const clearClose = () => {
      if (this.inFlightAgentCloses.get(agentId) === close) {
        this.inFlightAgentCloses.delete(agentId);
      }
    };
    void close.then(clearClose, clearClose);
    return close;
  }

  /** Await an in-flight close started elsewhere; resolves immediately if none. */
  async waitForAgentClose(agentId: string): Promise<void> {
    await this.inFlightAgentCloses.get(agentId)?.catch(() => undefined);
  }

  /** Marks every still-running provider child of an agent as canceled. */
  private cancelRunningProviderSubagents(agent: LiveManagedAgent): void {
    for (const subagent of this.providerSubagents.list(agent.id)) {
      if (subagent.status !== "running") {
        continue;
      }
      const update = this.providerSubagents.apply(agent.id, agent.provider, {
        type: "upsert",
        id: subagent.id,
        status: "canceled",
      });
      this.dispatch({ type: "provider_subagent", event: update });
    }
  }

  private async closeAgentRuntime(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
      },
      "agent.manager.close.start",
    );
    // Let queued provider events land before deciding what is still running: a
    // child whose terminal status was already in flight when close was called
    // is recorded as the completion it was, rather than canceled on the way
    // past. Whatever is still running after that cannot outlive the session
    // that reported it, and left alone its status stays "running" so the rail
    // shows a live subagent under a closed parent.
    //
    // One event-loop turn, not flush(): flush also drains persistence, and a
    // close triggered from inside a persistence task then waits on itself.
    await new Promise<void>((resolveTurn) => yieldEventLoopTurn(resolveTurn));
    this.cancelRunningProviderSubagents(agent);
    const closedAgent = this.prepareAgentForClosure(agent, "agent closed");
    // A provider that fails to clean up must not take the closure with it. The
    // error still surfaces to the caller, but the record is persisted and the
    // closed state emitted first, so the agent is resumable instead of stuck
    // reading as live with no session behind it.
    let closeError: unknown;
    try {
      await agent.session.close();
    } catch (error) {
      closeError = error;
      this.logger.warn(
        { err: error, agentId, provider: agent.provider },
        "Provider session close failed; closing the agent anyway",
      );
    }
    this.timelineStore.delete(agentId);
    await this.persistSnapshot(closedAgent);
    this.emitClosedAgent(closedAgent, { persist: false });
    this.logger.trace(
      {
        agentId,
        provider: closedAgent.provider,
        sessionId: closedAgent.persistence?.sessionId ?? undefined,
      },
      "agent.manager.close.complete",
    );
    if (closeError) {
      throw closeError;
    }
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const agent = this.requireAgent(agentId);
    if (!this.registry) {
      throw new Error("Agent storage is not configured");
    }

    await this.registry.applySnapshot(agent, {
      internal: agent.internal,
    });
    const stored = await this.registry.get(agentId);
    if (!stored) {
      throw new Error(`Agent ${agentId} not found in storage after snapshot`);
    }

    const { archivedAt } = await this.markRecordArchived(stored);
    agent.updatedAt = new Date(archivedAt);
    await this.closeAgent(agentId);

    await this.cascadeArchiveChildren(agentId);

    return { archivedAt };
  }

  // Children created via the MCP `create_chat` tool carry the parent-agent-id
  // label pointing back at the caller. Archiving the parent cascades to those
  // children so subagent fleets don't outlive their orchestrator. Detached
  // handoff agents omit this label, so they stand outside the cascade.
  private async cascadeArchiveChildren(parentAgentId: string): Promise<void> {
    const registry = this.registry;
    if (!registry) {
      return;
    }
    const records = await registry.list();
    for (const record of records) {
      if (record.archivedAt) {
        continue;
      }
      if (record.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
        continue;
      }
      if (this.agents.has(record.id)) {
        await this.archiveAgent(record.id);
      } else {
        await this.markRecordArchived(record);
        await this.cascadeArchiveChildren(record.id);
      }
    }
  }

  private async markRecordArchived(record: StoredAgentRecord): Promise<ArchivedStoredAgentRecord> {
    const registry = this.requireRegistry();
    const archivedAt = new Date().toISOString();
    const archivedRecord = buildArchivedAgentRecord(record, { archivedAt, updatedAt: archivedAt });

    await registry.upsert(archivedRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(record.id)) {
      this.notifyAgentState(record.id);
    } else if (!archivedRecord.internal) {
      this.dispatchArchivedStoredAgent(archivedRecord);
    }

    await this.fireAgentArchived(record.id);

    return archivedRecord;
  }

  private async fireAgentArchived(agentId: string): Promise<void> {
    const callback = this.onAgentArchived;
    if (!callback) {
      return;
    }
    try {
      await callback(agentId);
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "onAgentArchived callback failed");
    }
  }

  private dispatchArchivedStoredAgent(record: StoredAgentRecord): void {
    const updatedAt = new Date(record.updatedAt);
    this.dispatch({
      type: "agent_state",
      agent: {
        id: record.id,
        provider: record.provider,
        cwd: record.cwd,
        workspaceId: record.workspaceId,
        session: null,
        capabilities: STORED_AGENT_CAPABILITIES,
        config: buildStoredAgentConfig(record),
        runtimeInfo: undefined,
        lifecycle: "closed",
        createdAt: new Date(record.createdAt),
        updatedAt,
        availableModes: [],
        features: record.features,
        currentModeId: record.lastModeId ?? null,
        pendingPermissions: new Map(),
        bufferedPermissionResolutions: new Map(),
        inFlightPermissionResponses: new Set(),
        pendingReplacement: false,
        steerQueue: [],
        pendingSteerDrain: false,
        activeForegroundTurnId: null,
        foregroundTurnWaiters: new Set(),
        finalizedForegroundTurnIds: new Set(),
        unsubscribeSession: null,
        persistence: record.persistence ?? null,
        historyPrimed: true,
        lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
        lastUsage: undefined,
        lastError: record.lastError ?? undefined,
        attention: { requiresAttention: false },
        internal: record.internal,
        labels: record.labels,
      },
    });
  }

  /**
   * Config mutations on one agent serialize through a per-agent promise chain:
   * the multi-await setters (setAgentPersonality resolves snapshots and applies
   * prompt + brain across several RPC hops) must not interleave with a racing
   * set_agent_model/mode/thinking and persist a mixed half-and-half state.
   */
  private readonly agentConfigMutations = new Map<string, Promise<void>>();

  /**
   * True while an explicit config mutation is in flight for this agent.
   *
   * Providers echo their own setters back as drift events, and those echoes can
   * land after a later explicit mutation has already been applied - setModel
   * emitting a thinking_option_changed carrying the pre-mutation value, for
   * instance. Config only records drift the provider raised on its own; an echo
   * would roll the newer explicit value back.
   */
  private hasConfigMutationInFlight(agentId: string): boolean {
    return this.agentConfigMutations.has(agentId);
  }

  /**
   * The three events by which a provider reports that its own model, mode, or
   * thinking option moved. All three land the same way: runtime state updates
   * unconditionally, stored config only when the change is genuine drift.
   */
  private onStreamConfigDrift(
    agent: ActiveManagedAgent,
    event: Extract<
      AgentStreamEvent,
      { type: "mode_changed" | "model_changed" | "thinking_option_changed" }
    >,
  ): void {
    if (event.type === "mode_changed") {
      agent.currentModeId = event.currentModeId;
      agent.availableModes = event.availableModes;
      this.applyConfigDrift(agent, { modeId: event.currentModeId ?? undefined });
      if (agent.runtimeInfo) {
        agent.runtimeInfo = { ...agent.runtimeInfo, modeId: event.currentModeId };
      }
      return;
    }
    if (event.type === "thinking_option_changed") {
      this.applyConfigDrift(agent, { thinkingOptionId: event.thinkingOptionId ?? undefined });
      if (agent.runtimeInfo) {
        agent.runtimeInfo = { ...agent.runtimeInfo, thinkingOptionId: event.thinkingOptionId };
      }
      return;
    }
    agent.runtimeInfo = event.runtimeInfo;
    this.applyConfigDrift(agent, {
      model: event.runtimeInfo.model ?? agent.config.model,
      modeId: event.runtimeInfo.modeId ?? agent.config.modeId,
      thinkingOptionId: event.runtimeInfo.thinkingOptionId ?? agent.config.thinkingOptionId,
    });
    if (!agent.persistence && event.runtimeInfo.sessionId) {
      agent.persistence = attachPersistenceCwd(
        { provider: agent.provider, sessionId: event.runtimeInfo.sessionId },
        agent.cwd,
      );
    }
    agent.currentModeId = event.runtimeInfo.modeId ?? agent.currentModeId;
  }

  /**
   * Records provider-side config drift on the agent's stored config, which is
   * what gets persisted and replayed on resume - drift that only reached
   * runtimeInfo was silently reverted by the next restart. Skipped entirely
   * while an explicit mutation is in flight, so a provider's echo of its own
   * setter cannot roll back the newer value.
   */
  private applyConfigDrift(
    agent: ActiveManagedAgent,
    patch: { model?: string; modeId?: string; thinkingOptionId?: string },
  ): void {
    if (this.hasConfigMutationInFlight(agent.id)) {
      return;
    }
    if ("model" in patch) agent.config.model = patch.model;
    if ("modeId" in patch) agent.config.modeId = patch.modeId;
    if ("thinkingOptionId" in patch) agent.config.thinkingOptionId = patch.thinkingOptionId;
  }

  private async withAgentConfigLock<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.agentConfigMutations.get(agentId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    this.agentConfigMutations.set(agentId, settled);
    const cleanup = async () => {
      await settled;
      if (this.agentConfigMutations.get(agentId) === settled) {
        this.agentConfigMutations.delete(agentId);
      }
    };
    void cleanup();
    return run;
  }

  async setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null> {
    return this.withAgentConfigLock(agentId, () => this.setAgentModeUnlocked(agentId, modeId));
  }

  private async setAgentModeUnlocked(
    agentId: string,
    modeId: string,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const notice = await this.applyModeToAgent(agent, agent.session, modeId);
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  /**
   * Push a mode onto a live session and mirror it onto the managed agent.
   * Shared by the mode setter and the model-pick exit below so both land the
   * agent's mode state the same way; neither emits, so the caller controls when.
   * The session is explicit because the personality path already holds one.
   */
  private async applyModeToAgent(
    agent: ManagedAgent,
    session: AgentSession,
    modeId: string,
  ): Promise<AgentProviderNotice | null> {
    const notice = (await session.setMode(modeId)) ?? null;
    const currentMode = (await session.getCurrentMode()) ?? modeId;
    agent.config.modeId = currentMode ?? undefined;
    agent.currentModeId = currentMode;
    // Update runtimeInfo to reflect the new mode
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
    }
    return notice;
  }

  async setAgentModel(
    agentId: string,
    modelId: string | null,
  ): Promise<AgentProviderNotice | null> {
    return this.withAgentConfigLock(agentId, () => this.setAgentModelUnlocked(agentId, modelId));
  }

  private async setAgentModelUnlocked(
    agentId: string,
    modelId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;

    if (agent.session.setModel) {
      await agent.session.setModel(normalizedModelId);
    }

    agent.config.model = normalizedModelId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, model: normalizedModelId };
    }
    // Only an explicit pick leaves a model-selecting mode. Clearing back to the
    // provider default (null) is the user declining to choose, which is exactly
    // what such a mode is for.
    const notice = normalizedModelId
      ? await this.exitModelSelectingMode(agent, agent.session)
      : null;
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  /**
   * A mode that picks the model for each turn (Claude's Auto) would silently
   * override a model that was just chosen, so choosing one moves the agent out
   * of it. Shared by the explicit pick and by a personality that carries a model
   * without carrying a mode. No-op for every provider whose modes don't claim
   * `selectsModel`.
   *
   * A failure to change the mode does not fail the model change: the caller
   * asked for a model and got one. It downgrades to a warning so the override is
   * named rather than left to be discovered on the next turn.
   */
  private async exitModelSelectingMode(
    agent: ManagedAgent,
    session: AgentSession,
  ): Promise<AgentProviderNotice | null> {
    const exitModeId = resolveModelPickExitModeId({
      provider: agent.provider,
      currentModeId: agent.currentModeId,
      availableModes: agent.availableModes,
    });
    if (!exitModeId) {
      return null;
    }
    const findLabel = (modeId: string | null | undefined): string =>
      agent.availableModes.find((mode) => mode.id === modeId)?.label ??
      modeId ??
      "the current mode";
    const previousLabel = findLabel(agent.currentModeId);
    try {
      await this.applyModeToAgent(agent, session, exitModeId);
    } catch (error) {
      this.logger.warn(
        { err: error, agentId: agent.id, provider: agent.provider, exitModeId },
        "agent.model.exit_mode_failed",
      );
      return {
        type: "warning",
        message: `${previousLabel} picks the model for each turn and could not be changed, so it may override this model.`,
      };
    }
    return {
      type: "info",
      message: `Switched off ${previousLabel} to ${findLabel(agent.currentModeId)}: it picks the model for each turn, which would override your choice.`,
    };
  }

  async setAgentThinkingOption(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    return this.withAgentConfigLock(agentId, () =>
      this.setAgentThinkingOptionUnlocked(agentId, thinkingOptionId),
    );
  }

  private async setAgentThinkingOptionUnlocked(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;

    let notice: AgentProviderNotice | null = null;
    if (agent.session.setThinkingOption) {
      notice = (await agent.session.setThinkingOption(normalizedThinkingOptionId)) ?? null;
    }

    agent.config.thinkingOptionId = normalizedThinkingOptionId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = {
        ...agent.runtimeInfo,
        thinkingOptionId: normalizedThinkingOptionId,
      };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  /**
   * Live-switch a running agent's personality (or clear it with null). The
   * prompt half goes through the session's applyPersonality (providers without
   * it reject - they cannot change a system prompt mid-conversation); the brain
   * half (model/mode/effort) rides the existing setters. Identity (name/spinner)
   * follows automatically: agent_state projects it from config.profileSnapshot.
   * The caller resolves the roster personality against the agent's cwd and
   * guarantees provider match; this method only applies.
   */
  async setAgentPersonality(
    agentId: string,
    snapshot: ResolvedProfileSnapshot | null,
  ): Promise<AgentProviderNotice | null> {
    return this.withAgentConfigLock(agentId, () =>
      this.setAgentPersonalityUnlocked(agentId, snapshot),
    );
  }

  private async setAgentPersonalityUnlocked(
    agentId: string,
    snapshot: ResolvedProfileSnapshot | null,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const session = agent.session;
    if (!session.applyPersonality) {
      throw new Error(
        `Provider '${agent.config.provider}' does not support switching personality on a running agent`,
      );
    }
    if (snapshot && snapshot.provider !== agent.config.provider) {
      throw new Error(
        `Personality "${snapshot.name}" targets provider '${snapshot.provider}', but this agent runs '${agent.config.provider}'`,
      );
    }

    // Prompt half. The personality prompt only owns config.systemPrompt when
    // the caller set none at spawn (mirrors applyPersonalityIdentityToConfig);
    // a caller-authored prompt survives the switch. The born team is frozen:
    // the prompt recomposes against the agent's teamSnapshot, never the
    // currently-active team - switching to an off-team personality keeps the
    // team prompt, and clearing the personality keeps team + brain, dropping
    // only the personality prompt.
    const teamSnapshot = agent.config.teamSnapshot;
    const outgoingPersonalityPrompt = agent.config.profileSnapshot?.systemPrompt;
    // Recompose the outgoing prompt with the SAME role directive it was born
    // with (its snapshot's roles) so the ownership comparison still matches the
    // stored systemPrompt; the incoming prompt takes the new personality's roles.
    const outgoingComposedPrompt = composeTeamAndPersonalityPrompt(
      teamSnapshot,
      outgoingPersonalityPrompt,
      agent.config.profileSnapshot?.roles,
    );
    const promptIsPersonalityOwned =
      agent.config.systemPrompt === undefined ||
      agent.config.systemPrompt === outgoingComposedPrompt ||
      agent.config.systemPrompt === outgoingPersonalityPrompt;
    const nextSystemPrompt = promptIsPersonalityOwned
      ? composeTeamAndPersonalityPrompt(teamSnapshot, snapshot?.systemPrompt, snapshot?.roles)
      : agent.config.systemPrompt;

    // The incoming personality brings its own lessons, so a live switch has to
    // re-resolve the brief exactly as a spawn would - otherwise switching to a
    // personality mid-chat gives you its prompt and its brain but not what it
    // has learned. The augmented prompt goes to the provider; `nextSystemPrompt`
    // (memory-free) is what persists, keeping the ownership check above valid.
    const promptWithMemory = promptIsPersonalityOwned
      ? await this.withPersonalityMemory(nextSystemPrompt, snapshot, agent.config.cwd)
      : nextSystemPrompt;
    const providerSystemPrompt = await this.withProjectKnowledge(
      promptWithMemory,
      agent.config.cwd,
    );

    const daemonAppendSystemPrompt = this.appendSystemPrompt.trim();
    const personalityUpdate: AgentPersonalityUpdate = {
      profileSnapshot: snapshot ?? undefined,
      systemPrompt: providerSystemPrompt,
      // Same rule as applyDaemonAppendSystemPrompt: a personality with
      // respectGlobalAppendPrompt === false owns its whole prompt.
      daemonAppendSystemPrompt:
        daemonAppendSystemPrompt && snapshot?.respectGlobalAppendPrompt !== false
          ? daemonAppendSystemPrompt
          : undefined,
    };
    const notices: (AgentProviderNotice | null)[] = [];

    // Brain half first - only when binding a personality; clearing keeps the
    // brain. Ordering matters for Claude: applyPersonality flags a query
    // restart, and the brain's setModel/setMode call ensureQuery, which would
    // then tear down + respawn the CLI synchronously inside this RPC. Brain
    // first rides the live query; the restart stays lazy (next turn).
    if (snapshot) {
      notices.push(...(await this.applyPersonalityBrain(agent, session, snapshot)));
    }
    notices.push((await session.applyPersonality(personalityUpdate)) ?? null);

    // Stored config: personality + prompt persist; daemonAppendSystemPrompt is
    // deliberately runtime-only (re-derived from daemon settings on resume).
    agent.config.profileSnapshot = snapshot ?? undefined;
    agent.config.systemPrompt = nextSystemPrompt;

    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notices.find((notice) => notice !== null) ?? null;
  }

  /**
   * Apply a personality's brain fields (model/effort/mode) to a live session and
   * mirror them onto the managed agent's config/runtimeInfo. Split out of
   * setAgentPersonality purely to keep that method under the complexity ceiling.
   */
  private async applyPersonalityBrain(
    agent: ManagedAgent,
    session: AgentSession,
    snapshot: ResolvedProfileSnapshot,
  ): Promise<(AgentProviderNotice | null)[]> {
    const notices: (AgentProviderNotice | null)[] = [];
    // Ordering carries two invariants:
    // 1. setMode is the fallible step (Claude rejects e.g. "auto" on
    //    Bedrock/Vertex), so it runs FIRST - a mode failure must not leave a
    //    half-applied switch (new model + old identity) behind.
    // 2. Mode and model ride the live query (Claude: ensureQuery + SDK
    //    setters) and run before setThinkingOption, which flags a query
    //    restart.
    if (snapshot.modeId !== undefined) {
      notices.push((await session.setMode(snapshot.modeId)) ?? null);
      const currentMode = (await session.getCurrentMode()) ?? snapshot.modeId;
      agent.config.modeId = currentMode ?? undefined;
      agent.currentModeId = currentMode;
      if (agent.runtimeInfo) {
        agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
      }
    }
    if (session.setModel) {
      await session.setModel(snapshot.model);
      agent.config.model = snapshot.model;
      if (agent.runtimeInfo) {
        agent.runtimeInfo = { ...agent.runtimeInfo, model: snapshot.model };
      }
    }
    // A personality that declares no mode leaves the agent in whatever mode it
    // was already in. If that mode picks the model itself, the personality's
    // model would silently lose to it, exactly as an explicit pick would - so
    // it leaves the mode on the same terms. A personality that DOES declare a
    // mode has already said what it wants, and that stands even when the mode
    // it names is the model-picking one.
    if (snapshot.modeId === undefined && snapshot.model) {
      notices.push(await this.exitModelSelectingMode(agent, session));
    }
    if (session.setThinkingOption) {
      // Always set - a snapshot without an effort (degraded or unspecified)
      // clears the previous personality's thinking option back to the model
      // default instead of silently carrying it onto the new model.
      notices.push((await session.setThinkingOption(snapshot.thinkingOptionId ?? null)) ?? null);
      agent.config.thinkingOptionId = snapshot.thinkingOptionId;
      if (agent.runtimeInfo) {
        agent.runtimeInfo = {
          ...agent.runtimeInfo,
          thinkingOptionId: snapshot.thinkingOptionId,
        };
      }
    }
    return notices;
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    return this.withAgentConfigLock(agentId, () =>
      this.setAgentFeatureUnlocked(agentId, featureId, value),
    );
  }

  private async setAgentFeatureUnlocked(
    agentId: string,
    featureId: string,
    value: unknown,
  ): Promise<void> {
    const agent = this.requireAgent(agentId);

    if (!agent.session.setFeature) {
      throw new Error("Agent session does not support setting features");
    }

    await agent.session.setFeature(featureId, value);
    agent.config.featureValues = { ...agent.config.featureValues, [featureId]: value };
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    if (
      this.agentsAwaitingInitialSnapshotPersist.has(agent.id) &&
      this.registry &&
      (await this.registry.get(agent.id)) === null
    ) {
      return;
    }
    this.touchUpdatedAt(agent);
    await this.persistSnapshot(agent, { title: normalizedTitle });
    this.emitState(agent, { persist: false });
  }

  async setLabels(agentId: string, labels: Record<string, string>): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.writeLabels(agent.id, labels);
  }

  private async writeLabels(agentId: string, patch: AgentLabelPatch): Promise<WriteLabelsResult> {
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      liveAgent.labels = applyLabelPatch(liveAgent.labels, patch);
      this.touchUpdatedAt(liveAgent);
      await this.persistSnapshot(liveAgent);
      this.emitState(liveAgent, { persist: false });
      const record = this.registry ? await this.registry.get(agentId) : null;
      return { record, live: true };
    }

    const nextRecord = await this.writeStoredMetadata(agentId, { labels: patch });
    return { record: nextRecord, live: false };
  }

  private async writeStoredMetadata(
    agentId: string,
    patch: AgentMetadataPatch,
  ): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = {
      ...record,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.labels ? { labels: applyLabelPatch(record.labels, patch.labels) } : {}),
      updatedAt: this.nextStoredUpdatedAt(record),
    };
    await registry.upsert(nextRecord);
    return nextRecord;
  }

  /**
   * Re-stamps which workspace owns a chat.
   *
   * A move and nothing more: ownership is the single `workspaceId` field, agent
   * state on disk is keyed by agent id rather than by workspace, and the timeline
   * store is keyed by agent id too, so there is nothing to migrate alongside it.
   *
   * Deliberately does **not** touch `cwd`. The two answer different questions
   * (see ManagedAgent.workspaceId) and are not required to agree, so a moved chat
   * keeps running where it was started. See `transferAgentWorkspaceCommand` for
   * the preconditions on the target workspace.
   */
  async transferAgentWorkspace(
    agentId: string,
    workspaceId: string,
  ): Promise<{ record: StoredAgentRecord; live: boolean }> {
    const registry = this.requireRegistry();
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      liveAgent.workspaceId = workspaceId;
      this.touchUpdatedAt(liveAgent);
      await this.persistSnapshot(liveAgent);
      // Broadcast so every client's ownership gate re-evaluates: the tab appears
      // in the target workspace and prunes from the source without either
      // workspace being told about it directly.
      this.emitState(liveAgent, { persist: false });
      const record = await registry.get(agentId);
      if (!record) {
        throw new Error(`Agent not found in storage after workspace transfer: ${agentId}`);
      }
      return { record, live: true };
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const nextRecord: StoredAgentRecord = {
      ...record,
      workspaceId,
      updatedAt: this.nextStoredUpdatedAt(record),
    };
    await registry.upsert(nextRecord);
    return { record: nextRecord, live: false };
  }

  async detachAgent(agentId: string): Promise<{
    record: StoredAgentRecord;
    live: boolean;
    previousParentAgentId: string | null;
  }> {
    const registry = this.requireRegistry();
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      const previousParentAgentId = getParentAgentIdFromLabels(liveAgent.labels);
      if (!previousParentAgentId) {
        await this.persistSnapshot(liveAgent);
        const record = await registry.get(agentId);
        if (!record) {
          throw new Error(`Agent not found in storage after detach: ${agentId}`);
        }
        return { record, live: true, previousParentAgentId: null };
      }

      const { record } = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
      if (!record) {
        throw new Error(`Agent not found in storage after detach: ${agentId}`);
      }
      return { record, live: true, previousParentAgentId };
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const previousParentAgentId = getParentAgentIdFromLabels(record.labels);
    if (!previousParentAgentId) {
      return { record, live: false, previousParentAgentId: null };
    }

    const result = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
    if (!result.record) {
      throw new Error(`Agent not found in storage after detach: ${agentId}`);
    }
    return { record: result.record, live: false, previousParentAgentId };
  }

  notifyAgentState(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.internal) {
      return;
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async clearAgentAttention(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.attention.requiresAttention) {
      agent.attention = { requiresAttention: false };
      await this.persistSnapshot(agent);
      this.emitState(agent, { persist: false });
    }
  }

  async archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      await this.persistSnapshot(liveAgent, {
        internal: liveAgent.internal,
      });
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const archivedRecord = buildArchivedAgentRecord(record, { archivedAt });
    // archiveBytes is stored on the record it measures. Find its fixed point
    // before persisting so the displayed value is exactly what cleanup reclaims.
    let archiveBytes = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next = Buffer.byteLength(
        JSON.stringify({ ...archivedRecord, archiveBytes }, null, 2),
        "utf8",
      );
      if (next === archiveBytes) break;
      archiveBytes = next;
    }
    const nextRecord = { ...archivedRecord, archiveBytes };
    await registry.upsert(nextRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(agentId)) {
      this.notifyAgentState(agentId);
    } else if (!nextRecord.internal) {
      this.dispatchArchivedStoredAgent(nextRecord);
    }

    // Same cascade archiveAgent performs. Reached when the parent was already
    // closed, which is exactly when it is easy to miss: without it a closed
    // orchestrator archives alone and its managed children stay behind.
    await this.cascadeArchiveChildren(agentId);

    await this.fireAgentArchived(agentId);

    return nextRecord;
  }

  async unarchiveSnapshot(
    agentId: string,
    updates?: { workspaceId?: string; labels?: AgentLabelPatch },
  ): Promise<boolean> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record || !record.archivedAt) {
      return false;
    }

    await this.unarchiveNativeSession(record.provider, record.persistence);

    await registry.upsert({
      ...record,
      ...(updates?.workspaceId ? { workspaceId: updates.workspaceId } : {}),
      ...(updates?.labels ? { labels: applyLabelPatch(record.labels, updates.labels) } : {}),
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    });

    if (this.getAgent(agentId)) {
      this.notifyAgentState(agentId);
    }
    return true;
  }

  async unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void> {
    const registry = this.requireRegistry();
    const records = await registry.list();
    const matched = records.find(
      (record) =>
        record.persistence?.provider === handle.provider &&
        record.persistence?.sessionId === handle.sessionId,
    );
    if (!matched) {
      return;
    }

    await this.unarchiveSnapshot(matched.id);
  }

  async updateAgentMetadata(
    agentId: string,
    updates: {
      title?: string;
      labels?: Record<string, string>;
    },
  ): Promise<void> {
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      if (updates.title) {
        await this.setTitle(agentId, updates.title);
      }
      if (updates.labels) {
        await this.writeLabels(agentId, updates.labels);
      }
      return;
    }

    await this.writeStoredMetadata(agentId, updates);
  }

  async runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const events = this.streamAgent(agentId, prompt, options);
    const timeline: AgentTimelineItem[] = [];
    let finalText = "";
    let usage: AgentUsage | undefined;
    let canceled = false;

    for await (const event of events) {
      if (event.type === "timeline") {
        timeline.push(event.item);
      } else if (event.type === "turn_completed") {
        usage = event.usage;
      } else if (event.type === "turn_failed") {
        throw new Error(this.formatTurnFailedMessage(event));
      } else if (event.type === "turn_canceled") {
        canceled = true;
      }
    }

    finalText = this.getLastAssistantMessageFromTimeline(timeline) ?? "";

    const agent = this.requireAgent(agentId);
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId) {
      throw new Error(`Agent ${agentId} has no persistence.sessionId after run completed`);
    }
    return {
      sessionId,
      finalText,
      usage,
      timeline,
      canceled,
    };
  }

  /**
   * Try to run a prompt out-of-band - i.e. without allocating a foreground turn
   * and without canceling any active turn. Returns true when the session
   * accepted the prompt as a side-effect command (e.g. /goal pause). Events
   * emitted by the handler flow through dispatchStream so they persist and
   * broadcast like normal timeline events.
   */
  tryRunOutOfBand(
    agentId: string,
    prompt: AgentPromptInput,
    runOptions?: AgentRunOptions,
  ): boolean {
    const agent = this.requireSessionAgent(agentId);
    const handler = agent.session.tryHandleOutOfBand?.(prompt);
    if (!handler) {
      return false;
    }
    const dispatch = (event: AgentStreamEvent): void => {
      // Persist timeline items so they show up in fetchAgentTimeline; broadcast
      // for live subscribers. Other event types are broadcast only.
      if (event.type === "timeline") {
        this.touchUpdatedAt(agent);
        const row = this.recordTimeline(agent.id, event.item);
        this.dispatchStream(agent.id, event, {
          seq: row.seq,
          epoch: this.timelineStore.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
        return;
      }
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    };

    // An out-of-band command allocates no turn, so no provider ever echoes the
    // prompt back the way startTurn does. Record it HERE, before the handler
    // runs, or the typed command exists only as the client's optimistic row:
    // absent from the persisted timeline, so it disappears on reload, and
    // unordered against the rows the handler goes on to emit - which is how a
    // /compact separator ends up rendered ABOVE the "/compact" the reader
    // typed. Emitting it first also gives it the lower seq, so the separator
    // sorts after it on every rehydration.
    const promptText = typeof prompt === "string" ? prompt : "";
    if (promptText && !isSystemInjectedEnvelope(promptText)) {
      const clientMessageId = normalizeClientMessageId(runOptions?.clientMessageId);
      dispatch({
        type: "timeline",
        provider: agent.provider,
        item: {
          type: "user_message",
          text: promptText,
          ...(runOptions?.messageId ? { messageId: runOptions.messageId } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
        },
      });
      agent.lastUserMessageAt = new Date();
      this.emitState(agent);
    }

    void (async () => {
      try {
        await handler.run({ emit: dispatch });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Out-of-band command failed";
        dispatch({
          type: "timeline",
          provider: agent.provider,
          item: { type: "assistant_message", text: `[Error] ${text}` },
        });
      }
    })();
    return true;
  }

  async appendTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    const row = this.recordTimeline(agentId, item);
    this.dispatchStream(
      agentId,
      {
        type: "timeline",
        item: row.item,
        provider: agent.provider,
      },
      {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agentId),
        timestamp: row.timestamp,
      },
    );
    await this.persistSnapshot(agent);
  }

  async emitLiveTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    this.dispatchStream(
      agentId,
      {
        // Live-only items skip the store, so they skip the bound recordTimeline
        // applies. The client renders these the same as persisted ones and
        // should not have to cope with a megabyte here either.
        type: "timeline",
        item: limitAgentTimelineItemContent(item),
        provider: agent.provider,
      },
      // No `seq` - this row was never committed, and that absence is how the
      // client tells a provisional apart from a persisted row. The epoch still
      // ships: without it a reconnecting client cannot tell whether the
      // provisional it is holding predates a rewind, so it kept replaying stale
      // provisionals across the reconnect.
      { epoch: this.timelineStore.getEpoch(agentId) },
    );
  }

  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const existingAgent = this.requireSessionAgent(agentId);
    this.logger.trace(
      {
        agentId,
        provider: existingAgent.provider,
        sessionId: existingAgent.persistence?.sessionId ?? undefined,
        turnId: existingAgent.activeForegroundTurnId ?? undefined,
        lifecycle: existingAgent.lifecycle,
        activeForegroundTurnId: existingAgent.activeForegroundTurnId,
        hasPendingForegroundRun: this.foregroundRuns.hasPendingRun(agentId),
        promptType: typeof prompt === "string" ? "string" : "structured",
        hasRunOptions: Boolean(options),
      },
      "agent.manager.stream.request",
    );
    if (existingAgent.activeForegroundTurnId || this.foregroundRuns.hasPendingRun(agentId)) {
      this.logger.trace(
        {
          agentId,
          provider: existingAgent.provider,
          sessionId: existingAgent.persistence?.sessionId ?? undefined,
          turnId: existingAgent.activeForegroundTurnId ?? undefined,
          lifecycle: existingAgent.lifecycle,
          hasPendingForegroundRun: this.foregroundRuns.hasPendingRun(agentId),
        },
        "agent.manager.stream.reject",
      );
      throw new Error(`Agent ${agentId} already has an active run`);
    }

    const agent = existingAgent;
    agent.pendingSteerDrain = false;
    // A new run resumes the queue: the hold only ever covered the finalize of
    // the turn that was cancelled.
    agent.steerQueueHeld = false;
    agent.lastError = undefined;

    // Passive stale-todo nudge: ride a reminder along on this turn if the agent
    // has an open todo list. Stripped from the recorded user message for display
    // (normalizeUserMessageForDisplay); the provider still sees it this turn.
    const effectivePrompt = this.maybeAppendTodoNudge(agent, prompt);
    const isCompact = isCompactCommand(prompt);

    const pendingRun = this.foregroundRuns.createPendingRun(agentId);

    const streamForwarder = async function* streamForwarder(this: AgentManager) {
      let turnId: string;
      let turnStream: ReturnType<AgentRunState["createTurnStream"]> | null = null;
      try {
        const result = await agent.session.startTurn(effectivePrompt, options);
        turnId = result.turnId;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Failed to start turn";
        await this.handleStreamEvent(agent, {
          type: "turn_failed",
          provider: agent.provider,
          error: errorMsg,
        });
        this.finalizeForegroundTurn(agent);
        this.foregroundRuns.settleForegroundRun(agentId, pendingRun.token);
        throw error;
      }

      pendingRun.started = true;
      agent.activeForegroundTurnId = turnId;
      if (isCompact) {
        this.silentCompletionTurnIds.set(agentId, turnId);
      } else {
        this.silentCompletionTurnIds.delete(agentId);
      }
      // Cleared here, not when the run was requested: between the old turn
      // being cancelled and this one becoming current there is a gap in which
      // the old turn's terminal event can still arrive. The flag is what stops
      // that stale terminal from reporting the agent idle, so it has to survive
      // until a replacement turn is actually current.
      agent.pendingReplacement = false;
      agent.lifecycle = "running";
      this.touchUpdatedAt(agent);
      this.emitState(agent);
      this.logger.trace(
        {
          agentId,
          provider: agent.provider,
          sessionId: agent.persistence?.sessionId ?? undefined,
          turnId,
          lifecycle: agent.lifecycle,
          activeForegroundTurnId: agent.activeForegroundTurnId,
        },
        "agent.manager.stream.start",
      );

      turnStream = this.foregroundRuns.createTurnStream(turnId);
      this.foregroundRuns.addWaiter(agent, turnStream.waiter);

      try {
        for await (const event of turnStream.events(isTurnTerminalEvent)) {
          yield event;
        }
      } finally {
        if (turnStream) {
          this.foregroundRuns.deleteWaiter(agent, turnStream.waiter);
        }
        this.foregroundRuns.settleForegroundRun(agentId, pendingRun.token);
        if (!agent.activeForegroundTurnId) {
          await this.refreshRuntimeInfo(agent);
        }
      }
    }.call(this);

    return streamForwarder;
  }

  private finalizeForegroundTurn(agent: ActiveManagedAgent, turnId?: string): void {
    const mutableAgent = agent;
    if (turnId) {
      this.foregroundRuns.rememberFinalizedTurn(mutableAgent, turnId);
    }
    mutableAgent.activeForegroundTurnId = null;
    const terminalError = mutableAgent.lastError;
    const shouldHoldBusyForReplacement = mutableAgent.pendingReplacement && !terminalError;
    // Before the drain is decided: if this turn would otherwise leave the agent
    // idle with a stale todo list, park a one-shot reconcile turn on the queue so
    // the drain below runs it instead of going idle. Enqueuing here (not in the
    // idle-attention hook) reuses the existing steer machinery and avoids
    // re-entering the turn lifecycle. The method owns its own guards.
    this.maybeEnqueueTodoReconcile(mutableAgent);
    // Queue drain. Decided SYNCHRONOUSLY here, before the state emit, so a
    // message enqueued while the handoff is in flight sees a busy agent and is
    // buffered instead of racing into a second concurrent turn. A terminal
    // error (or a replacement already holding the slot) skips the drain: a
    // queued turn must never run unprompted into a broken session - the queue
    // is held and surfaced so the supervisor decides. A cancel holds it for the
    // same reason: the user pressed stop, so nothing new starts on its own,
    // and the queue stays put for them to send when ready.
    const drainBatch =
      !shouldHoldBusyForReplacement && !terminalError && !mutableAgent.steerQueueHeld
        ? takeNextSteerQueueBatch(mutableAgent.steerQueue)
        : null;
    if (drainBatch) {
      mutableAgent.steerQueue = drainBatch.rest;
      mutableAgent.pendingSteerDrain = true;
    }
    let nextLifecycle: "running" | "error" | "idle";
    if (shouldHoldBusyForReplacement || drainBatch) {
      nextLifecycle = "running";
    } else if (terminalError) {
      nextLifecycle = "error";
    } else {
      nextLifecycle = "idle";
    }
    mutableAgent.lifecycle = nextLifecycle;
    const persistenceHandle =
      mutableAgent.session.describePersistence() ??
      (mutableAgent.runtimeInfo?.sessionId
        ? { provider: mutableAgent.provider, sessionId: mutableAgent.runtimeInfo.sessionId }
        : null);
    if (persistenceHandle) {
      mutableAgent.persistence = attachPersistenceCwd(persistenceHandle, mutableAgent.cwd);
    }
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: mutableAgent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: mutableAgent.lifecycle,
        terminalError,
        pendingReplacement: mutableAgent.pendingReplacement,
        steerDrainSize: drainBatch?.entries.length ?? 0,
        steerQueueSize: mutableAgent.steerQueue.length,
      },
      "agent.manager.finalize",
    );
    if (!shouldHoldBusyForReplacement) {
      this.touchUpdatedAt(mutableAgent);
      this.emitState(mutableAgent);
    }
    if (drainBatch) {
      void this.dispatchSteerQueueBatch(agent.id, drainBatch.entries);
    }
  }

  /**
   * Park a one-shot todo reconcile turn on the queue when a turn is about to
   * leave the agent idle with a stale todo list (rows still open). The caller
   * runs this before deciding the drain, so the parked entry is picked up as the
   * next turn - the agent finishes the list instead of leaving a half-checked
   * one for the user to dismiss. Provider-agnostic: reads Otto's own `todo`
   * timeline item, which every provider's native todo tool feeds.
   *
   * Guards: opt-in via agentBehaviors.todoReconcileOnIdle; never for internal
   * agents; skips a turn that errored, is being replaced, or whose queue is held
   * (nothing new runs on its own then); only when the agent would otherwise go
   * idle (nothing already queued); and at most once per unique list state, so an
   * unchanged stale list (the agent explained why rows stay open) never re-fires.
   */
  private maybeEnqueueTodoReconcile(agent: ActiveManagedAgent): void {
    if (!this.agentBehaviors.todoReconcileOnIdle || agent.internal) {
      return;
    }
    // Mirror the drain's own preconditions: a terminal error, a pending
    // replacement, or a held queue all mean nothing should start on its own.
    if (agent.lastError || agent.pendingReplacement || agent.steerQueueHeld) {
      return;
    }
    // Only when the agent would otherwise become idle. A non-empty queue means
    // real work is already lined up to run next; don't jump ahead of it.
    if (agent.steerQueue.length > 0 || agent.session === null) {
      return;
    }
    const todo = findLatestTodoItem(this.timelineStore.getItems(agent.id));
    if (!isStaleTodoList(todo)) {
      // Clean (or absent) list: clear the guard so a future stale list can fire.
      this.lastReconciledTodoSignature.delete(agent.id);
      return;
    }
    const signature = todoListSignature(todo);
    if (this.lastReconciledTodoSignature.get(agent.id) === signature) {
      return;
    }
    this.lastReconciledTodoSignature.set(agent.id, signature);
    const entry = createSteerQueueEntry({
      prompt: formatSystemNotificationPrompt(buildTodoReconcileMessage(todo)),
      source: "system",
    });
    agent.steerQueue = [...agent.steerQueue, entry];
    this.logger.debug(
      { agentId: agent.id, provider: agent.provider, openItems: todo.items.length },
      "agent.manager.todo_reconcile.enqueue",
    );
  }

  /**
   * Attach the passive stale-todo reminder to an outgoing turn's prompt when the
   * agent has an open todo list. Opt-in via agentBehaviors.todoNudge; never for
   * internal agents; never for system-injected turns (chat mentions, schedule
   * fires, the idle reconcile pass carry their own envelope). Provider-agnostic -
   * runs at the one seam every provider's startTurn flows through.
   */
  private maybeAppendTodoNudge(
    agent: ActiveManagedAgent,
    prompt: AgentPromptInput,
  ): AgentPromptInput {
    if (!this.agentBehaviors.todoNudge || agent.internal) {
      return prompt;
    }
    if (typeof prompt === "string" && isSystemInjectedEnvelope(prompt)) {
      return prompt;
    }
    const todo = findLatestTodoItem(this.timelineStore.getItems(agent.id));
    if (!isStaleTodoList(todo)) {
      return prompt;
    }
    return appendTodoNudgeToPrompt(prompt, todo);
  }

  /**
   * Deliver a drained batch as the agent's next turn.
   *
   * Async because the just-finalized turn's stream generator settles its
   * pending run in a `finally` that has not run yet - `streamAgent` rejects
   * with "already has an active run" until it does. `pendingSteerDrain` holds
   * the agent visibly `running` across that gap.
   */
  private async dispatchSteerQueueBatch(
    agentId: string,
    entries: SteerQueueEntry[],
  ): Promise<void> {
    try {
      const pendingRun = this.foregroundRuns.getPendingRun(agentId);
      if (pendingRun && !pendingRun.settled) {
        await pendingRun.settledPromise;
      }

      // A closed agent is already out of `this.agents`, and prepareAgentForClosure
      // empties its queue - nothing left to deliver.
      const agent = this.agents.get(agentId);
      if (!agent || !agent.pendingSteerDrain) {
        return;
      }
      // Something else claimed the turn slot while we waited (an interrupting
      // send, a rewind). Put the batch back at the head rather than starting a
      // second concurrent turn - the next finalize drains it.
      if (agent.activeForegroundTurnId || this.foregroundRuns.hasPendingRun(agentId)) {
        agent.pendingSteerDrain = false;
        agent.steerQueue = [...entries, ...agent.steerQueue];
        this.emitState(agent);
        return;
      }

      const merged = mergeSteerQueueBatch(entries);
      this.logger.debug(
        { agentId, provider: agent.provider, entryCount: entries.length },
        "agent.manager.steer_queue.dispatch",
      );
      for await (const _ of this.streamAgent(agentId, merged.prompt, merged.runOptions)) {
        // Events are broadcast via AgentManager subscribers.
      }
    } catch (error) {
      this.logger.error({ err: error, agentId }, "agent.manager.steer_queue.dispatch_failed");
      const agent = this.agents.get(agentId);
      if (agent && agent.pendingSteerDrain) {
        agent.pendingSteerDrain = false;
        if (!agent.activeForegroundTurnId && agent.lifecycle === "running") {
          (agent as ActiveManagedAgent).lifecycle = "idle";
        }
        this.touchUpdatedAt(agent);
        this.emitState(agent);
      }
    }
  }

  /**
   * Park a prompt for delivery as the agent's next turn instead of interrupting
   * the one in flight (`delivery: "queue"`).
   *
   * Returns `{ queued: false }` when the agent is idle right now - the caller
   * dispatches immediately, because "queue" means "don't interrupt", not "wait".
   * The busy check and the push happen in one synchronous block, so the answer
   * cannot go stale between them.
   *
   * An agent with no live session cannot be busy, so it reports "not queued"
   * rather than throwing: `delivery: "queue"` must never be the reason a prompt
   * fails to reach an agent that would have accepted it as `interrupt`. This
   * matters for the system-injected senders (chat mentions, notify-on-finish),
   * whose target may be closed or not yet revived.
   */
  enqueueSteerMessage(
    agentId: string,
    prompt: AgentPromptInput,
    options?: { runOptions?: AgentRunOptions; source?: "user" | "system" },
  ): { queued: boolean; entry?: SteerQueueEntry } {
    const agent = this.agents.get(agentId);
    if (!agent || agent.session === null) {
      return { queued: false };
    }
    if (!this.hasInFlightRun(agentId) && !agent.pendingSteerDrain) {
      return { queued: false };
    }

    const entry = createSteerQueueEntry({
      prompt,
      ...(options?.runOptions ? { runOptions: options.runOptions } : {}),
      ...(options?.source ? { source: options.source } : {}),
    });
    agent.steerQueue = [...agent.steerQueue, entry];
    this.logger.debug(
      { agentId, provider: agent.provider, queueSize: agent.steerQueue.length },
      "agent.manager.steer_queue.enqueue",
    );

    // A terminal event finalizes the turn before the stream generator settles
    // its pending-run record. If a queue request lands after that finalize has
    // chosen idle but before the pending run is cleared, the normal finalize
    // drain has already been missed. Claim the batch here and let the existing
    // dispatcher wait for the old generator to settle before starting it.
    if (
      agent.lifecycle === "idle" &&
      !agent.activeForegroundTurnId &&
      !agent.pendingSteerDrain &&
      this.foregroundRuns.hasPendingRun(agentId)
    ) {
      const drainBatch = takeNextSteerQueueBatch(agent.steerQueue);
      if (drainBatch) {
        agent.steerQueue = drainBatch.rest;
        agent.pendingSteerDrain = true;
        (agent as ActiveManagedAgent).lifecycle = "running";
        void this.dispatchSteerQueueBatch(agentId, drainBatch.entries);
      }
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return { queued: true, entry };
  }

  getSteerQueue(agentId: string): SteerQueueEntry[] {
    return this.agents.get(agentId)?.steerQueue ?? [];
  }

  /**
   * Re-order the queue (Queue-track move up / move down).
   *
   * Order is the whole point of a FIFO, so this is the one edit that changes
   * what the next turn says without changing what is in the queue. Returns
   * false when the entry is already gone or the move is a no-op.
   */
  reorderSteerQueueEntry(agentId: string, entryId: string, toIndex: number): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    const reordered = moveSteerQueueEntry(agent.steerQueue, entryId, toIndex);
    if (!reordered) {
      return false;
    }
    agent.steerQueue = reordered;
    this.logger.debug(
      { agentId, provider: agent.provider, entryId, toIndex },
      "agent.manager.steer_queue.reorder",
    );
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return true;
  }

  /** Pull one entry back out of the queue (Queue-track edit / send now). */
  removeSteerQueueEntry(agentId: string, entryId: string): SteerQueueEntry | null {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }
    const entry = agent.steerQueue.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return null;
    }
    agent.steerQueue = agent.steerQueue.filter((candidate) => candidate.id !== entryId);
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return entry;
  }

  /**
   * Keep the queue, but stop the cancelled turn from draining it.
   *
   * Cancel used to empty the queue outright, on the theory that "stop
   * everything" includes the work lined up behind it. In practice the messages
   * you queued are the ones you still want: stopping the run is how you make
   * room for them, so wiping them destroys work the user typed. So stop now
   * means exactly what it says - nothing new starts by itself - while the
   * entries stay in the Queue track, ready to edit or send.
   *
   * Returns how many entries were held (0 when there was no queue), purely for
   * logging.
   */
  holdSteerQueue(agentId: string): number {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return 0;
    }
    agent.steerQueueHeld = true;
    return agent.steerQueue.length;
  }

  /**
   * Drop every queued message - the explicit "clear the queue" verb behind
   * `agent.queue.clear`, and the way a closing agent sheds its queue. Cancel
   * does NOT come through here; see `holdSteerQueue`.
   */
  clearSteerQueue(agentId: string): number {
    const agent = this.agents.get(agentId);
    if (!agent || agent.steerQueue.length === 0) {
      return 0;
    }
    const cleared = agent.steerQueue.length;
    agent.steerQueue = [];
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return cleared;
  }

  replaceAgentRun(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const snapshot = this.requireAgent(agentId);
    if (
      snapshot.lifecycle !== "running" &&
      !snapshot.activeForegroundTurnId &&
      !this.foregroundRuns.hasPendingRun(agentId)
    ) {
      return this.streamAgent(agentId, prompt, options);
    }

    const agent = this.requireSessionAgent(agentId);
    agent.pendingReplacement = true;
    agent.lifecycle = "running";
    this.touchUpdatedAt(agent);
    this.emitState(agent);

    // Started here rather than inside the generator: "replace this run" means
    // stop the current one now, not whenever something gets around to draining
    // the replacement's stream. A refused cancel means the previous run is
    // still going, and starting the replacement anyway would leave two turns
    // live against one session.
    const cancellation = (async () => {
      const result = await this.cancelAgentRun(agentId);
      if (result.status === "refused") {
        throw new AgentRunCancellationError(agentId, "replace");
      }
    })();
    // The generator below is the only consumer, but it may not be driven for a
    // while; park the rejection so it is not reported as unhandled first.
    cancellation.catch(() => undefined);

    return async function* replaceRunForwarder(this: AgentManager) {
      try {
        await cancellation;
        const nextRun = this.streamAgent(agentId, prompt, options);
        for await (const event of nextRun) {
          yield event;
        }
      } catch (error) {
        const latest = this.agents.get(agentId);
        if (latest) {
          const latestActive = latest;
          latestActive.pendingReplacement = false;
          // A refused cancellation leaves the original run in place, so the
          // agent really is still running and must keep saying so. Only a
          // replacement that failed after the cancel succeeded leaves nothing
          // behind to be running.
          const originalRunStillLive = error instanceof AgentRunCancellationError;
          if (
            !originalRunStillLive &&
            !latestActive.activeForegroundTurnId &&
            latestActive.lifecycle === "running"
          ) {
            (latestActive as ActiveManagedAgent).lifecycle = "idle";
          }
          this.touchUpdatedAt(latestActive);
          this.emitState(latestActive);
        }
        throw error;
      }
    }.call(this);
  }

  async waitForAgentRunStart(agentId: string, options?: WaitForAgentStartOptions): Promise<void> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingRun = this.foregroundRuns.getPendingRun(agentId);
    const heldForHandoff = snapshot.pendingReplacement || snapshot.pendingSteerDrain;
    if ((snapshot.lifecycle === "running" || pendingRun?.started) && !heldForHandoff) {
      return;
    }

    if (!snapshot.activeForegroundTurnId && !pendingRun && !heldForHandoff) {
      throw new Error(`Agent ${agentId} has no pending run`);
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent_start aborted");
    }

    await new Promise<void>((resolvePromise, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent_start aborted"));
        return;
      }

      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finishOk = () => {
        cleanup();
        resolvePromise();
      };

      const finishErr = (error: unknown) => {
        cleanup();
        reject(error);
      };

      if (options?.signal) {
        abortHandler = () =>
          finishErr(createAbortError(options.signal, "wait_for_agent_start aborted"));
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      const checkCurrentState = () => {
        const current = this.getAgent(agentId);
        if (!current) {
          finishErr(new Error(`Agent ${agentId} not found`));
          return true;
        }

        const currentPendingRun = this.foregroundRuns.getPendingRun(agentId);
        const currentHeldForHandoff = current.pendingReplacement || current.pendingSteerDrain;
        if (
          (current.lifecycle === "running" || currentPendingRun?.started) &&
          !currentHeldForHandoff
        ) {
          finishOk();
          return true;
        }

        if (current.lifecycle === "error" && !currentPendingRun?.started) {
          finishErr(new Error(current.lastError ?? `Agent ${agentId} failed to start`));
          return true;
        }

        if (!currentPendingRun && !current.activeForegroundTurnId && !currentHeldForHandoff) {
          finishErr(new Error(`Agent ${agentId} run finished before starting`));
          return true;
        }

        return false;
      };

      unsubscribe = this.subscribe(
        (event) => {
          if (event.type !== "agent_state" || event.agent.id !== agentId) {
            return;
          }
          checkCurrentState();
        },
        { agentId, replayState: false },
      );

      checkCurrentState();
    });
  }

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const agent = this.requireAgent(agentId);
    agent.inFlightPermissionResponses.add(requestId);

    try {
      const result = await agent.session.respondToPermission(requestId, response);
      agent.pendingPermissions.delete(requestId);

      try {
        await this.refreshSessionState(agent);
      } catch {
        // Ignore refresh errors - state sync after permission approval is best effort.
      }

      this.touchUpdatedAt(agent);
      this.emitState(agent);
      // The refreshed state is out, so the ordering obligation this buffer
      // exists to enforce is discharged - drop the marker HERE rather than in
      // `finally`. Holding it across `persistSnapshot` kept buffering
      // resolutions behind a disk write, and a provider that answers faster
      // than the disk (any local one) finished its whole turn in that window,
      // so the client saw `turn_completed` with no `permission_resolved` at
      // all. Past this line a resolution takes the normal dispatch path.
      agent.inFlightPermissionResponses.delete(requestId);
      this.flushBufferedPermissionResolution(agent, requestId);
      await this.persistSnapshot(agent);

      return result;
    } finally {
      agent.inFlightPermissionResponses.delete(requestId);
      // Deleting the in-flight marker first means a resolution that arrives
      // from here on dispatches through the normal path. Anything already
      // buffered still has to be flushed rather than dropped: discarding it
      // silently loses the only signal the client gets that its own approval
      // took effect.
      this.flushBufferedPermissionResolution(agent, requestId);
    }
  }

  private flushBufferedPermissionResolution(agent: ActiveManagedAgent, requestId: string): void {
    const buffered = agent.bufferedPermissionResolutions.get(requestId);
    if (!buffered) {
      return;
    }
    agent.bufferedPermissionResolutions.delete(requestId);
    this.dispatchStream(agent.id, buffered, { timestamp: new Date().toISOString() });
  }

  /**
   * Paseo widened this from boolean to a tri-state so callers can tell
   * "nothing was running" from "we cancelled it" from "the provider refused".
   * Otto adopts the contract; our implementation never produces `refused`
   * because it force-cancels rather than giving up.
   */
  async cancelAgentRun(agentId: string): Promise<AgentRunCancellationResult> {
    const agent = this.requireSessionAgent(agentId);
    const pendingRun = this.foregroundRuns.getPendingRun(agentId);
    const foregroundTurnId = agent.activeForegroundTurnId;
    const hasForegroundTurn = Boolean(foregroundTurnId);
    const isAutonomousRunning = agent.lifecycle === "running" && !hasForegroundTurn && !pendingRun;

    if (!hasForegroundTurn && !isAutonomousRunning && !pendingRun) {
      return { status: "not_running" };
    }

    // Stop means stop. Without the hold, finalizing the cancelled turn drains
    // the steer queue, so pressing Stop immediately started the agent again on
    // whatever was queued behind it. The hold covers this turn only; the next
    // run clears it and the queue rides behind that one instead.
    this.holdSteerQueue(agentId);

    const interruptOutcome = await this.interruptSession(agent.session, agentId);
    if (interruptOutcome !== "acknowledged" && this.isRunStillActive(agent, foregroundTurnId)) {
      // The provider never accepted the interrupt and its work is still going.
      // Refuse rather than force-dispatching a synthetic turn_canceled: that
      // would clear activeForegroundTurnId and settle the waiters, leaving the
      // UI showing a stopped agent that is in fact still running and still
      // spending tokens. The caller surfaces the refusal so the user can retry.
      //
      // A rejected interrupt is not automatically a refusal: providers commonly
      // reject because the turn just finished on its own, and that is a genuine
      // settle, which is why this checks the run rather than the outcome alone.
      return { status: "refused" };
    }

    // The interrupt will produce a turn_canceled/turn_failed event via subscribe(),
    // which flows through the session event dispatcher and settles the foreground turn waiter.
    // Wait briefly for the event to propagate if there's an active foreground turn.
    if (foregroundTurnId) {
      await this.waitForForegroundTurnToSettle(agent, foregroundTurnId, pendingRun);
    } else if (pendingRun) {
      const timeout = new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2000));
      await Promise.race([pendingRun.settledPromise, timeout]);
    } else if (isAutonomousRunning) {
      // An autonomous run has no foreground turn and no pending run to wait on,
      // so cancel used to return the moment the provider acknowledged the
      // interrupt - before the agent had actually stopped. Wait for it to leave
      // the running lifecycle so a resolved cancel means stopped.
      await this.waitForAgentToLeaveRunning(agentId);
    }

    // If the foreground turn is still stuck after the timeout, force-dispatch a
    // synthetic turn_canceled so the normal event pipeline cleans up
    // activeForegroundTurnId, settles waiters, and unblocks the streamForwarder.
    if (foregroundTurnId && agent.activeForegroundTurnId === foregroundTurnId) {
      this.logger.warn(
        { agentId, foregroundTurnId },
        "cancelAgentRun: foreground turn still active after timeout, force-canceling",
      );
      void this.dispatchSessionEvent(agent, {
        type: "turn_canceled",
        provider: agent.provider,
        reason: "interrupted",
        turnId: foregroundTurnId,
      });
      // The synthetic event unblocks the streamForwarder generator, whose finally
      // block settles the pending foreground run asynchronously. Wait for it.
      const staleRun = this.foregroundRuns.getPendingRun(agentId);
      if (staleRun && !staleRun.settled) {
        await staleRun.settledPromise;
      }
    }

    // Clear any pending permissions that weren't cleaned up by handleStreamEvent.
    if (agent.pendingPermissions.size > 0) {
      for (const [requestId] of agent.pendingPermissions) {
        this.dispatchStream(
          agent.id,
          {
            type: "permission_resolved",
            provider: agent.provider,
            requestId,
            resolution: { behavior: "deny", message: "Interrupted" },
          },
          { timestamp: new Date().toISOString() },
        );
      }
      agent.pendingPermissions.clear();
      this.touchUpdatedAt(agent);
      this.emitState(agent);
    }

    return { status: "settled" };
  }

  /**
   * Waits for an interrupted foreground turn to actually settle. The interrupt
   * produces a turn_canceled/turn_failed through the session event dispatcher;
   * this waits for that to land, then for the pending run to be torn down, so a
   * following streamAgent does not trip over a stale entry.
   */
  private async waitForForegroundTurnToSettle(
    agent: ManagedAgent,
    foregroundTurnId: string,
    pendingRun: PendingForegroundRun | null,
  ): Promise<void> {
    const agentId = agent.id;
    const waiter = Array.from(agent.foregroundTurnWaiters).find(
      (candidate) => candidate.turnId === foregroundTurnId,
    );
    const timeout = new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2000));
    if (waiter) {
      await Promise.race([waiter.settledPromise, timeout]);
    } else if (agent.activeForegroundTurnId === foregroundTurnId) {
      await Promise.race([
        new Promise<void>((resolvePromise) => {
          const unsubscribe = this.subscribe(
            (event) => {
              if (
                event.type === "agent_state" &&
                event.agent.id === agentId &&
                !event.agent.activeForegroundTurnId
              ) {
                unsubscribe();
                resolvePromise();
              }
            },
            { agentId, replayState: false },
          );
        }),
        timeout,
      ]);
    }
    if (pendingRun && !pendingRun.settled) {
      await Promise.race([pendingRun.settledPromise, timeout]);
    }
  }

  /** Resolves when the agent stops reporting `running`, or after 2s. */
  private async waitForAgentToLeaveRunning(agentId: string): Promise<void> {
    if (this.agents.get(agentId)?.lifecycle !== "running") {
      return;
    }
    await Promise.race([
      new Promise<void>((resolvePromise) => {
        const unsubscribe = this.subscribe(
          (event) => {
            if (
              event.type === "agent_state" &&
              event.agent.id === agentId &&
              event.agent.lifecycle !== "running"
            ) {
              unsubscribe();
              resolvePromise();
            }
          },
          { agentId, replayState: false },
        );
      }),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2000)),
    ]);
  }

  /**
   * Is there still work in flight after a refused interrupt? A foreground turn
   * counts while it is still the agent's active turn; an autonomous run counts
   * while the agent is still lifecycle-running.
   */
  private isRunStillActive(agent: ManagedAgent, foregroundTurnId: string | null): boolean {
    if (foregroundTurnId) {
      return agent.activeForegroundTurnId === foregroundTurnId;
    }
    return agent.lifecycle === "running";
  }

  /**
   * Reports whether the provider actually accepted the interrupt. The caller
   * needs to know: a hung or rejected interrupt means the provider is still
   * running, and pretending otherwise is how Stop stops the UI without stopping
   * the agent.
   */
  private async interruptSession(
    session: AgentSession,
    agentId: string,
  ): Promise<"acknowledged" | "timed_out" | "failed"> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.interrupt(),
        timeoutMs: this.rescueTimeouts.interruptSessionMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Session interrupt failed after timeout during cancel",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.interruptSessionMs },
          "Timed out interrupting session during cancel",
        );
        return "timed_out";
      }
      return "acknowledged";
    } catch (error) {
      this.logger.error({ err: error, agentId }, "Failed to interrupt session");
      return "failed";
    }
  }

  getPendingPermissions(agentId: string): AgentPermissionRequest[] {
    const agent = this.requireSessionAgent(agentId);
    return Array.from(agent.pendingPermissions.values());
  }

  private peekPendingPermission(agent: ManagedAgent): AgentPermissionRequest | null {
    const iterator = agent.pendingPermissions.values().next();
    return iterator.done ? null : iterator.value;
  }

  /**
   * Hydrates the timeline from provider history if the agent's durable
   * timeline is empty (e.g., imported agents that have provider history
   * on disk but no persisted timeline rows). No-ops if already hydrated.
   */
  async hydrateTimelineFromProvider(
    agentId: string,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.hydrateTimelineFromLegacyProviderHistory(agent, options);
  }

  async rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    const hadActiveRun =
      Boolean(agent.activeForegroundTurnId) || this.foregroundRuns.hasPendingRun(agentId);
    if (hadActiveRun) {
      // Rewinding under a still-live turn would rewrite history the provider is
      // actively appending to, so a refused cancel stops the rewind.
      if ((await this.cancelAgentRun(agentId)).status === "refused") {
        throw new AgentRunCancellationError(agentId, "rewind");
      }
    }

    const lock = this.foregroundRuns.createPendingRun(agentId);
    try {
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.start",
      );
      await invokeRewindCapability(agent.session, { messageId, mode });
      if (mode !== "files") {
        await this.hydrateTimelineFromProvider(agentId, { force: true, broadcast: true });
      }
      await this.refreshRuntimeInfo(agent);
      await this.persistSnapshot(agent);
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.complete",
      );
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.failed",
      );
      throw error;
    } finally {
      this.foregroundRuns.settleForegroundRun(agentId, lock.token);
    }
  }

  async deleteCommittedTimeline(agentId: string): Promise<void> {
    if (!this.durableTimelineStore) {
      return;
    }
    await this.durableTimelineStore.deleteAgent(agentId);
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    return await this.getLastAssistantMessageFromStores(agentId);
  }

  private getLastAssistantMessageFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): string | null {
    return this.getLastAssistantMessageSegmentFromTimeline(timeline)?.text ?? null;
  }

  private getLastAssistantMessageSegmentFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): { text: string; startsAtBeginning: boolean } | null {
    // Collect the last contiguous assistant messages (Claude streams chunks)
    const chunks: string[] = [];
    let startsAtBeginning = false;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.type !== "assistant_message") {
        if (chunks.length) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
      startsAtBeginning = i === 0;
    }

    if (!chunks.length) {
      return null;
    }

    return {
      text: chunks.toReversed().join(""),
      startsAtBeginning,
    };
  }

  private async getLastAssistantMessageFromStores(agentId: string): Promise<string | null> {
    const liveTimeline = this.timelineStore.getItems(agentId);
    const liveSegment = this.getLastAssistantMessageSegmentFromTimeline(liveTimeline);
    if (!this.durableTimelineStore) {
      return liveSegment?.text ?? null;
    }

    if (!liveSegment) {
      return await this.durableTimelineStore.getLastAssistantMessage(agentId);
    }

    if (!liveSegment.startsAtBeginning) {
      return liveSegment.text;
    }

    const lastDurableItem = await this.durableTimelineStore.getLastItem(agentId);
    if (lastDurableItem?.type !== "assistant_message") {
      return liveSegment.text;
    }

    const durableMessage = await this.durableTimelineStore.getLastAssistantMessage(agentId);
    return durableMessage ? `${durableMessage}${liveSegment.text}` : liveSegment.text;
  }

  private async getLastItemFromStores(agentId: string): Promise<AgentTimelineItem | null> {
    const lastLiveItem = this.timelineStore.getLastItem(agentId);
    if (lastLiveItem) {
      return lastLiveItem;
    }
    if (!this.durableTimelineStore) {
      return null;
    }
    return await this.durableTimelineStore.getLastItem(agentId);
  }

  async waitForAgentEvent(
    agentId: string,
    options?: WaitForAgentOptions,
  ): Promise<WaitForAgentResult> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingForegroundRun = this.foregroundRuns.getPendingRun(agentId);
    const hasForegroundTurn =
      Boolean(snapshot.activeForegroundTurnId) || Boolean(pendingForegroundRun);

    const immediatePermission = this.peekPendingPermission(snapshot);
    if (immediatePermission) {
      return {
        status: snapshot.lifecycle,
        permission: immediatePermission,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    const initialStatus = snapshot.lifecycle;
    const initialBusy = isAgentBusy(initialStatus) || hasForegroundTurn;
    const waitForActive = options?.waitForActive ?? false;
    if (!waitForActive && !initialBusy) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }
    if (waitForActive && !initialBusy && !hasForegroundTurn) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent aborted");
    }

    return await new Promise<WaitForAgentResult>((resolvePromise, reject) => {
      // Bug #1 Fix: Check abort signal AGAIN inside Promise constructor
      // to avoid race condition between pre-Promise check and abort listener registration
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent aborted"));
        return;
      }

      let currentStatus: AgentLifecycleStatus = initialStatus;
      let hasStarted =
        isAgentBusy(initialStatus) ||
        Boolean(snapshot.activeForegroundTurnId) ||
        Boolean(pendingForegroundRun?.started);
      let terminalStatusOverride: AgentLifecycleStatus | null = null;
      let finished = false;

      // Bug #3 Fix: Declare unsubscribe and abortHandler upfront so cleanup can reference them
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        // Clean up subscription
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }

        // Clean up abort listener
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finish = (permission: AgentPermissionRequest | null) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        void this.getLastAssistantMessage(agentId)
          .then((lastMessage) => {
            resolvePromise({
              status: currentStatus,
              permission,
              lastMessage,
            });
            return;
          })
          .catch(reject);
      };

      // Bug #3 Fix: Set up abort handler BEFORE subscription
      // to ensure cleanup handlers exist before callback can fire
      if (options?.signal) {
        abortHandler = () => {
          cleanup();
          reject(createAbortError(options.signal, "wait_for_agent aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Bug #3 Fix: Now subscribe with cleanup handlers already in place
      // This prevents race condition if callback fires synchronously with replayState: true
      unsubscribe = this.subscribe(
        (event) => {
          if (event.type === "agent_state") {
            currentStatus = event.agent.lifecycle;
            const pending = this.peekPendingPermission(event.agent);
            if (pending) {
              finish(pending);
              return;
            }
            if (isAgentBusy(event.agent.lifecycle)) {
              hasStarted = true;
              return;
            }
            if (!waitForActive || hasStarted) {
              if (terminalStatusOverride) {
                currentStatus = terminalStatusOverride;
              }
              finish(null);
            }
            return;
          }

          if (event.type === "agent_stream") {
            if (event.event.type === "permission_requested") {
              finish(event.event.request);
              return;
            }
            if (event.event.type === "turn_failed") {
              hasStarted = true;
              terminalStatusOverride = "error";
              return;
            }
            if (event.event.type === "turn_completed") {
              hasStarted = true;
            }
            if (event.event.type === "turn_canceled") {
              hasStarted = true;
            }
          }
        },
        { agentId, replayState: true },
      );
    });
  }

  /**
   * Wait for an agent AND its whole descendant tree to fully settle - not just
   * the agent's first idle. A worker that spawns background sub-agents goes idle
   * with an interim message ("waiting on my helpers…"); `setupFinishNotification`
   * then re-invokes it when a child finishes, so it gets more turns. `awaitAgent`
   * on the run engine must not capture that interim idle, or it grades a half-done
   * answer. This waits until the agent has reached its first idle (via
   * waitForAgentEvent) and then the entire subtree (the agent + every descendant
   * spawned under it, by parent-id label) has stayed non-busy for `quietMs`, or a
   * hard `timeoutMs` cap trips (so a hung child can't stall a run forever).
   */
  async waitForAgentFullySettled(
    agentId: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; quietMs?: number },
  ): Promise<WaitForAgentResult> {
    const first = await this.waitForAgentEvent(agentId, {
      ...(options?.signal ? { signal: options.signal } : {}),
      waitForActive: true,
    });
    // Blocked on permission or errored: nothing more will happen unattended.
    if (first.permission || first.status === "error") {
      return first;
    }
    return this.waitForSubtreeQuiet(agentId, first.status, options);
  }

  // Poll until the agent's whole subtree stays non-busy for `quietMs` (each burst
  // of re-invocation resets the timer), a pending permission surfaces, or the
  // `timeoutMs` cap trips. Split out of waitForAgentFullySettled for complexity.
  private async waitForSubtreeQuiet(
    agentId: string,
    fallbackStatus: AgentLifecycleStatus,
    options?: { signal?: AbortSignal; timeoutMs?: number; quietMs?: number },
  ): Promise<WaitForAgentResult> {
    const quietMs = options?.quietMs ?? 2500;
    const pollMs = 400;
    const deadline = Date.now() + (options?.timeoutMs ?? 20 * 60 * 1000);
    let quietSince: number | null = null;

    for (;;) {
      if (options?.signal?.aborted) {
        throw createAbortError(options.signal, "wait_for_agent_settled aborted");
      }
      const permission = this.peekPendingPermissionById(agentId);
      if (permission) {
        return this.settledResult(agentId, fallbackStatus, permission);
      }
      if (this.isAgentSubtreeBusy(agentId)) {
        quietSince = null;
      } else {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= quietMs) {
          break;
        }
      }
      if (Date.now() >= deadline) {
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return this.settledResult(agentId, fallbackStatus, null);
  }

  private async settledResult(
    agentId: string,
    fallbackStatus: AgentLifecycleStatus,
    permission: AgentPermissionRequest | null,
  ): Promise<WaitForAgentResult> {
    return {
      status: this.getAgent(agentId)?.lifecycle ?? fallbackStatus,
      permission,
      lastMessage: await this.getLastAssistantMessage(agentId),
    };
  }

  private peekPendingPermissionById(agentId: string): AgentPermissionRequest | null {
    const snapshot = this.getAgent(agentId);
    return snapshot ? this.peekPendingPermission(snapshot) : null;
  }

  // True if the agent or any descendant (by parent-id label, transitively) is
  // busy, mid-foreground-turn, or has a pending run - i.e. more work is coming.
  private isAgentSubtreeBusy(rootId: string): boolean {
    for (const id of this.collectAgentSubtree(rootId)) {
      const agent = this.agents.get(id);
      if (!agent) {
        continue;
      }
      if (
        isAgentBusy(agent.lifecycle) ||
        Boolean(agent.activeForegroundTurnId) ||
        Boolean(this.foregroundRuns.getPendingRun(id))
      ) {
        return true;
      }
    }
    return false;
  }

  // The root plus every agent reachable from it through PARENT_AGENT_ID_LABEL.
  private collectAgentSubtree(rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    const all = Array.from(this.agents.values());
    const frontier = [rootId];
    while (frontier.length > 0) {
      const parent = frontier.pop()!;
      for (const agent of all) {
        if (agent.labels?.[PARENT_AGENT_ID_LABEL] === parent && !result.has(agent.id)) {
          result.add(agent.id);
          frontier.push(agent.id);
        }
      }
    }
    return result;
  }

  private async registerSession(
    session: AgentSession,
    config: AgentSessionConfig,
    agentId: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      timeline?: AgentTimelineItem[];
      timelineRows?: AgentTimelineRow[];
      timelineNextSeq?: number;
      persistence?: AgentPersistenceHandle;
      historyPrimed?: boolean;
      lastUsage?: AgentUsage;
      lastError?: string;
      attention?: AttentionState;
      initialTitle?: string | null;
      publishWhenReady?: boolean;
      workspaceId?: string;
      owner?: AgentOwner;
    },
  ): Promise<ManagedAgent> {
    let registered = false;
    try {
      this.assertAcceptingAgentRegistrations();
      const resolvedAgentId = validateAgentId(agentId, "registerSession");
      if (this.agents.has(resolvedAgentId)) {
        throw new Error(`Agent with id ${resolvedAgentId} already exists`);
      }
      const initialPersistedTitle = await this.resolveInitialPersistedTitle(
        resolvedAgentId,
        config,
        options?.initialTitle ?? null,
      );

      const now = new Date();
      const { durableTimelineHasRows } = await this.initializeAgentTimelineForRegister({
        agentId: resolvedAgentId,
        now,
        options,
      });

      const managed = this.buildManagedAgentForRegister({
        resolvedAgentId,
        session,
        config,
        now,
        durableTimelineHasRows,
        options,
      });

      this.assertAcceptingAgentRegistrations();
      this.agents.set(resolvedAgentId, managed);
      registered = true;
      // Initialize previousStatus to track transitions
      this.previousStatuses.set(resolvedAgentId, managed.lifecycle);
      await this.refreshRuntimeInfo(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      await this.persistSnapshot(managed, {
        title: initialPersistedTitle,
      });
      this.assertAgentRegistrationActive(managed);
      if (!options?.publishWhenReady) {
        this.emitState(managed, { persist: false });
      }

      await this.refreshSessionState(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      managed.lifecycle = "idle";
      await this.persistSnapshot(managed);
      this.assertAgentRegistrationActive(managed);
      this.emitState(managed, { persist: false });
      this.subscribeToSession(managed);
      return { ...managed };
    } catch (error) {
      if (!registered) {
        await this.closeUnregisteredSession(session);
      }
      throw error;
    }
  }

  private assertAcceptingAgentRegistrations(): void {
    if (!this.acceptingAgentRegistrations) {
      throw new AgentManagerShuttingDownError();
    }
  }

  private assertAgentRegistrationActive(agent: ActiveManagedAgent): void {
    if (!this.acceptingAgentRegistrations || this.agents.get(agent.id) !== agent) {
      throw new AgentManagerShuttingDownError();
    }
  }

  private async closeUnregisteredSession(session: AgentSession): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to close unregistered agent session");
    }
  }

  private async initializeAgentTimelineForRegister(params: {
    agentId: string;
    now: Date;
    options:
      | {
          timeline?: AgentTimelineItem[];
          timelineRows?: AgentTimelineRow[];
          timelineNextSeq?: number;
          persistence?: AgentPersistenceHandle;
          createdAt?: Date;
          updatedAt?: Date;
        }
      | undefined;
  }): Promise<{ durableTimelineHasRows: boolean }> {
    const { agentId, now, options } = params;
    const explicitTimelineSeed = buildExplicitTimelineSeedForRegister(now, options);
    const shouldSeedFromDurable =
      !explicitTimelineSeed &&
      !this.timelineStore.has(agentId) &&
      this.durableTimelineStore !== undefined;
    const durableTimelineSeed = shouldSeedFromDurable
      ? await this.loadCommittedTimelineSeed(agentId, now)
      : null;
    const durableTimelineHasRows =
      durableTimelineSeed != null && (durableTimelineSeed.nextSeq ?? 1) > 1;
    const timelineSeed = explicitTimelineSeed ?? durableTimelineSeed;
    if (timelineSeed || !this.timelineStore.has(agentId)) {
      this.timelineStore.initialize(agentId, timelineSeed ?? { timestamp: now.toISOString() });
    }
    if (options?.timelineRows?.length) {
      this.enqueueDurableTimelineBulkInsert(agentId, options.timelineRows);
    }
    return { durableTimelineHasRows };
  }

  private buildManagedAgentForRegister(params: {
    resolvedAgentId: string;
    session: AgentSession;
    config: AgentSessionConfig;
    now: Date;
    durableTimelineHasRows: boolean;
    options:
      | {
          createdAt?: Date;
          updatedAt?: Date;
          lastUserMessageAt?: Date | null;
          labels?: Record<string, string>;
          historyPrimed?: boolean;
          lastUsage?: AgentUsage;
          lastError?: string;
          attention?: AttentionState;
          persistence?: AgentPersistenceHandle;
          workspaceId?: string;
          owner?: AgentOwner;
        }
      | undefined;
  }): ActiveManagedAgent {
    const { resolvedAgentId, session, config, now, durableTimelineHasRows } = params;
    // Defaulted once instead of optional-chaining every field below.
    const options = params.options ?? {};
    return {
      id: resolvedAgentId,
      provider: config.provider,
      cwd: config.cwd,
      workspaceId: options.workspaceId,
      session,
      capabilities: session.capabilities,
      config,
      runtimeInfo: undefined,
      lifecycle: "initializing",
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
      availableModes: [],
      currentModeId: null,
      pendingPermissions: new Map<string, AgentPermissionRequest>(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      steerQueue: [],
      pendingSteerDrain: false,
      activeForegroundTurnId: null,
      foregroundTurnWaiters: new Set<ForegroundTurnWaiter>(),
      finalizedForegroundTurnIds: new Set<string>(),
      unsubscribeSession: null,
      persistence: attachPersistenceCwd(
        options.persistence ?? session.describePersistence(),
        config.cwd,
      ),
      historyPrimed: options.historyPrimed ?? durableTimelineHasRows,
      lastUserMessageAt: options.lastUserMessageAt ?? null,
      lastUsage: options.lastUsage,
      lastError: options.lastError,
      attention: resolveInitialAttention(options.attention),
      unattended: config.unattended ?? false,
      guardrailDenials: 0,
      internal: config.internal ?? false,
      observable: config.observable ?? false,
      labels: options.labels ?? {},
      // Ownership has to reach the ManagedAgent, not just the create call:
      // toStoredAgentRecord projects it off the agent, so leaving it here meant
      // no hub execution was ever stamped onto its record and every duplicate
      // create missed findByDaemonExecution and spawned a second agent.
      owner: options.owner,
    } as ActiveManagedAgent;
  }

  private async loadCommittedTimelineSeed(
    agentId: string,
    now: Date,
  ): Promise<SeedAgentTimelineOptions> {
    if (!this.durableTimelineStore) {
      return { timestamp: now.toISOString() };
    }

    return {
      nextSeq: (await this.durableTimelineStore.getLatestCommittedSeq(agentId)) + 1,
      timestamp: now.toISOString(),
    };
  }

  private prepareAgentForClosure(
    agent: LiveManagedAgent,
    cancelReason: string,
  ): ManagedAgentClosed {
    this.agentStreamCoalescer.flushAndDiscard(agent.id);
    this.agents.delete(agent.id);
    this.previousStatuses.delete(agent.id);
    this.lastReconciledTodoSignature.delete(agent.id);
    if (agent.unsubscribeSession) {
      agent.unsubscribeSession();
      agent.unsubscribeSession = null;
    }
    this.foregroundRuns.cancelWaiters(agent, (turnId) => ({
      type: "turn_canceled",
      provider: agent.provider,
      reason: cancelReason,
      turnId,
    }));
    this.foregroundRuns.clearAgentRun(agent.id);
    return {
      ...agent,
      lifecycle: "closed",
      session: null,
      activeForegroundTurnId: null,
      // A closed session has no next turn to hand a queued message to.
      steerQueue: [],
      pendingSteerDrain: false,
    };
  }

  private emitClosedAgent(agent: ManagedAgentClosed, options?: { persist?: boolean }): void {
    this.emitState(agent, options);
  }
  private subscribeToSession(agent: ActiveManagedAgent): void {
    if (agent.unsubscribeSession) {
      return;
    }
    const agentId = agent.id;
    const unsubscribe = agent.session.subscribe((event: AgentStreamEvent) => {
      this.enqueueSessionEvent(agentId, event);
    });
    agent.unsubscribeSession = unsubscribe;
  }

  private enqueueSessionEvent(agentId: string, event: AgentStreamEvent): void {
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: this.agents.get(agentId)?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        event,
      },
      "agent.manager.enqueue",
    );
    const previous = this.sessionEventTails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.agents.get(agentId);
        if (!current) {
          return;
        }
        if (current.session == null) {
          return;
        }
        this.logger.trace(
          {
            agentId,
            provider: event.provider,
            sessionId: current.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            event,
          },
          "agent.manager.dequeue",
        );
        await this.dispatchSessionEvent(current, event);
        return;
      })
      .catch((err) => {
        this.logger.error(
          { err, agentId, eventType: event.type },
          "Failed to process session event",
        );
      });

    this.sessionEventTails.set(agentId, next);
    this.trackBackgroundTask(next);
    void next.finally(() => {
      if (this.sessionEventTails.get(agentId) === next) {
        this.sessionEventTails.delete(agentId);
      }
    });
  }

  private async dispatchSessionEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
  ): Promise<void> {
    // Provider-reported subagents never take part in the turn/waiter machinery:
    // they are a projection, not a run. Fold and forward before any of it.
    if (event.type === "provider_subagent") {
      const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
      this.dispatch({ type: "provider_subagent", event: update });
      return;
    }
    const turnId = getAgentStreamEventTurnId(event);
    const matchingWaiters = this.foregroundRuns.getMatchingWaiters(agent, turnId);
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        matchingWaiterCount: matchingWaiters.length,
        event,
      },
      "agent.manager.dispatch_session_event",
    );

    const shouldNotifyWaiters = await this.handleStreamEvent(agent, event);

    if (!shouldNotifyWaiters) {
      return;
    }

    this.foregroundRuns.notifyWaiters(matchingWaiters, event, {
      terminal: isTurnTerminalEvent(event),
    });
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        notifiedWaiterCount: matchingWaiters.length,
        terminal: isTurnTerminalEvent(event),
        event,
      },
      "agent.manager.notify_waiters",
    );
  }

  private async resolveInitialPersistedTitle(
    agentId: string,
    config: AgentSessionConfig,
    fallbackTitle: string | null,
  ): Promise<string | null> {
    const existing = await this.registry?.get(agentId);
    if (existing) {
      return existing.title ?? null;
    }
    const explicitTitle =
      typeof config.title === "string" && config.title.trim().length > 0
        ? config.title.trim()
        : null;
    return explicitTitle ?? fallbackTitle;
  }

  private async persistSnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    if (!this.registry) {
      return;
    }
    // Don't persist internal agents - they're ephemeral system tasks
    if (agent.internal) {
      return;
    }
    await this.registry.applySnapshot(agent, options);
  }

  private requireRegistry(): AgentStorage {
    if (!this.registry) {
      throw new Error("Agent storage unavailable");
    }
    return this.registry;
  }

  private async refreshSessionState(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const modes = await agent.session.getAvailableModes();
      agent.availableModes = modes;
    } catch {
      agent.availableModes = [];
    }

    try {
      agent.currentModeId = await agent.session.getCurrentMode();
    } catch {
      agent.currentModeId = null;
    }

    try {
      const pending = agent.session.getPendingPermissions();
      agent.pendingPermissions = new Map(pending.map((request) => [request.id, request]));
    } catch {
      agent.pendingPermissions.clear();
    }

    this.syncFeaturesFromSession(agent);
    await this.refreshRuntimeInfo(agent, options);
  }

  private async refreshRuntimeInfo(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const newInfo = await agent.session.getRuntimeInfo();
      const changed =
        newInfo.model !== agent.runtimeInfo?.model ||
        newInfo.thinkingOptionId !== agent.runtimeInfo?.thinkingOptionId ||
        newInfo.sessionId !== agent.runtimeInfo?.sessionId ||
        newInfo.modeId !== agent.runtimeInfo?.modeId;
      agent.runtimeInfo = newInfo;
      if (!agent.persistence && newInfo.sessionId) {
        agent.persistence = attachPersistenceCwd(
          { provider: agent.provider, sessionId: newInfo.sessionId },
          agent.cwd,
        );
      }
      // Emit state if runtimeInfo changed so clients get the updated model
      if (changed && options?.emit !== false) {
        this.emitState(agent);
      }
    } catch {
      // Keep existing runtimeInfo if refresh fails.
    }
  }

  /**
   * Replaces the parent's provider children with the ones its session history
   * reports. The removals are dispatched too, so a client already showing the
   * old set is told they are gone rather than being left to guess.
   */
  private rebuildProviderSubagentsFromHistory(
    agent: ActiveManagedAgent,
    events: Extract<AgentStreamEvent, { type: "provider_subagent" }>[],
    broadcast: boolean,
  ): void {
    for (const removal of this.providerSubagents.deleteParent(agent.id)) {
      this.dispatch({ type: "provider_subagent", event: removal });
    }
    for (const event of events) {
      const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
      if (broadcast) {
        this.dispatch({ type: "provider_subagent", event: update });
      }
    }
  }

  private async hydrateTimelineFromLegacyProviderHistory(
    agent: ActiveManagedAgent,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    if (agent.historyPrimed && !options?.force) {
      return;
    }

    if (options?.force) {
      await this.rehydrateTimelineFromScratch(agent, options);
      return;
    }

    agent.historyPrimed = true;
    try {
      const { timeline, subagents } = await this.readProviderHistory(agent);
      for (const event of timeline) {
        const row = this.recordTimeline(
          agent.id,
          event.item,
          event.timestamp ? { timestamp: event.timestamp } : undefined,
        );
        // Broadcast here too, not only on the forced path. A caller that asked
        // for one and happened to take this branch - a second loader joining an
        // already-primed agent, say - otherwise got a silent hydration.
        if (shouldBroadcastHydration(options?.broadcast)) {
          this.dispatchStream(agent.id, event, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agent.id),
            timestamp: row.timestamp,
          });
        }
      }
      // Only replaces the children once history actually produced some, so a
      // read that yielded nothing does not empty a rail that was correct.
      if (subagents.length > 0) {
        this.rebuildProviderSubagentsFromHistory(
          agent,
          subagents,
          shouldBroadcastHydration(options?.broadcast),
        );
      }
    } catch {
      // ignore history failures
    }
  }

  /** Splits a session's replayed history into the two streams hydration needs. */
  private async readProviderHistory(agent: ActiveManagedAgent): Promise<{
    timeline: Extract<AgentStreamEvent, { type: "timeline" }>[];
    subagents: Extract<AgentStreamEvent, { type: "provider_subagent" }>[];
  }> {
    const timeline: Extract<AgentStreamEvent, { type: "timeline" }>[] = [];
    const subagents: Extract<AgentStreamEvent, { type: "provider_subagent" }>[] = [];
    for await (const event of agent.session.streamHistory()) {
      if (event.type === "provider_subagent") {
        subagents.push(event);
      } else if (
        event.type === "timeline" &&
        !(event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text))
      ) {
        timeline.push(event);
      }
    }
    return { timeline, subagents };
  }

  /**
   * Drops the retained timeline and children and rebuilds both from a fresh
   * read of the session. A forced hydration is the authoritative read, so
   * anything history no longer reports is gone rather than merged.
   */
  private async rehydrateTimelineFromScratch(
    agent: ActiveManagedAgent,
    options: HydrateTimelineOptions,
  ): Promise<void> {
    const { timeline, subagents } = await this.readProviderHistory(agent);

    this.agentStreamCoalescer.flushAndDiscard(agent.id);
    await this.deleteCommittedTimeline(agent.id);
    this.timelineStore.delete(agent.id);
    this.timelineStore.initialize(agent.id, { timestamp: new Date().toISOString() });
    agent.historyPrimed = true;
    this.rebuildProviderSubagentsFromHistory(
      agent,
      subagents,
      shouldBroadcastHydration(options.broadcast),
    );

    for (const event of timeline) {
      const row = this.recordTimeline(
        agent.id,
        event.item,
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      if (shouldBroadcastHydration(options.broadcast)) {
        this.dispatchStream(agent.id, event, {
          seq: row.seq,
          epoch: this.timelineStore.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
      }
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  private notifyForegroundTurnWaiters(agentId: string, event: AgentStreamEvent): void {
    const turnId = getAgentStreamEventTurnId(event);
    if (turnId == null) {
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.foregroundRuns.notifyAgentWaiters(agent, event);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.notify_waiters.coalesced",
    );
  }

  private async handleStreamEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): Promise<boolean> {
    const eventTurnId = getAgentStreamEventTurnId(event);
    const isForegroundEvent = Boolean(eventTurnId && agent.activeForegroundTurnId === eventTurnId);
    this.traceHandleStreamEventStart(agent, event, eventTurnId, isForegroundEvent);
    if (
      eventTurnId &&
      isTurnTerminalEvent(event) &&
      this.foregroundRuns.hasFinalizedTurn(agent, eventTurnId)
    ) {
      return false;
    }

    // Only update timestamp for live events, not history replay
    if (!options?.fromHistory) {
      this.touchUpdatedAt(agent);
      if (this.agentStreamCoalescer.handle(agent.id, event)) {
        this.traceCoalescerBuffered(agent, event, eventTurnId);
        return false;
      }
      this.agentStreamCoalescer.flushFor(agent.id);
    }

    const flags: StreamEventFlags = { shouldDispatchEvent: true, shouldNotifyWaiters: true };

    const dispatchPromise = this.dispatchStreamEventByType({
      agent,
      event,
      options,
      isForegroundEvent,
      eventTurnId,
      flags,
    });
    if (dispatchPromise) {
      await dispatchPromise;
    }

    if (!options?.fromHistory && isForegroundEvent && isTurnTerminalEvent(event)) {
      this.finalizeForegroundTurn(agent, eventTurnId);
    }

    if (!options?.fromHistory && flags.shouldDispatchEvent) {
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    }

    this.traceHandleStreamEventEnd(agent, event, eventTurnId, flags);

    return flags.shouldNotifyWaiters;
  }

  private traceHandleStreamEventStart(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    isForegroundEvent: boolean,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        isForegroundEvent,
        event,
      },
      "agent.manager.handle_stream_event.start",
    );
  }

  private traceCoalescerBuffered(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.coalescer.buffer",
    );
  }

  private traceHandleStreamEventEnd(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    flags: StreamEventFlags,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        shouldDispatchEvent: flags.shouldDispatchEvent,
        shouldNotifyWaiters: flags.shouldNotifyWaiters,
        event,
      },
      "agent.manager.handle_stream_event.end",
    );
  }

  private dispatchStreamEventByType(params: {
    agent: ActiveManagedAgent;
    event: AgentStreamEvent;
    options: HandleStreamEventOptions | undefined;
    isForegroundEvent: boolean;
    eventTurnId: string | undefined;
    flags: StreamEventFlags;
  }): Promise<void> | undefined {
    const { agent, event, options, isForegroundEvent, eventTurnId, flags } = params;
    if (isProjectionStreamEvent(event)) {
      this.dispatchProjectionStreamEvent(agent, event);
      flags.shouldDispatchEvent = false;
      return undefined;
    }
    switch (event.type) {
      case "thread_started":
        this.onStreamThreadStarted(agent);
        return undefined;
      case "usage_updated":
        agent.lastUsage = this.carryContextComposition(agent.lastUsage, event.usage);
        this.emitState(agent);
        return undefined;
      case "mode_changed":
      case "model_changed":
      case "thinking_option_changed":
        this.onStreamConfigDrift(agent, event);
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "timeline":
        return this.onStreamTimelineEvent({ agent, event, options, isForegroundEvent, flags });
      case "turn_completed":
        this.onStreamTurnCompleted({ agent, event, eventTurnId, isForegroundEvent });
        return undefined;
      case "turn_failed":
        return this.onStreamTurnFailed({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          options,
        });
      case "turn_canceled":
        this.onStreamTurnCanceled({ agent, event, eventTurnId, isForegroundEvent, options });
        return undefined;
      case "turn_started":
        this.onStreamTurnStarted({ agent, eventTurnId, isForegroundEvent });
        return undefined;
      case "permission_requested":
        this.onStreamPermissionRequested(agent, event);
        return undefined;
      case "permission_resolved":
        this.onStreamPermissionResolved({ agent, event, options, flags });
        return undefined;
      default:
        return undefined;
    }
  }

  // Subagent/background-task projections (no ManagedAgent runtime of their
  // own) share no state with the main event switch above - split out to keep
  // dispatchStreamEventByType's cyclomatic complexity down.
  private dispatchProjectionStreamEvent(
    agent: ActiveManagedAgent,
    event: ProjectionStreamEvent,
  ): void {
    switch (event.type) {
      case "observed_subagent_updated":
        this.onObservedSubagentUpdated(agent, event);
        return;
      case "observed_subagent_timeline":
        this.onObservedSubagentTimeline(agent, event);
        return;
      case "background_shell_task_updated":
        this.onBackgroundShellTaskUpdated(agent, event);
        return;
    }
  }

  private onStreamThreadStarted(agent: ActiveManagedAgent): void {
    const previousSessionId = agent.persistence?.sessionId ?? null;
    const handle = agent.session.describePersistence();
    if (handle) {
      agent.persistence = attachPersistenceCwd(handle, agent.cwd);
      if (agent.persistence?.sessionId !== previousSessionId) {
        this.emitState(agent);
      }
    }
    void this.refreshRuntimeInfo(agent);
  }

  private async onStreamTimelineEvent(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "timeline" }>;
    options: { fromHistory?: boolean } | undefined;
    isForegroundEvent: boolean;
    flags: StreamEventFlags;
  }): Promise<void> {
    const { agent, event, options, flags } = params;

    if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    if (options?.fromHistory) {
      this.recordTimeline(
        agent.id,
        event.item,
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    this.recordAndDispatchTimelineItem(agent.id, event.item, event.provider, event.turnId);
    if (event.item.type === "user_message") {
      agent.lastUserMessageAt = new Date();
      this.emitState(agent);
    }
    this.observeStallGuard(agent.id, event.item);
    flags.shouldDispatchEvent = false;
    flags.shouldNotifyWaiters = true;
  }

  /**
   * Fold one live timeline item into the agent's tool-emission stall guard, and
   * stop the run if the guard trips.
   *
   * The guard answers one structural question - "has this agent produced
   * anything with a side effect lately?" - and nothing about the content of
   * what it produced. See agent-stall-guard.ts for the invariant and the two
   * resets (any tool call, any real user prompt).
   *
   * Only live items reach here: the `fromHistory` replay path and
   * system-injected prompts both return before this call. That is deliberate.
   * Replaying a stalled transcript must not re-stop an agent that is fine now,
   * and a daemon-authored nudge is not a user taking back control.
   */
  private observeStallGuard(agentId: string, item: AgentTimelineItem): void {
    const threshold = this.agentBehaviors.stallGuardThreshold;
    if (threshold <= 0) {
      return;
    }
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }
    const signal = classifyTimelineItem(item, {
      isSystemInjected: item.type === "user_message" && isSystemInjectedEnvelope(item.text),
    });
    const next = observeStallSignal(agent.stallGuard ?? createStallGuardState(), signal);
    agent.stallGuard = next;
    if (!hasStalled(next, threshold)) {
      return;
    }

    // Latch before stopping: the cancel is async, and the tail of the burst
    // keeps arriving through this same path. Without the latch the guard would
    // trip again every threshold messages and stack up duplicate stop rows for
    // one stall. A tool call or a real user prompt clears it.
    agent.stallGuard = latchStallGuard();
    const message = buildStallInterruptMessage(next.count);
    this.logger.warn(
      { agentId: agent.id, provider: agent.provider, count: next.count, threshold },
      "Stall guard tripped: no tool call in consecutive assistant messages, stopping the run",
    );
    // Surface the reason in the transcript first, so the row explaining the
    // stop is already there when the run goes idle.
    this.recordAndDispatchTimelineItem(agent.id, { type: "error", message }, agent.provider);
    void this.cancelAgentRun(agent.id).catch((error: unknown) => {
      this.logger.error({ err: error, agentId: agent.id }, "Stall guard failed to stop the run");
    });
  }

  /**
   * Fold a native child agent's own tool call into its track-row liveness
   * counters. Observed rows get these from the provider's task report; a native
   * (create_chat) child has no such report, so its transcript IS the source -
   * the one signal every provider produces. Returns true only when the readout
   * actually changed, so a tool call's running → completed transitions don't
   * re-emit and the row never strobes.
   *
   * Scoped to agents that are somebody's child: main chats don't render a track
   * row, so counting (and emitting) for them would be pure overhead.
   * See docs/chat-lifecycle.md (the subagents track).
   */
  private recordNativeSubagentToolActivity(
    agent: ManagedAgent,
    item: ToolCallTimelineItem,
  ): boolean {
    if (!agent.labels[PARENT_AGENT_ID_LABEL]) {
      return false;
    }
    const counted = (agent.countedToolCallIds ??= new Set<string>());
    if (counted.has(item.callId)) {
      return false;
    }
    counted.add(item.callId);
    agent.toolUseCount = (agent.toolUseCount ?? 0) + 1;
    if (item.name) {
      agent.currentTool = item.name;
    }
    return true;
  }

  /**
   * Roll a turn's provider-reported usage into the agent's lifetime token total
   * and the daemon activity counters. Shared by turn_completed and the
   * failed/canceled paths so a turn that errors or is interrupted after burning
   * tokens still counts (retry storms would otherwise be invisible to the cost
   * ledger). No-op when the provider reports no usage. (WP-D)
   *
   * The category is derived from the agent's kind: a turn on a child agent (one
   * with a parent-agent label) is attributed to `subagent`, everything else to
   * `mainChat`. Compaction spend is broken out within recordUsageActivity. (WP-G)
   *
   * Everything here books THIS TURN's spend, which for a provider that reports
   * a running session total (Pi, and OpenCode's cost) is not what it reported -
   * so the usage is normalized once, up front, and every sink below it is plain
   * addition. Without that step turn 3 re-books turns 1 and 2 and the error
   * grows with the chat. See turn-usage.ts.
   */
  private recordTurnUsage(
    agent: ActiveManagedAgent,
    reported: AgentUsage | undefined,
    provider: AgentProvider,
  ): void {
    const { usage, watermark } = toTurnSpend(reported, provider, agent.usageWatermark);
    agent.usageWatermark = watermark;
    agent.cumulativeTokens = accumulateAgentTokens(agent.cumulativeTokens, usage);
    const category = agent.labels[PARENT_AGENT_ID_LABEL] ? "subagent" : "mainChat";
    const model = agent.config.model ?? agent.runtimeInfo?.model ?? undefined;
    // De-inflate a parent chat: its Claude `total_cost_usd` is the WHOLE tree,
    // but its tokens are parent-only, so book its cost as the residual (tree −
    // Σ its settled sub-agents, priced on their own models). Drains the bucket so
    // the next turn starts clean; clamps at 0 if the sub-agent table over-priced.
    const costOverrideMicroUsd =
      category === "mainChat" ? this.residualParentCostMicroUsd(agent.id, usage) : undefined;
    const costMicroUsd = this.recordUsageActivity(usage, {
      category,
      provider,
      agentId: agent.id,
      model,
      ...(costOverrideMicroUsd !== undefined ? { costOverrideMicroUsd } : {}),
    });
    // Accumulate the cost that was ACTUALLY BOOKED (the residual for a parent),
    // never the raw whole-tree figure - that is what makes a chat's total equal
    // the sum of its own ledger rows instead of double-counting its sub-agents.
    agent.cumulativeUsage = accumulateLifetimeUsage(agent.cumulativeUsage, usage, costMicroUsd);
  }

  /**
   * A parent chat's real own-cost for this turn: the whole-tree `total_cost_usd`
   * minus the priced cost of the sub-agents that settled under it since the last
   * turn (drained here). Returns undefined when nothing was accumulated, so the
   * normal `usage.totalCostUsd` path is used unchanged. Clamped at 0 - a negative
   * residual would mean the sub-agent price table over-charged, which the
   * verify-against-modelUsage diagnostic surfaces separately.
   */
  private residualParentCostMicroUsd(
    agentId: string,
    usage: AgentUsage | undefined,
  ): number | undefined {
    const pending = this.pendingSubagentCostMicroUsdByParent.get(agentId);
    if (!pending) {
      return undefined;
    }
    this.pendingSubagentCostMicroUsdByParent.delete(agentId);
    const treeMicroUsd = usdToMicroUsd(usage?.totalCostUsd);
    return Math.max(0, treeMicroUsd - pending);
  }

  /**
   * Record one usage measurement into the daemon-wide activity counters, split by
   * cost category and provider (WP-G). Feeds the two-column Usage & Cost page.
   *
   * - Grand totals (`tokensSent`/`tokensReceived`/`costMicroUsd`) always get the
   *   FULL spend, so the headline stays honest and complete.
   * - The mid-turn compaction slice (openai-compat only, reported on
   *   `usage.compaction*Tokens`) is attributed to `compaction` and backed out of
   *   the turn's own category, so the categories partition the total rather than
   *   overlap.
   * - Cost is real only where the provider reports it (Claude's `totalCostUsd`);
   *   stored as integer micro-USD so it stays summable. Token-only categories
   *   leave their cost leaf at 0.
   * - Provider split: Claude (the real-cost provider) gets its own in/out
   *   counters; "other" is derived in the UI as the grand total minus Claude.
   *
   * Returns the cost actually booked (integer micro-USD), so the caller can fold
   * the identical figure into the agent's lifetime total and the two can never
   * drift apart. `undefined` when nothing was recorded at all.
   */
  private recordUsageActivity(
    usage: AgentUsage | undefined,
    meta: {
      category: "mainChat" | "generations" | "subagent";
      provider: AgentProvider;
      agentId?: string;
      model?: string;
      subtype?: string;
      // Model round-trips this measurement aggregates (sub-agent rows cover many;
      // a chat turn is one query). Makes a large cumulative cache-read legible.
      rounds?: number;
      // Explicit cost for this measurement, overriding `usage.totalCostUsd`. Used
      // to book a parent chat as the residual after its sub-agents' cost is backed
      // out (parent-residual de-inflation). Applies to BOTH the ledger row and the
      // aggregate counters so they stay consistent.
      costOverrideMicroUsd?: number;
      // Sub-agent rows only: spawn-tree identity (spawn time, own observed key,
      // spawning sub-agent's key) so the Log can group rows by who spawned whom
      // instead of by settle time. See UsageEventSchema.
      startedAt?: number;
      subagentKey?: string;
      parentSubagentKey?: string;
    },
  ): number | undefined {
    if (!usage) {
      return undefined;
    }
    const bump = (field: ActivityCounterField, by: number): void => {
      if (by > 0) {
        this.onActivity?.(field, by);
      }
    };
    const cachedInputTokens = usage.cachedInputTokens ?? 0;
    const inputTokens =
      (usage.inputTokens ?? 0) + cachedInputTokens + (usage.cacheCreationInputTokens ?? 0);
    const outputTokens = usage.outputTokens ?? 0;
    const costMicroUsd = meta.costOverrideMicroUsd ?? usdToMicroUsd(usage.totalCostUsd);
    const compactionIn = usage.compactionInputTokens ?? 0;
    const compactionOut = usage.compactionOutputTokens ?? 0;

    // Grand headline totals - full spend (compaction included).
    bump("tokensSent", inputTokens);
    bump("tokensReceived", outputTokens);
    bump("costMicroUsd", costMicroUsd);

    // Provider split (Claude vs. derived "other").
    if (meta.provider === "claude") {
      bump("claudeTokensIn", inputTokens);
      bump("claudeTokensOut", outputTokens);
    }

    // Compaction is its own category, disjoint from the turn's main/subagent share.
    bump("compactionTokensIn", compactionIn);
    bump("compactionTokensOut", compactionOut);

    const fields = USAGE_CATEGORY_FIELDS[meta.category];
    bump(fields.in, Math.max(0, inputTokens - compactionIn));
    bump(fields.out, Math.max(0, outputTokens - compactionOut));
    bump(fields.cost, costMicroUsd);

    // Second sink: the itemized ledger row for this same activity (usage-ledger).
    // Skip zero-usage measurements - an empty row is noise, not accounting.
    if (this.onUsageEvent && (inputTokens > 0 || outputTokens > 0)) {
      this.onUsageEvent(
        buildUsageLedgerEvent({
          kind: USAGE_CATEGORY_KIND[meta.category],
          meta,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          costMicroUsd,
          compactionIn,
          compactionOut,
        }),
      );
    }
    return costMicroUsd;
  }

  private onStreamTurnCompleted(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_completed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.completed",
    );
    // A completion without usage means "nothing further to report", not "the
    // turn used nothing". Providers that stream usage_updated during the turn
    // and then complete with no usage were having the turn's own numbers wiped.
    if (event.usage) {
      agent.lastUsage = this.withContextComposition(agent.id, event.usage);
    }
    // Then upgrade the estimate to the provider's own split where it can report
    // one (async, non-blocking - see `refreshContextCategories`).
    this.refreshContextCategories(agent);
    this.recordTurnUsage(agent, event.usage, event.provider);
    agent.lastError = undefined;
    if (
      !isForegroundEvent &&
      agent.lifecycle !== "idle" &&
      !agent.pendingReplacement &&
      !agent.pendingSteerDrain
    ) {
      (agent as ActiveManagedAgent).lifecycle = "idle";
      this.emitState(agent);
    }
    void this.refreshRuntimeInfo(agent);
  }

  private async onStreamTurnFailed(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options: { fromHistory?: boolean } | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.logger.warn(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
        error: event.error,
        code: event.code,
        diagnostic: event.diagnostic,
      },
      "handleStreamEvent: turn_failed",
    );
    if (!isForegroundEvent) {
      agent.lifecycle = "error";
    }
    const displayError = this.formatTurnFailedMessage(event);
    agent.lastError = isContextSizeError(event.error) ? displayError : event.error;
    this.recordTurnUsage(agent, event.usage, event.provider);
    // A foreground caller receives this same failure through its RPC response,
    // which the composer renders as its red send error. Persisting it as an
    // assistant message creates a second, misleading chat bubble. Background
    // failures have no caller to surface them, so retain their durable record.
    if (!isForegroundEvent) {
      await this.appendSystemErrorTimelineMessage(agent, event.provider, displayError, options);
    }
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Turn failed");
    if (!isForegroundEvent) {
      this.emitState(agent);
    }
  }

  private onStreamTurnCanceled(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_canceled" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options:
      | {
          fromHistory?: boolean;
        }
      | undefined;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
      },
      "agent.manager.turn.canceled",
    );
    if (!isForegroundEvent && !agent.pendingReplacement && !agent.pendingSteerDrain) {
      agent.lifecycle = "idle";
    }
    agent.lastError = undefined;
    this.recordTurnUsage(agent, event.usage, event.provider);
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Interrupted");
    if (!isForegroundEvent) {
      this.emitState(agent);
    }
  }

  private onStreamTurnStarted(params: {
    agent: ActiveManagedAgent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
  }): void {
    const { agent, eventTurnId, isForegroundEvent } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.started",
    );
    if (!isForegroundEvent) {
      agent.lifecycle = "running";
      this.emitState(agent);
    }
  }

  private onStreamPermissionRequested(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "permission_requested" }>,
  ): void {
    const hadPendingPermissions = agent.pendingPermissions.size > 0;
    const request = event.request;
    agent.pendingPermissions.set(request.id, request);

    // Guardrail: an unattended run (schedule/loop/artifact) has no client
    // watching to answer approval prompts. Claude's auto-mode classifier (and
    // any other provider that escalates) would otherwise stall the run here
    // forever. Answer immediately with DENY by policy - no attention broadcast,
    // no notification - and let the model adapt. Keyed on the creation-time
    // `unattended` flag, never the permission mode (an attended user in auto
    // mode still wants the prompt). This is Phase 4 parity for the prompt path.
    // See docs/safe-unattended.md (Phase 2).
    if (agent.unattended) {
      this.autoDenyUnattendedPermissionRequest(agent, request);
      return;
    }

    if (!hadPendingPermissions && !agent.internal) {
      this.broadcastAgentAttention(agent, "permission");
    }
    this.emitState(agent);
  }

  private autoDenyUnattendedPermissionRequest(
    agent: ActiveManagedAgent,
    request: AgentPermissionRequest,
  ): void {
    const reason = `Unattended run: '${request.name}' is not pre-approved; denied by policy`;
    this.recordGuardrailDenial(agent, request.name);
    // Reuse the exact deny path a client's response takes (resolves the pending
    // permission, refreshes state, continues the turn). Fire-and-forget: the
    // stream event handler is synchronous, so track the promise as a background
    // task and log any failure.
    this.trackBackgroundTask(
      this.respondToPermission(agent.id, request.id, { behavior: "deny", message: reason })
        .then(() => undefined)
        .catch((err) => {
          this.logger.error(
            { err, agentId: agent.id, tool: request.name },
            "safe-unattended: failed to auto-deny unattended permission request",
          );
        }),
    );
  }

  private recordGuardrailDenial(agent: ActiveManagedAgent, tool: string): void {
    agent.guardrailDenials = (agent.guardrailDenials ?? 0) + 1;
    agent.lastGuardrailDenialAt = new Date().toISOString();
    // TODO(safe-unattended Phase 3): surface this to the owning service
    // (schedule/artifact) as a promote-on-problem trigger so a guarded run that
    // hit a guardrail denial gets revealed alongside hard failures.
    // See docs/safe-unattended.md (Phase 3).
    this.logger.info(
      { agentId: agent.id, tool, guardrailDenials: agent.guardrailDenials },
      "safe-unattended: denied unattended permission request by policy",
    );
  }

  private onStreamPermissionResolved(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "permission_resolved" }>;
    options: { fromHistory?: boolean } | undefined;
    flags: StreamEventFlags;
  }): void {
    const { agent, event, options, flags } = params;
    agent.pendingPermissions.delete(event.requestId);
    if (!options?.fromHistory && agent.inFlightPermissionResponses.has(event.requestId)) {
      agent.bufferedPermissionResolutions.set(event.requestId, event);
      flags.shouldDispatchEvent = false;
      return;
    }
    this.emitState(agent);
  }

  private resolvePendingPermissionsForAgent(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    options: { fromHistory?: boolean } | undefined,
    message: string,
  ): void {
    for (const [requestId] of agent.pendingPermissions) {
      agent.pendingPermissions.delete(requestId);
      if (!options?.fromHistory) {
        this.dispatchStream(agent.id, {
          type: "permission_resolved",
          provider,
          requestId,
          resolution: { behavior: "deny", message },
        });
      }
    }
  }

  private observedSubagentId(parentAgentId: string, key: string): string {
    return `${parentAgentId}::sub::${key}`;
  }

  private emitObservedSubagentState(input: {
    id: string;
    /** Owning agent id - resolves to the tree parent below when the row was
     * spawned by another observed subagent (nested fan-out). */
    parentAgentId: string;
    parentKey?: string;
    provider: AgentProvider;
    cwd: string;
    workspaceId?: string;
    createdAt: string;
    title: string;
    cumulativeTokens?: number;
    lastUsage?: AgentUsage;
    model?: string;
    usageRounds?: number;
    toolUseCount?: number;
    currentTool?: string;
    backgrounded?: boolean;
    update: ObservedSubagentUpdate;
  }): void {
    const payload = toObservedSubagentPayload({
      ...input,
      parentAgentId: input.parentKey
        ? this.observedSubagentId(input.parentAgentId, input.parentKey)
        : input.parentAgentId,
    });
    const entry = this.observedSubagents.get(input.id);
    if (entry?.archivedAt) {
      // Archived rows stay archived: a late provider update must not undo the
      // user's archive on connected clients.
      payload.archivedAt = entry.archivedAt;
    }
    if (entry) {
      entry.lastPayload = payload;
    }
    this.dispatch({
      type: "observed_agent_state",
      payload,
    });
  }

  private onObservedSubagentUpdated(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "observed_subagent_updated" }>,
  ): void {
    const id = this.observedSubagentId(agent.id, event.update.key);
    const existing = this.observedSubagents.get(id);
    if (!existing) {
      this.onActivity?.("subagentsInvoked");
    }
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    const parentKey = event.update.parentKey ?? existing?.parentKey;
    const {
      title,
      titleFrozen,
      cumulativeTokens,
      lastUsage,
      model,
      usageRounds,
      toolUseCount,
      currentTool,
      backgrounded,
    } = resolveObservedSubagentDerivedState(existing, event.update);
    // A row nested under a backgrounded run survives whatever its ancestor
    // survives, so the flag flows down the tree. The parent row is always
    // registered before its children (it is announced by the tool call that
    // spawns them), so one hop is enough - the parent already carries its own
    // inherited value.
    const parentBackgrounded =
      parentKey !== undefined &&
      this.observedSubagents.get(this.observedSubagentId(agent.id, parentKey))?.backgrounded ===
        true;
    const optional = observedSubagentOptionalFields({
      parentKey,
      cumulativeTokens,
      lastUsage,
      model,
      usageRounds,
      toolUseCount,
      currentTool,
      ...(backgrounded || parentBackgrounded ? { backgrounded: true } : {}),
    });
    // Record the subagent's real usage to the itemized ledger on every settle,
    // but only the delta above what was already written (side effect inside the
    // helper). Returns the new watermark when a row was written, so a second
    // stream gets its own row and a duplicate terminal update gets none.
    // See [[subagent-real-accounting]].
    const priorRecorded = existing?.recorded;
    const recorded =
      this.recordObservedSubagentUsageIfSettled({
        status: event.update.status,
        recorded: priorRecorded,
        ownerAgentId: agent.id,
        provider: event.provider,
        lastUsage,
        usageRounds,
        model,
        title,
        subagentKey: event.update.key,
        parentSubagentKey: parentKey,
        createdAt,
      }) ?? priorRecorded;
    this.observedSubagents.set(id, {
      parentAgentId: agent.id,
      taskId: event.update.taskId ?? existing?.taskId,
      provider: event.provider,
      createdAt,
      title,
      titleFrozen,
      ...optional,
      ...(recorded ? { recorded } : {}),
      ...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
      lastPayload: existing?.lastPayload,
    });
    this.emitObservedSubagentState({
      id,
      parentAgentId: agent.id,
      provider: event.provider,
      cwd: agent.cwd,
      ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
      createdAt,
      title,
      ...optional,
      update: event.update,
    });
  }

  /**
   * Write an observed subagent's real usage into the itemized ledger, once, when
   * it first settles. Returns true iff a row was written (so the caller can mark
   * the entry recorded). No split ⇒ no row - an honest blank, never a fabricated
   * one. The row is attributed to the OWNING chat (`agentId`) so it traces back
   * to - and groups under - the parent chat in the Log; `subtype` carries the
   * subagent's name and `model` its own (possibly cheaper) model for pricing.
   * Cost is left to recordUsageActivity (0 until per-subagent pricing lands).
   */
  private recordObservedSubagentUsageIfSettled(params: {
    status: ObservedSubagentUpdate["status"];
    recorded: RecordedSubagentLedger | undefined;
    ownerAgentId: string;
    provider: AgentProvider;
    lastUsage: AgentUsage | undefined;
    usageRounds: number | undefined;
    model: string | undefined;
    title: string;
    subagentKey: string;
    parentSubagentKey: string | undefined;
    createdAt: string;
  }): RecordedSubagentLedger | undefined {
    const { status, recorded, ownerAgentId, provider, lastUsage, usageRounds, model, title } =
      params;
    if (!isTerminalObservedSubagentStatus(status) || !lastUsage) {
      return undefined;
    }
    // Only the increment above what the ledger already holds: a duplicate
    // terminal update yields nothing, a genuine second stream yields its own row.
    const delta = deltaAgentUsage(lastUsage, recorded?.usage);
    if (!delta) {
      return undefined;
    }
    const rounds = Math.max(0, (usageRounds ?? 0) - (recorded?.rounds ?? 0));
    // Spawn-tree identity: when the sub-agent was first observed (it belongs to
    // the turn that SPAWNED it, not the turn it settled in - async sub-agents
    // routinely settle turns later) and who spawned it.
    const startedAt = Date.parse(params.createdAt);
    this.recordUsageActivity(delta, {
      category: "subagent",
      provider,
      agentId: ownerAgentId,
      ...(rounds > 0 ? { rounds } : {}),
      ...(model ? { model } : {}),
      ...(title ? { subtype: title } : {}),
      ...(Number.isFinite(startedAt) ? { startedAt } : {}),
      subagentKey: params.subagentKey,
      ...(params.parentSubagentKey ? { parentSubagentKey: params.parentSubagentKey } : {}),
    });
    // Stage this increment's priced cost so the owning chat's next turn can back
    // it out of the whole-tree total (parent-residual de-inflation). Priced
    // upstream against the sub-agent's own model; absent when unpriceable, in
    // which case that spend simply stays on the parent (no fabrication).
    const subagentCostMicroUsd = usdToMicroUsd(delta.totalCostUsd);
    if (subagentCostMicroUsd > 0) {
      const prior = this.pendingSubagentCostMicroUsdByParent.get(ownerAgentId) ?? 0;
      this.pendingSubagentCostMicroUsdByParent.set(ownerAgentId, prior + subagentCostMicroUsd);
    }
    // The new watermark is the full running total we just caught up to.
    return { usage: lastUsage, rounds: usageRounds ?? recorded?.rounds ?? 0 };
  }

  private onObservedSubagentTimeline(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "observed_subagent_timeline" }>,
  ): void {
    const id = this.observedSubagentId(agent.id, event.key);
    // Timeline may arrive before the first lifecycle update; materialize the
    // observed subagent so its pane can open.
    if (!this.observedSubagents.has(id)) {
      const createdAt = new Date().toISOString();
      // Timeline arrived before any lifecycle update, so there's no name source
      // yet - use a provisional label and leave it unfrozen so the first real
      // task_started can set the stable name.
      const title = deriveObservedSubagentTitle({});
      this.observedSubagents.set(id, {
        parentAgentId: agent.id,
        provider: event.provider,
        createdAt,
        title,
        titleFrozen: false,
      });
      this.emitObservedSubagentState({
        id,
        parentAgentId: agent.id,
        provider: event.provider,
        cwd: agent.cwd,
        ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
        createdAt,
        title,
        update: { key: event.key, status: "running" },
      });
    }
    this.ensureObservedTimelineState(id);
    this.recordAndDispatchTimelineItem(id, event.item, event.provider, event.turnId);
  }

  /**
   * Stop a running observed subagent by resolving it to its owning provider
   * session's task. See projects/observed-subagents/observed-subagents.md.
   */
  async stopObservedSubagent(observedId: string): Promise<void> {
    const entry = this.observedSubagents.get(observedId);
    if (!entry) {
      // Not a synthetic task-fan-out subagent - check for a real internal
      // agent (e.g. artifact generation) rendered read-only via `attend:
      // "observed"`, and stop it the normal way instead.
      const agent = this.agents.get(observedId);
      if (agent?.internal) {
        await this.cancelAgentRun(observedId);
        return;
      }
      throw new Error(`Observed subagent not found: ${observedId}`);
    }
    if (!entry.taskId) {
      throw new Error(`Observed subagent has no task id to stop: ${observedId}`);
    }
    const parent = this.agents.get(entry.parentAgentId);
    const session = parent && "session" in parent ? parent.session : undefined;
    if (!session?.stopTask) {
      throw new Error(`Parent session cannot stop observed subagents: ${observedId}`);
    }
    await session.stopTask(entry.taskId);
  }

  /**
   * Archive an observed subagent. These are ephemeral registry projections with
   * no ManagedAgent and no stored record, so the normal archive path
   * (`archiveAgentCommand`) can't resolve them - this is its observed
   * counterpart, mirroring how fetch (`getObservedSubagentPayload`) and stop
   * (`stopObservedSubagent`) already special-case the registry. A still-live
   * subagent is stopped best-effort first; the entry is then retired in place
   * (kept, stamped `archivedAt`) so late provider updates can't resurrect the
   * row and open panes can still hydrate it.
   * See docs/agent-lifecycle.md (Items 2 + 6).
   */
  async archiveObservedSubagent(observedId: string): Promise<{ archivedAt: string }> {
    const entry = this.observedSubagents.get(observedId);
    if (!entry) {
      throw new Error(`Observed subagent not found: ${observedId}`);
    }
    if (entry.archivedAt) {
      return { archivedAt: entry.archivedAt };
    }
    const last = entry.lastPayload;
    const wasLive = last?.status === "running" || last?.status === "initializing";
    if (wasLive) {
      try {
        await this.stopObservedSubagent(observedId);
      } catch (error) {
        // Best-effort: the archive proceeds even if the provider task can't be
        // reached (parent gone, no task id) - the projection retires either way.
        this.logger.debug({ err: error, observedId }, "agent.manager.observed.archive.stop_failed");
      }
    }
    const archivedAt = new Date().toISOString();
    entry.archivedAt = archivedAt;
    if (last) {
      const payload: AgentSnapshotPayload = {
        ...last,
        status: wasLive ? "closed" : last.status,
        requiresAttention: false,
        attentionReason: null,
        updatedAt: archivedAt,
        archivedAt,
      };
      entry.lastPayload = payload;
      this.dispatch({
        type: "observed_agent_state",
        payload,
      });
    }
    return { archivedAt };
  }

  private backgroundShellTaskId(parentAgentId: string, key: string): string {
    return `${parentAgentId}::bg::${key}`;
  }

  private currentBackgroundShellTasksFor(parentAgentId: string): BackgroundShellTaskInfo[] {
    const tasks: BackgroundShellTaskInfo[] = [];
    for (const [id, entry] of this.backgroundShellTasks) {
      if (entry.parentAgentId !== parentAgentId || entry.archivedAt) {
        continue;
      }
      tasks.push({
        id,
        parentAgentId: entry.parentAgentId,
        provider: entry.provider,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.command ? { command: entry.command } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.requiresAttention !== undefined
          ? { requiresAttention: entry.requiresAttention }
          : {}),
      });
    }
    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private emitBackgroundShellTaskState(parentAgentId: string): void {
    this.dispatch({
      type: "background_shell_task_state",
      parentAgentId,
      tasks: this.currentBackgroundShellTasksFor(parentAgentId),
    });
  }

  private onBackgroundShellTaskUpdated(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "background_shell_task_updated" }>,
  ): void {
    const id = this.backgroundShellTaskId(agent.id, event.update.key);
    const existing = this.backgroundShellTasks.get(id);
    this.backgroundShellTasks.set(
      id,
      mergeBackgroundShellTaskEntry({
        parentAgentId: agent.id,
        provider: event.provider,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        existing,
        update: event.update,
      }),
    );
    this.emitBackgroundShellTaskState(agent.id);
  }

  /**
   * Stop a running background shell task (Claude Bash run_in_background) by
   * resolving it to its owning provider session's task. See
   * projects/observed-subagents/observed-subagents.md (the sibling flow this
   * mirrors) for the shape stopObservedSubagent already established.
   */
  async stopBackgroundShellTask(id: string): Promise<void> {
    const entry = this.backgroundShellTasks.get(id);
    if (!entry) {
      throw new Error(`Background shell task not found: ${id}`);
    }
    if (!entry.taskId) {
      throw new Error(`Background shell task has no task id to stop: ${id}`);
    }
    const parent = this.agents.get(entry.parentAgentId);
    const session = parent && "session" in parent ? parent.session : undefined;
    if (!session?.stopTask) {
      throw new Error(`Parent session cannot stop background shell tasks: ${id}`);
    }
    await session.stopTask(entry.taskId);
  }

  /**
   * Clear one or more background shell tasks from the track (single-row
   * dismiss and bulk "Clear all completed" both call this). Still-live tasks
   * are stopped best-effort first; entries are retired in place (archivedAt
   * stamped, never deleted) so a late provider update can't resurrect a
   * cleared row - same invariant as archiveObservedSubagent.
   */
  async clearBackgroundShellTasks(ids: readonly string[]): Promise<void> {
    const parentIds = new Set<string>();
    for (const id of ids) {
      const entry = this.backgroundShellTasks.get(id);
      if (!entry || entry.archivedAt) {
        continue;
      }
      const wasLive = entry.status === "running";
      if (wasLive) {
        try {
          await this.stopBackgroundShellTask(id);
        } catch (error) {
          this.logger.debug(
            { err: error, id },
            "agent.manager.background_shell_task.clear.stop_failed",
          );
        }
      }
      const archivedAt = new Date().toISOString();
      entry.archivedAt = archivedAt;
      entry.updatedAt = archivedAt;
      if (wasLive) {
        entry.status = "closed";
      }
      parentIds.add(entry.parentAgentId);
    }
    for (const parentId of parentIds) {
      this.emitBackgroundShellTaskState(parentId);
    }
  }

  // --- Suggested tasks (suggest_task / dismiss_task chips) ------------------

  private currentSuggestedTasksFor(parentAgentId: string): SuggestedTaskInfo[] {
    const tasks: SuggestedTaskInfo[] = [];
    for (const entry of this.suggestedTasks.values()) {
      if (entry.parentAgentId !== parentAgentId || entry.state !== "pending") {
        continue;
      }
      tasks.push({
        taskId: entry.id,
        parentAgentId: entry.parentAgentId,
        title: entry.title,
        tldr: entry.tldr,
        state: entry.state,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
      });
    }
    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private emitSuggestedTaskState(parentAgentId: string): void {
    this.dispatch({
      type: "suggested_task_state",
      parentAgentId,
      tasks: this.currentSuggestedTasksFor(parentAgentId),
    });
  }

  /** Create a pending suggested task and surface its chip. Returns the id. */
  spawnSuggestedTask(input: SpawnSuggestedTaskInput): string {
    const id = this.idFactory();
    const now = new Date().toISOString();
    this.suggestedTasks.set(id, {
      id,
      parentAgentId: input.parentAgentId,
      title: input.title,
      prompt: input.prompt,
      tldr: input.tldr,
      state: "pending",
      createdAt: now,
      updatedAt: now,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
    this.emitSuggestedTaskState(input.parentAgentId);
    return id;
  }

  /** The full entry (incl. the server-only prompt), for the start handler. */
  getSuggestedTaskEntry(taskId: string): SuggestedTaskEntry | undefined {
    return this.suggestedTasks.get(taskId);
  }

  /**
   * Atomically claim a suggested task for starting. Returns false - leaving no
   * claim - when the entry is missing, is not pending, or is already being
   * started; otherwise records the claim and returns true. Synchronous so two
   * concurrent start.requests can't both pass the pending gate before the
   * (awaited) agent/worktree creation flips the state. The caller must pair a
   * successful claim with `endSuggestedTaskStart` in a finally.
   */
  beginSuggestedTaskStart(taskId: string): boolean {
    const entry = this.suggestedTasks.get(taskId);
    if (!entry || entry.state !== "pending" || this.startingSuggestedTaskIds.has(taskId)) {
      return false;
    }
    this.startingSuggestedTaskIds.add(taskId);
    return true;
  }

  /** Release a claim made by `beginSuggestedTaskStart` (on success or failure). */
  endSuggestedTaskStart(taskId: string): void {
    this.startingSuggestedTaskIds.delete(taskId);
  }

  /**
   * Dismiss a suggested task. Idempotent: a task that was already started or
   * dismissed is reported via `state` with `dismissed: false`, and an unknown
   * task returns `found: false` - the caller decides how to surface each.
   */
  dismissSuggestedTask(taskId: string, reason?: string): DismissSuggestedTaskResult {
    const entry = this.suggestedTasks.get(taskId);
    if (!entry) {
      return { found: false, dismissed: false };
    }
    if (entry.state !== "pending") {
      return { found: true, dismissed: false, state: entry.state };
    }
    entry.state = "dismissed";
    entry.updatedAt = new Date().toISOString();
    if (reason) {
      entry.dismissReason = reason;
    }
    this.emitSuggestedTaskState(entry.parentAgentId);
    return { found: true, dismissed: true, state: "dismissed" };
  }

  /** Flip a pending task to started once its agent/steer has been dispatched. */
  markSuggestedTaskStarted(params: {
    taskId: string;
    mode: TasksSuggestedStartMode;
    startedAgentId?: string;
  }): void {
    const entry = this.suggestedTasks.get(params.taskId);
    if (!entry) {
      return;
    }
    entry.state = "started";
    entry.startMode = params.mode;
    entry.updatedAt = new Date().toISOString();
    if (params.startedAgentId) {
      entry.startedAgentId = params.startedAgentId;
    }
    this.emitSuggestedTaskState(entry.parentAgentId);
  }

  private recordAndDispatchTimelineItem(
    agentId: string,
    rawItem: AgentTimelineItem,
    provider: AgentProvider,
    turnId?: string,
  ): AgentStreamEvent {
    // Normalize once so persistence, the dispatched event, and activity
    // counters all see the same display-clean item (unwraps voice spoken-input,
    // and turns a show_widget call into a renderable widget).
    const row = this.recordTimeline(agentId, rawItem);
    const item = row.item;
    this.recordTimelineActivity(item);
    const event: AgentStreamEvent = {
      type: "timeline",
      item,
      provider,
      ...(turnId !== undefined ? { turnId } : {}),
    };
    this.dispatchStream(agentId, event, {
      seq: row.seq,
      epoch: this.timelineStore.getEpoch(agentId),
      timestamp: row.timestamp,
    });

    if (item.type === "tool_call") {
      // The one place BOTH timeline delivery paths meet - the direct stream
      // event and the coalescer's flush. The liveness hook lives here so a
      // coalesced tool call still moves the row's readout. (The coalescer is
      // also what keeps the row from strobing: running tool calls arrive
      // batched, so this emits at the coalesce window's rate, not per event.)
      const agent = this.agents.get(agentId);
      if (agent) {
        if (this.recordNativeSubagentToolActivity(agent, item)) {
          this.emitState(agent);
        }
        if (
          item.status === "completed" &&
          item.detail?.type === "shell" &&
          commandMayHaveChangedExternalState(item.detail.command)
        ) {
          this.onWorkspaceStateMayHaveChanged?.({ cwd: agent.cwd });
        }
      }
    }

    return event;
  }

  /** Fun-stats counters derived from timeline items - see activity-stats. */
  private recordTimelineActivity(item: AgentTimelineItem): void {
    switch (item.type) {
      case "user_message":
        this.onActivity?.("messagesSent");
        break;
      case "assistant_message":
        this.onActivity?.("messagesReceived");
        break;
      case "reasoning":
        this.onActivity?.("thoughts");
        break;
      case "tool_call":
        // Count once per call, at the moment it starts - not on every
        // running -> completed/failed/canceled status update.
        if (item.status === "running") {
          this.onActivity?.("toolsCalled");
        }
        break;
      default:
        break;
    }
  }

  private async appendSystemErrorTimelineMessage(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    message: string,
    options?: { fromHistory?: boolean },
  ): Promise<void> {
    if (options?.fromHistory) {
      return;
    }

    const normalized = message.trim();
    if (!normalized) {
      return;
    }

    const text = `${SYSTEM_ERROR_PREFIX} ${normalized}`;
    const lastItem = await this.getLastItemFromStores(agent.id);
    if (lastItem?.type === "assistant_message" && lastItem.text === text) {
      return;
    }

    const item: AgentTimelineItem = { type: "assistant_message", text };
    const row = this.recordTimeline(agent.id, item);
    this.dispatchStream(
      agent.id,
      {
        type: "timeline",
        item,
        provider,
      },
      {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agent.id),
        timestamp: row.timestamp,
      },
    );
  }

  private formatTurnFailedMessage(
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
  ): string {
    const base = event.error.trim();
    if (isContextSizeError(base)) {
      return CONTEXT_SIZE_ERROR_MESSAGE;
    }
    const parts = [base.length > 0 ? base : "Provider run failed"];
    const code = event.code?.trim();
    if (code) {
      parts.push(`code: ${code}`);
    }
    const diagnostic = event.diagnostic?.trim();
    if (diagnostic && diagnostic !== base) {
      parts.push(diagnostic);
    }
    return parts.join("\n\n");
  }

  private recordTimeline(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): AgentTimelineRow {
    // Bound here rather than at each caller: this is the one gate every
    // timeline write passes through, and an unbounded shell output otherwise
    // lands in the row store, the durable log, the stream, and from there in
    // the next model request. Callers dispatch row.item so the client is shown
    // exactly what was persisted.
    const row = this.timelineStore.append(
      agentId,
      limitAgentTimelineItemContent(normalizeTimelineItemForDisplay(item)),
      options,
    );
    this.enqueueDurableTimelineAppend(agentId, row);
    return row;
  }

  private emitState(agent: ManagedAgent, options?: { persist?: boolean }): void {
    // Keep attention as an edge-triggered unread signal, not a level signal.
    this.checkAndSetAttention(agent);
    if (options?.persist !== false) {
      this.enqueueBackgroundPersist(agent);
    }

    this.syncFeaturesFromSession(agent);

    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
        persist: options?.persist !== false,
      },
      "agent.manager.emit_state",
    );

    this.dispatch({
      type: "agent_state",
      agent: { ...agent },
    });
  }

  private syncFeaturesFromSession(agent: ManagedAgent): void {
    if ("session" in agent && agent.session?.features) {
      agent.features = agent.session.features;
    }
  }

  private checkAndSetAttention(agent: ManagedAgent): void {
    const previousStatus = this.previousStatuses.get(agent.id);
    const currentStatus = agent.lifecycle;

    // Track the new status
    this.previousStatuses.set(agent.id, currentStatus);

    // Skip attention tracking for internal agents
    if (agent.internal) {
      return;
    }

    // Skip if already requires attention
    if (agent.attention.requiresAttention) {
      return;
    }

    // Don't raise an unread badge on a chat somebody is already reading. The
    // client can only clear a raised badge a round trip later, which reads as a
    // flash in the tab strip and the sidebar; not raising it is the only way to
    // not show it at all.
    //
    // Scoped to the finished/error transitions below, which is the whole of this
    // function. A pending permission is a prompt to act rather than an unread
    // marker, and it badges off pendingPermissions instead of requiresAttention
    // (see deriveSidebarStateBucket), so it still surfaces to a watching reader.
    if (this.isAgentActivelyWatched?.(agent.id)) {
      return;
    }

    // Check if agent transitioned from running to idle (finished)
    if (previousStatus === "running" && currentStatus === "idle") {
      const silentTurnId = this.silentCompletionTurnIds.get(agent.id);
      if (silentTurnId !== undefined) {
        this.silentCompletionTurnIds.delete(agent.id);
        return;
      }
      agent.attention = {
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "finished");
      return;
    }

    // Check if agent entered error state
    if (previousStatus !== "error" && currentStatus === "error") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "error",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "error");
      return;
    }
  }

  private enqueueBackgroundPersist(agent: ManagedAgent): void {
    const task = this.persistSnapshot(agent).catch((err) => {
      this.logger.error({ err, agentId: agent.id }, "Failed to persist agent snapshot");
    });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableTimelineAppend(agentId: string, row: AgentTimelineRow): void {
    if (!this.durableTimelineStore) {
      return;
    }
    const task = this.durableTimelineStore
      .bulkInsert(agentId, [row])
      .then(() => undefined)
      .catch((err) => {
        this.logger.error(
          { err, agentId, seq: row.seq, itemType: row.item.type },
          "Failed to append timeline row to durable store",
        );
      });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableTimelineBulkInsert(
    agentId: string,
    rows: readonly AgentTimelineRow[],
  ): void {
    if (!this.durableTimelineStore || rows.length === 0) {
      return;
    }
    const task = this.durableTimelineStore.bulkInsert(agentId, rows).catch((err) => {
      this.logger.error(
        { err, agentId, rowCount: rows.length },
        "Failed to seed durable timeline store",
      );
    });
    this.trackBackgroundTask(task);
  }

  private trackBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
  }

  private trackAgentRegistrationOperation<T>(result: Promise<T>): Promise<T> {
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.agentRegistrationTasks.add(settled);
    void settled.then(() => {
      this.agentRegistrationTasks.delete(settled);
      return undefined;
    });
    return result;
  }

  /**
   * Flush any background persistence work (best-effort).
   */
  async flush(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: false });
  }

  /**
   * Flush persistence and agent registrations that crossed the synchronous
   * shutdown barrier. Those registrations own provider sessions until they
   * either install them or close them.
   */
  async flushForShutdown(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: true });
  }

  private async flushTasks(options: { includeAgentRegistrations: boolean }): Promise<void> {
    this.agentStreamCoalescer.flushAll();
    // Drain tasks, including tasks spawned while awaiting.
    while (
      this.backgroundTasks.size > 0 ||
      (options.includeAgentRegistrations && this.agentRegistrationTasks.size > 0)
    ) {
      const pending = options.includeAgentRegistrations
        ? [...this.backgroundTasks, ...this.agentRegistrationTasks]
        : [...this.backgroundTasks];
      await Promise.allSettled(pending);
    }
  }

  private broadcastAgentAttention(
    agent: ManagedAgent,
    reason: "finished" | "error" | "permission",
  ): void {
    if (isDelegatedAgent(agent)) {
      return;
    }

    this.onAgentAttention?.({
      agentId: agent.id,
      provider: agent.provider,
      reason,
    });
  }

  private dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void {
    const agent = this.agents.get(agentId);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        metadata,
        event,
      },
      "agent.manager.dispatch_stream",
    );
    this.dispatch({ type: "agent_stream", agentId, event, ...metadata });
  }

  private dispatch(event: AgentManagerEvent): void {
    for (const subscriber of this.subscribers) {
      if (
        subscriber.agentId &&
        event.type === "agent_stream" &&
        subscriber.agentId !== event.agentId
      ) {
        continue;
      }
      if (
        subscriber.agentId &&
        event.type === "agent_state" &&
        subscriber.agentId !== event.agent.id
      ) {
        continue;
      }
      // Skip internal agents for global subscribers (those without a specific agentId)
      if (!subscriber.agentId) {
        if (event.type === "agent_state" && event.agent.internal) {
          continue;
        }
        if (event.type === "agent_stream") {
          const agent = this.agents.get(event.agentId);
          // Observable internal agents (e.g. artifact generation) still stream
          // so a client that opened their timeline sees messages live; other
          // internal agents (branch-name/git-metadata generators) stay silent.
          // agent_state above is always filtered, so neither clutters the sidebar.
          if (agent?.internal && !agent.observable) {
            continue;
          }
        }
        // An internal parent is hidden from global subscribers, so its children
        // must be too: leaking them puts subagents on the sidebar belonging to a
        // parent that is not there.
        if (event.type === "provider_subagent") {
          const parentAgentId =
            event.event.type === "upsert"
              ? event.event.subagent.parentAgentId
              : event.event.parentAgentId;
          if (this.agents.get(parentAgentId)?.internal) {
            continue;
          }
        }
      }
      subscriber.callback(event);
    }
  }

  private async normalizeConfig(
    config: AgentSessionConfig,
    options: NormalizeConfigOptions = {},
  ): Promise<AgentSessionConfig> {
    const normalized: AgentSessionConfig = { ...config };

    // Always resolve cwd to absolute path for consistent history file lookup
    if (normalized.cwd) {
      normalized.cwd = resolve(normalized.cwd);
      try {
        const cwdStats = await stat(normalized.cwd);
        if (!cwdStats.isDirectory()) {
          throw new Error(`Working directory is not a directory: ${normalized.cwd}`);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new Error(`Working directory does not exist: ${normalized.cwd}`, { cause: error });
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to access working directory: ${normalized.cwd}`, { cause: error });
      }
    }

    if (typeof normalized.model === "string") {
      const trimmed = normalized.model.trim();
      normalized.model = trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
    }

    const shouldResolveDefaultModel = options.resolveDefaultModel ?? true;
    if (shouldResolveDefaultModel && !normalized.model) {
      const defaultModelId = await this.resolveDefaultModelId(normalized);
      if (defaultModelId) {
        normalized.model = defaultModelId;
      }
    }

    if (!normalized.modeId) {
      // Ask the provider first: some pick a different default depending on how
      // they are hosted (Claude on Bedrock exposes a different approval set),
      // which the static manifest cannot express. The manifest is the fallback
      // for providers that do not implement the hook, or that decline to answer.
      normalized.modeId = await this.resolveDefaultModeId(normalized, options.env);
    }

    return normalized;
  }

  private async resolveDefaultModeId(
    config: AgentSessionConfig,
    env?: Record<string, string>,
  ): Promise<string | undefined> {
    try {
      const resolved = await this.clients.get(config.provider)?.resolveDefaultModeId?.({
        config,
        ...(env ? { env } : {}),
      });
      if (resolved) {
        return resolved;
      }
    } catch {
      // A provider that cannot answer falls through to the manifest rather than
      // failing agent creation over a default.
    }
    try {
      return getAgentProviderDefinition(config.provider).defaultModeId ?? undefined;
    } catch {
      // Unknown provider
      return undefined;
    }
  }

  private async resolveDefaultModelId(config: AgentSessionConfig): Promise<string | undefined> {
    const client = this.clients.get(config.provider);
    if (!client) {
      return undefined;
    }
    try {
      const catalog = await client.fetchCatalog({
        scope: "workspace",
        cwd: config.cwd,
        force: false,
      });
      return (catalog.models.find((model) => model.isDefault) ?? catalog.models[0])?.id;
    } catch {
      // Provider may not support model listing - leave model undefined.
      return undefined;
    }
  }

  private async prepareSessionConfig(
    config: AgentSessionConfig,
    agentId: string,
    // Launch env, so a provider whose default mode depends on how it is hosted
    // can answer with the mode this particular launch will actually run under.
    env?: Record<string, string>,
  ): Promise<PreparedSessionConfig> {
    const storedConfig = await this.normalizeConfig(
      stripInternalOttoMcpServer(config),
      env ? { env } : {},
    );
    // Instruction files go on last, so the repo's own rules read as the most
    // authoritative thing in the prompt - after the personality's identity, its
    // lessons, and the knowledge catalog.
    const launchConfig = await this.applyInstructionFiles(
      await this.applyProjectKnowledge(
        await this.applyPersonalityMemory(
          this.applyOttoWorkVocabulary(
            this.applyDaemonAppendSystemPrompt(
              withRuntimeOttoMcpServer({
                config: storedConfig,
                agentId,
                mcpBaseUrl: this.mcpBaseUrl,
                mcpAuthToken: this.mcpAuthToken,
              }),
            ),
          ),
        ),
      ),
    );
    return { storedConfig, launchConfig };
  }

  /**
   * Append the personality's accrued lessons to the LAUNCH config's system
   * prompt. Deliberately runtime-only - never written to `storedConfig` - for
   * two reasons that both matter:
   *
   * 1. Memory is re-read on every resume, so a lesson recorded yesterday is
   *    present today without rewriting any agent record.
   * 2. The live-personality-switch ownership check compares the stored
   *    `systemPrompt` against the recomposed personality prompt; baking memory
   *    into the stored prompt would make that comparison start failing the
   *    moment a personality learned anything.
   *
   * Unlike the daemon-global append prompt this is NOT suppressed by
   * `respectGlobalAppendPrompt`: that toggle governs the daemon's prompt, and
   * these lessons are the personality's own.
   */
  private async applyPersonalityMemory(config: AgentSessionConfig): Promise<AgentSessionConfig> {
    const systemPrompt = await this.withPersonalityMemory(
      config.systemPrompt,
      config.profileSnapshot,
      config.cwd,
    );
    return systemPrompt === config.systemPrompt ? config : { ...config, systemPrompt };
  }

  /**
   * Runtime-only vocabulary for sessions that actually receive Otto's native
   * catalog. Tool descriptions explain individual calls; this compact brief
   * explains the shared task/chat/orchestration model without spending tokens
   * in providers that cannot use those tools.
   */
  private applyOttoWorkVocabulary(config: AgentSessionConfig): AgentSessionConfig {
    if (
      !this.ottoToolsEnabled ||
      !this.getProviderCapabilities(config.provider)?.supportsNativeOttoTools
    ) {
      return config;
    }
    const existing = config.systemPrompt?.trim();
    return {
      ...config,
      systemPrompt: existing
        ? `${existing}\n\n${OTTO_WORK_VOCABULARY_DIRECTIVE}`
        : OTTO_WORK_VOCABULARY_DIRECTIVE,
    };
  }

  /**
   * Stack a personality's accrued lessons under a system prompt, or hand the
   * prompt back untouched. Shared by the spawn path and the live switch so both
   * compose memory identically - a personality that behaved differently
   * depending on how you attached it would be two personalities.
   */
  private async withPersonalityMemory(
    systemPrompt: string | undefined,
    snapshot: ResolvedProfileSnapshot | null | undefined,
    cwd: string | undefined,
  ): Promise<string | undefined> {
    if (!snapshot || !this.resolvePersonalityMemoryBrief) {
      return systemPrompt;
    }
    const brief = await this.resolvePersonalityMemoryBrief({
      personalityId: snapshot.profileId,
      personalityName: snapshot.name,
      cwd,
    });
    if (!brief) {
      return systemPrompt;
    }
    const existing = systemPrompt?.trim();
    return existing ? `${existing}\n\n${brief}` : brief;
  }

  /**
   * Load the workspace's `AGENTS.md` chain into the LAUNCH prompt, for the
   * providers that have no process of their own to do it.
   *
   * Gated on `ownsContextPayload` rather than a provider name, and the gate is
   * the whole correctness argument: Claude, Codex and OpenCode each read these
   * files themselves, so loading them here too would send the repo's
   * instructions twice and bill for both. A provider that does not compose its
   * own request gets them from us; a provider that does is left alone.
   *
   * Runtime-only for the same reason as personality memory and the knowledge
   * catalog: editing `AGENTS.md` must reach the next session without rewriting
   * any agent record, and the stored prompt has to stay comparable for the
   * live-personality-switch ownership check.
   */
  private async applyInstructionFiles(config: AgentSessionConfig): Promise<AgentSessionConfig> {
    if (!this.resolveInstructionFiles) return config;
    if (!this.getProviderCapabilities(config.provider)?.ownsContextPayload) return config;

    let text: string | null;
    try {
      text = await this.resolveInstructionFiles({ cwd: config.cwd });
    } catch (error) {
      this.logger.warn({ err: error, cwd: config.cwd }, "Failed to load instruction files");
      return config;
    }
    if (!text) return config;

    const existing = config.systemPrompt?.trim();
    return { ...config, systemPrompt: existing ? `${existing}\n\n${text}` : text };
  }

  /** Runtime-only, just like personality memory: the catalog is re-read on each session start. */
  private async applyProjectKnowledge(config: AgentSessionConfig): Promise<AgentSessionConfig> {
    const systemPrompt = await this.withProjectKnowledge(config.systemPrompt, config.cwd);
    return systemPrompt === config.systemPrompt ? config : { ...config, systemPrompt };
  }

  private async withProjectKnowledge(
    systemPrompt: string | undefined,
    cwd: string | undefined,
  ): Promise<string | undefined> {
    if (!this.resolveProjectKnowledgeBrief) return systemPrompt;
    let brief: string | null;
    try {
      brief = await this.resolveProjectKnowledgeBrief({ cwd });
    } catch (error) {
      this.logger.warn({ err: error, cwd }, "Failed to resolve project knowledge catalog");
      return systemPrompt;
    }
    if (!brief) return systemPrompt;
    const existing = systemPrompt?.trim();
    return existing ? `${existing}\n\n${brief}` : brief;
  }

  private applyDaemonAppendSystemPrompt(config: AgentSessionConfig): AgentSessionConfig {
    const daemonAppendSystemPrompt = this.appendSystemPrompt.trim();
    const next = { ...config };
    delete next.daemonAppendSystemPrompt;

    // A personality with respectGlobalAppendPrompt === false owns its whole
    // system prompt - the daemon-global append must not stack on top of it.
    const suppressGlobalAppend = config.profileSnapshot?.respectGlobalAppendPrompt === false;

    return daemonAppendSystemPrompt && !suppressGlobalAppend
      ? {
          ...next,
          daemonAppendSystemPrompt,
        }
      : next;
  }

  private async buildLaunchContext(
    agentId: string,
    client: AgentClient,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<AgentLaunchContext> {
    const context: AgentLaunchContext = {
      agentId,
      env: {
        ...env,
        OTTO_AGENT_ID: agentId,
        // Alongside the id so anything the agent spawns - a hook, a workspace
        // script, a nested tool - can find the workspace it belongs to without
        // relying on having inherited the process cwd.
        OTTO_AGENT_CWD: cwd,
      },
      // Resolved daemon-wide behavior toggles for this launch. Providers that
      // don't support a behavior ignore it (Claude reads promptSuggestions /
      // agentProgressSummaries).
      agentBehaviors: this.agentBehaviors,
    };
    if (
      this.ottoToolsEnabled &&
      client.capabilities.supportsNativeOttoTools &&
      this.ottoToolCatalogFactory
    ) {
      context.ottoTools = await this.ottoToolCatalogFactory({ callerAgentId: agentId });
    }
    return context;
  }

  private resolveProviderLaunchConfig(
    launchConfig: AgentSessionConfig,
    launchContext: AgentLaunchContext,
  ): AgentSessionConfig {
    return launchContext.ottoTools ? stripInternalOttoMcpServer(launchConfig) : launchConfig;
  }

  private async requireAvailableClient(options: { provider: AgentProvider }): Promise<AgentClient> {
    const client = this.clients.get(options.provider);
    if (!client) {
      const configuredProviders = this.getConfiguredProviderIds();
      throw new Error(
        `Unknown provider '${options.provider}'. Configured providers: ${formatProviderList(
          configuredProviders,
        )}.`,
      );
    }

    let unavailableReason: string | null = null;
    try {
      const available = await client.isAvailable();
      if (available) {
        return client;
      }
    } catch (error) {
      unavailableReason = error instanceof Error ? error.message : String(error);
    }

    const availableProviders = (await this.listProviderAvailability())
      .filter((entry) => entry.available)
      .map((entry) => entry.provider);
    const providerList = formatProviderList(availableProviders);
    const reason = unavailableReason ? ` Reason: ${unavailableReason}.` : "";
    throw new Error(
      `Provider '${options.provider}' is not available.${reason} Available providers: ${providerList}. Use one of those providers, or install/configure '${options.provider}'.`,
    );
  }

  private requireEnabledProvider(provider: AgentProvider): void {
    if (this.providerEnabled.get(provider) === false) {
      throw new Error(`Provider '${provider}' is disabled`);
    }
  }

  private getConfiguredProviderIds(): AgentProvider[] {
    return Array.from(new Set([...this.providerEnabled.keys(), ...this.clients.keys()]));
  }

  private requireClient(provider: AgentProvider): AgentClient {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`No client registered for provider '${provider}'`);
    }
    return client;
  }

  async archiveNativeSessionBestEffort(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = this.clients.get(provider);
    if (!client?.archiveNativeSession) return;
    try {
      await client.archiveNativeSession(persistence);
    } catch (error) {
      this.logger.warn(
        { error, provider, sessionId: persistence.sessionId },
        "Failed to archive native session (best-effort)",
      );
    }
  }

  private async unarchiveNativeSession(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = this.clients.get(provider);
    if (!client?.unarchiveNativeSession) return;
    await client.unarchiveNativeSession(persistence);
  }

  private requireAgent(id: string): LiveManagedAgent {
    const normalizedId = validateAgentId(id, "requireAgent");
    const agent = this.agents.get(normalizedId);
    if (!agent) {
      throw new Error(`Unknown agent '${normalizedId}'`);
    }
    return agent;
  }

  private requireSessionAgent(id: string): ActiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.session === null) {
      throw new Error(`Agent '${agent.id}' has no managed session`);
    }
    return agent;
  }
}

export function commandMayHaveChangedExternalState(command: string): boolean {
  const normalized = command.toLowerCase();
  // Commands that operate on remote state and do NOT trigger local file
  // watchers. Local git mutations (commit, checkout, merge, rebase, reset,
  // pull) are already caught by watchers on .git/HEAD and refs/heads/.
  return (
    // GitHub PR operations (merge, close, create, edit, comment, review)
    /\bgh\s+pr\s+(merge|close|create|edit|comment|review)\b/.test(normalized) ||
    // Pushes to remote - local refs unchanged, but remote state (PR checks,
    // mergeable status) may shift immediately after.
    /\bgit\s+push\b/.test(normalized) ||
    // Fetches update refs/remotes/ which our watchers do not watch, so
    // ahead/behind counts can drift stale until the next refresh.
    /\bgit\s+fetch\b/.test(normalized)
  );
}
