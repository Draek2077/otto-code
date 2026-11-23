/** Local models benchmark through the shared host pool; external endpoints stay explicit. */
import path from "node:path";
import { z } from "zod/v3";
import { loadBrainConfig } from "../config/store.js";
import { formatReport, formatComparison } from "../bench/index.js";
import { findCuratedRepo, describeCuratedRepos } from "../bench/curated-repos.js";
import {
  BenchmarkOptionsSchema,
  parseBenchmarkEndpoint,
  type BenchmarkOptions,
} from "../service/benchmark-options.js";
import {
  BenchmarkReportSchema,
  publicBenchmarkReport,
  runOwnedBenchmark,
  EndpointBenchmarkResultSchema,
} from "../service/benchmark-run.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import {
  withCommandHost,
  withCommandSignal,
  waitForCommandJob,
  type HostCommandPort,
} from "./host-command.js";
import { runHostedModelJob } from "./model-job.js";
import { selectedBrainCommandHost } from "./target.js";
export { parseBenchmarkEndpoint } from "../service/benchmark-options.js";

export interface BenchOptions {
  model?: string;
  endpoint?: string;
  only?: string;
  depths?: string;
  concurrency?: string;
  execute?: boolean;
  port?: string;
  repoDir?: string;
  repoWorkspace?: string;
  repoWorkspaceDir?: string;
  repoRef?: string;
  repoMax?: string;
  curated?: string;
}
const ProfileSchema = z.object({
  contextSize: z.number(),
  cacheTypeK: z.string(),
  cacheTypeV: z.string(),
  reasoningBudget: z.number(),
  vision: z.boolean(),
});
const ResultSchema = z.object({ report: BenchmarkReportSchema, profile: ProfileSchema });
export interface BenchEntry {
  modelName: string;
  report: z.infer<typeof BenchmarkReportSchema>;
  profile: z.infer<typeof ProfileSchema> | null;
}
function render(entries: BenchEntry | BenchEntry[]) {
  const rows = Array.isArray(entries) ? entries : [entries];
  return (
    rows
      .map((entry) =>
        formatReport(entry.report, { modelName: entry.modelName, profile: entry.profile }),
      )
      .join("\n") + (rows.length > 1 ? `\n${formatComparison(rows)}\n` : "")
  );
}
const schema: OutputSchema<BenchEntry> = {
  idField: "modelName",
  columns: [
    { header: "MODEL", field: "modelName" },
    { header: "OVERALL", field: (row) => row.report.overall },
  ],
  renderHuman: render,
};

