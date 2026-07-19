// Disk-backed usage source for PLAIN Task/Agent sub-agents — the non-workflow
// twin of WorkflowTranscriptWatcher (see docs/subagent-accounting.md).
//
// Why disk at all (proven 2026-07-19 against a real nested fan-out session):
//  - The live SDK stream forwards ONLY depth-1 sidechain frames. A sub-agent's
//    own sub-agents (depth ≥ 2) never stream — their usage and conversation
//    exist ONLY in their on-disk transcripts.
//  - Even at depth 1 the live sidechain assistant frames carry only the
//    message_start usage snapshot (output_tokens ≈ 1-2); the final per-message
//    usage lands only on disk, so live-accumulated rows under-reported output.
//
// The CLI writes every sub-agent's transcript in real time to
//   <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl
// and — unlike workflows — hands us a positive correlation: every Task/Agent
// tool_result carries "agentId: <id>" in its text (the sync completion and the
// async launch ack alike, at every depth; a nested spawn's tool_result rides
// the depth-1 sidechain the daemon DOES see). Binding is exact — no heuristic
// dir discovery.
//
// Row lifecycle stays owned by agent.ts (announce via sidechain/task events,
// settle via tool_result/task_notification). This watcher only emits
//  - the authoritative usage split (+ model, rounds, grand total), and
//  - timeline items for keys with no live feed (nested sub-agents' panes).
// After a key settles it keeps draining briefly so a transcript chunk flushed
// just after the terminal event still lands, re-asserting the settled status
// (the ledger's delta-recording books the remainder without a status flip).

import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";

import { grandTotalTokens } from "../../subagent-usage.js";

import { claudeProjectDirSync } from "./project-dir.js";
import { toClaudeSubagentUsage } from "./claude-subagent-usage.js";
import { JsonlTail } from "./jsonl-tail.js";
import { WorkflowSubagentTranscriptMapper } from "./workflow-transcript-mapper.js";
import type { WorkflowWatcherLogger } from "./workflow-transcript-watcher.js";

const POLL_INTERVAL_MS = 700;
// How long a settled key keeps polling for a late transcript flush.
const SETTLE_DRAIN_MS = 3_500;

// The "agentId: <id>" note the CLI embeds in every Task/Agent tool_result —
// the id doubles as the transcript filename (agent-<id>.jsonl).
const AGENT_ID_PATTERN = /\bagentId:\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

/**
 * Extract the sub-agent's on-disk agent id from a Task/Agent tool_result's
 * content (string, or the Anthropic block array whose text blocks carry it).
 */
export function readClaudeSubagentAgentIdFromToolResult(content: unknown): string | undefined {
  if (typeof content === "string") {
    return AGENT_ID_PATTERN.exec(content)?.[1];
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    const text = typeof block === "string" ? block : (block as { text?: unknown } | null)?.text;
    if (typeof text === "string") {
      const match = AGENT_ID_PATTERN.exec(text);
      if (match) {
        return match[1];
      }
    }
  }
  return undefined;
}

export interface TaskTranscriptWatcherOptions {
  /** Agent cwd, encoded into the on-disk <projectDir>. */
  cwd: string;
  /** Override for ~/.claude (honors CLAUDE_CONFIG_DIR when unset). */
  configDir?: string;
  /** Live Claude session id — the <sessionId> directory transcripts live under. */
  getSessionId: () => string | null;
  /** Push a synthetic AgentStreamEvent into the parent session stream. */
  emit: (event: AgentStreamEvent) => void;
  logger: WorkflowWatcherLogger;
  /** Test override for the poll cadence. */
  pollIntervalMs?: number;
  /** Test override for the post-settle drain window. */
  settleDrainMs?: number;
}

interface TrackedTaskAgent {
  key: string;
  agentId: string;
  tail: JsonlTail;
  mapper: WorkflowSubagentTranscriptMapper;
  /** Emit timeline items from disk — only for keys with no live sidechain feed. */
  emitTimeline: boolean;
  settledStatus?: "idle" | "error" | "closed";
  drainDeadlineMs?: number;
  lastTokens: number;
  done: boolean;
}

