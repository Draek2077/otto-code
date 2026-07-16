// Pure Otto -> SimulationEvent mapping. No I/O, no store/client access — the
// stateful side (name registry, backfill fetch, live-stream cursor dedup)
// lives in use-visualizer-event-adapter.ts, which calls into these functions.
// See docs/visualizer.md for the mapping table this file implements.
import type { AgentLifecycleStatus } from "@otto-code/protocol/agent-lifecycle";
import { deriveObservedSubagentTitle } from "@otto-code/protocol/observed-subagent-title";
import type {
  AgentTimelineItem,
  AgentUsage,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "@otto-code/protocol/agent-types";
import type { AgentStreamEventPayload } from "@otto-code/protocol/messages";
import type { SimulationEvent } from "@/visualizer/visualizer-view-types";

export type VisualizerRuntime =
  | "claude"
  | "codex"
  | "copilot"
  | "opencode"
  | "pi"
  | "openai-compat";

/** `runtime` only picks the node logo; unmapped providers (e.g. a
 * user-defined custom openai-compatible provider with an arbitrary id) omit
 * the field so the page falls back to its default (claude) logo — matching
 * vendor/agent-flow/OTTO-PATCHES.md's "generic diamond mark" patch, which
 * only fires for these known literals. "omp" is Otto's builtin id for the
 * bundled openai-compatible provider (Oh My Pi) — see
 * packages/protocol/src/provider-manifest.ts. */
export function resolveVisualizerRuntime(provider: string): VisualizerRuntime | undefined {
  if (provider === "claude") {
    return "claude";
  }
  if (provider.startsWith("codex")) {
    return "codex";
  }
  if (provider === "copilot" || provider === "opencode" || provider === "pi") {
    return provider;
  }
  if (provider === "omp") {
    return "openai-compat";
  }
  return undefined;
}

const MAX_SUMMARY_LENGTH = 200;

function truncate(text: string, max: number = MAX_SUMMARY_LENGTH): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Session tab labels render in a cramped horizontal strip at the page's
 * top-left (vendor session-tabs.tsx pins each tab `whiteSpace: nowrap` +
 * `flexShrink: 0` with no max-width/ellipsis), so a long agent title blows the
 * tab out and crowds the others off. Cap the *label* host-side — the node
 * `name` (graph key, must stay unique/stable) is deliberately left full. */
const MAX_SESSION_LABEL_LENGTH = 24;

export function truncateSessionLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > MAX_SESSION_LABEL_LENGTH
    ? `${trimmed.slice(0, MAX_SESSION_LABEL_LENGTH).trimEnd()}…`
    : trimmed;
}

/** Node names must be stable and unique per session (the page keys agents by
 * `name`). `usedNames` is the set already assigned within the same
 * SimulationEvent sessionId; on collision a short id suffix disambiguates. */
export function resolveAgentNodeName(input: {
  agentId: string;
  title: string | null;
  usedNames: ReadonlySet<string>;
}): string {
  const trimmedTitle = input.title?.trim();
  const candidate =
    trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : `Agent ${input.agentId.slice(0, 6)}`;
  if (!input.usedNames.has(candidate)) {
    return candidate;
  }
  return `${candidate} (${input.agentId.slice(0, 6)})`;
}

/** Shared identity a mapping call needs: the resolved node name and the
 * SimulationEvent sessionId (the root agent's own id) this node belongs to. */
export interface AgentNodeContext {
  name: string;
  sessionId: string;
}

export function buildRootAgentSpawnEvent(input: {
  ctx: AgentNodeContext;
  model: string | null;
  provider: string;
  time: number;
}): SimulationEvent {
  const runtime = resolveVisualizerRuntime(input.provider);
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_spawn",
    payload: {
      name: input.ctx.name,
      isMain: true,
      ...(input.model ? { model: input.model } : {}),
      ...(runtime ? { runtime } : {}),
    },
  };
}

export function buildObservedSubagentSpawnEvent(input: {
  ctx: AgentNodeContext;
  parentName: string;
  task?: string | null;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_spawn",
    payload: {
      name: input.ctx.name,
      parent: input.parentName,
      ...(input.task ? { task: input.task } : {}),
    },
  };
}

