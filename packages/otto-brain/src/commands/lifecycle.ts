import type { Command } from "commander";
import { loadBrainConfig } from "../config/store.js";
import { scanModels, pickModel } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { readRunningService } from "../service/pid-lock.js";
import { startLocalBrain, stopLocalBrain } from "../service/lifecycle.js";
import { localBrainRequest } from "../service/local-client.js";

interface LifecycleRow {
  status: string;
  pid: number | string;
  host: string;
  port: number | string;
}
const schema: OutputSchema<LifecycleRow> = {
  idField: "pid",
  columns: [
    { header: "STATUS", field: "status" },
    { header: "PID", field: "pid" },
    { header: "HOST", field: "host" },
    { header: "PORT", field: "port" },
  ],
};
function result(
  status: string,
  record: ReturnType<typeof readRunningService>,
): AnyCommandResult<LifecycleRow> {
  return {
    type: "single",
    data: {
      status,
      pid: record?.pid ?? "-",
      host: record?.displayHost ?? record?.host ?? "-",
      port: record?.port ?? "-",
    },
    schema,
  };
}

export function addServeOptions(command: Command): Command {
  return command
    .description("Run the Brain host in the foreground")
    .option("--model <fragment>", "explicit model to load after the host is ready");
}
export function addStartOptions(command: Command): Command {
  return command
    .description("Start Brain detached")
    .option("--model <fragment>", "explicit model to load");
}
export function addStopOptions(command: Command): Command {
  return command.description("Stop the exact locally owned Brain host");
}
export function addRestartOptions(command: Command): Command {
  return command
    .description("Restart the locally owned Brain host")
    .option("--model <fragment>", "explicit model to load");
}
export function addStatusOptions(command: Command): Command {
  return command.description("Show local Brain host health");
}

export async function runServeCommand(options: { model?: string }): Promise<void> {
  const [{ startService }, { createHostRuntime }] = await Promise.all([
    import("../service/serve.js"),
    import("../service/engine.js"),
  ]);
  const config = loadBrainConfig();
  let runtime!: ReturnType<typeof createHostRuntime>;
  const host = await startService({
    config,
    createRuntime: (context) => {
      runtime = createHostRuntime(context);
      return runtime;
    },
  });
  process.stdout.write(
    `Otto Brain listening on ${host.secure ? "https" : "http"}://${host.displayHost}:${host.port}\n`,
  );
  const shutdown = () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void host.stop().catch(() => {
      process.stderr.write("Otto Brain could not shut down cleanly.\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (options.model) {
    try {
      await runtime.pool.preload(pickModel(scanModels(config), options.model));
    } catch {
      process.stderr.write(
        "Brain could not load the selected model; the host remains available for management.\n",
      );
    }
  }
}
export async function runStartCommand(options: {
  model?: string;
}): Promise<AnyCommandResult<LifecycleRow>> {
  const state = await startLocalBrain(options);
  return result(state.status, state.record);
}
export async function runStopCommand(): Promise<AnyCommandResult<LifecycleRow>> {
  const state = await stopLocalBrain();
  return result(state.status, state.record);
}
export async function runRestartCommand(options: {
  model?: string;
}): Promise<AnyCommandResult<LifecycleRow>> {
  await stopLocalBrain();
  return runStartCommand(options);
}
export async function runStatusCommand(): Promise<AnyCommandResult<LifecycleRow>> {
  const record = readRunningService();
  if (!record) return result("stopped", null);
  try {
    await localBrainRequest({ record, config: loadBrainConfig() }, "/health");
    return result("running", record);
  } catch {
    return result("unreachable", record);
  }
}
