/**
 * Runtime resolution across sources. Two providers implement "where does
 * llama-server come from": `managed` (downloaded by otto-brain, the self-contained
 * path) and `lmstudio` (discovered from an existing LM Studio install, a
 * zero-download fast path). Selection follows config: an explicit path override
 * wins; otherwise `auto` prefers a managed runtime and falls back to LM Studio.
 */
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import type { Runtime } from "../types.js";
import { listRuntimes as listLmStudioRuntimes, resolveOverride } from "./lmstudio.js";
import {
  defaultRuntimeSpec,
  installManagedRuntime,
  listManagedRuntimes,
  type InstallProgress,
} from "./managed.js";

export { BACKENDS_DIR, LMSTUDIO_ROOT, listRuntimes as listLmStudioRuntimes } from "./lmstudio.js";
export { buildArgs, buildEnv, formatCommand, type ServeTarget } from "./args.js";
export {
  installManagedRuntime,
  listManagedRuntimes,
  defaultRuntimeSpec,
  DEFAULT_LLAMA_BUILD,
  type RuntimeSpec,
  type InstallProgress,
} from "./managed.js";

/** Every runtime available on this machine, managed first then LM Studio. */
export function listAllRuntimes(env: NodeJS.ProcessEnv = process.env): Runtime[] {
  const paths = resolveBrainPaths(env);
  return [...listManagedRuntimes(paths.runtimesDir), ...listLmStudioRuntimes()];
}

/** The runtime to use given config, or null when none is available. */
export function resolveRuntime(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
): Runtime | null {
  const rc = config.runtime;
  if (rc.path) return resolveOverride(rc.path);

  const paths = resolveBrainPaths(env);
  const managed = listManagedRuntimes(paths.runtimesDir);
  const lmstudio = listLmStudioRuntimes();

  if (rc.source === "managed") return managed[0] ?? null;
  if (rc.source === "lmstudio") return lmstudio[0] ?? null;
  return managed[0] ?? lmstudio[0] ?? null; // auto
}

/** Ensure a runtime exists, downloading the default managed build if none does. */
export async function ensureRuntime(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
  onProgress?: (progress: InstallProgress) => void,
): Promise<Runtime> {
  const existing = resolveRuntime(config, env);
  if (existing) return existing;

  const paths = resolveBrainPaths(env);
  return installManagedRuntime(defaultRuntimeSpec(), paths.runtimesDir, onProgress);
}