export function buildModelDetectedEvent(input: {
  ctx: AgentNodeContext;
  model: string;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "model_detected",
    payload: { agent: input.ctx.name, model: input.model },
  };
}

/** What the visualizer needs to decide whether an agent's node is finished
 * and should emit `agent_complete` (fade out of the graph). */
export interface VisualizerTerminalInput {
  status: AgentLifecycleStatus;
  attend: "attended" | "observed" | undefined;
  archived: boolean;
  requiresAttention: boolean;
}

/** True when a node should complete and fade out. Mirrors the subagents
 * track's tidy-eligibility (`isSubagentRowTidyEligible` in
 * subagents/track-presentation.ts) so a subagent leaves the graph at exactly
 * the moment the track collapses it into its "Completed" group:
 *
 * - `closed` or archived is always terminal (roots included — a session that
 *   ends stops rendering as active).
 * - A provider-managed (`observed`) subagent is also done at `idle` or `error`:
 *   a Claude Task ends its run at `idle` and never resumes, so idle-observed is
 *   genuinely finished, whereas a native subagent idles *between turns* and may
 *   still be mid-conversation — so only `observed` idle counts. Attention rows
 *   (e.g. a usage-exhausted failure) stay visible so the signal isn't buried.
 *
 * Without this an idle Claude Task node lingered forever, because the old test
 * was `status === "closed" || archived` only — an observed subagent that
 * completes to `idle` matched neither and never faded. */
export function isVisualizerAgentTerminal(input: VisualizerTerminalInput): boolean {
  if (input.status === "closed" || input.archived) {
    return true;
  }
  if (input.attend === "observed" && !input.requiresAttention) {
    return input.status === "idle" || input.status === "error";
  }
  return false;
}

export function buildAgentCompleteEvent(input: {
  ctx: AgentNodeContext;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_complete",
    payload: { name: input.ctx.name },
  };
}

export function buildAgentIdleEvent(input: {
  ctx: AgentNodeContext;
  time: number;
  /** True marks a real turn end — the page rests the node at its dim 'idle'
   * state (Otto vendor patch) instead of the upstream "back to thinking"
   * transition, so an idle agent no longer looks identical to one reasoning. */
  resting?: boolean;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "agent_idle",
    payload: { name: input.ctx.name, ...(input.resting ? { resting: true } : {}) },
  };
}

export function buildPermissionRequestedEvent(input: {
  ctx: AgentNodeContext;
  time: number;
}): SimulationEvent {
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "permission_requested",
    payload: { agent: input.ctx.name },
  };
}

/** `contextBreakdown` has no Otto source — omit it; the page tolerates
 * missing fields. `tokens`/`tokensMax` are context OCCUPANCY (drives the
 * ring); `cumulativeTokens` is the agent's honest lifetime total (drives the
 * page's token/cost sums — Otto vendor patch). Returns null when neither
 * reading is present (nothing worth emitting). */
export function buildContextUpdateEvent(input: {
  ctx: AgentNodeContext;
  usage?: AgentUsage;
  cumulativeTokens?: number;
  time: number;
}): SimulationEvent | null {
  const contextTokens = input.usage?.contextWindowUsedTokens;
  if (contextTokens == null && input.cumulativeTokens == null) {
    return null;
  }
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "context_update",
    payload: {
      agent: input.ctx.name,
      ...(contextTokens != null ? { tokens: contextTokens } : {}),
      ...(input.usage?.contextWindowMaxTokens != null
        ? { tokensMax: input.usage.contextWindowMaxTokens }
        : {}),
      ...(input.cumulativeTokens != null ? { cumulativeTokens: input.cumulativeTokens } : {}),
    },
  };
}

export function toolCallDetailFilePath(detail: ToolCallDetail): string | undefined {
  switch (detail.type) {
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    default:
      return undefined;
  }
}

/** Short args summary shown on the tool-call node while it's running. */
export function summarizeToolCallArgs(detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    case "search":
      return detail.query;
    case "fetch":
      return detail.url;
    case "worktree_setup":
      return detail.branchName;
    case "sub_agent":
      return detail.description ?? detail.subAgentType ?? "";
    case "plain_text":
      return detail.label ?? detail.text ?? "";
    case "plan":
      return truncate(detail.text);
    case "unknown":
      return "";
    default:
      return "";
  }
}

