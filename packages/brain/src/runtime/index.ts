/**
 * Runtime resolution across sources. Two providers implement "where does
 * llama-server come from": `managed` (downloaded by otto-brain, the self-contained
 * path) and `lmstudio` (discovered from an existing LM Studio install, a
 * zero-download fast path). Selection follows config: an explicit path override
 * wins; otherwise `auto` prefers a managed runtime and falls back to LM Studio.
 *
 * Both providers are cross-platform. Which accelerator a managed install picks
 * is decided in `managed.resolveRuntimeVariant` from the platform, the arch and
 * whether an NVIDIA GPU answered - `probeNvidiaGpu` below is the one place that
 * asks, so the download layer stays free of process spawning.
 */
import { query as queryGpu } from "../gpu.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { BrainConfig } from "../config/schema.js";
import type { Runtime } from "../types.js";
import { listRuntimes as listLmStudioRuntimes, resolveOverride } from "./lmstudio.js";
import {
  defaultRuntimeSpec,
  installManagedRuntime,
  listManagedRuntimes,
  type InstallProgress,
  type RuntimeTarget,
} from "./managed.js";

export { BACKENDS_DIR, LMSTUDIO_ROOT, listRuntimes as listLmStudioRuntimes } from "./lmstudio.js";
export { buildArgs, buildEnv, formatCommand, type ServeTarget } from "./args.js";
export {
  installManagedRuntime,
  removeManagedRuntime,
  listManagedRuntimes,
  listRuntimeDevices,
  verifyRuntimeExecutable,
  defaultRuntimeSpec,
  extractArchive,
  resolveRuntimeVariant,
  serverExeName,
  supportedVariants,
  DEFAULT_LLAMA_BUILD,
  listRuntimeReleases,
  latestRuntimeBuild,
  resolveLatestBuildOrPin,
  MissingAssetError,
  type ResolvedBuild,
  type RuntimeRelease,
  type RuntimeSpec,
  type RuntimeTarget,
  type RuntimeVariant,
  type InstallProgress,
} from "./managed.js";

/** Every runtime available on this machine, managed first then LM Studio. */
export function listAllRuntimes(env: NodeJS.ProcessEnv = process.env): Runtime[] {
  const paths = resolveBrainPaths(env);
  return [...listManagedRuntimes(paths.runtimesDir), ...listLmStudioRuntimes()];
}

/**
 * Whether this machine has an NVIDIA GPU, for picking a managed build. Returns
 * false rather than throwing when nvidia-smi is absent, which is the normal
 * case on macOS and on AMD/Intel machines.
 */
export async function probeNvidiaGpu(): Promise<boolean> {
  return (await queryGpu()) !== null;
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

/**
 * The numeric llama.cpp build carried by a resolved runtime, when its source
 * identifies one. LM Studio and explicit overrides need not expose their
 * upstream build, so callers must treat null as incompatible with a component
 * that declares a minimum build rather than guessing compatibility.
 */
export function runtimeBuild(runtime: Runtime | null | undefined): number | null {
  const match = /^b(\d+)$/iu.exec(runtime?.version ?? "");
  return match ? Number(match[1]) : null;
}

/** Ensure a runtime exists, downloading the default managed build if none does. */
export async function ensureRuntime(
  config: BrainConfig,
  env: NodeJS.ProcessEnv = process.env,
  onProgress?: (progress: InstallProgress) => void,
  target: RuntimeTarget = {},
): Promise<Runtime> {
  const existing = resolveRuntime(config, env);
  if (existing) return existing;

  const paths = resolveBrainPaths(env);
  const resolved: RuntimeTarget = {
    ...target,
    hasNvidiaGpu: target.hasNvidiaGpu ?? (await probeNvidiaGpu()),
  };
  return installManagedRuntime(defaultRuntimeSpec(null, resolved), paths.runtimesDir, onProgress);
}
