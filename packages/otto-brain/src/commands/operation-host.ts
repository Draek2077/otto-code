/** Standalone operations reuse an owner, or explicitly own one temporary host. */
import { loadBrainConfig } from "../config/store.js";
import { readRunningService, readPidFile } from "../service/pid-lock.js";
import { startService, type StartServiceOptions } from "../service/serve.js";
import { createHostRuntime } from "../service/engine.js";
import type { LocalBrainClientOptions } from "../service/local-client.js";

export interface OperationHostOptions {
  env?: NodeJS.ProcessEnv;
  createRuntime?: StartServiceOptions["createRuntime"];
}

export async function withOperationHost<T>(
  run: (client: LocalBrainClientOptions) => Promise<T>,
  options: OperationHostOptions = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const persisted = loadBrainConfig(env);
  const running = readRunningService(env);
  if (running) return run({ record: running, config: persisted, env });
  // This loopback-only transport belongs to this one explicit operation. Its
  // port/TLS overrides are never persisted and never change another service.
  const config = {
    ...persisted,
    listen: { host: "127.0.0.1", port: 0 },
    tls: { ...persisted.tls, mode: "off" as const },
    allowRemoteConfig: false,
  };
  const service = await startService({
    config,
    env,
    createRuntime: options.createRuntime ?? createHostRuntime,
  });
  return completeOwnedOperation(
    async () => {
      const record = readPidFile(env);
      if (!record) throw new Error("Brain operation host has no ownership record");
      return await run({ record, config, env });
    },
    () => service.stop(),
  );
}

async function attempt<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function completeOwnedOperation<T>(
  run: () => Promise<T>,
  stop: () => Promise<void>,
): Promise<T> {
  const operation = await attempt(run);
  const cleanup = await attempt(stop);
  if (!operation.ok && !cleanup.ok)
    throw new AggregateError(
      [operation.error, cleanup.error],
      "Brain command and host shutdown failed",
      { cause: operation.error },
    );
  if (!operation.ok) throw operation.error;
  if (!cleanup.ok) throw cleanup.error;
  return operation.value;
}
