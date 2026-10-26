import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { HostBrowserPages } from "./pages.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fakePage() {
  let closed = false;
  return {
    isClosed: () => closed,
    close: vi.fn(async () => {
      closed = true;
    }),
  };
}
const managers: Array<HostBrowserPages<ReturnType<typeof fakePage>>> = [];
const binding = { workspaceId: "workspace", cwd: "host-project" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close();
  vi.useRealTimers();
});
function fixture() {
  const pages: Array<ReturnType<typeof fakePage>> = [];
  const open = vi.fn(async () => {
    const page = fakePage();
    pages.push(page);
    return page;
  });
  const close = vi.fn(async () => {
    for (const page of pages) await page.close();
  });
  const manager = new HostBrowserPages({ open, close });
  managers.push(manager);
  return { manager, open, close, pages };
}
test("construction and workspace inventory do not launch or schedule; a create returns a host-owned identity", async () => {
  const f = fixture();
  expect(f.manager.list(binding.workspaceId)).toEqual([]);
  expect(f.open).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  const tab = await f.manager.create(binding, "https://example.test");
  expect(tab).toMatchObject({
    ...binding,
    state: "ready",
    viewportWidth: 390,
    viewportHeight: 844,
  });
  expect(f.manager.list("peer")).toEqual([]);
  await expect(f.manager.use("peer", tab.browserId, async () => {})).rejects.toThrow("workspace");
  expect(f.open).toHaveBeenCalledTimes(1);
});
test("four live pages are bounded under concurrent creates and inactive pages alone yield capacity", async () => {
  const f = fixture();
  const tabs = await Promise.all(
    Array.from({ length: 8 }, (_, id) => f.manager.create(binding, `https://example.test/${id}`)),
  );
  expect(f.pages.filter((page) => !page.isClosed())).toHaveLength(4);
  expect(f.manager.list(binding.workspaceId)).toHaveLength(8);
  expect(f.manager.get(binding.workspaceId, tabs[0].browserId).state).toBe("suspended");
});
test("active leases prevent eviction; one explicit release permits a new page without closing a peer viewer", async () => {
  const f = fixture();
  const tabs = await Promise.all(
    Array.from({ length: 4 }, () => f.manager.create(binding, "https://example.test")),
  );
  const leases = await Promise.all(
    tabs.map((tab) => f.manager.acquire(binding.workspaceId, tab.browserId)),
  );
  await expect(f.manager.create(binding, "https://example.test/blocked")).rejects.toThrow(
    "Four Host Browser",
  );
  expect(f.manager.list(binding.workspaceId)).toHaveLength(4);
  leases[0].release();
  await f.manager.create(binding, "https://example.test/next");
  expect(f.pages[0].isClosed()).toBe(true);
  for (const lease of leases.slice(1)) {
    expect(lease.page.isClosed()).toBe(false);
    lease.release();
  }
});
test("five idle minutes suspend pixels, retain metadata and wake only on a new explicit operation", async () => {
  const f = fixture(),
    tab = await f.manager.create(binding, "https://example.test");
  f.manager.update(binding.workspaceId, tab.browserId, {
    title: "Retained",
    url: "https://example.test/visited",
  });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(f.manager.get(binding.workspaceId, tab.browserId)).toMatchObject({
    title: "Retained",
    state: "suspended",
  });
  expect(f.open).toHaveBeenCalledTimes(1);
  await f.manager.use(binding.workspaceId, tab.browserId, async () => {});
  expect(f.open).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: "https://example.test/visited" }),
  );
  expect(f.open).toHaveBeenCalledTimes(2);
});
test("a hidden viewer release is idempotent and a visible lease has no idle timer", async () => {
  const f = fixture(),
    tab = await f.manager.create(binding, "https://example.test");
  const lease = await f.manager.acquire(binding.workspaceId, tab.browserId);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(lease.page.isClosed()).toBe(false);
  lease.release();
  lease.release();
  expect(vi.getTimerCount()).toBe(1);
  await f.manager.remove(binding.workspaceId, tab.browserId);
  expect(vi.getTimerCount()).toBe(0);
});
test("commands on one page serialize while other pages remain usable", async () => {
  const f = fixture(),
    tab = await f.manager.create(binding, "https://example.test");
  const gate = deferred<void>(),
    started = deferred<void>(),
    order: string[] = [];
  const first = f.manager.use(binding.workspaceId, tab.browserId, async () => {
    order.push("first");
    started.resolve();
    await gate.promise;
  });
  await started.promise;
  const second = f.manager.use(binding.workspaceId, tab.browserId, async () => {
    order.push("second");
  });
  const peer = await f.manager.create(binding, "https://example.test/peer");
  await f.manager.use(binding.workspaceId, peer.browserId, async () => {
    order.push("peer");
  });
  expect(order).toEqual(["first", "peer"]);
  gate.resolve();
  await first;
  await second;
  expect(order).toEqual(["first", "peer", "second"]);
});
test("failed runtime admission leaves no invisible identity or automatic launch retry", async () => {
  const f = fixture();
  f.open.mockRejectedValueOnce(new Error("runtime absent"));
  await expect(f.manager.create(binding, "https://example.test")).rejects.toThrow("runtime absent");
  expect(f.manager.list(binding.workspaceId)).toEqual([]);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.open).toHaveBeenCalledTimes(1);
  await f.manager.create(binding, "https://example.test");
  expect(f.open).toHaveBeenCalledTimes(2);
});
test("shutdown during launch closes the eventual page, rejects its identity and never revives demand", async () => {
  const f = fixture(),
    pending = deferred<ReturnType<typeof fakePage>>(),
    started = deferred<void>();
  f.open.mockImplementationOnce(async () => {
    started.resolve();
    return pending.promise;
  });
  const creation = f.manager.create(binding, "https://example.test");
  const failed = expect(creation).rejects.toThrow("closed");
  await started.promise;
  const shutdown = f.manager.close(),
    page = fakePage();
  pending.resolve(page);
  await failed;
  await shutdown;
  expect(page.close).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  await expect(f.manager.create(binding, "https://example.test")).rejects.toThrow("closed");
});
test("native runtime creation does not inherit an RPC's asynchronous source context", async () => {
  const source = new AsyncLocalStorage<string>();
  const f = fixture();
  f.open.mockImplementationOnce(async () => {
    expect(source.getStore()).toBeUndefined();
    return fakePage();
  });
  await source.run("viewer-socket", () => f.manager.create(binding, "https://example.test"));
});
test("a reached error page preserves its actionable navigation error after runtime admission", async () => {
  const f = fixture();
  f.open.mockImplementationOnce(async () => {
    const pending = f.manager.list(binding.workspaceId)[0];
    f.manager.update(binding.workspaceId, pending.browserId, {
      error: "The page could not be reached.",
    });
    return fakePage();
  });
  const tab = await f.manager.create(binding, "https://unreachable.test");
  expect(tab.error).toBe("The page could not be reached.");
  expect(tab.state).toBe("ready");
});
