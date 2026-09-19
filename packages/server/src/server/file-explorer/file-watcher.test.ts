import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { SessionFileWatcher, type FileWatchChange } from "./file-watcher.js";

class DirectoryWatches {
  opened = 0;
  closed = 0;
  readonly watchers: EventEmitter[] = [];

  readonly watchDirectory = (): FSWatcher => {
    this.opened += 1;
    const watcher = Object.assign(new EventEmitter(), {
      close: () => {
        this.closed += 1;
      },
    });
    this.watchers.push(watcher);
    return watcher as unknown as FSWatcher;
  };
}

const roots: string[] = [];
const watchers: SessionFileWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-session-file-watcher-"));
  roots.push(root);
  return root;
}

function createWatcher(options: { maxHashBytes?: number; watches?: DirectoryWatches }) {
  const events: FileWatchChange[] = [];
  const watcher = new SessionFileWatcher({
    logger: createTestLogger(),
    emitEvent: (event) => events.push(event),
    pollIntervalMs: 20,
    debounceMs: 5,
    maxHashBytes: options.maxHashBytes,
    watchDirectory: options.watches?.watchDirectory,
  });
  watchers.push(watcher);
  return { watcher, events };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("SessionFileWatcher", () => {
  test("reports a content change with its hash", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.txt"), "one");
    const { watcher, events } = createWatcher({ watches: new DirectoryWatches() });
    await watcher.subscribe({ cwd: root, path: "a.txt" });

    await writeFile(path.join(root, "a.txt"), "two!");

    await waitFor(() => events.length > 0);
    expect(events[0]).toMatchObject({ path: "a.txt", change: "changed", size: 4 });
    expect(events[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("reports a change to a file over the hashing limit without a hash", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "big.log"), "x".repeat(64));
    const { watcher, events } = createWatcher({
      maxHashBytes: 16,
      watches: new DirectoryWatches(),
    });
    await watcher.subscribe({ cwd: root, path: "big.log" });

    await writeFile(path.join(root, "big.log"), "y".repeat(80));

    await waitFor(() => events.length > 0);
    expect(events[0]).toMatchObject({ change: "changed", hash: null, size: 80 });
    expect(events[0]?.modifiedAt).not.toBeNull();
  });

  test("opens one directory watcher for concurrent subscribes and closes it", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.txt"), "one");
    const watches = new DirectoryWatches();
    const { watcher } = createWatcher({ watches });

    await Promise.all([
      watcher.subscribe({ cwd: root, path: "a.txt" }),
      watcher.subscribe({ cwd: root, path: "a.txt" }),
    ]);
    watcher.unsubscribe({ cwd: root, path: "a.txt" });

    expect(watches.opened).toBe(1);
    expect(watches.closed).toBe(1);
  });

  test("an unsubscribe during a pending subscribe opens nothing", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.txt"), "one");
    const watches = new DirectoryWatches();
    const { watcher, events } = createWatcher({ watches });

    const subscribing = watcher.subscribe({ cwd: root, path: "a.txt" });
    watcher.unsubscribe({ cwd: root, path: "a.txt" });
    await subscribing;
    await writeFile(path.join(root, "a.txt"), "two, longer");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(watches.opened).toBe(0);
    expect(events).toEqual([]);
  });

  test("a resubscribe after an unsubscribe during a pending subscribe stays subscribed", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.txt"), "one");
    const watches = new DirectoryWatches();
    const { watcher, events } = createWatcher({ watches });

    const first = watcher.subscribe({ cwd: root, path: "a.txt" });
    watcher.unsubscribe({ cwd: root, path: "a.txt" });
    await Promise.all([first, watcher.subscribe({ cwd: root, path: "a.txt" })]);
    await writeFile(path.join(root, "a.txt"), "two, longer");

    await waitFor(() => events.length > 0);
    expect(watches.opened).toBe(1);
  });

  test("a directory watcher error falls back to polling instead of throwing", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "a.txt"), "one");
    const watches = new DirectoryWatches();
    const { watcher, events } = createWatcher({ watches });
    await watcher.subscribe({ cwd: root, path: "a.txt" });

    watches.watchers[0]?.emit("error", new Error("EPERM"));
    await writeFile(path.join(root, "a.txt"), "two, longer");

    await waitFor(() => events.length > 0);
    expect(watches.closed).toBe(1);
    expect(events[0]).toMatchObject({ change: "changed" });
  });
});
