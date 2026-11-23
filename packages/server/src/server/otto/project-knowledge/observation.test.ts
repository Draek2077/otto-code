import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import type { FileObserver, FileObserverCallback } from "../../file-observer/index.js";
import { KnowledgeObservations, knowledgeObservationPlan } from "./observation.js";
import type { KnowledgeStore } from "./store-resolver.js";

const parent = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-observation/", import.meta.url),
);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).toReversed()) await close();
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  cleanup.push(async () => {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  });
  const store: KnowledgeStore = {
    projectId: "project-a",
    projectRoot: root,
    boundary: root,
    base: path.join(root, ".otto"),
    location: "repository",
  };
  const callbacks: FileObserverCallback[] = [];
  const subscriptions: {
    root: string;
    unsubscribe: ReturnType<typeof vi.fn>;
    updateIgnore: ReturnType<typeof vi.fn>;
  }[] = [];
  const observer: FileObserver = {
    subscribe: vi.fn(async (directory, callback) => {
      callbacks.push(callback);
      const subscription = {
        root: directory,
        unsubscribe: vi.fn(async () => {}),
        updateIgnore: vi.fn(async () => {}),
      };
      subscriptions.push(subscription);
      return subscription;
    }),
    close: vi.fn(async () => {}),
    getDiagnostics: () => {
      throw new Error("Not needed by consumer");
    },
  };
  const feeds = new KnowledgeObservations({
    resolve: async () => store,
    createObserver: () => observer,
  });
  cleanup.push(() => feeds.close());
  return { root, store, feeds, observer, callbacks, subscriptions };
}
it("prunes unrelated project trees and follows an external first-store creation", async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, "node_modules"));
  expect(await knowledgeObservationPlan(f.store)).toEqual({
    root: f.root,
    ignore: [path.join(f.root, "node_modules")],
  });
  const first = await f.feeds.wait("session", "lease", "project-a", null);
  expect(f.subscriptions[0].root).toBe(f.root);
  vi.useFakeTimers();
  await mkdir(path.join(f.store.base, "knowledge"), { recursive: true });
  f.callbacks[0](null, [{ path: f.store.base, type: "create" }]);
  const pending = f.feeds.wait("session", "lease", "project-a", first.cursor);
  await vi.advanceTimersByTimeAsync(150);
  expect((await pending).cursor).not.toBe(first.cursor);
  await f.feeds.wait("session", "lease", "project-a", null);
  expect(f.subscriptions).toHaveLength(2);
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(f.subscriptions[1].root).toBe(f.store.base);
});
it("shares one observer and debounces bursts across paired sessions", async () => {
  const f = await fixture();
  const first = await f.feeds.wait("one", "lease", "project-a", null);
  const second = await f.feeds.wait("two", "lease", "project-a", null);
  expect(second.cursor).toBe(first.cursor);
  expect(f.observer.subscribe).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  const a = f.feeds.wait("one", "lease", "project-a", first.cursor);
  const b = f.feeds.wait("two", "lease", "project-a", first.cursor);
  const changed = vi.fn();
  void a.then(changed);
  for (let n = 0; n < 10; n++) f.callbacks[0](null, [{ path: f.store.base, type: "update" }]);
  await vi.advanceTimersByTimeAsync(149);
  expect(changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect((await a).cursor).toBe((await b).cursor);
  await f.feeds.releaseClient("one");
  expect(f.subscriptions[0].unsubscribe).not.toHaveBeenCalled();
  await f.feeds.releaseClient("two");
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
});
it("delivers committed own writes immediately and waits without rereading on heartbeats", async () => {
  const f = await fixture();
  const first = await f.feeds.wait("one", "lease", "project-a", null);
  vi.useFakeTimers();
  const waiting = f.feeds.wait("one", "lease", "project-a", first.cursor);
  await vi.advanceTimersByTimeAsync(20000);
  expect((await waiting).cursor).toBe(first.cursor);
  expect(f.observer.subscribe).toHaveBeenCalledOnce();
  const next = f.feeds.wait("one", "lease", "project-a", first.cursor);
  f.feeds.notify("project-a");
  expect((await next).cursor).not.toBe(first.cursor);
});
it("scopes releases to paired sessions, rejects lease rebinding and cancels late work on close", async () => {
  const f = await fixture();
  const first = await f.feeds.wait("one", "lease", "project-a", null);
  await expect(f.feeds.wait("one", "lease", "other-project", null)).rejects.toThrow(
    "changed project",
  );
  await f.feeds.release("other-session", "lease");
  const waiting = f.feeds.wait("one", "lease", "project-a", first.cursor);
  await Promise.resolve();
  await expect(f.feeds.wait("one", "lease", "project-a", null)).rejects.toThrow("pending wait");
  const rejected = expect(waiting).rejects.toThrow("released");
  await f.feeds.close();
  await rejected;
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(f.observer.close).toHaveBeenCalledOnce();
  await expect(f.feeds.wait("one", "new", "project-a", null)).rejects.toThrow("live paired");
});
it("reports observer failure safely and expires abandoned demand", async () => {
  const f = await fixture();
  const first = await f.feeds.wait("one", "lease", "project-a", null);
  vi.useFakeTimers();
  f.callbacks[0](new Error("private host path"), []);
  const failed = await f.feeds.wait("one", "lease", "project-a", first.cursor);
  expect(failed.error).toContain("Refresh manually");
  expect(failed.error).not.toContain("private");
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
});
it("rebinds a store move before reading its next cursor and closes the old subscription", async () => {
  const f = await fixture();
  await f.feeds.wait("one", "lease", "project-a", null);
  await mkdir(path.join(f.root, "host-store"));
  f.store.base = path.join(f.root, "host-store");
  f.feeds.notify("project-a");
  await f.feeds.wait("one", "lease", "project-a", null);
  expect(f.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
  expect(f.subscriptions[1].root).toBe(f.store.base);
});
