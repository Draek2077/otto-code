/**
 * The on-disk layout of otto-brain's home, a namespaced subdirectory of $OTTO_HOME
 * (the dominant per-subsystem convention in Otto: projects/, chat/, loops/, …).
 * Everything the brain persists lives under `$OTTO_HOME/otto-brain/`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveOttoHome } from "./otto-home.js";

export interface BrainPaths {
  home: string;
  root: string;
  configFile: string;
  profilesFile: string;
  catalogFile: string;
  modelsDir: string;
  runtimesDir: string;
  pidFile: string;
  logFile: string;
  resultsDir: string;
}

export function resolveBrainPaths(env: NodeJS.ProcessEnv = process.env): BrainPaths {
  const home = resolveOttoHome(env);
  const root = path.join(home, "otto-brain");
  return {
    home,
    root,
    configFile: path.join(root, "config.json"),
    profilesFile: path.join(root, "profiles.json"),
    catalogFile: path.join(root, "catalog.json"),
    modelsDir: path.join(root, "models"),
    runtimesDir: path.join(root, "runtimes"),
    pidFile: path.join(root, "otto-brain.pid"),
    logFile: path.join(root, "otto-brain.log"),
    resultsDir: path.join(root, "results"),
  };
}

/**
 * The package root, resolved from this module's location whether running from
 * `dist/config/` (built) or `src/config/` (tsx). Used only to find the legacy
 * repo-local `config/` seed data during the one-time migration.
 */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}
