import { afterEach, expect, test, vi } from "vitest";
import { PageFindController, readPageFindResult, type FindableGuest } from "./find-controller";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
test("typing coalesces to the latest query without a search before the bar is active", async () => {
  vi.useFakeTimers();
  const execute = vi.fn<NonNullable<FindableGuest["executeJavaScript"]>>(async () => ({
    current: 1,
    total: 2,
    limited: false,
  }));
  const model = new PageFindController(() => ({ executeJavaScript: execute }));
  model.setQuery("not active");
  await vi.advanceTimersByTimeAsync(200);
  expect(execute).not.toHaveBeenCalled();
  const release = model.activate();
  model.setQuery("first");
  await vi.advanceTimersByTimeAsync(100);
  model.setQuery("café");
  model.setOption("wholeWords", true);
  await vi.advanceTimersByTimeAsync(150);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[0]).toContain('"query":"café"');
  expect(execute.mock.calls[0]?.[0]).toContain('"wholeWords":true');
  expect(model.getSnapshot().result).toEqual({ current: 1, total: 2, limited: false });
  release();
});
test("next and previous requests run serially, preserving every explicit navigation intent", async () => {
  const pending = deferred<unknown>();
  const execute = vi
    .fn<NonNullable<FindableGuest["executeJavaScript"]>>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ current: 2, total: 3, limited: false });
  const model = new PageFindController(() => ({ executeJavaScript: execute }));
  const release = model.activate();
  model.setQuery("match");
  model.run(0);
  await Promise.resolve();
  model.run(1);
  model.run(-1);
  expect(execute).toHaveBeenCalledTimes(1);
  pending.resolve({ current: 1, total: 3, limited: false });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
  expect(execute.mock.calls[1]?.[0]).toContain('"direction":1');
  expect(execute.mock.calls[2]?.[0]).toContain('"direction":-1');
  release();
});
test("a hidden late result cannot publish, and cleanup clears only the guest that was searched", async () => {
  const pending = deferred<unknown>();
  const execute = vi
    .fn<NonNullable<FindableGuest["executeJavaScript"]>>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ current: 0, total: 0, limited: false });
  const replacement = { executeJavaScript: vi.fn() };
  let guest: FindableGuest = { executeJavaScript: execute };
  const model = new PageFindController(() => guest);
  const release = model.activate();
  model.setQuery("match");
  model.run(0);
  await Promise.resolve();
  guest = replacement;
  release();
  pending.resolve({ current: 1, total: 9, limited: false });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(model.getSnapshot().result.total).toBe(0);
  expect(execute.mock.calls[1]?.[0]).toContain('"query":""');
  expect(replacement.executeJavaScript).not.toHaveBeenCalled();
});
test("invalid guest replies and evaluation failures show safe feedback while preserving the query for recovery", async () => {
  const execute = vi
    .fn<NonNullable<FindableGuest["executeJavaScript"]>>()
    .mockResolvedValueOnce({ current: 900, total: 1, limited: false })
    .mockRejectedValueOnce(Error("private guest diagnostics"))
    .mockResolvedValue({ current: 1, total: 1, limited: false });
  const model = new PageFindController(() => ({ executeJavaScript: execute }));
  const release = model.activate();
  model.setQuery("match");
  model.refresh();
  await vi.waitFor(() => expect(model.getSnapshot().error).toBe(true));
  expect(model.getSnapshot().query).toBe("match");
  model.refresh();
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  model.refresh();
  await vi.waitFor(() =>
    expect(model.getSnapshot()).toMatchObject({ error: false, result: { total: 1 } }),
  );
  release();
});
test("result validation accepts bounded counters and refuses malformed or inconsistent counts", () => {
  expect(readPageFindResult({ current: 0, total: 0, limited: false })).not.toBeNull();
  expect(readPageFindResult({ current: 10000, total: 10000, limited: true })).not.toBeNull();
  for (const raw of [
    null,
    [],
    { current: 0, total: 3, limited: false },
    { current: 1, total: 10001, limited: true },
    { current: 1.5, total: 3, limited: false },
    { current: 1, total: 3, limited: "false" },
  ])
    expect(readPageFindResult(raw)).toBeNull();
});
