import { afterEach, expect, test, vi } from "vitest";
import { hostBrowserDeadline } from "./deadline.js";
afterEach(() => vi.useRealTimers());
test("a successful or rejected action clears its deadline without closing the page", async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => {});
  expect(await hostBrowserDeadline(async () => "done", close, 10)).toBe("done");
  await expect(
    hostBrowserDeadline(
      async () => {
        throw new Error("primary");
      },
      close,
      10,
    ),
  ).rejects.toThrow("primary");
  await vi.advanceTimersByTimeAsync(20);
  expect(close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
test("a hung evaluation closes its owned page once and cannot turn a late result into success", async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => {});
  let complete!: (value: string) => void;
  const result = hostBrowserDeadline(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    close,
    10,
  );
  const failed = expect(result).rejects.toMatchObject({ code: "browser_timeout" });
  await vi.advanceTimersByTimeAsync(10);
  await failed;
  complete("too late");
  await vi.advanceTimersByTimeAsync(100);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
