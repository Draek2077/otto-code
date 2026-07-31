/**
 * `otto brain scan` — list detected models with their arch, quant, size, native
 * context, vision, calibration state, and source. Returns a typed list the output
 * layer renders as a table (default), json, or yaml.
 */
import type { Command } from "commander";

import { getCalibration, forModel, loadBrainConfig, loadProfilesStore } from "../config/index.js";
import { formatBytes, scanModels } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";

export interface ScanRow {
  model: string;
  arch: string;
  quant: string;
  size: string;
  ctx: string;
  vision: string;
  calibrated: string;
  features: string;
  source: string;
}

export const scanSchema: OutputSchema<ScanRow> = {
  idField: "model",
  columns: [
    { header: "MODEL", field: "model", width: 40 },
    { header: "ARCH", field: "arch", width: 10 },
    { header: "QUANT", field: "quant", width: 8 },
    { header: "SIZE", field: "size", width: 9, align: "right" },
    { header: "CTX", field: "ctx", width: 9, align: "right" },
    { header: "VIS", field: "vision", width: 4 },
    {
      header: "CAL",
      field: "calibrated",
      width: 4,
      color: (v) => (v === "yes" ? "green" : undefined),
    },
    { header: "FEAT", field: "features", width: 10 },
    { header: "SOURCE", field: "source", width: 8 },
  ],
};

export function addScanOptions(cmd: Command): Command {
  return cmd
    .description("List detected local models")
    .option("--no-metadata", "skip reading GGUF headers (faster)");
}

export async function runScanCommand(
  options: { metadata?: boolean },
  _command: Command,
): Promise<AnyCommandResult<ScanRow>> {
  const config = loadBrainConfig();
  const store = loadProfilesStore();
  const catalog = scanModels(config, process.env, { withMetadata: options.metadata !== false });

  const rows: ScanRow[] = catalog.map((model) => {
    const profile = forModel(store, model, config.defaults);
    const md = model.metadata ?? {};
    const feat = [
      model.features.mtp ? "MTP" : null,
      md.reasoning || model.thinking ? "think" : null,
      model.features.distilled ? "distill" : null,
    ]
      .filter(Boolean)
      .join(",");
    return {
      model: model.displayName.slice(0, 45),
      arch: String(md.arch ?? "-"),
      quant: model.quant ?? "-",
      size: formatBytes(model.sizeBytes),
      ctx: md.contextLength ? String(md.contextLength) : "-",
      vision: model.mmprojPath ? "yes" : "",
      calibrated: getCalibration(store, model, profile) ? "yes" : "",
      features: feat,
      source: model.origin ?? "-",
    };
  });

  return { type: "list", data: rows, schema: scanSchema };
}
