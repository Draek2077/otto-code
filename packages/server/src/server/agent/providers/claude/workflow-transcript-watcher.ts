// Synthetic event source for Claude Workflow (ultracode) runs — see
// projects/workflow-decomposition/workflow-decomposition.md.
//
// A Workflow's internal agent() fan-out carries NO per-agent identity on the
// live SDK stream (proven 2026-07-16): the parent query sees only the aggregate
// `local_workflow` task lifecycle. But the CLI writes each internal agent's full
// transcript to disk in real time:
//
//   <projectDir>/<sessionId>/subagents/workflows/<wf_runId>/
//       journal.jsonl            per-agent {type:"started"|"result", agentId, ...}
//       agent-<id>.jsonl         full per-agent transcript (appended live)
//       agent-<id>.meta.json     {agentType, spawnDepth}
//   <projectDir>/<sessionId>/workflows/<wf_runId>.json   run-state (written at completion)
//
// This watcher is armed by the Claude provider when a `local_workflow`
// task_started fires (bound to the workflow's observed row key), tails those
// files, and re-emits Otto's EXISTING observed-subagent events — one observed
// child per internal agent, nested under the workflow row via `parentKey` — so
// the subagents track, visualizer, and metrics ingest the fan-out exactly as if
// it were a real SDK stream. At disarm it reconciles against the run-state file
// for authoritative per-agent tokens + final state.
//
// Dir binding: the SDK task_id ≠ the on-disk wf_<runId> dir name, and the only
// on-disk correlator is the `taskId` field in the run-state file — which is
// written at COMPLETION. So a live run is bound heuristically (oldest unclaimed
// live-looking dir, including a dir created just before arm — the engine can
// create it before task_started reaches the provider), and identity is
// confirmed retroactively the moment the run-state appears: a taskId match
// confirms the bind, a mismatch releases the dir and resumes discovery.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";

import { grandTotalTokens } from "../../subagent-usage.js";

import { claudeProjectDirSync } from "./project-dir.js";
import { toClaudeSubagentUsage } from "./claude-subagent-usage.js";
import { WorkflowSubagentTranscriptMapper } from "./workflow-transcript-mapper.js";

const POLL_INTERVAL_MS = 700;
// An unbound watcher stops discovery-polling after this long — a run whose dir
// never appeared (engine crashed pre-write, wrong session dir, ...) must not
// leave a readdir interval running forever.
const BIND_DEADLINE_MS = 90_000;
// A dir that already existed at arm time only qualifies for binding when it was
// created this recently before arm (covers the create-dir → task_started race);
// anything older is some earlier run's.
const PRE_ARM_RECENCY_MS = 30_000;
// agentType values that make poor row titles — mirrors deriveObservedSubagentTitle's
// rejection set (@otto-code/protocol/observed-subagent-title) plus the workflow
// sentinel, so a distinct per-agent prompt is used as the title/label instead.
const GENERIC_AGENT_TYPES = new Set([
  "general-purpose",
  "general",
  "task",
  "agent",
  "subagent",
  "workflow-subagent",
]);

export interface WorkflowWatcherLogger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface WorkflowTranscriptWatcherOptions {
  /** The Workflow tool_use id = the observed row key children nest under. */
  workflowKey: string;
  /**
   * SDK task id. The run-state file (`workflows/<wf_runId>.json`, written at
   * completion) carries a matching `taskId`, so this is the identity used to
   * bind a fast-completed dir positively, reject other runs' completed dirs,
   * and retroactively confirm (or undo) a heuristic live bind.
   */
  taskId?: string;
  /** Live Claude session id (the on-disk <sessionId> directory name). */
  sessionId: string;
  /** Agent cwd, encoded into the on-disk <projectDir>. */
  cwd: string;
  /** Override for ~/.claude (honors CLAUDE_CONFIG_DIR when unset). */
  configDir?: string;
  /** Push a synthetic AgentStreamEvent into the parent session stream. */
  emit: (event: AgentStreamEvent) => void;
  logger: WorkflowWatcherLogger;
  /** Shared across concurrent watchers so two runs never bind the same dir. */
  claimedDirs: Set<string>;
}

