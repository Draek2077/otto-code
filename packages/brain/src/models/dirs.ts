/**
 * Resolves which directories to scan for models: the managed dir under
 * `$OTTO_HOME/otto-brain/models` (where `otto brain pull` downloads to) plus the
 * LM Studio library as an additional discovery source. The managed dir wins on id
 * collisions so a pulled model shadows an identically-pathed LM Studio one.
 */
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import { LMSTUDIO_MODELS_DIR } from "./scan.js";

export interface ModelsDir {
  dir: string;
  origin: "managed" | "lmstudio";
}

export function resolveModelsDirs(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
): ModelsDir[] {
  const paths = resolveBrainPaths(env);
  const managed = config.modelsDir ?? paths.modelsDir;
  return [
    { dir: managed, origin: "managed" },
    { dir: LMSTUDIO_MODELS_DIR, origin: "lmstudio" },
  ];
}

/** The single directory new downloads are written to. */
export function managedModelsDir(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return config.modelsDir ?? resolveBrainPaths(env).modelsDir;
}
