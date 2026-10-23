import type { Command } from "commander";
import { z } from "zod/v3";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { formatGiB } from "../vram.js";
import { runModelJob } from "./model-job.js";

export interface CalibrateRow {
  model: string;
  measuredKvKB: string;
  formulaKvKB: string;
  overhead: string;
  maxContext: string;
}
const schema: OutputSchema<CalibrateRow> = {
  idField: "model",
  columns: [
    { header: "MODEL", field: "model", width: 40 },
    { header: "MEASURED KV", field: "measuredKvKB", width: 12, align: "right" },
    { header: "FORMULA KV", field: "formulaKvKB", width: 12, align: "right" },
    { header: "OVERHEAD", field: "overhead", width: 9, align: "right" },
    { header: "MAX CTX", field: "maxContext", width: 12, align: "right" },
  ],
};
const resultSchema = z.object({
  kvBytesPerToken: z.number().positive(),
  baseOverheadBytes: z.number().nonnegative(),
  theoreticalKvBytesPerToken: z.number().nullable(),
  maxContext: z.number().nullable(),
});
export function addCalibrateOptions(command: Command): Command {
  return command
    .description("Measure real KV bytes/token and save it")
    .option("--model <fragment>", "model name fragment or catalog id");
}
export async function runCalibrateCommand(options: {
  model?: string;
}): Promise<AnyCommandResult<CalibrateRow>> {
  const { model, job } = await runModelJob({ operation: "calibrate", model: options.model });
  const result = resultSchema.parse(job.result);
  return {
    type: "single",
    schema,
    data: {
      model: model.displayName,
      measuredKvKB: `${(result.kvBytesPerToken / 1024).toFixed(2)} KB`,
      formulaKvKB: result.theoreticalKvBytesPerToken
        ? `${(result.theoreticalKvBytesPerToken / 1024).toFixed(2)} KB`
        : "-",
      overhead: formatGiB(result.baseOverheadBytes),
      maxContext: result.maxContext ? result.maxContext.toLocaleString() : "unknown",
    },
  };
}
