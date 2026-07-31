import http from "node:http";

import { TASKS } from "./tasks.js";
import { findPython } from "./verify.js";
import * as archive from "../ops/archive.js";

import type { Task, ChatFn, ChatPayload, ChatResponse } from "./tasks.js";
import type { Profile } from "../config/schema.js";

/**
 * Fast, locally-verifiable agentic-coding suite.
 *
 * This is deliberately NOT a replacement for SWE-bench or Aider Polyglot -
 * those run hundreds of multi-turn exercises and take hours per model. This is
 * the triage stage: a few minutes per model, enough to rank a shelf of quant
 * variants and to catch the system-level failures (reasoning runaway, VRAM
 * spill, throughput collapse at depth) that model-level leaderboards never
 * measure because they do not know your hardware.
 *
 * Use it to pick finalists, then run a full public benchmark on those.
 */

export const DEFAULT_DEPTHS = [1000, 16000, 64000];

interface ChatRequestArgs {
  host: string;
  port: number;
  payload: ChatPayload;
  timeoutMs: number;
}

function chatRequest({ host, port, payload, timeoutMs }: ChatRequestArgs): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host,
        port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`endpoint returned ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as ChatResponse);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`request exceeded ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** A progress event emitted as the suite runs. */
export interface ProgressEvent {
  phase: "start" | "done" | "failed";
  task?: string;
  title?: string;
  id?: string;
  category?: string;
  weight?: number;
  description?: string;
  score?: number;
  summary?: string;
  detail?: unknown;
  seconds?: number;
  error?: string | null;
}

/** Options for {@link runSuite}. */
export interface RunSuiteOptions {
  host?: string;
  port?: number;
  execute?: boolean;
  depths?: number[];
  only?: string[] | null;
  concurrency?: number;
  /**
   * The resident model's reasoning-token budget, forwarded to tasks that must
   * size their response cap above it (the concurrency throughput task).
   */
  reasoningBudget?: number | null;
  /** The resident model's loaded context window, for context-utilization reporting. */
  contextWindow?: number | null;
  timeoutMs?: number;
  archiveId?: string | null;
  onProgress?: (event: ProgressEvent) => void;
  /**
   * Task list override. Defaults to the static {@link TASKS}. Repo-backed
   * SWE-bench tasks are opt-in and passed here so the static suite never
   * requires a repo checkout to run.
   */
  tasks?: Task[] | null;
}

/** The scored result of one task within a suite run. */
export interface SuiteTaskResult {
  id: string;
  category: string;
  weight: number;
  description?: string;
  score: number;
  summary: string;
  detail?: unknown;
  seconds: number;
  error: string | null;
}

/** The full scorecard produced by a suite run. */
export interface SuiteReport {
  overall: number;
  grade: string;
  results: SuiteTaskResult[];
  seconds: number;
  executedCode: boolean;
  pythonVersion: string | null;
  archiveId: string | null;
  ranAt: string;
}

/**
 * Run the suite against an already-serving endpoint.
 *
 * @param {object} options
 * @param {string} options.host        endpoint host
 * @param {number} options.port        endpoint port
 * @param {boolean} options.execute    actually run generated tests
 * @param {number[]} options.depths    prompt depths for the scaling task
 * @param {string[]} options.only      task ids to run (default: all)
 */
export async function runSuite({
  host = "127.0.0.1",
  port = 1234,
  execute = true,
  depths = DEFAULT_DEPTHS,
  only = null,
  concurrency = 3,
  reasoningBudget = null,
  contextWindow = null,
  timeoutMs = 900_000,
  archiveId = null,
  onProgress = () => {},
  tasks = null,
}: RunSuiteOptions = {}): Promise<SuiteReport> {
  const python = findPython();

  const pool: Task[] = tasks && tasks.length ? tasks : TASKS;
  const selected: Task[] = only && only.length ? pool.filter((t) => only.includes(t.id)) : pool;

  const results: SuiteTaskResult[] = [];
  const startedAll = Date.now();

  for (const task of selected) {
    onProgress({ phase: "start", task: task.id, title: task.category });
    const started = Date.now();

    // Archive every exchange for this task, so a future scorer can re-grade it
    // without re-running the model.
    let exchange = 0;
    const chat: ChatFn = async (payload) => {
      const response = await chatRequest({ host, port, payload, timeoutMs });
      if (archiveId) {
        try {
          archive.put(archiveId, task.id, {
            label: `exchange-${(exchange += 1)}`,
            request: payload,
            response,
          });
        } catch {
          /* archiving must never fail a benchmark run */
        }
      }
      return response;
    };

    try {
      const outcome = await task.run({
        chat,
        execute: execute && Boolean(python),
        depths,
        concurrency,
        reasoningBudget,
        contextWindow,
      });
      const entry: SuiteTaskResult = {
        id: task.id,
        category: task.category,
        weight: task.weight,
        description: task.description,
        score: Math.max(0, Math.min(1, outcome.score)),
        summary: outcome.summary,
        detail: outcome.detail,
        seconds: (Date.now() - started) / 1000,
        error: null,
      };
      results.push(entry);
      // `title` is what the progress UI renders; entry carries `category`, not
      // `title`, so pass it explicitly or the label shows "undefined".
      onProgress({ phase: "done", title: task.category, ...entry });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: SuiteTaskResult = {
        id: task.id,
        category: task.category,
        weight: task.weight,
        score: 0,
        summary: `failed: ${message}`,
        seconds: (Date.now() - started) / 1000,
        error: message,
      };
      results.push(entry);
      onProgress({ phase: "failed", title: task.category, ...entry });
    }
  }

  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  const overall = totalWeight
    ? results.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight
    : 0;

  return {
    overall,
    grade: grade(overall),
    results,
    seconds: (Date.now() - startedAll) / 1000,
    executedCode: execute && Boolean(python),
    pythonVersion: python ? python.version : null,
    archiveId,
    ranAt: new Date().toISOString(),
  };
}

