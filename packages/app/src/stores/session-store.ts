import equal from "fast-deep-equal";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { FileEol } from "@otto-code/protocol/messages";
import type { ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import {
  appendSubmittedUserMessage,
  handoffCreatedAgentUserMessageToStream,
  removeSubmittedUserMessage,
  type StreamItem,
  type TodoEntry,
  type UserMessageItem,
} from "@/types/stream";
import {
  acceptMessageSubmission,
  beginMessageSubmission,
  getActiveMessageSubmissions,
  observeMessageSubmissionCanonical,
  rejectMessageSubmission,
  type MessageSubmissionRecord,
  type MessageSubmissionRejectionOutcome,
} from "@/composer/submission/model";
import type { PendingPermission } from "@/types/shared";
import type { ComposerAttachment } from "@/attachments/types";
import type { AgentLifecycleStatus } from "@otto-code/protocol/agent-lifecycle";
import type {
  AgentPermissionRequest,
  AgentFeature,
  AgentProvider,
  AgentMode,
  AgentCapabilityFlags,
  AgentUsage,
  AgentPersistenceHandle,
} from "@otto-code/protocol/agent-types";
import type {
  AgentCumulativeUsage,
  QueuedAgentMessagePayload,
  ServerInfoStatusPayload,
  ProjectPlacementPayload,
  ServerCapabilities,
  WorkspaceDescriptorPayload,
  WorkspaceProjectDescriptorPayload,
  BackgroundShellTaskInfo,
  SuggestedTaskInfo,
  AgentRateLimitInfo,
  ProjectKanbanTarget,
} from "@otto-code/protocol/messages";
import {
  normalizeWorkspaceOpaqueId,
  normalizeWorkspacePath,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import {
  createAgentLastActivityCoalescer,
  type AgentLastActivityCommitter,
} from "@/runtime/activity";
import {
  buildWorkspaceAgentActivityIndex,
  type WorkspaceAgentActivity,
} from "@/utils/workspace-agent-activity";
import { planAgentStreamEviction } from "@/timeline/agent-stream-retention";
import { buildWorkspaceExplorerStateKey } from "@/file-explorer/state-key";
import { useClearedSubagentTokensStore } from "@/subagents/cleared-subagent-tokens-store";
import {
  applyTurnLivenessTransition,
  resolveTurnPresentation,
  TURN_LIVENESS_IDLE,
  type TurnLiveness,
  type TurnLivenessTransition,
  type TurnPresentation,
} from "@/timeline/turn-liveness";

// Ordering-only clock for stream-buffer retention. Global rather than
// per-session because it only ever has to increase; comparisons are always
// within one session's map.
let agentStreamTouchTick = 0;
let nextCancellationRequestId = 0;

// Re-export types that were in session-context
export type MessageEntry =
  | {
      type: "user";
      id: string;
      timestamp: number;
      message: string;
    }
  | {
      type: "assistant";
      id: string;
      timestamp: number;
      message: string;
    }
  | {
      type: "activity";
      id: string;
      timestamp: number;
      activityType: "system" | "info" | "success" | "error";
      message: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "artifact";
      id: string;
      timestamp: number;
      artifactId: string;
      artifactType: string;
      title: string;
    }
  | {
      type: "tool_call";
      id: string;
      timestamp: number;
      toolName: string;
      args: unknown;
      result?: unknown;
      error?: unknown;
      status: "executing" | "completed" | "failed";
    };

export interface AgentRuntimeInfo {
  provider: AgentProvider;
  sessionId: string | null;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  extra?: Record<string, unknown>;
}

export interface Agent {
  serverId: string;
  id: string;
  provider: AgentProvider;
  status: AgentLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  lastUserMessageAt: Date | null;
  lastActivityAt: Date;
  capabilities: AgentCapabilityFlags;
  currentModeId: string | null;
  availableModes: AgentMode[];
  pendingPermissions: AgentPermissionRequest[];
  persistence: AgentPersistenceHandle | null;
  runtimeInfo?: AgentRuntimeInfo;
  lastUsage?: AgentUsage;
  /**
   * Honest cumulative token total (Σ across the whole run) from the provider,
   * for the subagents-track cost readout. Absent ⇒ no readout (old daemon or a
   * provider that doesn't report it). See docs/agent-lifecycle.md.
   */
  cumulativeTokens?: number;
  /**
   * The same lifetime spend as `cumulativeTokens`, as the real in / cached /
   * cache-write / out split plus the provider's OWN cost - never a rate-table
   * estimate. Feeds the chat total (see chat-totals.ts). Absent ⇒ an old daemon
   * or a provider that reported nothing; `costUsd` absent ⇒ genuinely
   * unpriceable, which surfaces as a blank rather than a guess.
   * COMPAT(cumulativeUsage): gated on `features.cumulativeUsage`.
   */
  cumulativeUsage?: AgentCumulativeUsage;
  /**
   * Sub-agents-track liveness: how much work this agent has done
   * (`toolUseCount`, cumulative - it survives on a finished row) and what it is
   * doing right now (`currentTool`, which the daemon clears once the agent is
   * terminal). Absent ⇒ the row omits that readout - an old daemon or a
   * provider that can't report it, never a guessed value.
   * See docs/chat-lifecycle.md (the subagents track).
   */
  toolUseCount?: number;
  currentTool?: string;
  /**
   * Messages the daemon is holding to run as this agent's next turn
   * (`delivery: "queue"`). Absent ⇒ nothing queued, or a host without
   * `features.steerQueue` - in which case the composer's own queue is the one
   * in play. See packages/app/src/composer/queue.ts.
   */
  queuedMessages?: QueuedAgentMessagePayload[];
  lastError?: string | null;
  title: string | null;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  features?: AgentFeature[];
  thinkingOptionId?: string | null;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: Date | null;
  archivedAt?: Date | null;
  archiveBytes?: number;
  parentAgentId: string | null;
  labels: Record<string, string>;
  projectPlacement?: ProjectPlacementPayload | null;
  /**
   * "observed" marks a provider-managed subagent the user can watch but not
   * prompt or reconfigure. The pane renders read-only and interactive controls
   * are disabled. Absent (from older daemons) is treated as "attended". See
   * projects/observed-subagents/observed-subagents.md.
   */
  attend?: "attended" | "observed";
  /**
   * True when this observed sub-agent run outlives an interrupt of its parent's
   * turn (a backgrounded Task/Agent, a Workflow run, or anything nested under
   * one). Absent (from older daemons, and on every attended agent) is treated as
   * foreground. See docs/chat-lifecycle.md.
   */
  backgrounded?: boolean;
  /**
   * Spinner colors from the Agent Personality this agent was spawned from, so
   * its live thinking indicator shows the personality's identity. Absent/null ⇒
   * the theme's default spinner colors. See docs/agent-personalities.md.
   */
  personalitySpinner?: { glowA: string; glowB: string } | null;
  /**
   * Name of the Agent Personality this agent was spawned from. Present ⇒ the
   * running-agent controls keep the personality identity (model trigger shows
   * the name, effort chip hidden). Absent/null ⇒ plain provider/model controls.
   */
  personalityName?: string | null;
  /**
   * Stable id of the bound Agent Personality. Roster selection keys on this
   * (names can be renamed); personalityName is display + the fallback against
   * daemons that predate the field.
   */
  personalityId?: string | null;
}

export interface WorkspaceDescriptor {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectCustomIconRevision?: string | null;
  projectRootPath: string;
  workspaceDirectory: string;
  projectKind: WorkspaceDescriptorPayload["projectKind"];
  workspaceKind: WorkspaceDescriptorPayload["workspaceKind"];
  name: string;
  title?: string | null;
  pinnedAt?: string | null;
  status: WorkspaceDescriptorPayload["status"];
  statusEnteredAt: Date | null;
  archivingAt: string | null;
  // Working tree relative to HEAD. Unlike the legacy `diffStat`, this is empty
  // after commit and is the default workspace-row indicator.
  workingTreeDiffStat?: { additions: number; deletions: number } | null;
  diffStat: { additions: number; deletions: number } | null;
  scripts: WorkspaceDescriptorPayload["scripts"];
  gitRuntime?: WorkspaceDescriptorPayload["gitRuntime"];
  githubRuntime?: WorkspaceDescriptorPayload["githubRuntime"];
  forge?: WorkspaceDescriptorPayload["forge"];
  project?: ProjectPlacementPayload;
  worktreeSlug?: WorkspaceDescriptorPayload["worktreeSlug"];
}

export function normalizeWorkspaceDescriptor(
  payload: WorkspaceDescriptorPayload,
): WorkspaceDescriptor {
  const statusEnteredAtRaw = payload.statusEnteredAt;
  const statusEnteredAt: Date | null =
    typeof statusEnteredAtRaw === "string" && statusEnteredAtRaw.length > 0
      ? new Date(statusEnteredAtRaw)
      : null;
  return {
    id: normalizeWorkspaceOpaqueId(payload.id) ?? payload.id,
    projectId: payload.projectId,
    projectDisplayName: payload.projectDisplayName,
    projectCustomName: payload.projectCustomName ?? null,
    projectCustomIconRevision: payload.projectCustomIconRevision ?? null,
    projectRootPath: payload.projectRootPath,
    // Canonicalize the workspace directory once, at the store boundary, so every
    // consumer can read workspace.workspaceDirectory directly. Empty means "no
    // usable directory" (older daemons may omit it; the wire field is optional).
    workspaceDirectory: normalizeWorkspacePath(payload.workspaceDirectory) ?? "",
    projectKind: payload.projectKind,
    workspaceKind: payload.workspaceKind,
    name: payload.name,
    title: payload.title ?? null,
    pinnedAt: payload.pinnedAt ?? null,
    status: payload.status,
    statusEnteredAt,
    archivingAt: payload.archivingAt ?? null,
    workingTreeDiffStat: payload.workingTreeDiffStat ?? null,
    diffStat: payload.diffStat ?? null,
    scripts: (payload.scripts ?? []).map((s) => Object.assign({}, s)),
    gitRuntime: payload.gitRuntime,
    githubRuntime: payload.githubRuntime,
    forge: payload.forge,
    project: payload.project,
    worktreeSlug: payload.worktreeSlug,
  };
}

export interface ProjectDescriptor {
  projectId: string;
  projectKey?: string | null;
  projectDisplayName: string;
  projectCustomName: string | null;
  projectCustomIconRevision?: string | null;
  /** The project's Kanban board target; null means no board is configured. */
  projectKanban: ProjectKanbanTarget | null;
  projectRootPath: string;
  projectKind: WorkspaceDescriptorPayload["projectKind"];
}

export function normalizeProjectDescriptor(
  payload: WorkspaceProjectDescriptorPayload,
): ProjectDescriptor {
  return {
    projectId: payload.projectId,
    projectKey: payload.projectKey ?? null,
    projectDisplayName: payload.projectDisplayName,
    projectCustomName: payload.projectCustomName ?? null,
    projectCustomIconRevision: payload.projectCustomIconRevision ?? null,
    // A pointer, never a credential; null keeps the descriptor readable for
    // daemons that predate the field.
    projectKanban: payload.projectKanban ?? null,
    projectRootPath: payload.projectRootPath,
    projectKind: payload.projectKind,
  };
}

function preserveWorkspaceDescriptorIdentity(
  incoming: WorkspaceDescriptor,
  existing?: WorkspaceDescriptor | null,
): WorkspaceDescriptor {
  if (existing && equal(existing, incoming)) {
    return existing;
  }
  return incoming;
}

function preserveWorkspaceMapIdentity(
  existing: Map<string, WorkspaceDescriptor>,
  incoming: Map<string, WorkspaceDescriptor>,
): Map<string, WorkspaceDescriptor> {
  if (existing === incoming) {
    return existing;
  }

  const next = new Map<string, WorkspaceDescriptor>();
  let changed = existing.size !== incoming.size;
  const existingEntries = existing.entries();

  for (const [key, workspace] of incoming) {
    const existingWorkspace = existing.get(key);
    const nextWorkspace = preserveWorkspaceDescriptorIdentity(workspace, existingWorkspace);
    next.set(key, nextWorkspace);
    const existingEntry = existingEntries.next().value;
    if (!existingEntry || existingEntry[0] !== key || existingEntry[1] !== nextWorkspace) {
      changed = true;
    }
  }

  return changed ? next : existing;
}

function projectMapsEqual(
  left: ReadonlyMap<string, ProjectDescriptor>,
  right: ReadonlyMap<string, ProjectDescriptor>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [projectId, project] of right) {
    if (!equal(left.get(projectId), project)) return false;
  }
  return true;
}

export type ExplorerEntryKind = "file" | "directory";
export type ExplorerFileKind = "text" | "image" | "binary";
export type ExplorerEncoding = "utf-8" | "base64" | "none";

export interface ExplorerEntry {
  name: string;
  path: string;
  kind: ExplorerEntryKind;
  size: number;
  modifiedAt: string;
}

export interface ExplorerFile {
  path: string;
  kind: ExplorerFileKind;
  /** Opaque daemon revision used for conflict-safe writes. */
  revision?: string;
  encoding: ExplorerEncoding;
  content?: string;
  // TextDecoder removes a leading UTF-8 BOM; retain this bit so file writes can restore it.
  hasBom: boolean;
  mimeType?: string;
  size: number;
  modifiedAt: string;
  /** Null when the read path didn't report line endings (binary transfer). */
  eol: FileEol | null;
}

export interface ExplorerDirectory {
  path: string;
  entries: ExplorerEntry[];
}

interface ExplorerRequestState {
  path: string;
  mode: "list" | "file";
}

export interface AgentFileExplorerState {
  directories: Map<string, ExplorerDirectory>;
  files: Map<string, ExplorerFile>;
  isLoading: boolean;
  lastError: string | null;
  pendingRequest: ExplorerRequestState | null;
  currentPath: string;
  history: string[];
  lastVisitedPath: string;
  selectedEntryPath: string | null;
}

export interface DaemonServerInfo {
  serverId: string;
  hostname: string | null;
  version: string | null;
  platform?: string;
  terminalShells?: NonNullable<ServerInfoStatusPayload["terminalShells"]>;
  desktopManaged?: boolean;
  capabilities?: ServerCapabilities;
  features?: ServerInfoStatusPayload["features"];
}

export interface AgentTimelineCursorState {
  epoch: string;
  startSeq: number;
  endSeq: number;
  retainedRanges?: Array<{ startSeq: number; endSeq: number; hasOlder?: boolean }>;
}

export type AgentTimelineState =
  | { status: "cold" }
  | { status: "painted"; items: StreamItem[] }
  | {
      status: "synced";
      items: StreamItem[];
      range: AgentTimelineCursorState | null;
      older: "available" | "none";
      newer: "available" | "none";
    };

export interface SessionReplicaTimeline {
  agentId: string;
  items: StreamItem[];
  cursor: AgentTimelineCursorState | null;
  hasOlder: boolean;
}

export interface SessionReplica {
  agents: Map<string, Agent>;
  workspaces: Map<string, WorkspaceDescriptor>;
  projects: Map<string, ProjectDescriptor>;
  timeline: SessionReplicaTimeline | null;
}

export type WorkspaceRestoreStatus = "restoring" | "failed" | "needs-host-upgrade";

// Per-session state
export interface SessionState {
  serverId: string;

  // Daemon client (immutable reference)
  client: DaemonClient | null;
  clientGeneration: number;
  viewedTimelineSync: ViewedTimelineUiBridge | null;

  // Server metadata (from server_info handshake)
  serverInfo: DaemonServerInfo | null;

  // Hydration status
  hasHydratedAgents: boolean;
  hasHydratedWorkspaces: boolean;

  // Audio state
  isPlayingAudio: boolean;

  // Focus
  focusedAgentId: string | null;
  focusedTerminalId: string | null;

  // Messages
  messages: MessageEntry[];
  currentAssistantMessage: string;

  // Stream state (head/tail model)
  agentStreamTail: Map<string, StreamItem[]>;
  agentStreamHead: Map<string, StreamItem[]>;
  agentTasks: Map<string, TodoEntry[]>;
  agentTurnLiveness: Map<string, TurnLiveness>;
  messageSubmissions: Map<string, MessageSubmissionRecord[]>;
  agentTimelineCursor: Map<string, AgentTimelineCursorState>;
  agentTimelineHasOlder: Map<string, boolean>;
  agentTimelineHasNewer: Map<string, boolean>;
  agentTimelineOlderFetchInFlight: Map<string, boolean>;
  historySyncGeneration: number;
  agentHistorySyncGeneration: Map<string, number>;
  agentAuthoritativeHistoryApplied: Map<string, boolean>;
  // Ref counts, not a flag set: two panes can show the same chat, and the
  // second unmount must not release buffers the first pane is still rendering.
  // See timeline/agent-stream-retention.ts for what this gates.
  agentStreamRetainers: Map<string, number>;
  /**
   * Write order of each agent's buffers, newest highest. Drives eviction order.
   * A monotonic tick rather than `Date.now()` on purpose: a burst of stream
   * flushes lands inside one millisecond, and wall-clock ties would collapse
   * "least recently used" into "lowest agent id".
   */
  agentStreamTouchSeq: Map<string, number>;

  // Initializing agents (used for UI loading state)
  initializingAgents: Map<string, boolean>;

  // Agents
  agents: Map<string, Agent>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
  agentDetails: Map<string, Agent>;
  // Background shell tasks (Claude Bash tool run_in_background) keyed by task
  // id - not AI agents/subagents, plain shell processes for the Background
  // Tasks track. See packages/app/src/background-tasks/.
  backgroundShellTasks: Map<string, BackgroundShellTaskInfo>;
  // Suggested tasks (spawn_task chips) keyed by taskId. Full per-parent pending
  // list, reconciled on suggested_tasks_changed. See packages/app/src/suggested-tasks/.
  suggestedTasks: Map<string, SuggestedTaskInfo>;
  workspaces: Map<string, WorkspaceDescriptor>;
  // All active project descriptors, keyed by host-local projectId.
  projects: Map<string, ProjectDescriptor>;
  // Transient restore state for archived workspaces, keyed by normalized
  // workspaceId. Cleared in mergeWorkspaces when the descriptor lands.
  restoringWorkspaces: Map<string, WorkspaceRestoreStatus>;

  // Permissions
  pendingPermissions: Map<string, PendingPermission>;

  // File explorer
  fileExplorer: Map<string, AgentFileExplorerState>;

  // Queued messages
  queuedMessages: Map<
    string,
    Array<{ id: string; text: string; attachments: ComposerAttachment[] }>
  >;

  // Latest AI prompt suggestion per agent (native Claude next-prompt prediction).
  // Transient: set on a prompt_suggestion event, cleared on the next turn_started.
  // The composer renders it as ghost-text watermark (Tab to accept).
  agentPromptSuggestions: Map<string, string>;

  // Latest provider-reported plan rate-limit status per agent. Transient: set
  // on a rate_limit_updated event, replaced by the next one. The composer
  // shows a warning strip for warning/rejected states (suppressible via the
  // rateLimitWarningsEnabled setting).
  agentRateLimits: Map<string, AgentRateLimitInfo>;

  // Per-agent "the user X'd out this warning" mute. Timed, not permanent: it
  // re-surfaces after `mutedUntil` so a steady near-limit state keeps nudging
  // (you shouldn't forget). `key` (`status:limitType`) scopes the mute to the
  // dismissed warning so an escalation (warning→rejected) or a different window
  // breaks through immediately. Device-local UI state; never synced.
  dismissedRateLimits: Map<string, RateLimitDismissal>;

  // Per-agent stack of prompts the user has sent in this chat, oldest→newest.
  // Powers ArrowUp/ArrowDown shell-style history recall in the composer. Sending
  // always appends (an edited recall clones as a new top entry). Capped length.
  sentPromptHistory: Map<string, string[]>;
}

export function selectAgentTurnPresentation(
  session: SessionState | undefined,
  agentId: string,
): TurnPresentation {
  const agent = session?.agents.get(agentId);
  return resolveTurnPresentation(
    session?.agentTurnLiveness.get(agentId) ?? TURN_LIVENESS_IDLE,
    getActiveMessageSubmissions(session?.messageSubmissions.get(agentId)).length > 0,
    agent?.status === "running",
    agent?.lastUserMessageAt ?? null,
  );
}

export function selectAgentTimelineState(
  session: SessionState | undefined,
  agentId: string,
): AgentTimelineState {
  if (!session) return { status: "cold" };
  const items = session.agentStreamTail.get(agentId) ?? [];
  if (session.agentAuthoritativeHistoryApplied.get(agentId) === true) {
    return {
      status: "synced",
      items,
      range: session.agentTimelineCursor.get(agentId) ?? null,
      older: session.agentTimelineHasOlder.get(agentId) === true ? "available" : "none",
      newer: session.agentTimelineHasNewer.get(agentId) === true ? "available" : "none",
    };
  }
  return items.length > 0 ? { status: "painted", items } : { status: "cold" };
}

function latestTasksFromStream(items: readonly StreamItem[]): TodoEntry[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "todo_list") return item.items;
  }
  return [];
}

