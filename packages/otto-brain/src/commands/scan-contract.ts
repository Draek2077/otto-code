/** Shared CLI projection of the owning host's discovery and calibration state. */
import { z } from "zod/v3";
import { forModel, getCalibration } from "../config/profiles.js";
import type { BrainConfig, ProfilesStore } from "../config/schema.js";
import type { Model } from "../types.js";
import { formatBytes } from "../models/scan.js";

export const ScanRowSchema = z
  .object({
    model: z.string(),
    arch: z.string(),
    quant: z.string(),
    size: z.string(),
    ctx: z.string(),
    vision: z.string(),
    calibrated: z.string(),
    features: z.string(),
    source: z.string(),
  })
  .strict();
export const ScanReplySchema = z.object({ models: z.array(ScanRowSchema).max(10000) }).strict();
export type ScanRow = z.infer<typeof ScanRowSchema>;

export function projectScanRows(
  catalog: Model[],
  store: ProfilesStore,
  config: BrainConfig,
): ScanRow[] {
  return catalog.map((model) => {
    const profile = forModel(store, model, config.defaults);
    const md = model.metadata ?? {};
    const features = [
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
      features,
      source: model.origin ?? "-",
    };
  });
}
