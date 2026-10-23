import * as archive from "../ops/archive.js";
import { TOOL_CASES } from "./tasks.js";
import { scorePythonVerification, verifyPython, verifyToolCall } from "./verify.js";
import type { VerifyPythonOptions } from "./verify.js";
import { ChatResponseSchema } from "./chat.js";
import { z } from "zod/v3";

import type { TranscriptEntry } from "../ops/archive.js";

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
const ArchivedRequestSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.string().optional(), content: z.unknown() }).passthrough())
      .optional(),
  })
  .passthrough();

export interface RescoreOptions extends VerifyPythonOptions {
  env?: NodeJS.ProcessEnv;
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
  const parsed = ArchivedRequestSchema.safeParse(request);
  const messages = parsed.success ? (parsed.data.messages ?? []) : [];
  const user = messages.find((m) => m.role === "user");
  return typeof user?.content === "string" ? user.content : "";
}

async function rescoreLongHorizon(
  exchanges: TranscriptEntry[],
  options: RescoreOptions,
): Promise<RescoreOutcome> {
  const last = exchanges[exchanges.length - 1];
  const parsed = ChatResponseSchema.safeParse(last?.response);
  const choice = parsed.success ? (parsed.data.choices?.[0] ?? {}) : {};
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
    ...options,
  });

  const score = scorePythonVerification(
    verification,
    options.execute !== false,
    LONG_HORIZON_FILES.length,
  );

  const bits = [
    `${LONG_HORIZON_FILES.length - verification.filesMissing.length}/${LONG_HORIZON_FILES.length} files`,
    verification.compiled ? "compiles" : "syntax errors",
  ];
  if (verification.testsRun)
    bits.push(`${verification.testsPassed}/${verification.testsTotal} tests pass`);
  else if (options.execute === false) bits.push("tests not executed");
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
    const parsed = ChatResponseSchema.safeParse(exchange.response);
    const message = parsed.success ? (parsed.data.choices?.[0]?.message ?? {}) : {};
    const verdict = verifyToolCall(message.tool_calls, testCase.expect);
    outcomes.push({ id: testCase.id, ok: verdict.ok, reason: verdict.reason || null });
  }
  if (!outcomes.length) return { score: null, summary: "no matching cases in archive" };
  const passed = outcomes.filter((o) => o.ok).length;
  const failed = outcomes
    .filter((o) => !o.ok)
    .map((o) => `${o.id.replace(/^tools\//, "")} (${o.reason ?? "failed"})`);
  return {
    score: passed / outcomes.length,
    summary:
      `${passed}/${outcomes.length} tool calls correct` +
      (failed.length ? ` - missed: ${failed.join("; ")}` : ""),
    detail: outcomes,
  };
}

/**
 * @returns {{archiveId:string, tasks:Array, changed:Array}}
 */
export async function rescoreRun(
  archiveId: string,
  options: RescoreOptions = {},
): Promise<RescoreRunResult> {
  options.signal?.throwIfAborted();
  const byTask = archive.load(archiveId, options.env);
  const tasks: RescoreTaskResult[] = [];

  for (const [taskId, exchanges] of Object.entries(byTask)) {
    options.signal?.throwIfAborted();
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
      tasks.push({ taskId, ...(await rescoreLongHorizon(exchanges, options)) });
    } else if (taskId === "tool-calling") {
      tasks.push({ taskId, ...rescoreToolCalling(exchanges) });
    }
  }

  return { archiveId, tasks };
}

/** Re-score every archived run and report where the new scorer disagrees. */
export async function rescoreAll({
  onProgress = () => {},
  ...options
}: RescoreOptions & { onProgress?: (event: RescoreProgress) => void } = {}): Promise<
  RescoreRunResult[]
> {
  options.signal?.throwIfAborted();
  const runs = archive.list(options.env);
  const results: RescoreRunResult[] = [];
  for (const id of runs) {
    options.signal?.throwIfAborted();
    onProgress({ phase: "start", archiveId: id });
    const result = await rescoreRun(id, options);
    results.push(result);
    onProgress({ phase: "done", ...result });
  }
  return results;
}

export { RESCORABLE };