function updateAgentTasks(
  current: Map<string, TodoEntry[]>,
  agentId: string,
  taskSnapshot: TodoEntry[] | undefined,
): Map<string, TodoEntry[]> {
  if (taskSnapshot === undefined || equal(current.get(agentId) ?? [], taskSnapshot)) return current;
  const next = new Map(current);
  if (taskSnapshot.length > 0) next.set(agentId, taskSnapshot);
  else next.delete(agentId);
  return next;
}

// Global store state
interface SessionStoreState {
  sessions: Record<string, SessionState>;

  // Agent activity timestamps (top-level, keyed by agentId to prevent cascade rerenders)
  agentLastActivity: Map<string, Date>;
}

// Action types
interface SessionStoreActions {
  // Session management
  initializeSession: (
    serverId: string,
    client: DaemonClient | null,
    clientGeneration?: number,
  ) => void;
  restoreSessionReplica: (serverId: string, replica: SessionReplica) => void;
  clearSession: (serverId: string) => void;
  getSession: (serverId: string) => SessionState | undefined;
  updateSessionClient: (serverId: string, client: DaemonClient, clientGeneration?: number) => void;
  setViewedTimelineSync: (serverId: string, sync: ViewedTimelineUiBridge | null) => void;
  updateSessionServerInfo: (serverId: string, info: DaemonServerInfo) => void;

