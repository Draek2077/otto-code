import { vi } from "vitest";
import type {
  FileObserverCallback,
  FileObserverOptions,
  FileObserverSubscription,
} from "../server/file-observer/index.js";

/** Drives the normalized observer boundary without opening native handles. */
export function createWorkspaceFileObserver() {
  const records: Array<{
    directory: string;
    callback: FileObserverCallback;
    ignore: string[];
    subscription: FileObserverSubscription;
  }> = [];
  const subscribe = vi.fn(
    async (
      directory: string,
      callback: FileObserverCallback,
      options?: FileObserverOptions,
    ): Promise<FileObserverSubscription> => {
      const record: (typeof records)[number] = {
        directory,
        callback,
        ignore: options?.ignore ?? [],
        subscription: {
          updateIgnore: vi.fn(async (paths: string[]) => {
            record.ignore = paths;
          }),
          unsubscribe: vi.fn(async () => {}),
        },
      };
      records.push(record);
      return record.subscription;
    },
  );
  return { records, subscribe };
}

export function createWorkspaceWatcherCanary() {
  return {
    path: "",
    filterEvents: <T>(events: T): T => events,
    verify: vi.fn(async () => {}),
  };
}
