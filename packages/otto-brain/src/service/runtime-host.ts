/** Runtime management effects stay on the owning Brain host. */
import { createHash } from "node:crypto";
import { loadPersistedConfig, saveBrainConfig } from "../config/store.js";
import { applyEnvOverrides } from "../config/env.js";
import { queryNvidia } from "../gpu.js";
import {
  listAllRuntimes,
  supportedVariants,
  latestRuntimeBuild,
  defaultRuntimeSpec,
  installManagedRuntime,
  removeManagedRuntime,
  listRuntimeDevices,
} from "../runtime/index.js";
import type { Runtime } from "../types.js";
import type { BrainRuntimeContext } from "./serve.js";
import type { BrainJobs } from "./jobs.js";
import { RuntimeManagement } from "./runtime-management.js";
import { RequestError } from "./http-body.js";

interface RuntimeHostPorts {
  jobs: BrainJobs;
  list?(): Runtime[];
  selected(): Runtime | null;
  isRuntimeInUse(runtime: Runtime): boolean;
  changed(): void;
  requireWrite: ConstructorParameters<typeof RuntimeManagement>[0]["requireWrite"];
}

export function createRuntimeManagement(
  context: BrainRuntimeContext,
  ports: RuntimeHostPorts,
): RuntimeManagement {
  const revision = (runtime: typeof context.config.runtime) =>
    createHash("sha256").update(JSON.stringify(runtime)).digest("hex");
  return new RuntimeManagement({
    jobs: ports.jobs,
    variants: supportedVariants(),
    list: ports.list ?? (() => listAllRuntimes(context.env)),
    selected: () => {
      // A missing saved executable must not hide acquisition or repair controls.
      try {
        return ports.selected();
      } catch {
        return null;
      }
    },
    selectionRevision: () => revision(loadPersistedConfig(context.paths).runtime),
    select: (runtime, expectedRevision) => {
      const persisted = loadPersistedConfig(context.paths);
      if (expectedRevision !== undefined && revision(persisted.runtime) !== expectedRevision)
        return false;
      const selection = {
        source: runtime?.source ?? ("auto" as const),
        path: runtime?.exe ?? null,
      };
      const next = { ...persisted, runtime: { ...persisted.runtime, ...selection } };
      const effective = applyEnvOverrides(next, context.env);
      if (
        effective.runtime.path !== selection.path ||
        effective.runtime.source !== selection.source
      )
        throw new RequestError(409, "Runtime selection is controlled by the host environment");
      saveBrainConfig(next, context.paths);
      context.config.runtime = effective.runtime;
      return true;
    },
    assertUnused: (runtime) => {
      if (ports.isRuntimeInUse(runtime))
        throw new RequestError(409, "A resident or queued operation is using this runtime");
    },
    remove: (runtime) => removeManagedRuntime(context.paths.runtimesDir, runtime.label),
    latest: (signal) => latestRuntimeBuild(signal),
    install: async (build, variant, progress, signal) => {
      const hasNvidiaGpu =
        variant === "auto" && process.platform === "win32"
          ? (await queryNvidia(signal)) !== null
          : undefined;
      signal.throwIfAborted();
      return installManagedRuntime(
        defaultRuntimeSpec(build, { variant, hasNvidiaGpu }),
        context.paths.runtimesDir,
        progress,
        signal,
      );
    },
    diagnose: async (runtime, signal) => {
      if (runtime.label.toLowerCase().startsWith("cpu")) return null;
      try {
        const devices = await listRuntimeDevices(runtime, process.platform, signal);
        return devices.length
          ? null
          : "This runtime reports no GPU device. Inference will use the CPU until the host's GPU driver is available.";
      } catch {
        signal.throwIfAborted();
        return "The runtime was installed, but its GPU devices could not be verified.";
      }
    },
    changed: ports.changed,
    requireWrite: ports.requireWrite,
  });
}