  // Audio state
  setIsPlayingAudio: (serverId: string, playing: boolean) => void;

  // Focus
  setFocusedAgentId: (serverId: string, agentId: string | null) => void;
  setFocusedTerminalId: (serverId: string, terminalId: string | null) => void;

  // Messages
  setMessages: (
    serverId: string,
    messages: MessageEntry[] | ((prev: MessageEntry[]) => MessageEntry[]),
  ) => void;
  setCurrentAssistantMessage: (
    serverId: string,
    message: string | ((prev: string) => string),
  ) => void;

  // Stream state (head/tail model)
  setAgentStreamTail: (
    serverId: string,
    state:
      | Map<string, StreamItem[]>
      | ((prev: Map<string, StreamItem[]>) => Map<string, StreamItem[]>),
  ) => void;
  setAgentStreamHead: (
    serverId: string,
    state:
      | Map<string, StreamItem[]>
      | ((prev: Map<string, StreamItem[]>) => Map<string, StreamItem[]>),
  ) => void;
  setAgentStreamState: (
    serverId: string,
    agentId: string,
    state: {
      tail?: StreamItem[];
      head?: StreamItem[];
      acknowledgedClientMessageIds?: readonly string[];
      taskSnapshot?: TodoEntry[];
    },
  ) => void;
  applyAgentTurnLiveness: (
    serverId: string,
    agentId: string,
    transition: TurnLivenessTransition | readonly TurnLivenessTransition[],
  ) => void;
  beginAgentCancellation: (serverId: string, agentId: string) => number;
  settleAgentCancellation: (serverId: string, agentId: string, requestId: number) => void;
  clearAgentTurnLiveness: (serverId: string) => void;
  beginAgentMessageSubmission: (
    serverId: string,
    agentId: string,
    message: UserMessageItem,
  ) => void;
  acceptAgentMessageSubmission: (
    serverId: string,
    agentId: string,
    clientMessageId: string,
  ) => void;
  rejectAgentMessageSubmission: (
    serverId: string,
    agentId: string,
    clientMessageId: string,
  ) => MessageSubmissionRejectionOutcome;
  handoffCreatedAgentUserMessage: (
    serverId: string,
    agentId: string,
    message: UserMessageItem,
  ) => boolean;
  clearAgentStreamHead: (serverId: string, agentId: string) => void;
  setAgentTimelineCursor: (
    serverId: string,
    state:
      | Map<string, AgentTimelineCursorState>
      | ((prev: Map<string, AgentTimelineCursorState>) => Map<string, AgentTimelineCursorState>),
  ) => void;
  setAgentTimelineHasOlder: (
    serverId: string,
    state: Map<string, boolean> | ((prev: Map<string, boolean>) => Map<string, boolean>),
  ) => void;
  setAgentTimelineHasNewer: (
    serverId: string,
    state: Map<string, boolean> | ((prev: Map<string, boolean>) => Map<string, boolean>),
  ) => void;
  setAgentTimelineOlderFetchInFlight: (
    serverId: string,
    state: Map<string, boolean> | ((prev: Map<string, boolean>) => Map<string, boolean>),
  ) => void;
  bumpHistorySyncGeneration: (serverId: string) => void;
  markAgentHistorySynchronized: (serverId: string, agentId: string) => void;
  setAgentAuthoritativeHistoryApplied: (
    serverId: string,
    agentId: string,
    applied: boolean,
  ) => void;
  applyAgentTimelineResponseState: (
    serverId: string,
    agentId: string,
    state: {
      items: StreamItem[];
      head: StreamItem[];
      range: AgentTimelineCursorState | null;
      older: "available" | "none" | "unchanged";
      newer: boolean;
      synchronized: boolean;
      acknowledgedClientMessageIds: string[];
    },
  ) => void;
  /**
   * Mark an agent's stream buffers as in use by a mounted surface. Returns the
   * matching release; call it on unmount. Prefer `useAgentStreamRetention`.
   */
  retainAgentStream: (serverId: string, agentId: string) => () => void;
  /**
   * Drop an agent's stream buffers *and* the resume state that would otherwise
   * make the next open a no-op catch-up. The two always move together - see
   * timeline/agent-stream-retention.ts.
   */
  releaseAgentStreams: (serverId: string, agentIds: readonly string[]) => void;
  /**
   * Apply the retention cap, plus any agents the caller knows have left the
   * session. Called where the buffer key set can grow and on departure events.
   */
  sweepAgentStreams: (serverId: string, departedAgentIds?: readonly string[]) => void;
  /**
   * Drop what a closed chat tab owned and nothing else does: the hydrated
   * snapshot an archived chat was opened from (`agentDetails`) and its
   * cleared-sub-agent tally. Call it when the TAB closes, not when a pane
   * unmounts - a background pane can be unmounted by mounted-tab retention or
   * a workspace-deck eviction while its tab is very much still open, and the
   * tab strip renders its title straight out of this map.
   */
  releaseClosedChat: (serverId: string, agentId: string) => void;

  // Initializing agents
  setInitializingAgents: (
    serverId: string,
    state: Map<string, boolean> | ((prev: Map<string, boolean>) => Map<string, boolean>),
  ) => void;

