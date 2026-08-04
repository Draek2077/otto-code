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
  defaultRuntimeSpec,
  installManagedRuntime,
  listAllRuntimes,
  probeNvidiaGpu,
  supportedVariants,
  type RuntimeVariant,
} from "../runtime/index.js";

export interface RuntimeRow {
  label: string;
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
    .option("--build <tag>", "llama.cpp release build tag")
    .option(
      "--variant <name>",
      `accelerator to install (${supportedVariants().join("|")}); defaults to the best one this machine can use`,
    );
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
  const spec = defaultRuntimeSpec(options.build, {
    variant: (options.variant as RuntimeVariant | undefined) ?? "auto",
    hasNvidiaGpu: options.variant ? undefined : await probeNvidiaGpu(),
  });

  process.stderr.write(`  installing ${spec.label} (${spec.version})…\n`);
  const runtime = await installManagedRuntime(spec, runtimesDir, (p) => {
    if (p.phase === "downloading" && p.totalBytes) {
      const pct = Math.floor(((p.receivedBytes ?? 0) / p.totalBytes) * 100);
      process.stderr.write(`  ${pct}%\r`);
    }
    if (p.phase === "extracting") process.stderr.write("\n  extracting…\n");
  });
  process.stderr.write("\n");

  return {
    type: "single",
    data: {
      label: runtime.label,
      version: runtime.version,
      source: runtime.source,
      dir: runtime.dir,
    },
    schema: runtimeSchema,
  };
}
