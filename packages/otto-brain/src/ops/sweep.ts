import { setTimeout as delay } from "node:timers/promises";
import { requestChat } from "../bench/chat.js";
import type { ModelOperationProcess, OperationSupervisor } from "./process.js";

import type { Profile } from "../config/schema.js";

/**
 * Find the reasoning budget that delivers the most useful output for a model.
 *
 * Thinking models default to an unrestricted budget (-1) and will happily burn
 * an entire token allowance reasoning, returning no content at all. The right
 * cap is model-specific, so measure it: run one long-horizon task per candidate
 * budget and take the largest budget that still delivers the whole task. See
 * rankSweepResults for why "largest" and not "fastest".
 */

/**
 * The candidates a sweep tries, in ascending order of thinking room.
 *
 * Capped at 1536 deliberately. The ranking prefers the largest budget that
 * still delivers, so whatever sits at the top of this list is what a healthy
 * thinking model gets recommended - the list itself is the ceiling, and 1536 is
 * the value every hand-set profile has run on without trouble. Each extra
 * candidate also costs a full model load plus a long generation, so the ladder
 * earns its length. `-1` stays because a model that fails under every finite cap
 * still needs an answer; it ranks last and wins only in that case.
 */
export const DEFAULT_BUDGETS = [0, 512, 1536, -1];

/** llama.cpp's "no cap at all" sentinel, which a sweep must never recommend. */
const UNRESTRICTED_BUDGET = -1;

export const LONG_TASK =
  "Write a complete Python implementation of a thread-safe LRU cache with TTL " +
  "expiry. Produce FOUR separate complete files, each fully implemented with no " +
  "placeholders or elisions:\n" +
  "1. lru.py - the cache with get/put/delete/clear, OrderedDict-based, RLock, " +
  "per-entry TTL, and a background sweeper thread\n" +
  "2. metrics.py - hit/miss/eviction counters with a snapshot() method\n" +
  "3. test_lru.py - at least 12 unittest cases covering eviction order, TTL " +
  "expiry, concurrent access, and edge cases\n" +
  "4. README.md - full usage documentation with examples\n" +
  "Write every file out in full. Do not abbreviate anything.";

export const EXPECTED_FILES = ["lru.py", "metrics.py", "test_lru.py", "README.md"];

/** The measured outcome of a single generation trial. */
export interface Trial {
  finishReason: string | null;
  outputTokens: number | null;
  contentChars: number;
  reasoningChars: number;
  filesDelivered: number;
  elapsedSeconds: number;
  tokensPerSecond: number | null;
  contentPerSecond: number;
}

interface RunTrialOptions {
  supervisor: Pick<OperationSupervisor, "host" | "internalPort">;
  signal?: AbortSignal;
  maxTokens: number;
  temperature: number;
}

export async function runTrial({
  supervisor,
  maxTokens,
  temperature,
  signal,
}: RunTrialOptions): Promise<Trial> {
  const started = Date.now();
  const result = await requestChat({
    host: supervisor.host,
    port: supervisor.internalPort,
    signal,
    payload: {
      messages: [{ role: "user", content: LONG_TASK }],
      max_tokens: maxTokens,
      temperature,
      top_k: 20,
      top_p: 0.95,
    },
  });

  const elapsedSeconds = (Date.now() - started) / 1000;
  const choice = result.choices?.[0];
  const message = choice?.message;
  const content = message?.content || "";
  const reasoning = message?.reasoning_content || "";

  return {
    finishReason: choice?.finish_reason ?? null,
    outputTokens: result.usage?.completion_tokens ?? null,
    contentChars: content.length,
    reasoningChars: reasoning.length,
    filesDelivered: EXPECTED_FILES.filter((name) => content.includes(name)).length,
    elapsedSeconds,
    tokensPerSecond: result.timings?.predicted_per_second ?? null,
    // The metric that matters: useful output per unit of wall time.
    contentPerSecond: elapsedSeconds > 0 ? content.length / elapsedSeconds : 0,
  };
}

/** Progress event emitted while sweeping reasoning budgets. */
export interface SweepProgress {
  phase: "loading" | "generating" | "done" | "failed";
  budget: number;
  error?: string;
  finishReason?: string | null;
  outputTokens?: number | null;
  contentChars?: number;
  reasoningChars?: number;
  filesDelivered?: number;
  elapsedSeconds?: number;
  tokensPerSecond?: number | null;
  contentPerSecond?: number;
}