  // Agents
  setAgents: (
    serverId: string,
    agents: Map<string, Agent> | ((prev: Map<string, Agent>) => Map<string, Agent>),
  ) => void;
  setAgentDetails: (
    serverId: string,
    agents: Map<string, Agent> | ((prev: Map<string, Agent>) => Map<string, Agent>),
  ) => void;
  // Replaces every background shell task belonging to `parentAgentId` with
  // the pushed list - mirrors the full-list reconciliation the daemon sends
  // on background_shell_tasks_changed.
  setBackgroundShellTasksForParent: (
    serverId: string,
    parentAgentId: string,
    tasks: readonly BackgroundShellTaskInfo[],
  ) => void;
  // Replace the pending suggested tasks for a parent agent with the pushed list
  // - mirrors the full-list reconciliation the daemon sends on
  // suggested_tasks_changed.
  setSuggestedTasksForParent: (
    serverId: string,
    parentAgentId: string,
    tasks: readonly SuggestedTaskInfo[],
  ) => void;
  setWorkspaces: (
    serverId: string,
    workspaces:
      | Map<string, WorkspaceDescriptor>
      | ((prev: Map<string, WorkspaceDescriptor>) => Map<string, WorkspaceDescriptor>),
  ) => void;
  mergeWorkspaces: (serverId: string, workspaces: Iterable<WorkspaceDescriptor>) => void;
  removeWorkspace: (serverId: string, workspaceId: string) => void;
  setProjects: (serverId: string, projects: Iterable<ProjectDescriptor>) => void;
  upsertProject: (serverId: string, project: ProjectDescriptor) => void;
  removeProject: (serverId: string, projectId: string) => void;
  setWorkspaceRestoreStatus: (
    serverId: string,
    workspaceId: string,
    status: WorkspaceRestoreStatus,
  ) => void;
  clearWorkspaceRestoreStatus: (serverId: string, workspaceId: string) => void;

  // Agent activity timestamps
  setAgentLastActivity: (agentId: string, timestamp: Date) => void;
  setAgentLastActivityBatch: (
    updates: Map<string, Date> | ((prev: Map<string, Date>) => Map<string, Date>),
  ) => void;
  flushAgentLastActivity: () => void;

  // Permissions
  setPendingPermissions: (
    serverId: string,
    perms:
      | Map<string, PendingPermission>
      | ((prev: Map<string, PendingPermission>) => Map<string, PendingPermission>),
  ) => void;

  // File explorer
  setFileExplorer: (
    serverId: string,
    state:
      | Map<string, AgentFileExplorerState>
      | ((prev: Map<string, AgentFileExplorerState>) => Map<string, AgentFileExplorerState>),
  ) => void;

  // Queued messages
  setQueuedMessages: (
    serverId: string,
    value:
      | Map<string, Array<{ id: string; text: string; attachments: ComposerAttachment[] }>>
      | ((
          prev: Map<string, Array<{ id: string; text: string; attachments: ComposerAttachment[] }>>,
        ) => Map<string, Array<{ id: string; text: string; attachments: ComposerAttachment[] }>>),
  ) => void;

  // AI prompt suggestions (ghost text). Pass null to clear the agent's suggestion.
  setAgentPromptSuggestion: (serverId: string, agentId: string, suggestion: string | null) => void;

  // Plan rate-limit status. Pass null to clear the agent's entry.
  setAgentRateLimit: (serverId: string, agentId: string, info: AgentRateLimitInfo | null) => void;

  // Record the user X-ing out the agent's current rate-limit warning, so it stays
  // hidden until the status/window changes. No-op when there's nothing to dismiss.
  dismissAgentRateLimit: (serverId: string, agentId: string) => void;

  // Sent-message history stack. Appends text as the newest entry (deduping an
  // immediate repeat of the current tail); caps the stack length.
  appendSentPrompt: (serverId: string, agentId: string, text: string) => void;

  // Hydration
  setHasHydratedAgents: (serverId: string, hydrated: boolean) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;

  // Agent directory (derived from agents)
  getAgentDirectory: (serverId: string) => AgentDirectoryEntry[] | undefined;
}

type SessionStore = SessionStoreState & SessionStoreActions;

const agentLastActivityCoalescer = createAgentLastActivityCoalescer();

// Cap on the per-agent sent-message history stack (ArrowUp/ArrowDown recall).
const SENT_PROMPT_HISTORY_LIMIT = 100;

// How long the X mutes a rate-limit warning before it re-surfaces. Long enough
// not to nag every turn, short enough that a near-limit state keeps reminding you
// well before you actually hit the wall. Tune here.
export const RATE_LIMIT_MUTE_MS = 30 * 60 * 1000; // 30 minutes

export interface RateLimitDismissal {
  // The `status:limitType` identity that was muted (see rateLimitDismissKey).
  key: string;
  // Epoch ms after which the warning re-surfaces.
  mutedUntil: number;
}

// Identity of a rate-limit warning for mute purposes: status + window, so a mute
// survives percent ticks but a change in either breaks through.
export function rateLimitDismissKey(info: AgentRateLimitInfo): string {
  return `${info.status}:${info.limitType ?? ""}`;
}

// Helper to create initial session state
function createInitialSessionState(
  serverId: string,
  client: DaemonClient | null,
  clientGeneration = 0,
): SessionState {
  return {
    serverId,
    client,
    clientGeneration,
    viewedTimelineSync: null,
    serverInfo: null,
    hasHydratedAgents: false,
    hasHydratedWorkspaces: false,
    isPlayingAudio: false,
    focusedAgentId: null,
    focusedTerminalId: null,
    messages: [],
    currentAssistantMessage: "",
    agentStreamTail: new Map(),
    agentStreamHead: new Map(),
    agentTasks: new Map(),
    agentTurnLiveness: new Map(),
    messageSubmissions: new Map(),
    agentTimelineCursor: new Map(),
    agentTimelineHasOlder: new Map(),
    agentTimelineHasNewer: new Map(),
    agentTimelineOlderFetchInFlight: new Map(),
    historySyncGeneration: 0,
    agentHistorySyncGeneration: new Map(),
    agentAuthoritativeHistoryApplied: new Map(),
    agentStreamRetainers: new Map(),
    agentStreamTouchSeq: new Map(),
    initializingAgents: new Map(),
    agents: new Map(),
    workspaceAgentActivity: new Map(),
    agentDetails: new Map(),
    backgroundShellTasks: new Map(),
    suggestedTasks: new Map(),
    workspaces: new Map(),
    projects: new Map(),
    restoringWorkspaces: new Map(),
    pendingPermissions: new Map(),
    fileExplorer: new Map(),
    queuedMessages: new Map(),
    agentPromptSuggestions: new Map(),
    agentRateLimits: new Map(),
    dismissedRateLimits: new Map(),
    sentPromptHistory: new Map(),
  };
}

