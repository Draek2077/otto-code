/**
 * `otto brain sweep` — find the reasoning budget that yields the best output, and
 * save it to the model's profile. Guards against the thinking-model failure where
 * an unrestricted budget returns pure reasoning and no content.
 */
import type { Command } from "commander";

import {
  forModel,
  loadBrainConfig,
  loadProfilesStore,
  put,
  saveProfilesStore,
} from "../config/index.js";
import { pickModel, scanModels } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { sweep } from "../ops/sweep.js";
import { resolveRuntime } from "../runtime/index.js";

export interface SweepRow {
  budget: number | string;
  content: string;
  files: string;
  tokensPerSec: string;
  seconds: string;
  best: string;
}

const sweepSchema: OutputSchema<SweepRow> = {
  idField: "budget",
  columns: [
    { header: "BUDGET", field: "budget", width: 8, align: "right" },
    { header: "CONTENT", field: "content", width: 9, align: "right" },
    { header: "FILES", field: "files", width: 6, align: "right" },
    { header: "TOK/S", field: "tokensPerSec", width: 7, align: "right" },
    { header: "TIME", field: "seconds", width: 6, align: "right" },
    { header: "", field: "best", width: 8, color: () => "green" },
  ],
};

export function addSweepOptions(cmd: Command): Command {
  return cmd
    .description("Find and save the best reasoning budget")
    .option("--model <fragment>", "model name fragment or catalog id")
    .option("--budgets <a,b,c>", "reasoning budgets to sweep");
}

export async function runSweepCommand(
  options: { model?: string; budgets?: string },
  _command: Command,
): Promise<AnyCommandResult<SweepRow>> {
  const config = loadBrainConfig();
  const runtime = resolveRuntime(config);
  if (!runtime) {
    throw new CommandError({
      code: "NO_RUNTIME",
      message: "no llama.cpp runtime available",
      details: "run `otto brain runtime install`",
    });
  }

  const store = loadProfilesStore();
  const catalog = scanModels(config);
  const model = pickModel(catalog, options.model ?? store.lastModelId ?? undefined);
  const profile = forModel(store, model, config.defaults);
  const budgets = options.budgets
    ? options.budgets.split(",").map((s) => Number(s.trim()))
    : undefined;

  const report = await sweep({
    runtime,
    model,
    profile,
    budgets,
    onProgress: (p) => {
      if (p.phase === "loading")
        process.stderr.write(`  budget ${String(p.budget).padStart(5)}: loading…\n`);
      if (p.phase === "done")
        process.stderr.write(`  budget ${String(p.budget).padStart(5)}: done\n`);
      if (p.phase === "failed")
        process.stderr.write(`  budget ${String(p.budget).padStart(5)}: failed ${p.error}\n`);
    },
  });

  if (report.recommended !== null && report.recommended !== undefined) {
    profile.reasoningBudget = report.recommended;
    put(store, model, profile);
    saveProfilesStore(store);
  }

  const rows: SweepRow[] = report.results.map((r) => ({
    budget: r.budget,
    content: r.error ? "error" : `${(r.contentChars / 1024).toFixed(1)}KB`,
    files: r.error ? "-" : `${r.filesDelivered}/4`,
    tokensPerSec: (r.tokensPerSecond ?? 0).toFixed(1),
    seconds: `${(r.elapsedSeconds ?? 0).toFixed(0)}s`,
    best: r.budget === report.recommended ? "<- best" : "",
  }));

  return { type: "list", data: rows, schema: sweepSchema };
}
