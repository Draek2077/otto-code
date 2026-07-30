/**
 * Service lifecycle commands. `serve` runs the brain in the foreground; `start`
 * launches it detached (the shape the Otto daemon uses to supervise a managed
 * child); `stop`/`status` operate on the pid file. All honor the opt-in config —
 * they are always explicit user actions, never auto-started.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import type { Command } from "commander";

import { loadBrainConfig } from "../config/index.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { CommandError } from "../output/types.js";
import { readRunningService, removePidFile, type PidRecord } from "../service/pid-lock.js";
import { startService } from "../service/serve.js";
import * as vram from "../vram.js";

// ------------------------------------------------------------------------ serve

export function addServeOptions(cmd: Command): Command {
  return cmd
    .description("Host a model in the foreground (Ctrl+C to stop)")
    .option("--model <fragment>", "model name fragment or catalog id");
}

export async function runServeCommand(
  options: { model?: string },
  _command: Command,
): Promise<void> {
  const config = loadBrainConfig();
  const handle = await startService({
    config,
    modelNeedle: options.model,
    onLog: (line) => process.stderr.write(`  ${line}\n`),
  });
  process.stdout.write(`router listening on http://${handle.host}:${handle.port}\n`);
  process.stdout.write(
    `ready: ${handle.model.displayName}, ${vram.formatGiB(handle.supervisor.vramAtReadyBytes ?? 0)} VRAM in use\n`,
  );
  process.stdout.write("press Ctrl+C to stop\n");

  const shutdown = async (): Promise<void> => {
    process.stdout.write("\nstopping…\n");
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ------------------------------------------------------------------------ start

export interface LifecycleRow {
  status: string;
  pid: number | string;
  host: string;
  port: number | string;
}

export const lifecycleSchema: OutputSchema<LifecycleRow> = {
  idField: "pid",
  columns: [
    {
      header: "STATUS",
      field: "status",
      width: 10,
      color: (v) => (v === "running" ? "green" : "yellow"),
    },
    { header: "PID", field: "pid", width: 8, align: "right" },
    { header: "HOST", field: "host", width: 16 },
    { header: "PORT", field: "port", width: 6, align: "right" },
  ],
};

export function addStartOptions(cmd: Command): Command {
  return cmd
    .description("Start the brain service detached")
    .option("--model <fragment>", "model name fragment or catalog id");
}

export async function runStartCommand(
  options: { model?: string },
  _command: Command,
): Promise<AnyCommandResult<LifecycleRow>> {
  const existing = readRunningService();
  if (existing) {
    throw new CommandError({
      code: "ALREADY_RUNNING",
      message: `brain already running (pid ${existing.pid}) on ${existing.host}:${existing.port}`,
      details: "stop it with `otto brain stop`",
    });
  }

  const { logFile } = resolveBrainPaths();
  const entry = process.argv[1];
  const args = ["serve"];
  if (options.model) args.push("--model", options.model);

  const out = openSync(logFile, "a");
  const child = spawn(process.execPath, [entry, ...args], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();

  return {
    type: "single",
    data: { status: "starting", pid: child.pid ?? "-", host: "-", port: "-" },
    schema: lifecycleSchema,
  };
}

// ------------------------------------------------------------------------- stop

export function addStopOptions(cmd: Command): Command {
  return cmd.description("Stop the running brain service");
}

export async function runStopCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<LifecycleRow>> {
  const running = readRunningService();
  if (!running) {
    throw new CommandError({ code: "NOT_RUNNING", message: "no brain service is running" });
  }
  process.kill(running.pid, "SIGTERM");
  removePidFile();
  return {
    type: "single",
    data: { status: "stopped", pid: running.pid, host: running.host, port: running.port },
    schema: lifecycleSchema,
  };
}

// ----------------------------------------------------------------------- status

export interface StatusRow extends LifecycleRow {
  health: string;
}

const statusSchema: OutputSchema<StatusRow> = {
  idField: "pid",
  columns: [
    ...lifecycleSchema.columns,
    { header: "HEALTH", field: "health", width: 10, color: (v) => (v === "ok" ? "green" : "red") },
  ],
};

export function addStatusOptions(cmd: Command): Command {
  return cmd.description("Show whether the brain service is running");
}

async function probeHealth(record: PidRecord): Promise<string> {
  try {
    const res = await fetch(`http://${record.host}:${record.port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? "ok" : `http ${res.status}`;
  } catch {
    return "loading";
  }
}

export async function runStatusCommand(
  _options: unknown,
  _command: Command,
): Promise<AnyCommandResult<StatusRow>> {
  const running = readRunningService();
  if (!running) {
    return {
      type: "single",
      data: { status: "stopped", pid: "-", host: "-", port: "-", health: "-" },
      schema: statusSchema,
    };
  }
  const health = await probeHealth(running);
  return {
    type: "single",
    data: { status: "running", pid: running.pid, host: running.host, port: running.port, health },
    schema: statusSchema,
  };
}
