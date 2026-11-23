/** Standalone/daemon lifecycle. No bare PID is ever used as permission to stop a process. */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ensurePrivateDirectory } from "../config/private-files.js";
import { resolveBrainPaths } from "../config/paths.js";
import { loadBrainConfig } from "../config/store.js";
import { isProcessAlive, readRunningService, readPidFile, type PidRecord } from "./pid-lock.js";
import { localBrainRequest } from "./local-client.js";

export interface LocalBrainState {
  status: "stopped" | "starting" | "running";
  record: PidRecord | null;
}

export async function startLocalBrain(
  options: { env?: NodeJS.ProcessEnv; model?: string; signal?: AbortSignal } = {},
): Promise<LocalBrainState> {
  const env = options.env ?? process.env;
  options.signal?.throwIfAborted();
  if (readRunningService(env)) throw new Error("Brain is already running");
  const entry = fileURLToPath(new URL("../main.js", import.meta.url));
  if (!existsSync(entry))
    throw new Error("Build the standalone Brain package before starting it detached");
  const paths = resolveBrainPaths(env);
  ensurePrivateDirectory(paths.root);
  const descriptor = openSync(paths.logFile, "a", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    const args = [entry, "serve"];
    if (options.model) args.push("--model", options.model);
    child = spawn(process.execPath, args, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", descriptor, descriptor],
      env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1" },
    });
  } finally {
    closeSync(descriptor);
  }
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const record = readRunningService(env);
    if (record && record.pid !== child.pid)
      throw new Error("Another Brain host acquired the home during startup");
    if (record) {
      try {
        await localBrainRequest(
          { env, record, config: loadBrainConfig(env) },
          "/health",
          undefined,
          options.signal,
        );
        return { status: "running", record };
      } catch {
        options.signal?.throwIfAborted();
      }
    }
    if (!child.pid || !isProcessAlive(child.pid))
      throw new Error("Brain exited during startup; inspect its local log");
    await delay(100, undefined, { signal: options.signal });
  }
  // A slow readiness probe is not authority to kill or restart an otherwise live owner.
  return { status: "starting", record: readPidFile(env) };
}

export async function stopLocalBrain(
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<LocalBrainState> {
  const record = readRunningService(env);
  if (!record) return { status: "stopped", record: null };
  // COMPAT(brainPidOwnership): added in v0.10.0, remove after 2027-04-23.
  if (!record.instanceId)
    throw new Error(
      "This Brain host predates safe local control; stop it through its owning terminal",
    );
  await localBrainRequest(
    { record, env, config: loadBrainConfig(env) },
    "/__host/local/stop",
    { instanceId: record.instanceId },
    signal,
  );
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const current = readPidFile(env);
    if (!current) return { status: "stopped", record: null };
    if (current.instanceId !== record.instanceId)
      throw new Error("Brain host lifetime changed while stopping");
    await delay(100, undefined, { signal });
  }
  throw new Error("Brain has not finished stopping; its ownership record was retained");
}