/** One appended JSONL file, read incrementally by byte offset with a partial-line buffer. */
class JsonlTail {
  private offset = 0;
  private partial = "";

  constructor(private readonly filePath: string) {}

  readNew(): unknown[] {
    let size: number;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      return [];
    }
    if (size < this.offset) {
      // Truncated/rewritten — restart from the top.
      this.offset = 0;
      this.partial = "";
    }
    if (size === this.offset) {
      return [];
    }
    let chunk = "";
    const fd = fs.openSync(this.filePath, "r");
    try {
      const length = size - this.offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buffer, 0, length, this.offset);
      this.offset += read;
      chunk = buffer.toString("utf8", 0, read);
    } finally {
      fs.closeSync(fd);
    }
    this.partial += chunk;
    const lines = this.partial.split("\n");
    this.partial = lines.pop() ?? "";
    const out: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // A partial line mid-append; the next read will complete it.
      }
    }
    return out;
  }
}

interface AgentState {
  key: string;
  mapper: WorkflowSubagentTranscriptMapper;
  tail: JsonlTail;
  announced: boolean;
  settled: boolean;
  /** The terminal status emitted at settle; token updates re-assert it. */
  settledStatus?: "idle" | "error" | "closed";
  lastTokens: number;
}

interface RunStateInfo {
  exists: boolean;
  taskId?: string;
}

export class WorkflowTranscriptWatcher {
  private readonly opts: WorkflowTranscriptWatcherOptions;
  private readonly baseDir: string | null;
  private preArmDirs = new Set<string>();
  private armedAt = 0;
  private bindDeadlineAt = 0;
  /** Dirs proven (via run-state taskId) to belong to another run. */
  private readonly rejectedDirs = new Set<string>();
  private boundDir: string | null = null;
  /** The bound dir's run-state taskId matched ours (or no comparison exists). */
  private identityConfirmed = false;
  /** The bound dir's run-state file exists → the engine finished writing. */
  private runStateComplete = false;
  /** One post-completion scan has run; the next tick may stop polling. */
  private stopAfterNextScan = false;
  private journalTail: JsonlTail | null = null;
  private readonly agents = new Map<string, AgentState>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disarmed = false;

  constructor(options: WorkflowTranscriptWatcherOptions) {
    this.opts = options;
    this.baseDir = this.resolveBaseDir();
  }

  arm(): void {
    if (!this.baseDir) {
      this.opts.logger.warn(
        { workflowKey: this.opts.workflowKey },
        "workflow watcher could not resolve base dir; not arming",
      );
      return;
    }
    this.armedAt = Date.now();
    this.bindDeadlineAt = this.armedAt + BIND_DEADLINE_MS;
    this.preArmDirs = this.listWorkflowDirs();
    this.opts.logger.debug(
      { workflowKey: this.opts.workflowKey, baseDir: this.baseDir, preArm: this.preArmDirs.size },
      "workflow watcher armed",
    );
    const timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    timer.unref?.();
    this.pollTimer = timer;
    // Fire an immediate first tick so a very fast workflow isn't missed.
    this.tick();
  }

  disarm(finalStatus: "idle" | "error" | "closed"): void {
    if (this.disarmed) {
      return;
    }
    this.disarmed = true;
    this.stopPolling("disarmed");
    if (!this.boundDir) {
      // Last-chance identity bind: our dir may have been claimed by a
      // mis-bound sibling (or discovery stopped at the bind deadline) while
      // the run-state file — the ground truth — only appeared at completion.
      // A positive taskId match overrides claims, rejections, and the
      // deadline so the run's rows still backfill below.
      this.bindByRunStateIdentity();
    }
    // One last tail so nothing written just before completion is lost.
    try {
      this.scan();
    } catch {
      // best-effort
    }
    this.reconcileFromRunState();
    // Settle any child still marked running.
    for (const [agentId, state] of this.agents) {
      if (state.announced && !state.settled) {
        this.settleAgent(agentId, state, finalStatus);
      }
    }
    if (this.boundDir) {
      this.opts.claimedDirs.delete(this.boundDir);
    }
  }