function summarizeShellResult(detail: Extract<ToolCallDetail, { type: "shell" }>): string {
  if (detail.output) {
    return truncate(detail.output);
  }
  return detail.exitCode != null ? `exit ${detail.exitCode}` : "";
}

function summarizeSearchResult(detail: Extract<ToolCallDetail, { type: "search" }>): string {
  if (detail.numMatches != null) {
    return `${detail.numMatches} matches`;
  }
  if (detail.numFiles != null) {
    return `${detail.numFiles} files`;
  }
  return detail.content ? truncate(detail.content) : "";
}

/** Short result summary shown once the tool call finishes. */
export function summarizeToolCallResult(detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return summarizeShellResult(detail);
    case "read":
      return detail.content ? truncate(detail.content) : "";
    case "edit":
      return detail.unifiedDiff ? truncate(detail.unifiedDiff) : "";
    case "write":
      return detail.content ? truncate(detail.content) : "";
    case "search":
      return summarizeSearchResult(detail);
    case "fetch":
      return detail.result ? truncate(detail.result) : (detail.codeText ?? "");
    case "worktree_setup":
      return truncate(detail.log);
    case "sub_agent":
      return truncate(detail.log);
    case "plain_text":
      return detail.text ?? detail.label ?? "";
    case "plan":
      return truncate(detail.text);
    case "unknown":
      return "";
    default:
      return "";
  }
}

function stringifyToolCallError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Child label for subagent_dispatch/subagent_return. MUST resolve to the same
 * string as the observed child agent's node name (which is the daemon-frozen
 * row title) — the page renders dispatch/return particles on the parent→child
 * edge keyed by that name, so any mismatch makes them silently invisible.
 * Both sides therefore share `deriveObservedSubagentTitle`. Exported so the
 * stateful layer can re-dispatch when a running item's streaming input
 * changes the derived label (e.g. `subagent_type` parses after `description`).
 */
export function resolveSubAgentChildLabel(
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>,
): string {
  return deriveObservedSubagentTitle({
    ...(detail.subAgentType ? { subAgentType: detail.subAgentType } : {}),
    ...(detail.description ? { description: detail.description } : {}),
  });
}

function toolCallSubAgentLabel(detail: Extract<ToolCallDetail, { type: "sub_agent" }>): string {
  return resolveSubAgentChildLabel(detail);
}

/** A dispatch spark alone — for a long-running sub_agent call whose first
 * running item predated the sub_agent detail (or whose start was already
 * emitted); the stateful layer dedupes per callId. */
export function buildSubagentDispatchEvent(input: {
  ctx: AgentNodeContext;
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>;
  time: number;
}): SimulationEvent {
  const label = toolCallSubAgentLabel(input.detail);
  return {
    time: input.time,
    sessionId: input.ctx.sessionId,
    type: "subagent_dispatch",
    payload: { parent: input.ctx.name, child: label, task: label },
  };
}

/** The `tool_call_start` (+ `subagent_dispatch` for sub_agent calls) a
 * running item produces. Status-independent on purpose: also used to
 * synthesize the start for a terminal item whose running snapshot never
 * reached the client (the daemon's stream coalescer collapses running ->
 * terminal within its flush window into a single terminal item, live AND
 * persisted — the page drops a `tool_call_end` with no running match). */
