/**
 * `otto brain bench` — score a model's agentic coding ability on this machine.
 * Either benchmarks an endpoint that is already serving (`--endpoint`) or loads
 * each requested model itself. A long streaming run, so it prints a formatted
 * report directly rather than going through the output layer.
 */
import http from "node:http";
import path from "node:path";
import type { Command } from "commander";

import { forModel, getCalibration, loadBrainConfig, loadProfilesStore } from "../config/index.js";
import { query as queryGpu } from "../gpu.js";
import { pickModel, scanModels } from "../models/index.js";
import { CommandError } from "../output/types.js";
import { resolveRuntime } from "../runtime/index.js";
import { createRouter, Telemetry } from "../service/router.js";
import { Supervisor } from "../service/supervisor.js";
import * as bench from "../bench/index.js";
import { loadRepoTasks } from "../bench/repo-task.js";
import { describeCuratedRepos, findCuratedRepo } from "../bench/curated-repos.js";
import * as archive from "../ops/archive.js";
import * as results from "../ops/results.js";
import * as vram from "../vram.js";

import type { Task } from "../bench/tasks.js";

interface BenchOptions {
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

function progress(p: {
  phase: string;
  title?: string;
  score?: number;
  summary?: string;
  seconds?: number;
}): void {
  if (p.phase === "start") process.stderr.write(`  ${(p.title ?? "").padEnd(20)} running…\n`);
  if (p.phase === "done") {
    process.stderr.write(
      `  ${(p.title ?? "").padEnd(20)} ${((p.score ?? 0) * 100).toFixed(0)}%  ${p.summary}\n`,
    );
  }
  if (p.phase === "failed") process.stderr.write(`  failed: ${p.summary}\n`);
}

export function addBenchOptions(cmd: Command): Command {
  return cmd
    .description("Score agentic coding ability on this machine")
    .option("--model <fragments>", "model name fragment(s), comma-separated")
    .option("--endpoint <host:port>", "benchmark an endpoint already serving")
    .option("--only <a,b>", "run only these tasks")
    .option("--depths <a,b,c>", "prompt depths for the depth-scaling task")
    .option("--concurrency <n>", "requests in flight for the concurrency task", "3")
    .option("--no-execute", "syntax-check generated code but do not run it")
    .option("--port <n>", "internal port for the loaded model", "1251")
    .option(
      "--repo-workspace-dir <dir>",
      "mine SWE-bench tasks from a workspace, e.g. packages/protocol",
    )
    .option(
      "--repo-workspace <name>",
      "npm workspace name for mined tasks, e.g. @otto-code/protocol",
    )
    .option("--repo-dir <dir>", "repo working copy to mine (default: current directory)")
    .option("--repo-ref <ref>", "git ref to mine from", "origin/main")
    .option("--repo-max <n>", "max mined tasks to run", "5")
    .option(
      "--curated <name>",
      "run a curated mined-repo preset (needs --repo-dir); pass an unknown name to list presets",
    );
}

export async function runBenchCommand(options: BenchOptions, _command: Command): Promise<void> {
  const config = loadBrainConfig();
  const execute = options.execute !== false;
  const depths = options.depths
    ? options.depths.split(",").map((s) => Number(s.trim()))
    : undefined;
  const only = options.only ? options.only.split(",").map((s) => s.trim()) : null;
  const concurrency = options.concurrency ? Math.max(1, Number(options.concurrency)) : 3;

  // Opt-in: mining a repo replaces the static suite with real SWE-bench tasks.
  // Absent these flags nothing touches a repo checkout.
  let repoTasks: Task[] | undefined;
  if (options.curated) {
    const preset = findCuratedRepo(options.curated);
    if (!preset) {
      throw new CommandError({
        code: "NO_CURATED",
        message: `unknown curated preset "${options.curated}". Available:\n${describeCuratedRepos()}`,
      });
    }
    // The harness resets the working copy hard between tasks, so require an
    // explicit --repo-dir rather than silently mutating the current checkout.
    if (!options.repoDir) {
      throw new CommandError({
        code: "NO_REPO_DIR",
        message:
          "--repo-dir is required with --curated: the working copy is reset hard " +
          "(git reset --hard + git clean -fd) between tasks, so point it at a spare " +
          "checkout, never one with uncommitted work.",
      });
    }
    const dir = path.resolve(options.repoDir);
    process.stderr.write(
      `\ncurated: mining ${preset.workspace} @ ${preset.ref} in ${dir}\n` +
        `  note: this resets the working copy (git reset --hard + git clean -fd)\n`,
    );
    const tasks = await loadRepoTasks({
      dir,
      workspace: preset.workspace,
      workspaceDir: preset.workspaceDir,
      ref: preset.ref,
      maxTasks: preset.maxTasks,
    });
    if (!tasks.length) {
      throw new CommandError({
        code: "NO_TASKS",
        message: `no mineable fix commits found in ${preset.workspaceDir}`,
      });
    }
    process.stderr.write(`  ${tasks.length} mined task(s): ${tasks.map((t) => t.id).join(", ")}\n`);
    repoTasks = tasks;
  } else if (options.repoWorkspaceDir) {
    if (!options.repoWorkspace) {
      throw new CommandError({
        code: "NO_WORKSPACE",
        message: "--repo-workspace <name> is required with --repo-workspace-dir",
      });
    }
    const dir = options.repoDir ? path.resolve(options.repoDir) : process.cwd();
    process.stderr.write(`\nmining tasks from ${options.repoWorkspaceDir} @ ${options.repoRef}\n`);
    const tasks = await loadRepoTasks({
      dir,
      workspace: options.repoWorkspace,
      workspaceDir: options.repoWorkspaceDir,
      ref: options.repoRef,
      maxTasks: options.repoMax ? Math.max(1, Number(options.repoMax)) : 5,
    });
    if (!tasks.length) {
      throw new CommandError({
        code: "NO_TASKS",
        message: `no mineable fix commits found in ${options.repoWorkspaceDir}`,
      });
    }
    process.stderr.write(`  ${tasks.length} mined task(s): ${tasks.map((t) => t.id).join(", ")}\n`);
    repoTasks = tasks;
  }

  if (options.endpoint) {
    const [host, portStr] = options.endpoint.split(":");
    const port = Number(portStr || config.listen.port);
    process.stderr.write(`\nbenchmarking endpoint ${host}:${port}\n`);
    const report = await bench.runSuite({
      host,
      port,
      execute,
      depths,
      only,
      concurrency,
      tasks: repoTasks,
      onProgress: progress,
    });
    process.stdout.write(`${bench.formatReport(report, { modelName: `${host}:${port}` })}\n`);
    return;
  }

  const store = loadProfilesStore();
  const catalog = scanModels(config);
  const needles = options.model
    ? options.model.split(",").map((s) => s.trim())
    : [store.lastModelId].filter((v): v is string => Boolean(v));
  if (!needles.length) {
    throw new CommandError({
      code: "NO_MODEL",
      message: "specify --model <fragment>[,<fragment>...] or --endpoint host:port",
    });
  }

  const runtime = resolveRuntime(config);
  if (!runtime) {
    throw new CommandError({
      code: "NO_RUNTIME",
      message: "no llama.cpp runtime; run `otto brain runtime install`",
    });
  }

  const port = Number(options.port || 1251);
  const entries: { modelName: string; report: Awaited<ReturnType<typeof bench.runSuite>> }[] = [];

  for (const needle of needles) {
    const model = pickModel(catalog, needle);
    let profile = forModel(store, model, config.defaults);

    const gpu = await queryGpu();
    if (gpu) {
      const fit = vram.fitToBudget({
        model,
        profile,
        calibration: getCalibration(store, model, profile),
        totalVramBytes: gpu.totalBytes,
      });
      if (!fit.adjusted && !fit.budget.fits) {
        process.stderr.write(`\nskipping ${model.displayName}: ${fit.reason}\n`);
        continue;
      }
      profile = fit.profile;
    }

    process.stdout.write(`\n${"=".repeat(74)}\n${model.displayName}\n${"=".repeat(74)}\n`);
    const supervisor = new Supervisor({ runtime, internalPort: port });
    const telemetry = new Telemetry();
    const server = http.createServer(
      createRouter({ supervisor, telemetry, getCatalog: () => catalog }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port + 1, "127.0.0.1", resolve);
    });

    try {
      await supervisor.start(model, profile);
      const archiveId = archive.runId(model);
      const report = await bench.runSuite({
        host: "127.0.0.1",
        port: port + 1,
        execute,
        depths,
        only,
        concurrency,
        reasoningBudget: profile.reasoningBudget ?? null,
        contextWindow: profile.contextSize ?? null,
        archiveId,
        tasks: repoTasks,
        onProgress: progress,
      });
      process.stdout.write(
        `${bench.formatReport(report, { modelName: model.displayName, profile })}\n`,
      );

      const runtimeLabel = `${runtime.label} v${runtime.version}`;
      const { file } = results.save({
        model,
        profile,
        report,
        gpu,
        runtime: runtimeLabel,
        archiveId,
      });
      process.stderr.write(`  saved to results/${path.basename(file)}\n`);
      entries.push({ modelName: model.displayName, report });
    } finally {
      await supervisor.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  if (entries.length > 1) {
    process.stdout.write(`\n${"=".repeat(74)}\n  COMPARISON\n${"=".repeat(74)}\n`);
    process.stdout.write(`${bench.formatComparison(entries)}\n`);
  }
}
