/** Barrel for the models subsystem plus the config-aware union scan. */
import type { BrainConfig } from "../config/schema.js";
import type { Model } from "../types.js";
import { resolveModelsDirs } from "./dirs.js";
import { scan } from "./scan.js";

export * from "./scan.js";
export { pickModel } from "./pick.js";
export { resolveModelsDirs, managedModelsDir, type ModelsDir } from "./dirs.js";
export { pullModel, type PullOptions, type PullProgress } from "./download.js";

export interface ScanModelsOptions {
  withMetadata?: boolean;
}

/** Scan every configured models directory (managed ∪ LM Studio), de-duplicated. */
export function scanModels(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: ScanModelsOptions = {},
): Model[] {
  const dirs = resolveModelsDirs(config, env);
  const seen = new Set<string>();
  const all: Model[] = [];
  for (const { dir, origin } of dirs) {
    for (const model of scan({
      modelsDir: dir,
      withMetadata: options.withMetadata ?? true,
      origin,
    })) {
      if (seen.has(model.modelPath)) continue;
      seen.add(model.modelPath);
      all.push(model);
    }
  }
  all.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return all;
}