export function grade(score: number): string {
  if (score >= 0.9) return "excellent";
  if (score >= 0.75) return "strong";
  if (score >= 0.55) return "usable";
  if (score >= 0.35) return "weak";
  return "unusable";
}

/** One row of the depth-scaling detail, surfaced in the scorecard. */
interface DepthReportPoint {
  promptTokens?: number | null;
  ttftSeconds?: number | null;
  promptPerSecond?: number | null;
  generatePerSecond?: number | null;
}

/** Render a scorecard for one model. */
export function formatReport(
  report: SuiteReport,
  { modelName = "model", profile = null }: { modelName?: string; profile?: Profile | null } = {},
): string {
  const lines: string[] = [];
  const bar = (score: number): string => {
    const cells = 20;
    const filled = Math.round(score * cells);
    return "█".repeat(filled) + "░".repeat(cells - filled);
  };

  lines.push("");
  lines.push(`  Agentic coding scorecard - ${modelName}`);
  if (profile) {
    lines.push(
      `  context ${profile.contextSize.toLocaleString()}  kv ${profile.cacheTypeK}/${profile.cacheTypeV}  ` +
        `reasoning budget ${profile.reasoningBudget}${profile.vision ? "  vision on" : ""}`,
    );
  }
  lines.push(`  ${"-".repeat(72)}`);

  for (const r of report.results) {
    lines.push(
      `  ${r.category.padEnd(18)} ${bar(r.score)} ${(r.score * 100).toFixed(0).padStart(3)}%  ${r.summary}`,
    );
  }

  lines.push(`  ${"-".repeat(72)}`);
  lines.push(
    `  ${"OVERALL".padEnd(18)} ${bar(report.overall)} ${(report.overall * 100).toFixed(0).padStart(3)}%  ${report.grade}`,
  );
  lines.push("");
  lines.push(
    `  ran in ${report.seconds.toFixed(0)}s` +
      (report.executedCode
        ? `, generated tests executed with ${report.pythonVersion}`
        : ", code not executed"),
  );

  // Surface depth numbers, which are the most system-specific result here.
  const depth = report.results.find((r) => r.id === "context-depth");
  if (depth && Array.isArray(depth.detail)) {
    lines.push("");
    lines.push(
      `  ${"prompt tokens".padStart(14)} ${"TTFT".padStart(8)} ${"prompt tok/s".padStart(13)} ${"gen tok/s".padStart(10)}`,
    );
    for (const p of depth.detail as DepthReportPoint[]) {
      lines.push(
        `  ${String(p.promptTokens ?? "?").padStart(14)} ${((p.ttftSeconds ?? 0).toFixed(2) + "s").padStart(8)} ` +
          `${(p.promptPerSecond ?? 0).toFixed(0).padStart(13)} ${(p.generatePerSecond ?? 0).toFixed(1).padStart(10)}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** One completed report paired with its model name, for comparison. */
export interface ComparisonEntry {
  modelName: string;
  report: SuiteReport;
}

/** Compare several completed reports. */
export function formatComparison(entries: ComparisonEntry[]): string {
  const lines: string[] = [];
  const categories = entries[0]?.report.results.map((r) => r.category) || [];

  lines.push("");
  lines.push(
    `  ${"model".padEnd(42)}${categories.map((c) => c.slice(0, 9).padStart(10)).join("")}${"OVERALL".padStart(10)}`,
  );
  lines.push(`  ${"-".repeat(42 + categories.length * 10 + 10)}`);

  const ranked = [...entries].sort((a, b) => b.report.overall - a.report.overall);
  for (const { modelName, report } of ranked) {
    const cells = report.results.map((r) => `${(r.score * 100).toFixed(0)}%`.padStart(10)).join("");
    lines.push(
      `  ${modelName.slice(0, 41).padEnd(42)}${cells}${`${(report.overall * 100).toFixed(0)}%`.padStart(10)}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
