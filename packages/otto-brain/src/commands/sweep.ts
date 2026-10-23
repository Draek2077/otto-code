import type { Command } from "commander";
import { z } from "zod/v3";
import { formatReasoningBudget } from "../config/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { SweepBudgetsSchema } from "../service/model-job-options.js";
import { runModelJob } from "./model-job.js";

export interface SweepRow {
  budget: number;
  content: string;
  files: string;
  tokensPerSec: string;
  seconds: string;
  best: string;
}
const schema: OutputSchema<SweepRow> = {
  idField: "budget",
  columns: [
    {
      header: "BUDGET",
      field: (row) => formatReasoningBudget(row.budget),
      width: 8,
      align: "right",
    },
    { header: "CONTENT", field: "content", width: 9, align: "right" },
    { header: "FILES", field: "files", width: 6, align: "right" },
    { header: "TOK/S", field: "tokensPerSec", width: 7, align: "right" },
    { header: "TIME", field: "seconds", width: 6, align: "right" },
    { header: "", field: "best", width: 8, color: () => "green" },
  ],
};
const resultSchema = z.object({
  recommended: z.number().nullable(),
  applied: z.boolean(),
  results: z.array(
    z.object({
      budget: z.number(),
      error: z.string().nullable(),
      contentChars: z.number(),
      filesDelivered: z.number(),
      tokensPerSecond: z.number().nullable(),
      elapsedSeconds: z.number().nullable(),
    }),
  ),
});
export function parseSweepBudgets(raw: string | undefined): number[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(",").map((part) => part.trim());
  const result = SweepBudgetsSchema.safeParse(
    parts.map((part) => (/^-?\d+$/.test(part) ? Number(part) : Number.NaN)),
  );
  if (!result.success)
    throw new CommandError({
      code: "INVALID_BUDGETS",
      message: "Supply 1 to 64 integer reasoning budgets, each at least -1.",
    });
  return result.data;
}
export function addSweepOptions(command: Command): Command {
  return command
    .description("Find and save the best reasoning budget")
    .option("--model <fragment>", "model name fragment or catalog id")
    .option("--budgets <a,b,c>", "reasoning budgets to sweep");
}
export async function runSweepCommand(options: {
  model?: string;
  budgets?: string;
}): Promise<AnyCommandResult<SweepRow>> {
  const budgets = parseSweepBudgets(options.budgets);
  const { job } = await runModelJob({ operation: "sweep", model: options.model, budgets });
  const report = resultSchema.parse(job.result);
  const bestLabel = report.applied ? "<- best" : "<- best (not saved)";
  return {
    type: "list",
    schema,
    data: report.results.map((trial) => ({
      budget: trial.budget,
      content: trial.error ? "error" : `${(trial.contentChars / 1024).toFixed(1)}KB`,
      files: trial.error ? "-" : `${trial.filesDelivered}/4`,
      tokensPerSec: (trial.tokensPerSecond ?? 0).toFixed(1),
      seconds: `${(trial.elapsedSeconds ?? 0).toFixed(0)}s`,
      best: trial.budget === report.recommended ? bestLabel : "",
    })),
  };
}
