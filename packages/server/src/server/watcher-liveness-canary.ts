import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange } from "./file-observer/index.js";
import { waitForWatcherCanary } from "./otto/file-observation/liveness.js"; // OTTO(watcher-readiness): native stream startup can miss the initial create.

export const WATCHER_LIVENESS_CANARY_TIMEOUT_MS = 10_000;

export interface WatcherLivenessCanary {
  readonly path: string;
  filterEvents(events: FileChange[]): FileChange[];
  verify(signal?: AbortSignal): Promise<void>;
}

export function createWatcherLivenessCanary(
  watchRoot: string,
  options: { timeoutMs?: number } = {},
): WatcherLivenessCanary {
  const canaryPath = join(watchRoot, `.paseo-watcher-canary-${randomUUID()}`);
  const timeoutMs = options.timeoutMs ?? WATCHER_LIVENESS_CANARY_TIMEOUT_MS;
  let reportCanary!: () => void;
  const reported = new Promise<void>((resolve) => {
    reportCanary = resolve;
  });

  return {
    path: canaryPath,
    filterEvents(events) {
      const filtered = events.filter((event) => event.path !== canaryPath);
      if (filtered.length !== events.length) {
        reportCanary();
      }
      return filtered;
    },
    async verify(signal) {
      const file = await open(canaryPath, "wx");
      try {
        await file.writeFile("paseo watcher liveness canary\n");
        // OTTO(watcher-readiness): keep the existing deadline and callback proof;
        // only this temporary canary is re-signaled while startup is unverified.
        await waitForWatcherCanary({
          watchRoot,
          timeoutMs,
          reported,
          signal,
          // Keep the exclusively created handle: a replaced path must never
          // redirect a readiness probe into another file.
          touch: async () => {
            await file.write("paseo watcher liveness canary\n", 0, "utf8");
          },
        });
      } finally {
        try {
          await file.close();
        } finally {
          await rm(canaryPath, { force: true });
        }
      }
    },
  };
}
