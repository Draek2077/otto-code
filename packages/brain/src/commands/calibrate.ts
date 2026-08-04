/**
 * `otto brain calibrate` - measure real KV bytes/token for a model and persist it,
 * so the VRAM budget uses a measured figure instead of the (over-estimating)
 * theoretical formula.
 */
import type { Command } from "commander";

import {
  getCalibration,
  forModel,
  loadBrainConfig,
  loadProfilesStore,
  putCalibration,
  saveProfilesStore,
} from "../config/index.js";
import { query as queryGpu } from "../gpu.js";
import { pickModel, scanModels } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { calibrate } from "../ops/calibrate.js";
import { resolveRuntime } from "../runtime/index.js";
import { withActivity } from "../service/activity.js";
import * as vram from "../vram.js";

export interface CalibrateRow {
  model: string;
  measuredKvKB: string;
  formulaKvKB: string;
  overhead: string;
  maxContext: string;
}

const calibrateSchema: OutputSchema<CalibrateRow> = {
  idField: "model",
  columns: [
    { header: "MODEL", field: "model", width: 40 },
    { header: "MEASURED KV", field: "measuredKvKB", width: 12, align: "right" },
    { header: "FORMULA KV", field: "formulaKvKB", width: 12, align: "right" },
    { header: "OVERHEAD", field: "overhead", width: 9, align: "right" },
    { header: "MAX CTX", field: "maxContext", width: 12, align: "right" },
  ],
};

export function addCalibrateOptions(cmd: Command): Command {
  return cmd
    .description("Measure real KV bytes/token and save it")
    .option("--model <fragment>", "model name fragment or catalog id");
}

export async function runCalibrateCommand(
  options: { model?: string },
  _command: Command,
): Promise<AnyCommandResult<CalibrateRow>> {
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

  // Announced so the Brain rail can show the host as busy: a calibrate loads the
  // model at several context sizes and will make anything else queue behind it.
  const measurement = await withActivity("calibrate", { target: model.displayName }, () =>
    calibrate({
      runtime,
      model,
      profile,
      onProgress: (p) => {
        if (p.phase === "loading")
          process.stderr.write(`  loading at ${p.contextSize?.toLocaleString()} ctx…\n`);
        if (p.phase === "measured")
          process.stderr.write(`    used ${vram.formatGiB(p.deltaBytes ?? 0)}\n`);
        if (p.phase === "skip") process.stderr.write(`  skipped ${p.contextSize}: ${p.reason}\n`);
      },
    }),
  );

  putCalibration(store, model, profile, measurement);
  saveProfilesStore(store);

  const gpu = await queryGpu();
  const maxCtx = gpu
    ? vram.maxContextThatFits({
        model,
        profile,
        calibration: getCalibration(store, model, profile),
        totalVramBytes: gpu.totalBytes,
      })
    : null;

  return {
    type: "single",
    data: {
      model: model.displayName,
      measuredKvKB: `${(measurement.kvBytesPerToken / 1024).toFixed(2)} KB`,
      formulaKvKB: measurement.theoreticalKvBytesPerToken
        ? `${(measurement.theoreticalKvBytesPerToken / 1024).toFixed(2)} KB`
        : "-",
      overhead: vram.formatGiB(measurement.baseOverheadBytes),
      maxContext: maxCtx ? maxCtx.toLocaleString() : "unknown",
    },
    schema: calibrateSchema,
  };
}