export class TaskTranscriptWatcher {
  private readonly opts: TaskTranscriptWatcherOptions;
  private readonly agents = new Map<string, TrackedTaskAgent>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: TaskTranscriptWatcherOptions) {
    this.opts = options;
  }

  /** True once a key has a disk tail — the live sidechain accumulator must then
   * stand down for it (disk is a strict superset with the real output counts). */
  isBound(key: string): boolean {
    return this.agents.has(key);
  }

  /**
   * Bind a sub-agent's observed key to its on-disk transcript. Idempotent per
   * key; scans immediately so a sync Task's full transcript (already complete
   * on disk at tool_result time) lands before the terminal event goes out.
   */
  bind(input: { key: string; agentId: string; emitTimeline: boolean }): void {
    if (this.closed || this.agents.has(input.key)) {
      return;
    }
    const dir = this.resolveSubagentsDir();
    if (!dir) {
      this.opts.logger.warn(
        { key: input.key, agentId: input.agentId },
        "task transcript watcher could not resolve transcript dir; not binding",
      );
      return;
    }
    const entry: TrackedTaskAgent = {
      key: input.key,
      agentId: input.agentId,
      tail: new JsonlTail(path.join(dir, `agent-${input.agentId}.jsonl`)),
      mapper: new WorkflowSubagentTranscriptMapper(),
      emitTimeline: input.emitTimeline,
      lastTokens: 0,
      done: false,
    };
    this.agents.set(input.key, entry);
    this.opts.logger.debug(
      { key: input.key, agentId: input.agentId, emitTimeline: input.emitTimeline },
      "task transcript watcher bound sub-agent transcript",
    );
    this.scanEntry(entry);
    this.ensurePolling();
  }

  /**
   * The key's row reached a terminal status (agent.ts owns that emission).
   * Scan once synchronously so the authoritative usage precedes the terminal
   * event whenever the transcript is already flushed, then keep draining
   * briefly for a late flush.
   */
  markSettled(key: string, status: "idle" | "error" | "closed"): void {
    const entry = this.agents.get(key);
    if (!entry || entry.done) {
      return;
    }
    entry.settledStatus = status;
    entry.drainDeadlineMs = Date.now() + (this.opts.settleDrainMs ?? SETTLE_DRAIN_MS);
    this.scanEntry(entry);
  }

  close(): void {
    this.closed = true;
    this.stopPolling();
    this.agents.clear();
  }

  // --- internals ---

  private ensurePolling(): void {
    if (this.pollTimer || this.closed) {
      return;
    }
    const timer = setInterval(() => this.tick(), this.opts.pollIntervalMs ?? POLL_INTERVAL_MS);
    timer.unref?.();
    this.pollTimer = timer;
  }

  private stopPolling(): void {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private tick(): void {
    let live = 0;
    for (const entry of this.agents.values()) {
      if (entry.done) {
        continue;
      }
      try {
        this.scanEntry(entry);
      } catch (error) {
        this.opts.logger.warn(
          { key: entry.key, agentId: entry.agentId, err: error },
          "task transcript watcher scan failed",
        );
      }
      if (
        entry.settledStatus &&
        entry.drainDeadlineMs !== undefined &&
        Date.now() >= entry.drainDeadlineMs
      ) {
        entry.done = true;
        continue;
      }
      live += 1;
    }
    if (live === 0) {
      this.stopPolling();
    }
  }

  private scanEntry(entry: TrackedTaskAgent): void {
    const lines = entry.tail.readNew();
    if (lines.length > 0 && entry.emitTimeline) {
      for (const line of lines) {
        for (const item of entry.mapper.mapEntry(line as never)) {
          this.opts.emit({
            type: "observed_subagent_timeline",
            provider: "claude",
            key: entry.key,
            item,
          });
        }
      }
    } else {
      for (const line of lines) {
        entry.mapper.mapEntry(line as never);
      }
    }
    this.maybeEmitUsage(entry);
  }

  private maybeEmitUsage(entry: TrackedTaskAgent): void {
    const totals = entry.mapper.usageTotals();
    const tokens = grandTotalTokens(totals);
    if (tokens <= entry.lastTokens) {
      return;
    }
    entry.lastTokens = tokens;
    const status = entry.settledStatus ?? "running";
    const model = entry.mapper.model();
    this.opts.emit({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: entry.key,
        status,
        ...(status === "error" ? { requiresAttention: true } : {}),
        // The real in/out/cache split from the transcript's API frames, priced
        // on the sub-agent's OWN model, plus the grand-total scalar the track
        // readout shows — same contract as the workflow watcher.
        usage: toClaudeSubagentUsage(totals, model),
        usageRounds: entry.mapper.roundCount(),
        ...(model ? { model } : {}),
        cumulativeTokens: tokens,
      },
    });
  }

  // <projectDir>/<sessionId>/subagents — resolved lazily so binds always use
  // the session id current at spawn time.
  private resolveSubagentsDir(): string | null {
    const sessionId = this.opts.getSessionId();
    if (!sessionId) {
      return null;
    }
    for (const candidate of this.cwdCandidates()) {
      try {
        const projectDir = claudeProjectDirSync(candidate, {
          configDir: this.opts.configDir,
        });
        return path.join(projectDir, sessionId, "subagents");
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  private cwdCandidates(): string[] {
    const candidates = [this.opts.cwd];
    try {
      const real = fs.realpathSync(this.opts.cwd);
      if (real !== this.opts.cwd) {
        candidates.push(real);
      }
    } catch {
      // cwd may not exist yet; the primary candidate still encodes fine
    }
    return candidates;
  }
}
