/** A command borrows the selected owner's transport; it never owns that host's lifetime. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostCommandPort } from "./host-command.js";

const selected = new AsyncLocalStorage<HostCommandPort>();

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