function areServerCapabilitiesEqual(
  current: ServerCapabilities | undefined,
  next: ServerCapabilities | undefined,
): boolean {
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

function areServerInfoFeaturesEqual(
  current: ServerInfoStatusPayload["features"] | undefined,
  next: ServerInfoStatusPayload["features"] | undefined,
): boolean {
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

function areTerminalShellsEqual(
  current: ServerInfoStatusPayload["terminalShells"] | undefined,
  next: ServerInfoStatusPayload["terminalShells"] | undefined,
): boolean {
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

function isSessionServerInfoUnchanged(input: {
  currentServerInfo: SessionState["serverInfo"] | undefined;
  nextHostname: string | null;
  nextVersion: string | null;
  nextPlatform: string | undefined;
  nextTerminalShells: ServerInfoStatusPayload["terminalShells"] | undefined;
  nextDesktopManaged: boolean | undefined;
  nextCapabilities: ServerCapabilities | undefined;
  nextFeatures: ServerInfoStatusPayload["features"] | undefined;
  nextServerId: string;
}): boolean {
  const {
    currentServerInfo,
    nextHostname,
    nextVersion,
    nextPlatform,
    nextTerminalShells,
    nextDesktopManaged,
    nextCapabilities,
    nextFeatures,
  } = input;
  const prevHostname = currentServerInfo?.hostname?.trim() || null;
  const prevVersion = currentServerInfo?.version?.trim() || null;
  return (
    currentServerInfo?.serverId === input.nextServerId &&
    prevHostname === nextHostname &&
    prevVersion === nextVersion &&
    currentServerInfo?.platform === nextPlatform &&
    areTerminalShellsEqual(currentServerInfo?.terminalShells, nextTerminalShells) &&
    currentServerInfo?.desktopManaged === nextDesktopManaged &&
    areServerCapabilitiesEqual(currentServerInfo?.capabilities, nextCapabilities) &&
    areServerInfoFeaturesEqual(currentServerInfo?.features, nextFeatures)
  );
}

export const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set, get) => {
    const commitActivityUpdates: AgentLastActivityCommitter = (updates) => {
      set((prev) => {
        let nextActivity: Map<string, Date> | null = null;
        for (const [agentId, timestamp] of updates.entries()) {
          const current = prev.agentLastActivity.get(agentId);
          if (current && current.getTime() >= timestamp.getTime()) {
            continue;
          }
          if (!nextActivity) {
            nextActivity = new Map(prev.agentLastActivity);
          }
          nextActivity.set(agentId, timestamp);
        }
        if (!nextActivity) {
          return prev;
        }
        return {
          ...prev,
          agentLastActivity: nextActivity,
        };
      });
    };
    agentLastActivityCoalescer.setCommitter(commitActivityUpdates);

    return {
      sessions: {},
      agentLastActivity: new Map(),

      // Session management
      initializeSession: (serverId, client, clientGeneration) => {
        set((prev) => {
          if (prev.sessions[serverId]) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: createInitialSessionState(serverId, client, clientGeneration),
            },
          };
        });
      },

      restoreSessionReplica: (serverId, replica) => {
        set((prev) => {
          if (prev.sessions[serverId]) {
            return prev;
          }
          const session = createInitialSessionState(serverId, null);
          const timeline = replica.timeline;
          const agentStreamTail = new Map<string, StreamItem[]>();
          if (timeline) {
            agentStreamTail.set(timeline.agentId, timeline.items);
          }
          const agentLastActivity = new Map(prev.agentLastActivity);
          for (const agent of replica.agents.values()) {
            agentLastActivity.set(agent.id, agent.lastActivityAt);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agents: replica.agents,
                workspaceAgentActivity: buildWorkspaceAgentActivityIndex(replica.agents),
                workspaces: replica.workspaces,
                projects: replica.projects,
                agentStreamTail,
              },
            },
            agentLastActivity,
          };
        });
      },

      clearSession: (serverId) => {
        agentLastActivityCoalescer.flushNow();
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextSessions = { ...prev.sessions };
          delete nextSessions[serverId];
          let nextActivity = prev.agentLastActivity;
          if (session.agents.size > 0 || session.agentDetails.size > 0) {
            const candidate = new Map(prev.agentLastActivity);
            let changed = false;
            for (const agentId of new Set([
              ...session.agents.keys(),
              ...session.agentDetails.keys(),
            ])) {
              if (candidate.delete(agentId)) {
                changed = true;
              }
              agentLastActivityCoalescer.deletePending(agentId);
            }
            if (changed) {
              nextActivity = candidate;
            }
          }
          return {
            ...prev,
            sessions: nextSessions,
            agentLastActivity: nextActivity,
          };
        });
      },

      updateSessionClient: (serverId, client, clientGeneration = 0) => {
        set((prev) => {
          const session = prev.sessions[serverId];

          if (!session) {
            return prev;
          }

          if (session.client === client && session.clientGeneration === clientGeneration) {
            return prev;
          }

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                client,
                clientGeneration,
              },
            },
          };
        });
      },

      setViewedTimelineSync: (serverId, viewedTimelineSync) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.viewedTimelineSync === viewedTimelineSync) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, viewedTimelineSync },
            },
          };
        });
      },

      updateSessionServerInfo: (serverId, info) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }

          const nextHostname = info.hostname?.trim() || null;
          const nextVersion = info.version?.trim() || null;
          const nextPlatform = info.platform;
          const nextTerminalShells = info.terminalShells;
          const nextDesktopManaged = info.desktopManaged;
          const nextCapabilities = info.capabilities;
          const nextFeatures = info.features;

          if (
            isSessionServerInfoUnchanged({
              currentServerInfo: session.serverInfo,
              nextHostname,
              nextVersion,
              nextPlatform,
              nextTerminalShells,
              nextDesktopManaged,
              nextCapabilities,
              nextFeatures,
              nextServerId: info.serverId,
            })
          ) {
            return prev;
          }

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                serverInfo: {
                  serverId: info.serverId,
                  hostname: nextHostname,
                  version: nextVersion,
                  ...(nextPlatform ? { platform: nextPlatform } : {}),
                  ...(nextTerminalShells ? { terminalShells: nextTerminalShells } : {}),
                  ...(nextDesktopManaged !== undefined
                    ? { desktopManaged: nextDesktopManaged }
                    : {}),
                  ...(nextCapabilities ? { capabilities: nextCapabilities } : {}),
                  ...(nextFeatures ? { features: nextFeatures } : {}),
                },
              },
            },
          };
        });
      },

      getSession: (serverId) => {
        return get().sessions[serverId];
      },

      // Audio state
      setIsPlayingAudio: (serverId, playing) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.isPlayingAudio === playing) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, isPlayingAudio: playing },
            },
          };
        });
      },

      // Focus
      setFocusedAgentId: (serverId, agentId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.focusedAgentId === agentId) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                focusedAgentId: agentId,
              },
            },
          };
        });
      },

      setFocusedTerminalId: (serverId, terminalId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.focusedTerminalId === terminalId) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                focusedTerminalId: terminalId,
              },
            },
          };
        });
      },

      // Messages
      setMessages: (serverId, messages) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextMessages =
            typeof messages === "function" ? messages(session.messages) : messages;
          if (session.messages === nextMessages) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, messages: nextMessages },
            },
          };
        });
      },

      setCurrentAssistantMessage: (serverId, message) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextMessage =
            typeof message === "function" ? message(session.currentAssistantMessage) : message;
          if (session.currentAssistantMessage === nextMessage) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, currentAssistantMessage: nextMessage },
            },
          };
        });
      },

      // Stream state (head/tail model)
      setAgentStreamTail: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState = typeof state === "function" ? state(session.agentStreamTail) : state;
          if (session.agentStreamTail === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentStreamTail: nextState },
            },
          };
        });
      },

      setAgentStreamHead: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState = typeof state === "function" ? state(session.agentStreamHead) : state;
          if (session.agentStreamHead === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentStreamHead: nextState },
            },
          };
        });
      },

      setAgentStreamState: (serverId, agentId, state) => {
        // The cap can only be crossed when a *new* agent starts holding
        // buffers, so the sweep runs there rather than on every stream flush
        // (~1400 per session in a 2-minute soak - a per-event sweep would cost
        // more than the retention it reclaims).
        let addedAgent = false;
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          addedAgent =
            !session.agentStreamTail.has(agentId) && !session.agentStreamHead.has(agentId);

          let nextTail = session.agentStreamTail;
          let nextHead = session.agentStreamHead;
          let changedTail = false;
          let changedHead = false;

          if (state.tail !== undefined) {
            const existingTail = session.agentStreamTail.get(agentId);
            if (existingTail !== state.tail) {
              nextTail = new Map(session.agentStreamTail);
              nextTail.set(agentId, state.tail);
              changedTail = true;
            }
          }

          if (state.head !== undefined) {
            const existingHead = session.agentStreamHead.get(agentId);
            const shouldDeleteHead = state.head.length === 0;
            if (shouldDeleteHead) {
              if (session.agentStreamHead.has(agentId)) {
                nextHead = new Map(session.agentStreamHead);
                nextHead.delete(agentId);
                changedHead = true;
              }
            } else if (existingHead !== state.head) {
              nextHead = new Map(session.agentStreamHead);
              nextHead.set(agentId, state.head);
              changedHead = true;
            }
          }

          const currentSubmissions = session.messageSubmissions.get(agentId) ?? [];
          const observedSubmissions = observeMessageSubmissionCanonical(
            currentSubmissions,
            state.acknowledgedClientMessageIds ?? [],
          );
          const changedSubmissions = observedSubmissions !== currentSubmissions;
          const agentTasks = updateAgentTasks(session.agentTasks, agentId, state.taskSnapshot);
          const changedTasks = agentTasks !== session.agentTasks;

          if (!changedTail && !changedHead && !changedSubmissions && !changedTasks) {
            return prev;
          }

          // Recency for the retention cap. Written on the same chokepoint the
          // buffers grow through, so it can never drift from what is buffered.
          let nextTouchSeq = session.agentStreamTouchSeq;
          if (changedTail || changedHead) {
            agentStreamTouchTick += 1;
            nextTouchSeq = new Map(session.agentStreamTouchSeq);
            nextTouchSeq.set(agentId, agentStreamTouchTick);
          }
          let messageSubmissions = session.messageSubmissions;
          if (changedSubmissions) {
            messageSubmissions = new Map(session.messageSubmissions);
            if (observedSubmissions.length > 0) {
              messageSubmissions.set(agentId, observedSubmissions);
            } else {
              messageSubmissions.delete(agentId);
            }
          }

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail: nextTail,
                agentStreamHead: nextHead,
                agentStreamTouchSeq: nextTouchSeq,
                messageSubmissions,
                agentTasks,
              },
            },
          };
        });
        if (addedAgent) {
          get().sweepAgentStreams(serverId);
        }
      },

      applyAgentTurnLiveness: (serverId, agentId, transition) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          const agentTurnLiveness = applyTurnLivenessTransition(
            session.agentTurnLiveness,
            agentId,
            transition,
          );
          if (agentTurnLiveness === session.agentTurnLiveness) return prev;
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTurnLiveness },
            },
          };
        });
      },

      beginAgentCancellation: (serverId, agentId) => {
        nextCancellationRequestId += 1;
        const requestId = nextCancellationRequestId;
        get().applyAgentTurnLiveness(serverId, agentId, {
          type: "cancellation_started",
          requestId,
        });
        return requestId;
      },

      settleAgentCancellation: (serverId, agentId, requestId) => {
        get().applyAgentTurnLiveness(serverId, agentId, {
          type: "cancellation_settled",
          requestId,
        });
      },

      clearAgentTurnLiveness: (serverId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.agentTurnLiveness.size === 0) return prev;
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTurnLiveness: new Map() },
            },
          };
        });
      },

      beginAgentMessageSubmission: (serverId, agentId, message) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          if (!message.clientMessageId) {
            throw new Error("Beginning a message submission requires client identity");
          }
          const currentTail = session.agentStreamTail.get(agentId) ?? [];
          const currentHead = session.agentStreamHead.get(agentId) ?? [];
          const stream = appendSubmittedUserMessage({
            tail: currentTail,
            head: currentHead,
            message,
          });
          const submissions = beginMessageSubmission(
            session.messageSubmissions.get(agentId) ?? [],
            { clientMessageId: message.clientMessageId },
          );
          const messageSubmissions = new Map(session.messageSubmissions);
          messageSubmissions.set(agentId, submissions);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail:
                  stream.tail === currentTail
                    ? session.agentStreamTail
                    : new Map(session.agentStreamTail).set(agentId, stream.tail),
                agentStreamHead:
                  stream.head === currentHead
                    ? session.agentStreamHead
                    : new Map(session.agentStreamHead).set(agentId, stream.head),
                messageSubmissions,
              },
            },
          };
        });
      },

      acceptAgentMessageSubmission: (serverId, agentId, clientMessageId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          const currentSubmissions = session.messageSubmissions.get(agentId) ?? [];
          const submissions = acceptMessageSubmission(currentSubmissions, clientMessageId);
          if (submissions === currentSubmissions) return prev;
          const messageSubmissions = new Map(session.messageSubmissions);
          if (submissions.length > 0) messageSubmissions.set(agentId, submissions);
          else messageSubmissions.delete(agentId);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, messageSubmissions },
            },
          };
        });
      },

      rejectAgentMessageSubmission: (serverId, agentId, clientMessageId) => {
        let outcome: MessageSubmissionRejectionOutcome = "unknown";
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          const currentTail = session.agentStreamTail.get(agentId) ?? [];
          const currentHead = session.agentStreamHead.get(agentId) ?? [];
          const currentSubmissions = session.messageSubmissions.get(agentId) ?? [];
          const result = rejectMessageSubmission(currentSubmissions, clientMessageId);
          outcome = result.outcome;
          if (outcome === "unknown") return prev;
          const stream =
            outcome === "rejected"
              ? removeSubmittedUserMessage({
                  tail: currentTail,
                  head: currentHead,
                  clientMessageId,
                })
              : { tail: currentTail, head: currentHead };
          const messageSubmissions = new Map(session.messageSubmissions);
          if (result.submissions.length > 0) {
            messageSubmissions.set(agentId, result.submissions);
          } else {
            messageSubmissions.delete(agentId);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail:
                  stream.tail === currentTail
                    ? session.agentStreamTail
                    : new Map(session.agentStreamTail).set(agentId, stream.tail),
                agentStreamHead:
                  stream.head === currentHead
                    ? session.agentStreamHead
                    : new Map(session.agentStreamHead).set(agentId, stream.head),
                messageSubmissions,
              },
            },
          };
        });
        return outcome;
      },

      retainAgentStream: (serverId, agentId) => {
        let released = false;
        const adjust = (delta: number) => {
          set((prev) => {
            const session = prev.sessions[serverId];
            if (!session) {
              return prev;
            }
            const current = session.agentStreamRetainers.get(agentId) ?? 0;
            const next = current + delta;
            const nextRetainers = new Map(session.agentStreamRetainers);
            if (next > 0) {
              nextRetainers.set(agentId, next);
            } else {
              nextRetainers.delete(agentId);
            }
            return {
              ...prev,
              sessions: {
                ...prev.sessions,
                [serverId]: { ...session, agentStreamRetainers: nextRetainers },
              },
            };
          });
        };

        adjust(1);
        return () => {
          // Guard the release rather than the retain: React can re-run an
          // effect cleanup path in StrictMode, and a double decrement would
          // release buffers a still-mounted sibling pane is rendering.
          if (released) {
            return;
          }
          released = true;
          adjust(-1);
          // Closing the last pane on a chat that is no longer a live agent -
          // archived, deleted, or removed while it was open - is the "release
          // on chat close" half of the rule. Membership in `agents` is only
          // consulted here, at unmount, where nothing can be rendering it: the
          // planner still filters by retainers, so a copy open elsewhere is
          // safe. A live chat stays cached, so re-opening it is instant.
          const isLiveAgent = Boolean(get().sessions[serverId]?.agents.has(agentId));
          get().sweepAgentStreams(serverId, isLiveAgent ? undefined : [agentId]);
        };
      },

      releaseAgentStreams: (serverId, agentIds) => {
        if (agentIds.length === 0) {
          return;
        }
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }

          const nextTail = new Map(session.agentStreamTail);
          const nextHead = new Map(session.agentStreamHead);
          const nextCursor = new Map(session.agentTimelineCursor);
          const nextHasOlder = new Map(session.agentTimelineHasOlder);
          const nextHasNewer = new Map(session.agentTimelineHasNewer);
          const nextOlderInFlight = new Map(session.agentTimelineOlderFetchInFlight);
          const nextApplied = new Map(session.agentAuthoritativeHistoryApplied);
          const nextTouchSeq = new Map(session.agentStreamTouchSeq);
          // Everything below is per-agent bookkeeping with no owner once the
          // chat's buffers are gone. Left behind it accumulates one entry per
          // agent for the app's lifetime, which on an orchestrator workload is
          // one entry per sub-agent ever spawned.
          const nextSyncGeneration = new Map(session.agentHistorySyncGeneration);
          const nextPromptSuggestions = new Map(session.agentPromptSuggestions);
          const nextRateLimits = new Map(session.agentRateLimits);
          const nextDismissedRateLimits = new Map(session.dismissedRateLimits);
          const nextSentPromptHistory = new Map(session.sentPromptHistory);
          const nextQueuedMessages = new Map(session.queuedMessages);
          const nextTurnLiveness = new Map(session.agentTurnLiveness);
          const nextMessageSubmissions = new Map(session.messageSubmissions);
          const nextAgentTasks = new Map(session.agentTasks);

          let changed = false;
          for (const agentId of agentIds) {
            // The cursor and the applied flag are dropped with the buffers on
            // purpose: leaving them would tell planInitialAgentTimelineSync the
            // client is caught up, so the next open would issue an `after`
            // catch-up that returns nothing onto an empty tail - a blank chat.
            // Clearing them makes the next open plan a full `tail` fetch, and
            // dropping the sync generation with them keeps that family whole.
            changed =
              [
                nextTail.delete(agentId),
                nextHead.delete(agentId),
                nextCursor.delete(agentId),
                nextHasOlder.delete(agentId),
                nextHasNewer.delete(agentId),
                nextOlderInFlight.delete(agentId),
                nextApplied.delete(agentId),
                nextTouchSeq.delete(agentId),
                nextSyncGeneration.delete(agentId),
                nextPromptSuggestions.delete(agentId),
                nextRateLimits.delete(agentId),
                nextDismissedRateLimits.delete(agentId),
                nextSentPromptHistory.delete(agentId),
                nextQueuedMessages.delete(agentId),
                nextTurnLiveness.delete(agentId),
                nextMessageSubmissions.delete(agentId),
                nextAgentTasks.delete(agentId),
              ].some(Boolean) || changed;
          }
          if (!changed) {
            return prev;
          }

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail: nextTail,
                agentStreamHead: nextHead,
                agentTimelineCursor: nextCursor,
                agentTimelineHasOlder: nextHasOlder,
                agentTimelineHasNewer: nextHasNewer,
                agentTimelineOlderFetchInFlight: nextOlderInFlight,
                agentAuthoritativeHistoryApplied: nextApplied,
                agentStreamTouchSeq: nextTouchSeq,
                agentHistorySyncGeneration: nextSyncGeneration,
                agentPromptSuggestions: nextPromptSuggestions,
                agentRateLimits: nextRateLimits,
                dismissedRateLimits: nextDismissedRateLimits,
                sentPromptHistory: nextSentPromptHistory,
                queuedMessages: nextQueuedMessages,
                agentTurnLiveness: nextTurnLiveness,
                messageSubmissions: nextMessageSubmissions,
                agentTasks: nextAgentTasks,
              },
            },
          };
        });
      },

      sweepAgentStreams: (serverId, departedAgentIds) => {
        const session = get().sessions[serverId];
        if (!session) {
          return;
        }
        const bufferedAgentIds = [
          ...new Set([...session.agentStreamTail.keys(), ...session.agentStreamHead.keys()]),
        ];
        const evicted = planAgentStreamEviction({
          bufferedAgentIds,
          displayedAgentIds: new Set(session.agentStreamRetainers.keys()),
          // Departure is asserted by the caller that saw the event, never
          // inferred from store membership: an agent absent from `agents` may
          // still be a perfectly renderable chat opened by id into
          // `agentDetails`, and guessing wrong here blanks it.
          ...(departedAgentIds ? { departedAgentIds: new Set(departedAgentIds) } : {}),
          lastActivityAtByAgentId: session.agentStreamTouchSeq,
        });
        if (evicted.length === 0) {
          return;
        }
        get().releaseAgentStreams(serverId, evicted);
      },

      releaseClosedChat: (serverId, agentId) => {
        // A chat that is still in the active directory keeps its snapshot: the
        // directory owns that entry, not the tab. Only the by-id projection an
        // archived or deleted chat was opened with is the tab's to release -
        // and it is the one nothing else ever removes, so browsing History
        // accumulates one full Agent per chat visited.
        if (get().sessions[serverId]?.agents.has(agentId)) {
          return;
        }
        get().setAgentDetails(serverId, (current) => {
          if (!current.has(agentId)) {
            return current;
          }
          const next = new Map(current);
          next.delete(agentId);
          return next;
        });
        // Same owner, same lifetime: the tally only exists to keep this chat's
        // header total honest, and its id set otherwise grows one entry per
        // sub-agent ever cleared, for the life of the app.
        useClearedSubagentTokensStore.getState().resetForParent({
          serverId,
          parentAgentId: agentId,
        });
      },

      handoffCreatedAgentUserMessage: (serverId, agentId, message) => {
        let didHandoff = false;
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }

          const currentTail = session.agentStreamTail.get(agentId) ?? [];
          const currentHead = session.agentStreamHead.get(agentId) ?? [];
          const result = handoffCreatedAgentUserMessageToStream({
            tail: currentTail,
            head: currentHead,
            message,
          });
          if (!result.changedTail && !result.changedHead) {
            return prev;
          }

          const nextTail = result.changedTail
            ? new Map(session.agentStreamTail).set(agentId, result.tail)
            : session.agentStreamTail;
          const nextHead = result.changedHead
            ? new Map(session.agentStreamHead).set(agentId, result.head)
            : session.agentStreamHead;
          didHandoff = true;

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail: nextTail,
                agentStreamHead: nextHead,
              },
            },
          };
        });
        return didHandoff;
      },

      clearAgentStreamHead: (serverId, agentId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          if (!session.agentStreamHead.has(agentId)) {
            return prev;
          }
          const nextHead = new Map(session.agentStreamHead);
          nextHead.delete(agentId);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentStreamHead: nextHead },
            },
          };
        });
      },

      setAgentTimelineCursor: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState =
            typeof state === "function" ? state(session.agentTimelineCursor) : state;
          if (session.agentTimelineCursor === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTimelineCursor: nextState },
            },
          };
        });
      },

      setAgentTimelineHasOlder: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState =
            typeof state === "function" ? state(session.agentTimelineHasOlder) : state;
          if (session.agentTimelineHasOlder === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTimelineHasOlder: nextState },
            },
          };
        });
      },

      setAgentTimelineHasNewer: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          const nextState =
            typeof state === "function" ? state(session.agentTimelineHasNewer) : state;
          if (session.agentTimelineHasNewer === nextState) return prev;
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTimelineHasNewer: nextState },
            },
          };
        });
      },

      setAgentTimelineOlderFetchInFlight: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState =
            typeof state === "function" ? state(session.agentTimelineOlderFetchInFlight) : state;
          if (session.agentTimelineOlderFetchInFlight === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentTimelineOlderFetchInFlight: nextState },
            },
          };
        });
      },

      bumpHistorySyncGeneration: (serverId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextGeneration = session.historySyncGeneration + 1;
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                historySyncGeneration: nextGeneration,
              },
            },
          };
        });
      },

      markAgentHistorySynchronized: (serverId, agentId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const currentGeneration = session.historySyncGeneration;
          const previousGeneration = session.agentHistorySyncGeneration.get(agentId);
          if (previousGeneration === currentGeneration) {
            return prev;
          }
          const nextMap = new Map(session.agentHistorySyncGeneration);
          nextMap.set(agentId, currentGeneration);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentHistorySyncGeneration: nextMap,
              },
            },
          };
        });
      },

      setAgentAuthoritativeHistoryApplied: (serverId, agentId, applied) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }

          const previousApplied = session.agentAuthoritativeHistoryApplied.get(agentId) ?? false;
          if (previousApplied === applied) {
            return prev;
          }

          const nextApplied = new Map(session.agentAuthoritativeHistoryApplied);
          if (applied) {
            nextApplied.set(agentId, true);
          } else {
            nextApplied.delete(agentId);
          }

          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentAuthoritativeHistoryApplied: nextApplied,
              },
            },
          };
        });
      },

      applyAgentTimelineResponseState: (serverId, agentId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) return prev;
          const nextTail = new Map(session.agentStreamTail).set(agentId, state.items);
          const nextHead = new Map(session.agentStreamHead);
          if (state.head.length > 0) nextHead.set(agentId, state.head);
          else nextHead.delete(agentId);
          const nextCursor = new Map(session.agentTimelineCursor);
          if (state.range) nextCursor.set(agentId, state.range);
          else nextCursor.delete(agentId);
          const nextHasOlder = new Map(session.agentTimelineHasOlder);
          if (state.older !== "unchanged") {
            nextHasOlder.set(agentId, state.older === "available");
          }
          const nextHasNewer = new Map(session.agentTimelineHasNewer).set(agentId, state.newer);
          const nextAuthoritative = new Map(session.agentAuthoritativeHistoryApplied);
          const nextSyncGeneration = new Map(session.agentHistorySyncGeneration);
          if (state.synchronized) {
            nextAuthoritative.set(agentId, true);
            nextSyncGeneration.set(agentId, session.historySyncGeneration);
          }
          const currentSubmissions = session.messageSubmissions.get(agentId) ?? [];
          const observedSubmissions = observeMessageSubmissionCanonical(
            currentSubmissions,
            state.acknowledgedClientMessageIds,
          );
          let messageSubmissions = session.messageSubmissions;
          if (observedSubmissions !== currentSubmissions) {
            messageSubmissions = new Map(session.messageSubmissions);
            if (observedSubmissions.length > 0) {
              messageSubmissions.set(agentId, observedSubmissions);
            } else {
              messageSubmissions.delete(agentId);
            }
          }
          const tasks = latestTasksFromStream([...state.items, ...state.head]);
          const agentTasks = new Map(session.agentTasks);
          if (tasks.length > 0) agentTasks.set(agentId, tasks);
          else agentTasks.delete(agentId);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agentStreamTail: nextTail,
                agentStreamHead: nextHead,
                agentTasks,
                agentTimelineCursor: nextCursor,
                agentTimelineHasOlder: nextHasOlder,
                agentTimelineHasNewer: nextHasNewer,
                agentAuthoritativeHistoryApplied: nextAuthoritative,
                agentHistorySyncGeneration: nextSyncGeneration,
                messageSubmissions,
              },
            },
          };
        });
      },

      // Initializing agents
      setInitializingAgents: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState = typeof state === "function" ? state(session.initializingAgents) : state;
          if (session.initializingAgents === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, initializingAgents: nextState },
            },
          };
        });
      },

      // Agents
      setAgents: (serverId, agents) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextAgents = typeof agents === "function" ? agents(session.agents) : agents;
          if (session.agents === nextAgents) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                agents: nextAgents,
                workspaceAgentActivity: buildWorkspaceAgentActivityIndex(
                  nextAgents,
                  session.workspaceAgentActivity,
                ),
              },
            },
          };
        });
      },

      setBackgroundShellTasksForParent: (serverId, parentAgentId, tasks) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const next = new Map(session.backgroundShellTasks);
          for (const [id, task] of next) {
            if (task.parentAgentId === parentAgentId) {
              next.delete(id);
            }
          }
          for (const task of tasks) {
            next.set(task.id, task);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, backgroundShellTasks: next },
            },
          };
        });
      },

      setSuggestedTasksForParent: (serverId, parentAgentId, tasks) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const next = new Map(session.suggestedTasks);
          for (const [id, task] of next) {
            if (task.parentAgentId === parentAgentId) {
              next.delete(id);
            }
          }
          for (const task of tasks) {
            next.set(task.taskId, task);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, suggestedTasks: next },
            },
          };
        });
      },

      setAgentDetails: (serverId, agents) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextAgents = typeof agents === "function" ? agents(session.agentDetails) : agents;
          if (session.agentDetails === nextAgents) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentDetails: nextAgents },
            },
          };
        });
      },

      setWorkspaces: (serverId, workspaces) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextWorkspaces =
            typeof workspaces === "function" ? workspaces(session.workspaces) : workspaces;
          const preservedWorkspaces = preserveWorkspaceMapIdentity(
            session.workspaces,
            nextWorkspaces,
          );
          if (session.workspaces === preservedWorkspaces) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, workspaces: preservedWorkspaces },
            },
          };
        });
      },

      setProjects: (serverId, projects) => {
        const next = new Map<string, ProjectDescriptor>();
        for (const project of projects) next.set(project.projectId, project);
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || projectMapsEqual(session.projects, next)) return prev;
          return {
            ...prev,
            sessions: { ...prev.sessions, [serverId]: { ...session, projects: next } },
          };
        });
      },

      upsertProject: (serverId, project) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || equal(session.projects.get(project.projectId), project)) return prev;
          const projects = new Map(session.projects);
          projects.set(project.projectId, project);
          return {
            ...prev,
            sessions: { ...prev.sessions, [serverId]: { ...session, projects } },
          };
        });
      },

      removeProject: (serverId, projectId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session?.projects.has(projectId)) return prev;
          const projects = new Map(session.projects);
          projects.delete(projectId);
          return {
            ...prev,
            sessions: { ...prev.sessions, [serverId]: { ...session, projects } },
          };
        });
      },

      setWorkspaceRestoreStatus: (serverId, workspaceId, status) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          if (session.restoringWorkspaces.get(workspaceId) === status) {
            return prev;
          }
          // A late dir-gone timeout must not override a successful restore:
          // only mark failed while still restoring and the descriptor is absent.
          if (
            status === "failed" &&
            (session.restoringWorkspaces.get(workspaceId) !== "restoring" ||
              session.workspaces.has(workspaceId))
          ) {
            return prev;
          }
          const next = new Map(session.restoringWorkspaces);
          next.set(workspaceId, status);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, restoringWorkspaces: next },
            },
          };
        });
      },

      clearWorkspaceRestoreStatus: (serverId, workspaceId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || !session.restoringWorkspaces.has(workspaceId)) {
            return prev;
          }
          const next = new Map(session.restoringWorkspaces);
          next.delete(workspaceId);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, restoringWorkspaces: next },
            },
          };
        });
      },

      mergeWorkspaces: (serverId, workspaces) => {
        const nextEntries = Array.from(workspaces);
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || nextEntries.length === 0) {
            return prev;
          }
          const next = new Map(session.workspaces);
          let changed = false;
          // A descriptor arriving is the success signal for a pending restore:
          // clear it at the source so every entry point converges to "ready".
          let nextRestoring: Map<string, WorkspaceRestoreStatus> | null = null;
          for (const workspace of nextEntries) {
            if (session.restoringWorkspaces.has(workspace.id)) {
              nextRestoring ??= new Map(session.restoringWorkspaces);
              nextRestoring.delete(workspace.id);
              changed = true;
            }
            const existing = next.get(workspace.id);
            const nextWorkspace = preserveWorkspaceDescriptorIdentity(workspace, existing);
            if (existing === nextWorkspace) {
              continue;
            }
            next.set(workspace.id, nextWorkspace);
            changed = true;
          }
          if (!changed) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: {
                ...session,
                workspaces: next,
                restoringWorkspaces: nextRestoring ?? session.restoringWorkspaces,
              },
            },
          };
        });
      },

      removeWorkspace: (serverId, workspaceId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          const workspaceKey = resolveWorkspaceMapKeyByIdentity({
            workspaces: session?.workspaces,
            workspaceId,
          });
          if (!session || !workspaceKey) {
            return prev;
          }
          const removed = session.workspaces.get(workspaceKey);
          const next = new Map(session.workspaces);
          next.delete(workspaceKey);
          // The explorer caches one ExplorerDirectory per directory ever listed
          // and nothing else ever drops them, so the listings outlive the
          // workspace they describe. A pane keys them by whichever handle it
          // had (opaque id, path id, or bare root), so clear every spelling.
          let fileExplorer = session.fileExplorer;
          for (const key of [
            buildWorkspaceExplorerStateKey({ workspaceId: workspaceKey }),
            buildWorkspaceExplorerStateKey({ workspaceId }),
            buildWorkspaceExplorerStateKey({ workspaceRoot: removed?.workspaceDirectory }),
          ]) {
            if (!key || !fileExplorer.has(key)) {
              continue;
            }
            if (fileExplorer === session.fileExplorer) {
              fileExplorer = new Map(fileExplorer);
            }
            fileExplorer.delete(key);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, workspaces: next, fileExplorer },
            },
          };
        });
      },

      // Agent activity timestamps (top-level, does NOT mutate session object)
      setAgentLastActivity: (agentId, timestamp) => {
        agentLastActivityCoalescer.enqueue(agentId, timestamp);
      },

      setAgentLastActivityBatch: (updates) => {
        set((prev) => {
          const nextActivity =
            typeof updates === "function" ? updates(prev.agentLastActivity) : updates;
          if (nextActivity === prev.agentLastActivity) {
            return prev;
          }
          if (nextActivity.size === 0) {
            if (prev.agentLastActivity.size === 0) {
              return prev;
            }
            return {
              ...prev,
              agentLastActivity: new Map(),
            };
          }
          let changed = false;
          for (const [agentId, timestamp] of nextActivity.entries()) {
            const currentTimestamp = prev.agentLastActivity.get(agentId);
            if (!currentTimestamp || currentTimestamp.getTime() !== timestamp.getTime()) {
              changed = true;
              break;
            }
          }
          if (!changed && nextActivity.size === prev.agentLastActivity.size) {
            return prev;
          }
          return {
            ...prev,
            agentLastActivity: new Map(nextActivity),
          };
        });
      },

      flushAgentLastActivity: () => {
        agentLastActivityCoalescer.flushNow();
      },

      // Permissions
      setPendingPermissions: (serverId, perms) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextPerms = typeof perms === "function" ? perms(session.pendingPermissions) : perms;
          if (session.pendingPermissions === nextPerms) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, pendingPermissions: nextPerms },
            },
          };
        });
      },

      // File explorer
      setFileExplorer: (serverId, state) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextState = typeof state === "function" ? state(session.fileExplorer) : state;
          if (session.fileExplorer === nextState) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, fileExplorer: nextState },
            },
          };
        });
      },

      // Queued messages
      setQueuedMessages: (serverId, value) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const nextValue = typeof value === "function" ? value(session.queuedMessages) : value;
          if (session.queuedMessages === nextValue) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, queuedMessages: nextValue },
            },
          };
        });
      },

      // AI prompt suggestions (ghost text)
      setAgentPromptSuggestion: (serverId, agentId, suggestion) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const current = session.agentPromptSuggestions.get(agentId) ?? null;
          const trimmed = suggestion?.trim() ? suggestion.trim() : null;
          if (current === trimmed) {
            return prev;
          }
          const next = new Map(session.agentPromptSuggestions);
          if (trimmed === null) {
            next.delete(agentId);
          } else {
            next.set(agentId, trimmed);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentPromptSuggestions: next },
            },
          };
        });
      },

      // Plan rate-limit status
      setAgentRateLimit: (serverId, agentId, info) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const current = session.agentRateLimits.get(agentId) ?? null;
          if (JSON.stringify(current) === JSON.stringify(info)) {
            return prev;
          }
          const next = new Map(session.agentRateLimits);
          if (info === null) {
            next.delete(agentId);
          } else {
            next.set(agentId, info);
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, agentRateLimits: next },
            },
          };
        });
      },

      dismissAgentRateLimit: (serverId, agentId) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const current = session.agentRateLimits.get(agentId);
          if (!current) {
            return prev;
          }
          const next = new Map(session.dismissedRateLimits);
          next.set(agentId, {
            key: rateLimitDismissKey(current),
            mutedUntil: Date.now() + RATE_LIMIT_MUTE_MS,
          });
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, dismissedRateLimits: next },
            },
          };
        });
      },

      // Sent-message history stack
      appendSentPrompt: (serverId, agentId, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return;
        }
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session) {
            return prev;
          }
          const existing = session.sentPromptHistory.get(agentId) ?? [];
          // Skip an immediate duplicate of the newest entry (resending unchanged).
          if (existing.length > 0 && existing[existing.length - 1] === trimmed) {
            return prev;
          }
          const appended = [...existing, trimmed];
          const capped =
            appended.length > SENT_PROMPT_HISTORY_LIMIT
              ? appended.slice(appended.length - SENT_PROMPT_HISTORY_LIMIT)
              : appended;
          const next = new Map(session.sentPromptHistory);
          next.set(agentId, capped);
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, sentPromptHistory: next },
            },
          };
        });
      },

      // Hydration
      setHasHydratedAgents: (serverId, hydrated) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.hasHydratedAgents === hydrated) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, hasHydratedAgents: hydrated },
            },
          };
        });
      },

      setHasHydratedWorkspaces: (serverId, hydrated) => {
        set((prev) => {
          const session = prev.sessions[serverId];
          if (!session || session.hasHydratedWorkspaces === hydrated) {
            return prev;
          }
          return {
            ...prev,
            sessions: {
              ...prev.sessions,
              [serverId]: { ...session, hasHydratedWorkspaces: hydrated },
            },
          };
        });
      },

      // Agent directory - derived from agents (computed on-demand)
      getAgentDirectory: (serverId) => {
        const state = get();
        const session = state.sessions[serverId];
        if (!session) {
          return undefined;
        }

        const entries: AgentDirectoryEntry[] = [];
        for (const agent of session.agents.values()) {
          // Get lastActivityAt from top-level slice, fallback to agent.lastActivityAt
          const lastActivityAt = state.agentLastActivity.get(agent.id) ?? agent.lastActivityAt;
          entries.push({
            id: agent.id,
            serverId,
            title: agent.title ?? null,
            status: agent.status,
            lastActivityAt,
            cwd: agent.cwd,
            provider: agent.provider,
            pendingPermissionCount: agent.pendingPermissions.length,
            requiresAttention: agent.requiresAttention ?? false,
            attentionReason: agent.attentionReason ?? null,
            attentionTimestamp: agent.attentionTimestamp ?? null,
            createdAt: agent.createdAt,
            labels: agent.labels,
            archiveBytes: agent.archiveBytes,
          });
        }
        return entries;
      },
    };
  }),
);

export function useWorkspaceRestoreStatus(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceRestoreStatus | null {
  return useSessionStore((state) =>
    serverId && workspaceId
      ? (state.sessions[serverId]?.restoringWorkspaces.get(workspaceId) ?? null)
      : null,
  );
}