  // --- internals ---

  private resolveBaseDir(): string | null {
    const configDir =
      this.opts.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
    const projectDir = this.resolveProjectDir(configDir);
    if (!projectDir) {
      return null;
    }
    return path.join(projectDir, this.opts.sessionId, "subagents", "workflows");
  }

  private resolveProjectDir(configDir: string): string | null {
    for (const candidate of this.cwdCandidates()) {
      try {
        return claudeProjectDirSync(candidate, { configDir });
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

  private listWorkflowDirs(): Set<string> {
    const dirs = new Set<string>();
    if (!this.baseDir) {
      return dirs;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    } catch {
      return dirs;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("wf_")) {
        dirs.add(path.join(this.baseDir!, entry.name));
      }
    }
    return dirs;
  }

  private tick(): void {
    if (this.disarmed) {
      return;
    }
    try {
      if (!this.boundDir) {
        this.tryBind();
        if (!this.boundDir) {
          if (Date.now() >= this.bindDeadlineAt) {
            this.stopPolling("bind deadline elapsed");
          }
          return;
        }
      }
      this.scan();
      if (this.verifyBoundIdentity() === "mismatch") {
        // Wrong dir was released; discovery resumes on the next tick.
        return;
      }
      if (this.stopAfterNextScan) {
        // The run finished on disk and one full scan ran strictly after that —
        // nothing left to tail; disarm() will still do the final reconcile.
        this.stopPolling("run settled on disk");
        return;
      }
      if (this.runStateComplete) {
        this.stopAfterNextScan = true;
      }
    } catch (error) {
      this.opts.logger.warn(
        { workflowKey: this.opts.workflowKey, err: error },
        "workflow watcher tick failed",
      );
    }
  }

  private stopPolling(reason: string): void {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.opts.logger.debug(
      { workflowKey: this.opts.workflowKey, boundDir: this.boundDir, reason },
      "workflow watcher polling stopped",
    );
  }

  private tryBind(): void {
    let candidate: { dir: string; createdAt: number } | null = null;
    for (const dir of this.listWorkflowDirs()) {
      if (this.opts.claimedDirs.has(dir) || this.rejectedDirs.has(dir)) {
        continue;
      }
      const info = this.readRunStateInfo(dir);
      if (info.exists) {
        // Run-state only exists once a run completed. Bind only on a positive
        // taskId match (a fast run that finished before our first poll).
        if (this.opts.taskId && info.taskId && info.taskId === this.opts.taskId) {
          this.bind(dir, true);
          return;
        }
        if ((this.opts.taskId && info.taskId) || this.preArmDirs.has(dir)) {
          // Provably another run's (taskId mismatch), or a completed dir that
          // predates us with nothing to confirm it — never bind it.
          this.rejectedDirs.add(dir);
          continue;
        }
        // Completed post-arm dir with no taskId to compare — plausible fast
        // run of ours; falls through as a heuristic candidate.
      } else if (this.preArmDirs.has(dir)) {
        // A live pre-arm dir qualifies only when created just before arm —
        // the engine can create wf_<runId>/ before task_started reaches the
        // provider. Older pre-arm dirs belong to earlier runs.
        const createdAt = this.dirCreatedAt(dir);
        if (createdAt === null || this.armedAt - createdAt > PRE_ARM_RECENCY_MS) {
          continue;
        }
      }
      const createdAt = this.dirCreatedAt(dir) ?? Number.MAX_SAFE_INTEGER;
      // Oldest-created unclaimed dir wins: concurrent watchers arm in run-start
      // order, so FIFO pairing minimizes cross-binding while no identity exists.
      if (!candidate || createdAt < candidate.createdAt) {
        candidate = { dir, createdAt };
      }
    }
    if (candidate) {
      this.bind(candidate.dir, false);
    }
  }

  /**
   * Bind purely on run-state identity, ignoring claims/rejections/recency:
   * the run-state `taskId` is authoritative, so a match beats any heuristic
   * state another watcher (or an earlier tick of this one) left behind. A
   * mis-bound sibling still holding the claim releases it on its own
   * mismatch tick; we are disarmed by then and only read.
   */
  private bindByRunStateIdentity(): void {
    if (!this.opts.taskId) {
      return;
    }
    for (const dir of this.listWorkflowDirs()) {
      const info = this.readRunStateInfo(dir);
      if (info.exists && info.taskId === this.opts.taskId) {
        this.bind(dir, true);
        return;
      }
    }
  }

  private bind(dir: string, confirmed: boolean): void {
    this.boundDir = dir;
    this.opts.claimedDirs.add(dir);
    this.journalTail = new JsonlTail(path.join(dir, "journal.jsonl"));
    if (confirmed) {
      this.identityConfirmed = true;
      this.runStateComplete = true;
    }
    this.opts.logger.debug(
      { workflowKey: this.opts.workflowKey, boundDir: dir, confirmed },
      "workflow watcher bound on-disk run dir",
    );
  }

  /**
   * Retroactive identity check on a heuristic bind: the run-state file appears
   * at completion carrying the run's `taskId`. A match (or nothing to compare)
   * confirms the bind; a mismatch means we tailed another run's dir — settle
   * what we announced, release the dir, and resume discovery.
   */
  private verifyBoundIdentity(): "ok" | "mismatch" {
    if (!this.boundDir || this.runStateComplete) {
      return "ok";
    }
    const info = this.readRunStateInfo(this.boundDir);
    if (!info.exists) {
      return "ok";
    }
    if (
      !this.identityConfirmed &&
      this.opts.taskId &&
      info.taskId &&
      info.taskId !== this.opts.taskId
    ) {
      this.handleMisbind(info.taskId);
      return "mismatch";
    }
    this.identityConfirmed = true;
    this.runStateComplete = true;
    return "ok";
  }

  private handleMisbind(diskTaskId: string): void {
    const dir = this.boundDir!;
    this.opts.logger.warn(
      {
        workflowKey: this.opts.workflowKey,
        boundDir: dir,
        expectedTaskId: this.opts.taskId,
        diskTaskId,
      },
      "workflow watcher bound the wrong run dir; releasing and rebinding",
    );
    for (const [agentId, state] of this.agents) {
      if (state.announced && !state.settled) {
        this.settleAgent(agentId, state, "closed");
      }
    }
    this.agents.clear();
    this.journalTail = null;
    this.opts.claimedDirs.delete(dir);
    this.rejectedDirs.add(dir);
    this.boundDir = null;
    this.bindDeadlineAt = Date.now() + BIND_DEADLINE_MS;
  }

  private scan(): void {
    if (!this.boundDir) {
      return;
    }
    this.scanJournal();
    this.scanAgentTranscripts();
  }

  private scanJournal(): void {
    if (!this.journalTail) {
      return;
    }
    for (const raw of this.journalTail.readNew()) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const entry = raw as { type?: unknown; agentId?: unknown };
      const agentId = typeof entry.agentId === "string" ? entry.agentId : undefined;
      if (!agentId) {
        continue;
      }
      if (entry.type === "result") {
        const state = this.ensureAgent(agentId);
        this.ensureAnnounced(agentId, state);
        this.settleAgent(agentId, state, "idle");
      }
    }
  }

  private scanAgentTranscripts(): void {
    if (!this.boundDir) {
      return;
    }
    let files: string[];
    try {
      files = fs.readdirSync(this.boundDir);
    } catch {
      return;
    }
    for (const file of files) {
      const match = /^agent-(.+)\.jsonl$/.exec(file);
      if (!match) {
        continue;
      }
      const agentId = match[1]!;
      const state = this.ensureAgent(agentId);
      const entries = state.tail.readNew();
      if (entries.length === 0) {
        continue;
      }
      const items = entries.flatMap((entry) => state.mapper.mapEntry(entry as never));
      if (items.length > 0) {
        this.ensureAnnounced(agentId, state, items);
        for (const item of items) {
          this.opts.emit({
            type: "observed_subagent_timeline",
            provider: "claude",
            key: state.key,
            item,
          });
        }
      }
      this.maybeEmitTokens(state);
    }
  }

  private ensureAgent(agentId: string): AgentState {
    const existing = this.agents.get(agentId);
    if (existing) {
      return existing;
    }
    const state: AgentState = {
      key: `${this.opts.workflowKey}::wfagent:${agentId}`,
      mapper: new WorkflowSubagentTranscriptMapper(),
      tail: new JsonlTail(path.join(this.boundDir!, `agent-${agentId}.jsonl`)),
      announced: false,
      settled: false,
      lastTokens: 0,
    };
    this.agents.set(agentId, state);
    return state;
  }

  /** Announce the child (running) with a good title source BEFORE its first timeline item. */
  private ensureAnnounced(
    agentId: string,
    state: AgentState,
    items?: readonly { type: string; text?: string }[],
  ): void {
    if (state.announced) {
      return;
    }
    state.announced = true;
    const agentType = this.readAgentType(agentId);
    const subAgentType = agentType && !GENERIC_AGENT_TYPES.has(agentType) ? agentType : undefined;
    const description = this.firstUserText(items) ?? (subAgentType ? undefined : agentType);
    this.opts.emit({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: state.key,
        parentKey: this.opts.workflowKey,
        status: "running",
        ...(subAgentType ? { subAgentType } : {}),
        ...(description ? { description } : {}),
      },
    });
    this.opts.logger.debug(
      { workflowKey: this.opts.workflowKey, childKey: state.key, subAgentType, agentId },
      "workflow child announced",
    );
  }