function repositoryDirectory(options: BenchOptions, cwd: string | null): string {
  if (cwd === null) {
    if (!options.repoDir)
      throw new CommandError({
        code: "NO_REPO_DIR",
        message: "Supply --repo-dir as a source path on the selected Brain owner.",
      });
    return options.repoDir;
  }
  return path.resolve(cwd, options.repoDir ?? ".");
}
function repository(options: BenchOptions, cwd: string | null): BenchmarkOptions["repository"] {
  if (options.curated) {
    const preset = findCuratedRepo(options.curated);
    if (!preset)
      throw new CommandError({
        code: "NO_CURATED",
        message: `Unknown curated preset. Available:\n${describeCuratedRepos()}`,
      });
    if (!options.repoDir)
      throw new CommandError({
        code: "NO_REPO_DIR",
        message:
          "Supply --repo-dir as the source for the Brain-owned disposable benchmark checkout.",
      });
    return {
      directory: repositoryDirectory(options, cwd),
      workspace: preset.workspace,
      workspaceDirectory: preset.workspaceDir,
      ref: preset.ref,
      maxTasks: preset.maxTasks,
    };
  }
  if (!options.repoWorkspaceDir && !options.repoWorkspace && !options.repoDir) return undefined;
  if (!options.repoWorkspaceDir || !options.repoWorkspace)
    throw new CommandError({
      code: "NO_WORKSPACE",
      message: "Supply both --repo-workspace and --repo-workspace-dir to mine repository tasks.",
    });
  return {
    directory: repositoryDirectory(options, cwd),
    workspace: options.repoWorkspace,
    workspaceDirectory: options.repoWorkspaceDir,
    ref: options.repoRef ?? "origin/main",
    maxTasks: Number(options.repoMax ?? 5),
  };
}
export function parseBenchOptions(options: BenchOptions, cwd: string | null): BenchmarkOptions {
  const parsed = BenchmarkOptionsSchema.safeParse({
    execute: options.execute !== false,
    depths: options.depths?.split(",").map((part) => (part.trim() ? Number(part) : NaN)),
    only: options.only?.split(",").map((part) => part.trim()),
    concurrency: Number(options.concurrency ?? 3),
    repository: repository(options, cwd),
  });
  if (!parsed.success)
    throw new CommandError({
      code: "INVALID_BENCHMARK",
      message:
        "Choose valid benchmark task ids, positive depths, concurrency (1–64), and at most 100 repository tasks.",
    });
  return parsed.data;
}
export async function runHostedBenchmarks(
  port: HostCommandPort,
  options: BenchmarkOptions,
  fragments: string[] | undefined,
  signal: AbortSignal,
): Promise<BenchEntry[]> {
  const entries: BenchEntry[] = [];
  for (const model of fragments ?? [undefined]) {
    const completed = await runHostedModelJob(
      port,
      { operation: "benchmark", model, benchmark: options },
      signal,
    );
    const result = ResultSchema.parse(completed.job.result);
    entries.push({ modelName: completed.model.displayName, ...result });
  }
  return entries;
}

export async function runBenchCommand(
  options: BenchOptions,
): Promise<AnyCommandResult<BenchEntry>> {
  const selected = selectedBrainCommandHost();
  const controls = parseBenchOptions(options, selected ? null : process.cwd());
  if (options.model && options.endpoint)
    throw new CommandError({
      code: "INVALID_BENCHMARK",
      message: "Choose --model or --endpoint for this benchmark.",
    });
  const fragments = options.model?.split(",").map((part) => part.trim());
  if (fragments?.some((part) => !part))
    throw new CommandError({
      code: "NO_MODEL",
      message: "Supply nonempty model fragments separated by commas.",
    });
  // COMPAT(brainBenchmarkPort): added in v0.10.0; remove after 2027-04-23.
  if (options.port !== undefined)
    process.stderr.write("Brain owns resident ports; the legacy --port option has no effect.\n");
  let data: BenchEntry[];
  if (options.endpoint && selected) {
    data = await withCommandHost(async (port, signal) => {
      // COMPAT(brainEndpointBenchmark): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
      if (
        !z
          .object({ endpointBenchmark: z.literal(true) })
          .safeParse(await port.request("/__host/capabilities", signal)).success
      )
        throw new CommandError({
          code: "UPDATE_HOST",
          message: "Update the Brain owner to benchmark external endpoints.",
        });
      const admitted = z.object({ job: z.object({ id: z.string() }) }).parse(
        await port.request("/__host/jobs/benchmark-endpoint", signal, {
          endpoint: options.endpoint,
          options: controls,
        }),
      );
      const job = await waitForCommandJob(port, admitted.job.id, signal);
      return [EndpointBenchmarkResultSchema.parse(job.result)];
    });
  } else if (options.endpoint) {
    data = await withCommandSignal(async (signal) => {
      const endpoint = parseBenchmarkEndpoint(options.endpoint!, loadBrainConfig().listen.port);
      const report = await runOwnedBenchmark(
        controls,
        { ...endpoint, signal },
        { env: process.env },
      );
      return [
        {
          modelName: `${endpoint.host}:${endpoint.port}`,
          report: publicBenchmarkReport(report),
          profile: null,
        },
      ];
    });
  } else {
    data = await withCommandHost((port, signal) =>
      runHostedBenchmarks(port, controls, fragments, signal),
    );
  }
  return { type: "list", data, schema };
}

export { addBenchOptions } from "./options.js";