/** A single budget's trial, plus its error (null on success). */
export interface SweepResult {
  budget: number;
  error: string | null;
  finishReason?: string | null;
  outputTokens?: number | null;
  contentChars: number;
  reasoningChars?: number;
  filesDelivered: number;
  elapsedSeconds?: number;
  tokensPerSecond?: number | null;
  contentPerSecond: number;
}

export interface SweepReport {
  results: SweepResult[];
  recommended: number | null;
  ranked: SweepResult[];
  sweptAt: string;
}

export interface SweepOptions {
  process: ModelOperationProcess;
  profile: Profile;
  budgets?: number[];
  maxTokens?: number;
  temperature?: number;
  releaseDelayMs?: number;
  signal?: AbortSignal;
  onProgress?(event: SweepProgress): void;
}

export async function sweep({
  process: lease,
  profile,
  budgets = DEFAULT_BUDGETS,
  maxTokens = 8192,
  temperature = 0.7,
  releaseDelayMs = 2500,
  signal,
  onProgress = () => {},
}: SweepOptions): Promise<SweepReport> {
  signal?.throwIfAborted();
  if (
    !budgets.length ||
    budgets.length > 64 ||
    budgets.some((value) => !Number.isSafeInteger(value) || value < -1)
  )
    throw new Error("Sweep budgets must contain 1 to 64 integer values of -1 or greater");
  const results: SweepResult[] = [];
  for (const budget of budgets) {
    signal?.throwIfAborted();
    onProgress({ phase: "loading", budget });
    try {
      await lease.start({ ...profile, reasoningBudget: budget });
      signal?.throwIfAborted();
      onProgress({ phase: "generating", budget });
      const trial = await runTrial({
        supervisor: lease.supervisor,
        maxTokens,
        temperature,
        signal,
      });
      results.push({ budget, ...trial, error: null });
      onProgress({ phase: "done", budget, ...trial });
    } catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        budget,
        error: message,
        contentChars: 0,
        contentPerSecond: 0,
        filesDelivered: 0,
      });
      onProgress({ phase: "failed", budget, error: message });
    } finally {
      await lease.stop();
      if (releaseDelayMs > 0 && !signal?.aborted)
        await delay(releaseDelayMs, undefined, { signal });
    }
  }
  const ranked = rankSweepResults(results);
  return {
    results,
    ranked,
    recommended: ranked.length ? ranked[0].budget : null,
    sweptAt: new Date().toISOString(),
  };
}

/**
 * Rank a sweep's trials, best first. `ranked[0].budget` is the recommendation.
 *
 * Delivery decides first: a budget that dropped a file did not do the job.
 * Among the budgets that delivered everything, prefer the **largest** - the most
 * thinking room a model can have without failing to deliver.
 *
 * That tie used to break on content per second, which was backwards. LONG_TASK
 * is pure output, so reasoning earns nothing on it and only costs wall clock:
 * every budget large enough to finish delivered all four files, the tie-break
 * therefore decided every sweep, and the smallest candidate won by construction
 * - 0 included. That is how models ended up capped at 0 and 512, tight enough
 * that llama-server guillotines an ordinary thought mid-sentence, injects
 * `--reasoning-budget-message`, and the model's unfinished reasoning carries on
 * over the content channel as user-visible prose. The sweep's job is to find the
 * cap past which a model degenerates into reasoning forever, not the cap that
 * types fastest. See the "reasoning budget makes thinking bleed into prose"
 * finding in Otto Knowledge.
 *
 * `-1` is the one budget "largest" must not read as large: an unrestricted
 * budget is the failure this package exists to prevent. It ranks below every
 * finite cap and is recommended only when nothing else survived, which means a
 * cap of any size broke the model.
 */
export function rankSweepResults(results: readonly SweepResult[]): SweepResult[] {
  const viable = results.filter((result) => !result.error && result.contentChars > 0);
  return [...viable].sort((a, b) => {
    if (b.filesDelivered !== a.filesDelivered) {
      return b.filesDelivered - a.filesDelivered;
    }
    const rankA = budgetRank(a.budget);
    const rankB = budgetRank(b.budget);
    if (rankA === rankB) {
      return 0;
    }
    // Compared rather than subtracted: the sentinel's rank is -Infinity, and
    // -Infinity - -Infinity is NaN, which would corrupt the whole sort.
    return rankB > rankA ? 1 : -1;
  });
}

function budgetRank(budget: number): number {
  return budget === UNRESTRICTED_BUDGET ? Number.NEGATIVE_INFINITY : budget;
}
