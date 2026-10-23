/** Repository work is explicit and confined to a disposable Brain-owned checkout. */
import { z } from "zod/v3";
import { loadRepoTasks, type LoadedRepoTasks } from "../bench/repo-task.js";
import { runSuite, type RunSuiteOptions, type SuiteReport } from "../bench/index.js";
import { completeOwnedOperation } from "./owned-operation.js";
import type { BenchmarkOptions } from "./benchmark-options.js";

export interface BenchmarkRunPorts {
  env: NodeJS.ProcessEnv;
  loadRepoTasks?: typeof loadRepoTasks;
  runSuite?: typeof runSuite;
}
export async function runOwnedBenchmark(
  options: BenchmarkOptions,
  connection: RunSuiteOptions,
  ports: BenchmarkRunPorts,
): Promise<SuiteReport> {
  let loaded: LoadedRepoTasks | null = null;
  return completeOwnedOperation(
    async () => {
      if (options.repository) {
        const repository = options.repository;
        loaded = await (ports.loadRepoTasks ?? loadRepoTasks)({
          dir: repository.directory,
          workspace: repository.workspace,
          workspaceDir: repository.workspaceDirectory,
          ref: repository.ref,
          maxTasks: repository.maxTasks,
          env: ports.env,
          signal: connection.signal,
        });
        if (!loaded.tasks.length) throw new Error("No mineable repository tasks were found");
      }
      return (ports.runSuite ?? runSuite)({
        ...connection,
        env: ports.env,
        execute: options.execute,
        depths: options.depths,
        only: options.only,
        concurrency: options.concurrency,
        tasks: loaded?.tasks,
      });
    },
    async () => {
      loaded?.dispose();
    },
  );
}
const DepthSchema = z.object({
  promptTokens: z.number().finite().nullable(),
  ttftSeconds: z.number().finite().nullable(),
  promptPerSecond: z.number().finite().nullable(),
  generatePerSecond: z.number().finite().nullable(),
});
export const BenchmarkReportSchema = z.object({
  overall: z.number().min(0).max(1),
  grade: z.string().max(128),
  seconds: z.number().nonnegative(),
  executedCode: z.boolean(),
  pythonVersion: z.string().max(256).nullable(),
  archiveId: z.string().max(256).nullable(),
  ranAt: z.string().max(128),
  results: z
    .array(
      z.object({
        id: z.string().max(128),
        category: z.string().max(128),
        weight: z.number().finite(),
        score: z.number().min(0).max(1),
        summary: z.string().max(1024),
        seconds: z.number().nonnegative(),
        error: z.string().nullable(),
        detail: z.array(DepthSchema).max(16).nullable(),
      }),
    )
    .max(128),
});
function depthPoint(value: unknown) {
  const point = DepthSchema.partial().parse(value);
  return {
    promptTokens: point.promptTokens ?? null,
    ttftSeconds: point.ttftSeconds ?? null,
    promptPerSecond: point.promptPerSecond ?? null,
    generatePerSecond: point.generatePerSecond ?? null,
  };
}
/** Full task details stay in the owner's archive, not in bounded job snapshots. */
export function publicBenchmarkReport(report: SuiteReport) {
  return BenchmarkReportSchema.parse({
    ...report,
    results: report.results.map((row) => ({
      id: row.id,
      category: row.category,
      weight: row.weight,
      score: row.score,
      seconds: row.seconds,
      summary: row.error ? "Brain benchmark task failed" : row.summary.slice(0, 1024),
      error: row.error ? "Brain benchmark task failed" : null,
      detail:
        row.id === "context-depth" && Array.isArray(row.detail) ? row.detail.map(depthPoint) : null,
    })),
  });
}
