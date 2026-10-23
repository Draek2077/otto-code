/**
 * `otto brain runtime install|list` - manage the self-contained llama.cpp runtime.
 * `install` downloads a pinned build into $OTTO_HOME/otto-brain/runtimes so the
 * tool needs no other software; `list` shows every runtime found (managed first,
 * then LM Studio).
 */
import type { Command } from "commander";

import { loadBrainConfig } from "../config/index.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import {
  DEFAULT_LLAMA_BUILD,
  defaultRuntimeSpec,
  installManagedRuntime,
  MissingAssetError,
  removeManagedRuntime,
  resolveLatestBuildOrPin,
  listAllRuntimes,
  listRuntimeDevices,
  probeNvidiaGpu,
  supportedVariants,
  type InstallProgress,
  type RuntimeSpec,
  type RuntimeTarget,
  type RuntimeVariant,
} from "../runtime/index.js";
import type { Runtime } from "../types.js";

export interface RuntimeRow {
  label: string;
  displayName: string;
  version: string;
  source: string;
  dir: string;
}

const runtimeSchema: OutputSchema<RuntimeRow> = {
  idField: "dir",
  columns: [
    { header: "LABEL", field: "label", width: 20 },
    { header: "VERSION", field: "version", width: 10 },
    {
      header: "SOURCE",
      field: "source",
      width: 10,
      color: (v) => (v === "managed" ? "green" : undefined),
    },
    { header: "DIR", field: "dir", width: 50 },
  ],
};

function toRows(): RuntimeRow[] {
  return listAllRuntimes().map((r) => ({
    label: r.label,
    displayName: r.displayName ?? `${r.label} · ${r.version}`,
    version: r.version,
    source: r.source,
    dir: r.dir,
  }));
}

export function addRuntimeListOptions(cmd: Command): Command {
  return cmd.description("List available llama.cpp runtimes");
}

export async function runRuntimeListCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<RuntimeRow>> {
  return { type: "list", data: toRows(), schema: runtimeSchema };
}

export function addRuntimeInstallOptions(cmd: Command): Command {
  return cmd
    .description("Download a self-contained llama.cpp runtime")
    .option("--build <tag>", "llama.cpp release build tag (for example b10355)")
    .option(
      "--variant <name>",
      `accelerator to install (${supportedVariants().join("|")}); defaults to the best one this machine can use`,
    );
}

export function addRuntimeRemoveOptions(cmd: Command): Command {
  return cmd.description("Remove one Otto-managed runtime").argument("<name>");
}

export async function runRuntimeRemoveCommand(
  name: string,
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<RuntimeRow>> {
  loadBrainConfig();
  removeManagedRuntime(resolveBrainPaths().runtimesDir, name);
  return { type: "list", data: toRows(), schema: runtimeSchema };
}

/**
 * Every warning this command emits is one line on purpose. The daemon's
 * BrainOpsManager keeps the *last* stderr line as the job's message, so a
 * multi-line warning would surface in the UI as a dangling fragment. As one line
 * it survives intact on both the CLI and the GUI.
 */
function warn(message: string): void {
  process.stderr.write(`  warning: ${message.replace(/\s+/gu, " ").trim()}\n`);
}

/** Download + extract a spec, reporting percentage and phase on stderr. */
async function install(spec: RuntimeSpec, runtimesDir: string): Promise<Runtime> {
  process.stderr.write(`  installing ${spec.label} (${spec.version})…\n`);
  const runtime = await installManagedRuntime(spec, runtimesDir, (p: InstallProgress) => {
    if (p.phase === "downloading" && p.totalBytes) {
      const pct = Math.floor(((p.receivedBytes ?? 0) / p.totalBytes) * 100);
      process.stderr.write(`  ${pct}%\r`);
    }
    if (p.phase === "extracting") process.stderr.write("\n  extracting…\n");
  });
  process.stderr.write("\n");
  return runtime;
}

export async function runRuntimeInstallCommand(
  options: { build?: string; variant?: string },
  _command: Command,
): Promise<AnyCommandResult<RuntimeRow>> {
  loadBrainConfig();
  const { runtimesDir } = resolveBrainPaths();

  const available = supportedVariants();
  if (options.variant && !available.includes(options.variant as RuntimeVariant)) {
    throw new CommandError({
      code: "UNSUPPORTED_VARIANT",
      message:
        `llama.cpp publishes no "${options.variant}" build for ${process.platform}/${process.arch}` +
        ` - available: ${available.join(", ") || "(none)"}`,
    });
  }

  // Only "auto" needs the GPU probe, and only to choose between CUDA and Vulkan
  // on the platforms that have both.
  const target: RuntimeTarget = {
    variant: (options.variant as RuntimeVariant | undefined) ?? "auto",
    hasNvidiaGpu: options.variant ? undefined : await probeNvidiaGpu(),
  };

  // "latest" is a request to update, not a promise upstream can always keep: the
  // lookup is unauthenticated and rate limited, so it falls back to the pin.
  const resolvedLatest = options.build === "latest" ? await resolveLatestBuildOrPin() : null;
  if (resolvedLatest?.warning) warn(resolvedLatest.warning);

  let spec = defaultRuntimeSpec(resolvedLatest ? resolvedLatest.build : options.build, target);
  let runtime: Runtime;
  try {
    runtime = await install(spec, runtimesDir);
  } catch (error) {
    // Asset names are not derivable from the build tag, and the scheme has
    // already changed once (b4600 shipped `win-cuda-cu12.4-x64`, b10265 ships
    // `win-cuda-12.4-x64`), so a tag resolved at run time can name assets that
    // do not exist under it. The pin's names are the ones managed.test.ts holds,
    // which makes it the only build this can fall back to. An explicit --build
    // still fails loudly: the user named that tag on purpose.
    if (
      !(error instanceof MissingAssetError) ||
      !resolvedLatest ||
      spec.version === DEFAULT_LLAMA_BUILD
    ) {
      throw error;
    }
    warn(
      `llama.cpp build ${spec.version} does not publish the asset this platform needs,` +
        ` so Otto installed the pinned build ${DEFAULT_LLAMA_BUILD} instead.`,
    );
    spec = defaultRuntimeSpec(DEFAULT_LLAMA_BUILD, target);
    runtime = await install(spec, runtimesDir);
  }

  // A GPU variant that finds no device still runs - on the CPU, at roughly a
  // fortieth of the prefill throughput, and says nothing about it. Measured on
  // WSL2, which carries no NVIDIA Vulkan ICD. Warn rather than fail: the runtime
  // is genuinely installed and usable, just not accelerated.
  if (spec.variant !== "cpu") {
    const devices = await listRuntimeDevices(runtime);
    if (devices.length === 0) {
      warn(
        `this ${spec.variant} runtime reports no GPU device, so inference will run` +
          ` on the CPU until a working ${spec.variant} driver for this GPU is installed.`,
      );
    }
  }

  return {
    type: "single",
    data: {
      label: runtime.label,
      displayName: runtime.displayName ?? `${runtime.label} · ${runtime.version}`,
      version: runtime.version,
      source: runtime.source,
      dir: runtime.dir,
    },
    schema: runtimeSchema,
  };
}
