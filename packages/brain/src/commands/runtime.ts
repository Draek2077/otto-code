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
import { defaultRuntimeSpec, installManagedRuntime, listAllRuntimes } from "../runtime/index.js";

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
    .option("--build <tag>", "llama.cpp release build tag");
}

export async function runRuntimeInstallCommand(
  options: { build?: string },
  _command: Command,
): Promise<AnyCommandResult<RuntimeRow>> {
  loadBrainConfig();
  const { runtimesDir } = resolveBrainPaths();
  const spec = defaultRuntimeSpec(options.build);

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