  private settleAgent(
    agentId: string,
    state: AgentState,
    status: "idle" | "error" | "closed",
  ): void {
    if (state.settled) {
      return;
    }
    state.settled = true;
    state.settledStatus = status;
    this.opts.emit({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: state.key,
        status,
        ...(status === "error" ? { requiresAttention: true } : {}),
        ...(state.lastTokens > 0 ? { cumulativeTokens: state.lastTokens } : {}),
      },
    });
    this.opts.logger.debug(
      { workflowKey: this.opts.workflowKey, childKey: state.key, status, agentId },
      "workflow child settled",
    );
  }

  private maybeEmitTokens(state: AgentState): void {
    const totals = state.mapper.usageTotals();
    const tokens = grandTotalTokens(totals);
    if (tokens <= state.lastTokens) {
      return;
    }
    state.lastTokens = tokens;
    // A settled child must not flip back to running when a late transcript
    // chunk raises its token total (the final chunk usually lands on the same
    // tick as the journal result) — re-assert the settled status instead.
    const status = state.settled ? (state.settledStatus ?? "idle") : "running";
    const model = state.mapper.model();
    this.opts.emit({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: state.key,
        status,
        ...(status === "error" ? { requiresAttention: true } : {}),
        // Full in/out/cache split (the real per-frame API numbers) priced on the
        // subagent's OWN model, alongside the grand-total scalar — so the ledger
        // costs this subagent on its own usage (not a roll-up) and the track
        // readout matches native agents.
        usage: toClaudeSubagentUsage(totals, model),
        usageRounds: state.mapper.roundCount(),
        ...(model ? { model } : {}),
        cumulativeTokens: tokens,
      },
    });
  }

  private firstUserText(items?: readonly { type: string; text?: string }[]): string | undefined {
    if (!items) {
      return undefined;
    }
    for (const item of items) {
      if (item.type === "user_message" && typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }
    }
    return undefined;
  }

  private readAgentType(agentId: string): string | undefined {
    if (!this.boundDir) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(path.join(this.boundDir, `agent-${agentId}.meta.json`), "utf8");
      const meta = JSON.parse(raw) as { agentType?: unknown };
      return typeof meta.agentType === "string" && meta.agentType.length > 0
        ? meta.agentType
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Backfill authoritative per-agent tokens + final state from the run-state file. */
  private reconcileFromRunState(): void {
    const runState = this.readRunState();
    if (!runState) {
      return;
    }
    const diskTaskId = typeof runState.taskId === "string" ? runState.taskId : undefined;
    if (
      !this.identityConfirmed &&
      this.opts.taskId &&
      diskTaskId &&
      diskTaskId !== this.opts.taskId
    ) {
      // Never backfill another run's agents onto this workflow's rows.
      this.opts.logger.warn(
        {
          workflowKey: this.opts.workflowKey,
          boundDir: this.boundDir,
          expectedTaskId: this.opts.taskId,
          diskTaskId,
        },
        "workflow run-state taskId mismatch at disarm; skipping reconcile",
      );
      return;
    }
    const progress = Array.isArray(runState.workflowProgress) ? runState.workflowProgress : [];
    for (const raw of progress) {
      this.reconcileRunStateEntry(raw);
    }
  }

  /** Announce + settle one `workflow_agent` progress entry from the run-state file. */
  private reconcileRunStateEntry(raw: unknown): void {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const entry = raw as {
      type?: unknown;
      agentId?: unknown;
      tokens?: unknown;
      state?: unknown;
      label?: unknown;
    };
    if (entry.type !== "workflow_agent" || typeof entry.agentId !== "string") {
      return;
    }
    const state = this.ensureAgent(entry.agentId);
    // Announce anything the live tail never saw, using the (now-available) label.
    if (!state.announced) {
      state.announced = true;
      const label = typeof entry.label === "string" ? entry.label : undefined;
      this.opts.emit({
        type: "observed_subagent_updated",
        provider: "claude",
        update: {
          key: state.key,
          parentKey: this.opts.workflowKey,
          status: "running",
          ...(label ? { description: label } : {}),
        },
      });
    }
    const tokens =
      typeof entry.tokens === "number" && Number.isFinite(entry.tokens) ? entry.tokens : undefined;
    const failed = entry.state === "error" || entry.state === "failed";
    state.settled = true;
    this.opts.emit({
      type: "observed_subagent_updated",
      provider: "claude",
      update: {
        key: state.key,
        status: failed ? "error" : "idle",
        ...(failed ? { requiresAttention: true } : {}),
        ...(tokens !== undefined ? { cumulativeTokens: tokens } : {}),
      },
    });
  }

  private dirCreatedAt(dir: string): number | null {
    try {
      const stat = fs.statSync(dir);
      const birth = stat.birthtimeMs;
      if (Number.isFinite(birth) && birth > 0) {
        return birth;
      }
      return stat.mtimeMs;
    } catch {
      return null;
    }
  }

  // <projectDir>/<sessionId>/workflows/<wf_runId>.json — sibling of subagents/.
  private runStatePathFor(dir: string): string | null {
    if (!this.baseDir) {
      return null;
    }
    const sessionDir = path.dirname(path.dirname(this.baseDir));
    return path.join(sessionDir, "workflows", `${path.basename(dir)}.json`);
  }

  /** Existence + taskId of a dir's run-state file (written at run completion). */
  private readRunStateInfo(dir: string): RunStateInfo {
    const runStatePath = this.runStatePathFor(dir);
    if (!runStatePath) {
      return { exists: false };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(runStatePath, "utf8");
    } catch {
      return { exists: false };
    }
    try {
      const parsed = JSON.parse(raw) as { taskId?: unknown };
      return {
        exists: true,
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
      };
    } catch {
      // Partially written — treat as absent and retry on the next tick.
      return { exists: false };
    }
  }

  private readRunState(): { workflowProgress?: unknown; taskId?: unknown } | null {
    if (!this.boundDir) {
      return null;
    }
    const runStatePath = this.runStatePathFor(this.boundDir);
    if (!runStatePath) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(runStatePath, "utf8")) as {
        workflowProgress?: unknown;
        taskId?: unknown;
      };
    } catch {
      return null;
    }
  }
}
