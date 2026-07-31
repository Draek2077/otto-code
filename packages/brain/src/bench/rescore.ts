import * as archive from "../ops/archive.js";
import { TOOL_CASES } from "./tasks.js";
import { verifyPython, verifyToolCall } from "./verify.js";

import type { TranscriptEntry } from "../ops/archive.js";
import type { ChatResponse } from "./tasks.js";

/**
 * Re-grade archived runs with the current scorer.
 *
 * Only tasks whose score is a pure function of the stored exchange can be
 * replayed. Timing-based tasks (depth scaling) cannot - their result depends on
 * the hardware state at the time - and are reported as not re-scorable rather
 * than silently reused or zeroed.
 */

const RESCORABLE = new Set(["long-horizon", "tool-calling"]);

const LONG_HORIZON_FILES = ["lru.py", "metrics.py", "test_lru.py"];

/** The shape of an archived request we read the first user message out of. */
interface ArchivedRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** Outcome of re-scoring one task from its transcript. */
interface RescoreOutcome {
  score: number | null;
  summary: string;
  detail?: unknown;
}

/** A re-scored task entry within a run. */
export interface RescoreTaskResult {
  taskId: string;
  score: number | null;
  summary: string;
  detail?: unknown;
  skipped?: boolean;
}

/** The re-scored result of one archived run. */
export interface RescoreRunResult {
  archiveId: string;
  tasks: RescoreTaskResult[];
}

/** Progress event emitted while re-scoring. */
export interface RescoreProgress {
  phase: "start" | "done";
  archiveId?: string;
  tasks?: RescoreTaskResult[];
}

function firstUserContent(request: unknown): string {
  const messages = (request as ArchivedRequest | null)?.messages || [];
  const user = messages.find((m) => m.role === "user");
  return typeof user?.content === "string" ? user.content : "";
}

async function rescoreLongHorizon(
  exchanges: TranscriptEntry[],
  { execute }: { execute: boolean },
): Promise<RescoreOutcome> {
  const last = exchanges[exchanges.length - 1];
  const choice = (last?.response as ChatResponse | undefined)?.choices?.[0] || {};
  const content = choice.message?.content || "";
  const reasoning = choice.message?.reasoning_content || "";

  if (!content) {
    return {
      score: 0,
      summary: reasoning ? `no content - all tokens went to reasoning` : "empty response",
    };
  }

  const verification = await verifyPython(content, {
    expectedFiles: LONG_HORIZON_FILES,
    execute,
  });

  const fileScore =
    (LONG_HORIZON_FILES.length - verification.filesMissing.length) / LONG_HORIZON_FILES.length;
  const compileScore = verification.compiled ? 1 : 0;
  let testScore: number | null = 0;
  if (verification.testsRun && verification.testsTotal) {
    testScore = (verification.testsPassed ?? 0) / verification.testsTotal;
  } else if (!execute && verification.compiled) {
    testScore = null;
  }

  const parts = [fileScore * 0.3, compileScore * 0.3];
  let weight = 0.6;
  if (testScore !== null) {
    parts.push(testScore * 0.4);
    weight = 1.0;
  }
  const penalty = Math.min(0.2, verification.placeholders * 0.1);
  const score = Math.max(0, parts.reduce((a, b) => a + b, 0) / weight - penalty);

  const bits = [
    `${LONG_HORIZON_FILES.length - verification.filesMissing.length}/${LONG_HORIZON_FILES.length} files`,
    verification.compiled ? "compiles" : "syntax errors",
  ];
  if (verification.testsRun)
    bits.push(`${verification.testsPassed}/${verification.testsTotal} tests pass`);
  else if (!execute) bits.push("tests not executed");
  if (verification.nameCollisions?.length)
    bits.push(`${verification.nameCollisions.length} name collisions`);

  return { score, summary: bits.join(", ") };
}

function rescoreToolCalling(exchanges: TranscriptEntry[]): RescoreOutcome {
  const outcomes = [];
  for (const exchange of exchanges) {
    const prompt = firstUserContent(exchange.request);
    // Match the archived exchange back to its case by prompt text, so a
    // reordering of TOOL_CASES cannot silently mis-grade history.
    const testCase = TOOL_CASES.find((c) => c.prompt === prompt);
    if (!testCase) continue;
    const message = (exchange.response as ChatResponse | undefined)?.choices?.[0]?.message || {};
    const verdict = verifyToolCall(message.tool_calls, testCase.expect);
    outcomes.push({ id: testCase.id, ok: verdict.ok, reason: verdict.reason || null });
  }
  if (!outcomes.length) return { score: null, summary: "no matching cases in archive" };
  const passed = outcomes.filter((o) => o.ok).length;
  return {
    score: passed / outcomes.length,
    summary: `${passed}/${outcomes.length} tool calls correct`,
    detail: outcomes,
  };
}

/**
 * @returns {{archiveId:string, tasks:Array, changed:Array}}
 */
export async function rescoreRun(
  archiveId: string,
  { execute = true }: { execute?: boolean } = {},
): Promise<RescoreRunResult> {
  const byTask = archive.load(archiveId);
  const tasks: RescoreTaskResult[] = [];

  for (const [taskId, exchanges] of Object.entries(byTask)) {
    if (!RESCORABLE.has(taskId)) {
      tasks.push({
        taskId,
        score: null,
        summary: "not re-scorable from a transcript",
        skipped: true,
      });
      continue;
    }
    if (taskId === "long-horizon") {
      tasks.push({ taskId, ...(await rescoreLongHorizon(exchanges, { execute })) });
    } else if (taskId === "tool-calling") {
      tasks.push({ taskId, ...rescoreToolCalling(exchanges) });
    }
  }

  return { archiveId, tasks };
}

/** Re-score every archived run and report where the new scorer disagrees. */
export async function rescoreAll({
  execute = true,
  onProgress = () => {},
}: { execute?: boolean; onProgress?: (event: RescoreProgress) => void } = {}): Promise<
  RescoreRunResult[]
> {
  const runs = archive.list();
  const results: RescoreRunResult[] = [];
  for (const id of runs) {
    onProgress({ phase: "start", archiveId: id });
    const result = await rescoreRun(id, { execute });
    results.push(result);
    onProgress({ phase: "done", ...result });
  }
  return results;
}

export { RESCORABLE };