function toolCallStartEvents(input: {
  ctx: AgentNodeContext;
  item: ToolCallTimelineItem;
  time: number;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  const filePath = toolCallDetailFilePath(item.detail);
  const events: SimulationEvent[] = [
    {
      time,
      sessionId: ctx.sessionId,
      type: "tool_call_start",
      payload: {
        agent: ctx.name,
        tool: item.name,
        args: summarizeToolCallArgs(item.detail),
        ...(filePath ? { inputData: { file_path: filePath } } : {}),
      },
    },
  ];
  if (item.detail.type === "sub_agent") {
    const label = toolCallSubAgentLabel(item.detail);
    events.push({
      time,
      sessionId: ctx.sessionId,
      type: "subagent_dispatch",
      payload: { parent: ctx.name, child: label, task: label },
    });
  }
  return events;
}

function toolCallToSimulationEvents(input: {
  ctx: AgentNodeContext;
  item: ToolCallTimelineItem;
  time: number;
  synthesizeStart?: boolean;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  const subAgentDetail = item.detail.type === "sub_agent" ? item.detail : null;

  if (item.status === "running") {
    return toolCallStartEvents({ ctx, item, time });
  }

  const events: SimulationEvent[] = input.synthesizeStart
    ? toolCallStartEvents({ ctx, item, time })
    : [];
  const isError = item.status === "failed";
  events.push({
    time,
    sessionId: ctx.sessionId,
    type: "tool_call_end",
    payload: {
      agent: ctx.name,
      tool: item.name,
      result: summarizeToolCallResult(item.detail),
      isError,
      ...(isError ? { errorMessage: stringifyToolCallError(item.error) } : {}),
    },
  });
  if (subAgentDetail) {
    const label = toolCallSubAgentLabel(subAgentDetail);
    events.push({
      time,
      sessionId: ctx.sessionId,
      type: "subagent_return",
      payload: { parent: ctx.name, child: label, summary: summarizeToolCallResult(item.detail) },
    });
  }
  return events;
}

/** Pure mapping of one canonical Otto timeline item to zero or more
 * SimulationEvents. Used both for timeline backfill (task 03 §Backfill) and
 * for live `agent_stream {type:"timeline"}` events (which carry the same
 * item shape). `todo`/`error`/`compaction` timeline items have no
 * SimulationEvent equivalent and are dropped. */
export function timelineItemToSimulationEvents(input: {
  ctx: AgentNodeContext;
  item: AgentTimelineItem;
  time: number;
  /** Prepend the tool_call_start (+ subagent_dispatch) a terminal tool_call
   * item would have been preceded by. Set by the stateful layer when it has
   * never seen a running item for this callId — see the coalescer note on
   * {@link toolCallStartEvents}. No effect on non-tool_call items. */
  synthesizeToolCallStart?: boolean;
}): SimulationEvent[] {
  const { ctx, item, time } = input;
  switch (item.type) {
    case "user_message":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "user" },
        },
      ];
    case "assistant_message":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "assistant" },
        },
      ];
    case "reasoning":
      return [
        {
          time,
          sessionId: ctx.sessionId,
          type: "message",
          payload: { agent: ctx.name, content: item.text, role: "thinking" },
        },
      ];
    case "tool_call":
      return toolCallToSimulationEvents({
        ctx,
        item,
        time,
        synthesizeStart: input.synthesizeToolCallStart,
      });
    case "todo":
    case "error":
    case "compaction":
      return [];
    default:
      return [];
  }
}

/** Pure mapping of one live `agent_stream` event to zero or more
 * SimulationEvents. `timeline` events delegate to
 * {@link timelineItemToSimulationEvents}. */
export function streamEventToSimulationEvents(input: {
  ctx: AgentNodeContext;
  event: AgentStreamEventPayload;
  time: number;
}): SimulationEvent[] {
  const { ctx, event, time } = input;
  switch (event.type) {
    case "timeline":
      return timelineItemToSimulationEvents({ ctx, item: event.item, time });
    case "turn_completed": {
      const events: SimulationEvent[] = [];
      const contextEvent = event.usage
        ? buildContextUpdateEvent({ ctx, usage: event.usage, time })
        : null;
      if (contextEvent) {
        events.push(contextEvent);
      }
      events.push(buildAgentIdleEvent({ ctx, time, resting: true }));
      return events;
    }
    case "turn_failed":
    case "turn_canceled":
      return [buildAgentIdleEvent({ ctx, time, resting: true })];
    case "permission_requested":
      return [buildPermissionRequestedEvent({ ctx, time })];
    case "permission_resolved":
      // The agent resumes its turn — back to reasoning, not resting.
      return [buildAgentIdleEvent({ ctx, time })];
    case "thread_started":
    case "turn_started":
    case "attention_required":
      return [];
    default:
      return [];
  }
}
