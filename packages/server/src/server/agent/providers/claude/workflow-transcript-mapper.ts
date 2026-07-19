// Maps an on-disk Claude workflow-subagent transcript (agent-<id>.jsonl) into
// Otto AgentTimelineItem[] — the SAME timeline shape the live SDK path produces,
// so the synthetic workflow-decomposition stream ingests identically (see
// projects/workflow-decomposition/workflow-decomposition.md).
//
// It is deliberately self-contained: it reuses the pure, exported
// mapClaude*ToolCall mappers from ./tool-call-mapper (so tool_call detail/summary
// is byte-identical to live) but does NOT import ./agent.ts, avoiding an import
// cycle with that 6000-line module. The envelope/block routing mirrors
// convertClaudeHistoryEntry + mapBlocksToTimeline (agent.ts) for the subset of
// message kinds that appear in a subagent transcript.
//
// Each line of a subagent transcript is one JSON object: a rich envelope plus a
// nested `message`. One assistant turn is split across multiple lines that share
// one `message.id` (a text line + one line per tool_use), with tool_result lines
// (type:"user") interleaved. tool_use carries name+input; the matching
// tool_result carries only tool_use_id + output, so pairing is stateful — this
// mapper keeps its own per-subagent tool-use cache.

import type { AgentTimelineItem } from "../../agent-sdk-types.js";

import { SubagentUsageAccumulator, type SubagentUsageTotals } from "../../subagent-usage.js";

import { readUsageTotals } from "./claude-subagent-usage.js";
import {
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";

export type { SubagentUsageTotals } from "../../subagent-usage.js";

interface RawTranscriptEntry {
  type?: unknown;
  uuid?: unknown;
  attachment?: unknown;
  message?:
    | { role?: unknown; content?: unknown; usage?: unknown; id?: unknown; model?: unknown }
    | undefined;
}

interface RawBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  tool_name?: unknown;
  content?: unknown;
  is_error?: unknown;
}

interface CachedToolUse {
  name: string;
  input: unknown;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRawBlock(value: unknown): value is RawBlock {
  return Boolean(value) && typeof value === "object";
}

/**
 * Stateful per-subagent transcript mapper. Feed it each parsed JSONL line in
 * order; it emits the timeline items for that line (assistant text, reasoning,
 * running tool_calls, settled tool_calls, the initial user prompt) and keeps a
 * running per-message usage total (in/out + cache read/creation) the watcher and
 * ledger surface as the sub-agent's real, authoritative token footprint.
 */
export class WorkflowSubagentTranscriptMapper {
  private readonly toolUseCache = new Map<string, CachedToolUse>();
  // Real per-frame token accounting (dedup by message.id, keep max-output frame,
  // sum across ids) — shared with the live sidechain path so both surface the
  // sub-agent's usage identically. See ../../subagent-usage.ts.
  private readonly usage = new SubagentUsageAccumulator();

  mapEntry(entry: RawTranscriptEntry): AgentTimelineItem[] {
    this.accumulateUsage(entry);

    // Attachment lines (deferred-tools / skill-listing deltas) have no message.
    if (entry.message === undefined || entry.message === null) {
      return [];
    }
    const content = entry.message.content;
    const messageId = readString(entry.uuid);

    if (entry.type === "user") {
      return this.mapUserEntry(content, messageId);
    }
    if (entry.type === "assistant") {
      return this.mapAssistantEntry(content, messageId);
    }
    return [];
  }

  /**
   * The sub-agent's real token footprint so far: input/output plus the cache
   * read/creation split, straight from the API `usage` on each frame. Summed
   * across deduped messages — no roll-up, no estimation.
   */
  usageTotals(): SubagentUsageTotals {
    return this.usage.totals();
  }

  /** Best-effort running total of output tokens across the transcript so far. */
  cumulativeOutputTokens(): number {
    return this.usage.totals().outputTokens;
  }

  /** The model this sub-agent ran on (first seen), e.g. "claude-haiku-4-5-…". */
  /** Model round-trips seen in this sub-agent's transcript so far. */
  roundCount(): number {
    return this.usage.roundCount();
  }

  model(): string | undefined {
    return this.usage.model();
  }

  private accumulateUsage(entry: RawTranscriptEntry): void {
    this.usage.observe({
      messageId: readString(entry.message?.id) ?? readString(entry.uuid),
      usage: readUsageTotals(entry.message?.usage),
      model: readString(entry.message?.model),
    });
  }

  private mapUserEntry(content: unknown, messageId: string | undefined): AgentTimelineItem[] {
    // The initial prompt is a plain string; later user lines are tool_result arrays.
    if (typeof content === "string") {
      const text = content.trim();
      return text ? [{ type: "user_message", text, ...(messageId ? { messageId } : {}) }] : [];
    }
    if (!Array.isArray(content)) {
      return [];
    }
    const items: AgentTimelineItem[] = [];
    for (const block of content) {
      if (!isRawBlock(block) || !String(block.type ?? "").endsWith("tool_result")) {
        continue;
      }
      const item = this.mapToolResult(block);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  private mapAssistantEntry(content: unknown, messageId: string | undefined): AgentTimelineItem[] {
    if (typeof content === "string") {
      const text = content.trim();
      return text ? [{ type: "assistant_message", text, ...(messageId ? { messageId } : {}) }] : [];
    }
    if (!Array.isArray(content)) {
      return [];
    }
    const items: AgentTimelineItem[] = [];
    for (const block of content) {
      if (!isRawBlock(block)) {
        continue;
      }
      switch (block.type) {
        case "text":
        case "text_delta": {
          const text = readString(block.text)?.trim();
          if (text) {
            items.push({ type: "assistant_message", text, ...(messageId ? { messageId } : {}) });
          }
          break;
        }
        case "thinking":
        case "thinking_delta": {
          const text = readString(block.thinking);
          if (text) {
            items.push({ type: "reasoning", text });
          }
          break;
        }
        case "tool_use":
        case "server_tool_use":
        case "mcp_tool_use": {
          const item = this.mapToolUse(block);
          if (item) {
            items.push(item);
          }
          break;
        }
        default:
          break;
      }
    }
    return items;
  }

  private mapToolUse(block: RawBlock): AgentTimelineItem | null {
    const callId = readString(block.id);
    const name = readString(block.name);
    if (!callId || !name) {
      return null;
    }
    const input = block.input ?? null;
    this.toolUseCache.set(callId, { name, input });
    return mapClaudeRunningToolCall({ callId, name, input, output: null });
  }

  private mapToolResult(block: RawBlock): AgentTimelineItem | null {
    const callId = readString(block.tool_use_id);
    if (!callId) {
      return null;
    }
    const cached = this.toolUseCache.get(callId);
    const name = cached?.name ?? readString(block.tool_name) ?? "tool";
    const params = { callId, name, input: cached?.input ?? null, output: block.content ?? null };
    if (block.is_error === true) {
      return mapClaudeFailedToolCall({ ...params, error: { message: "Tool call failed" } });
    }
    return mapClaudeCompletedToolCall(params);
  }
}
