import { afterEach, expect, test, vi } from "vitest";
import type { BrowserHistoryEntry } from "@getpaseo/plugin/otto/browser-history";
import { BrowserHistoryModel, browserHistoryVisit, type BrowserHistoryPort } from "./history-model";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
const entry = {
  url: "https://example.test/one",
  title: "One",
  visitedAt: "2026-01-01T00:00:00.000Z",
};
const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  const calls: string[] = [];
  const searches: { query: string; result: ReturnType<typeof deferred<BrowserHistoryEntry[]>> }[] =
    [];
  const record = { result: () => Promise.resolve() },
    clear = { result: () => Promise.resolve() };
  const port: BrowserHistoryPort = {
    search: (query) => {
      calls.push("search:" + query);
      const result = deferred<BrowserHistoryEntry[]>();
      searches.push({ query, result });
      return result.promise;
    },
    record: async (url, title) => {
      calls.push(`record:${url}:${title}`);
      await record.result();
    },
    clear: async () => {
      calls.push("clear");
      await clear.result();
    },
  };
  const model = new BrowserHistoryModel(port);
  const release = model.activate();
  releases.push(release);
  return { model, calls, searches, record, clear, release };
}
test("address edits debounce one scoped search and discard responses for the previous query", async () => {
  const f = fixture();
  f.model.focus(true);
  f.model.search("first");
  f.model.search("latest");
  await vi.advanceTimersByTimeAsync(120);
  expect(f.calls).toEqual(["search:latest"]);
  f.model.search("newer");
  await vi.advanceTimersByTimeAsync(120);
  f.searches[0]!.result.resolve([entry]);
  await Promise.resolve();
  expect(f.model.getSnapshot().entries).toEqual([]);
  f.searches[1]!.result.resolve([{ ...entry, title: "Newer" }]);
  await Promise.resolve();
  expect(f.model.getSnapshot()).toMatchObject({
    query: "newer",
    entries: [{ ...entry, title: "Newer" }],
    searching: false,
  });
});
test("hidden search cancels unsent work and cannot publish a late response after reactivation", async () => {
  const f = fixture();
  f.model.focus(true);
  await vi.advanceTimersByTimeAsync(120);
  f.release();
  const release = f.model.activate();
  releases.push(release);
  f.searches[0]!.result.resolve([entry]);
  await Promise.resolve();
  expect(f.model.getSnapshot().entries).toEqual([]);
  f.model.focus(true);
  f.model.search("unsent");
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.calls).toEqual(["search:"]);
});
test("keyboard selection wraps without replacing the typed address draft", async () => {
  const f = fixture();
  f.model.focus(true);
  f.model.search("typed");
  await vi.advanceTimersByTimeAsync(120);
  f.searches[0]!.result.resolve([entry, { ...entry, url: "https://example.test/two" }]);
  await Promise.resolve();
  f.model.move(-1);
  expect(f.model.selected()).toBe("https://example.test/two");
  f.model.move(1);
  expect(f.model.selected()).toBe(entry.url);
  expect(f.model.getSnapshot().query).toBe("typed");
  f.model.dismiss();
  expect(f.model.selected()).toBeNull();
});
test("navigation and title updates coalesce one visit without URL user information", async () => {
  const f = fixture();
  f.model.visit("https://user:secret@example.test/page", "Before");
  await vi.advanceTimersByTimeAsync(100);
  f.model.visit("https://user:secret@example.test/page", "After");
  await vi.advanceTimersByTimeAsync(180);
  expect(f.calls).toEqual(["record:https://example.test/page:After"]);
});
test.each([null, "file:///private", "javascript:alert(1)", "not a URL"])(
  "non-page navigation %s cannot become a history write",
  (url) => {
    expect(browserHistoryVisit(url, "Title")).toBeNull();
  },
);
test("record failure stays actionable; retry keeps its visit and admits only one pending write", async () => {
  const f = fixture();
  f.record.result = async () => {
    throw Error("private host path");
  };
  f.model.visit(entry.url, entry.title);
  await vi.advanceTimersByTimeAsync(180);
  expect(f.model.getSnapshot().visitError).toBe(
    "Could not save browsing history. Your saved history has been preserved.",
  );
  f.model.visit(null, "Loading");
  const pending = deferred<void>();
  f.record.result = () => pending.promise;
  f.model.retryVisit();
  f.model.retryVisit();
  await Promise.resolve();
  expect(f.calls).toEqual([
    `record:${entry.url}:${entry.title}`,
    `record:${entry.url}:${entry.title}`,
  ]);
  pending.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.model.getSnapshot().visitError).toBe("");
});
test("declining clear retains suggestions and never calls the host", async () => {
  const f = fixture();
  f.model.focus(true);
  await vi.advanceTimersByTimeAsync(120);
  f.searches[0]!.result.resolve([entry]);
  await Promise.resolve();
  expect(await f.model.clear(async () => false)).toBe(false);
  expect(f.model.getSnapshot().entries).toEqual([entry]);
  expect(f.calls).toEqual(["search:"]);
});
test("clear waits for admitted visits, cancels unsent work and rejects stale suggestions", async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.record.result = () => pending.promise;
  f.model.visit(entry.url, entry.title);
  await vi.advanceTimersByTimeAsync(180);
  f.model.focus(true);
  await vi.advanceTimersByTimeAsync(120);
  f.model.visit("https://example.test/unsent", "Unsent");
  const cleared = f.model.clear(async () => true);
  await Promise.resolve();
  expect(f.model.getSnapshot().clearing).toBe(true);
  expect(f.calls).not.toContain("clear");
  pending.resolve();
  expect(await cleared).toBe(true);
  f.searches[0]!.result.resolve([entry]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.calls).toEqual([`record:${entry.url}:${entry.title}`, "search:", "clear"]);
  expect(f.model.getSnapshot()).toMatchObject({
    cleared: true,
    clearing: false,
    entries: [],
    searching: false,
  });
});
test("a hidden confirmation cannot authorize clear after reactivation", async () => {
  const f = fixture();
  const confirmation = deferred<boolean>();
  const clearing = f.model.clear(() => confirmation.promise);
  f.release();
  releases.push(f.model.activate());
  confirmation.resolve(true);
  expect(await clearing).toBe(false);
  expect(f.calls).toEqual([]);
});
test("hidden clear acknowledgements cannot claim new success or leave a spinner stuck", async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.clear.result = () => pending.promise;
  const clearing = f.model.clear(async () => true);
  await Promise.resolve();
  await Promise.resolve();
  f.release();
  releases.push(f.model.activate());
  pending.resolve();
  await clearing;
  expect(f.model.getSnapshot()).toMatchObject({ clearing: false, cleared: false });
});
test("clear failures remain visible and require a fresh explicit retry", async () => {
  const f = fixture();
  f.clear.result = async () => {
    throw Error("private host path");
  };
  expect(await f.model.clear(async () => true)).toBe(false);
  expect(f.model.getSnapshot().clearError).toBe(
    "Could not clear browsing history. Retry when this host is available.",
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.calls).toEqual(["clear"]);
  f.clear.result = async () => {};
  expect(await f.model.clear(async () => true)).toBe(true);
  expect(f.model.getSnapshot()).toMatchObject({ clearError: "", cleared: true });
});
test("search failures reveal no host details and permit explicit search retry", async () => {
  const f = fixture();
  f.model.focus(true);
  await vi.advanceTimersByTimeAsync(120);
  f.searches[0]!.result.reject(Error("private host path"));
  await Promise.resolve();
  expect(f.model.getSnapshot().searchError).toBe("Could not load browsing history.");
  f.model.search("");
  await vi.advanceTimersByTimeAsync(120);
  f.searches[1]!.result.resolve([entry]);
  await Promise.resolve();
  expect(f.model.getSnapshot()).toMatchObject({ searchError: "", entries: [entry] });
});
