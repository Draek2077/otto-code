/** A command borrows the selected owner's transport; it never owns that host's lifetime. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostCommandPort } from "./host-command.js";

const selected = new AsyncLocalStorage<HostCommandPort>();
const localEnvironment = new AsyncLocalStorage<NodeJS.ProcessEnv>();

/** Foreground ownership is explicitly local and captures its home without mutating process.env. */
export function withBrainLocalEnvironment<T>(
  env: NodeJS.ProcessEnv,
  run: () => Promise<T>,
): Promise<T> {
  return localEnvironment.run({ ...env }, run);
}
export function selectedBrainLocalEnvironment(): NodeJS.ProcessEnv | undefined {
  return localEnvironment.getStore();
}

export function selectedBrainCommandHost(): HostCommandPort | undefined {
  return selected.getStore();
}

/** Scope persists through the handler's async work and cannot leak into another command. */
export function withBrainCommandHost<T>(
  host: HostCommandPort,
  execute: () => Promise<T>,
): Promise<T> {
  return selected.run(host, execute);
}
