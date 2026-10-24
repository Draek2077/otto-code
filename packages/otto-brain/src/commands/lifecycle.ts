import { loadBrainConfig } from "../config/store.js";
import { scanModels, pickModel } from "../models/index.js";
import type { AnyCommandResult, OutputSchema } from "../output/index.js";
import { readRunningService } from "../service/pid-lock.js";
import { startLocalBrain, stopLocalBrain } from "../service/lifecycle.js";
import { localBrainRequest } from "../service/local-client.js";
import { BrainServiceSession } from "../service/session.js";

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

export async function runServeCommand(options: { model?: string }): Promise<void> {
  const [{ startService }, { createHostRuntime }] = await Promise.all([
    import("../service/serve.js"),
    import("../service/engine.js"),
  ]);
  const session = new BrainServiceSession({
    readConfig: () => loadBrainConfig(),
    start: async (config, requestRestart, activation) => {
      let runtime!: ReturnType<typeof createHostRuntime>;
      const host = await startService({
        config,
        requestRestart,
        createRuntime: (context) => {
          runtime = createHostRuntime(context);
          return runtime;
        },
      });
      process.stdout.write(
        `Otto Brain listening on ${host.secure ? "https" : "http"}://${host.displayHost}:${host.port}\n`,
      );
      // Initial serve remains unloaded unless --model was explicit. An explicit
      // owner restart uses its requested model or the owner's saved default.
      const model =
        activation.kind === "initial" ? options.model : (activation.modelId ?? config.defaultModel);
      if (model) {
        void (async () => runtime.pool.preload(pickModel(scanModels(config), model)))().catch(
          () => {
            process.stderr.write(
              "Brain could not load the selected model; the host remains available for management.\n",
            );
          },
        );
      }
      return host;
    },
  });
  const shutdown = () => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void session.stop().catch(() => {
      process.stderr.write("Otto Brain could not shut down cleanly.\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await session.start();
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

export {
  addServeOptions,
  addStartOptions,
  addStopOptions,
  addRestartOptions,
  addStatusOptions,
} from "./options.js";
