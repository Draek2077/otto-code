import type { AgentUsage } from "@otto-code/protocol/agent-types";
import type { StreamItem } from "@/types/stream";

export interface TurnTiming {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  /** Present only for turns whose turn_completed event was observed live. */
  usage?: AgentUsage;
}

export interface StreamTurnTiming {
  byAssistantId: Map<string, TurnTiming>;
  runningStartedAt: Date | null;
  /**
   * Rough size of the running turn's streamed content so far (assistant text,
   * reasoning, and tool-call payloads) at ~4 chars per token. Real usage only
   * arrives at request boundaries, so this is what lets the count tick up with
   * each incoming chunk. Null when the agent is idle or nothing streamed yet.
   */
  runningEstimatedTokens: number | null;
}

const ESTIMATED_CHARS_PER_TOKEN = 4;

// Tool payload sizes are cached by payload identity. The merge logic reuses
// the existing detail object when an update doesn't change it, so status-only
// item replacements (running → completed) don't re-stringify large payloads —
// only genuinely new tool output does.
const toolCallCharsCache = new WeakMap<object, number>();

function estimateItemStreamedChars(item: StreamItem): number {
  if (item.kind === "assistant_message" || item.kind === "thought") {
    return item.text.length;
  }
  if (item.kind === "tool_call") {
    const payloadObject: object =
      item.payload.source === "agent" ? item.payload.data.detail : item.payload.data;
    const cached = toolCallCharsCache.get(payloadObject);
    if (cached !== undefined) {
      return cached;
    }
    let chars = 0;
    try {
      chars = JSON.stringify(payloadObject)?.length ?? 0;
    } catch {
      chars = 0;
    }
    toolCallCharsCache.set(payloadObject, chars);
    return chars;
  }
  return 0;
}

export function deriveStreamTurnTiming(params: {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
}): StreamTurnTiming {
  const byAssistantId = new Map<string, TurnTiming>();
  let currentUserAt: Date | null = null;
  let currentLastItemAt: Date | null = null;
  let currentAssistantIds: string[] = [];
  let currentUsage: AgentUsage | undefined;
  let currentStreamedChars = 0;

  const flushCompletedTurn = () => {
    if (!currentUserAt || !currentLastItemAt || currentAssistantIds.length === 0) {
      return;
    }
    const timing: TurnTiming = {
      startedAt: currentUserAt,
      completedAt: currentLastItemAt,
      durationMs: Math.max(0, currentLastItemAt.getTime() - currentUserAt.getTime()),
      ...(currentUsage ? { usage: currentUsage } : {}),
    };
    for (const id of currentAssistantIds) {
      byAssistantId.set(id, timing);
    }
  };

  const visitItem = (item: StreamItem) => {
    if (item.kind === "user_message") {
      flushCompletedTurn();
      currentUserAt = item.timestamp;
      currentLastItemAt = null;
      currentAssistantIds = [];
      currentUsage = undefined;
      currentStreamedChars = 0;
      return;
    }
    if (!currentUserAt) {
      return;
    }
    currentLastItemAt = item.timestamp;
    currentStreamedChars += estimateItemStreamedChars(item);
    if (item.kind === "assistant_message") {
      currentAssistantIds.push(item.id);
      if (item.turnUsage) {
        currentUsage = item.turnUsage;
      }
    }
  };

  for (const item of params.tail) {
    visitItem(item);
  }
  for (const item of params.head) {
    visitItem(item);
  }

  const runningStartedAt =
    params.agentStatus === "running"
      ? (findLastUserMessageTimestamp(params.head) ?? currentUserAt)
      : null;
  if (params.agentStatus !== "running") {
    flushCompletedTurn();
  }

  // After the walk, currentStreamedChars holds the last turn's total — which
  // is the in-flight turn exactly when the agent is running. Exact values are
  // fine here: the only per-tick re-render is the small token Text (the
  // spinner is memo-isolated in the footer).
  const runningEstimatedTokens =
    params.agentStatus === "running" && currentStreamedChars > 0
      ? Math.round(currentStreamedChars / ESTIMATED_CHARS_PER_TOKEN)
      : null;

  return {
    byAssistantId,
    runningStartedAt,
    runningEstimatedTokens,
  };
}

function findLastUserMessageTimestamp(items: StreamItem[]): Date | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "user_message") {
      return item.timestamp;
    }
  }
  return null;
}
