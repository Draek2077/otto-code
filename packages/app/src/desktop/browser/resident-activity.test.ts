import { describe, expect, it } from "vitest";
import {
  createResidentBrowserActivity,
  RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS,
  type ResidentBrowserActivityScheduler,
} from "./resident-activity";

class FakeScheduler implements ResidentBrowserActivityScheduler {
  private now = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  public setTimeout = (callback: () => void, delayMs: number): unknown => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.now + delayMs, callback });
    return handle;
  };

  public clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  public get pending(): number {
    return this.timers.size;
  }

  public advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = target;
  }
}

const IDLE_MS = 1_000;

function setup() {
  const scheduler = new FakeScheduler();
  const applied: Array<[string, boolean]> = [];
  const activity = createResidentBrowserActivity({
    idleMs: IDLE_MS,
    scheduler,
    setBackgrounded: (browserId, backgrounded) => applied.push([browserId, backgrounded]),
  });
  return { scheduler, applied, activity };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("resident browser activity", () => {
  it("uses a named idle grace inside the 10 to 30 second band", () => {
    expect(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS).toBeGreaterThanOrEqual(10_000);
    expect(RESIDENT_BROWSER_BACKGROUND_AFTER_IDLE_MS).toBeLessThanOrEqual(30_000);
  });

  it("starts a parked tab awake and backgrounds it after the idle grace", () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    expect(activity.isBackgrounded("a")).toBe(false);
    scheduler.advance(IDLE_MS - 1);
    expect(activity.isBackgrounded("a")).toBe(false);
    expect(applied).toEqual([]);
    scheduler.advance(1);
    expect(activity.isBackgrounded("a")).toBe(true);
    expect(applied).toEqual([["a", true]]);
  });

  it("never backgrounds a presented tab, and restarts the grace when it is parked", () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS / 2);
    activity.present("a");
    scheduler.advance(IDLE_MS * 10);
    expect(activity.isBackgrounded("a")).toBe(false);
    activity.park("a");
    scheduler.advance(IDLE_MS - 1);
    expect(activity.isBackgrounded("a")).toBe(false);
    scheduler.advance(1);
    expect(applied).toEqual([["a", true]]);
  });

  it("wakes a backgrounded tab synchronously when it is presented", () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS);
    activity.present("a");
    expect(activity.isBackgrounded("a")).toBe(false);
    expect(applied).toEqual([
      ["a", true],
      ["a", false],
    ]);
  });

  it("re-parking a parked tab does not extend its grace or wake it", () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS / 2);
    activity.park("a");
    scheduler.advance(IDLE_MS / 2);
    expect(activity.isBackgrounded("a")).toBe(true);
    activity.park("a");
    expect(activity.isBackgrounded("a")).toBe(true);
    expect(applied).toEqual([["a", true]]);
    expect(scheduler.pending).toBe(0);
  });

  it("wakes a backgrounded tab before an operation starts", async () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS);
    let backgroundedWhenOperationRan: boolean | null = null;
    const result = await activity.runAwake("a", async () => {
      backgroundedWhenOperationRan = activity.isBackgrounded("a");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(backgroundedWhenOperationRan).toBe(false);
    expect(applied).toEqual([
      ["a", true],
      ["a", false],
    ]);
  });

  it("stays awake while an operation runs, then backgrounds after the grace", async () => {
    const { scheduler, activity } = setup();
    activity.park("a");
    const operation = deferred<string>();
    const run = activity.runAwake("a", () => operation.promise);
    scheduler.advance(IDLE_MS * 5);
    expect(activity.isBackgrounded("a")).toBe(false);
    operation.resolve("done");
    await run;
    scheduler.advance(IDLE_MS - 1);
    expect(activity.isBackgrounded("a")).toBe(false);
    scheduler.advance(1);
    expect(activity.isBackgrounded("a")).toBe(true);
  });

  it("measures the grace from the last of several overlapping operations", async () => {
    const { scheduler, activity } = setup();
    activity.park("a");
    const first = deferred<void>();
    const second = deferred<void>();
    const runFirst = activity.runAwake("a", () => first.promise);
    const runSecond = activity.runAwake("a", () => second.promise);
    first.resolve();
    await runFirst;
    scheduler.advance(IDLE_MS * 2);
    expect(activity.isBackgrounded("a")).toBe(false);
    second.resolve();
    await runSecond;
    scheduler.advance(IDLE_MS / 2);
    // A follow-up operation inside the grace extends it.
    await activity.runAwake("a", async () => {});
    scheduler.advance(IDLE_MS - 1);
    expect(activity.isBackgrounded("a")).toBe(false);
    scheduler.advance(1);
    expect(activity.isBackgrounded("a")).toBe(true);
  });

  it("re-arms the grace when an operation fails", async () => {
    const { scheduler, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS);
    await expect(
      activity.runAwake("a", async () => {
        throw new Error("guest gone");
      }),
    ).rejects.toThrow("guest gone");
    expect(activity.isBackgrounded("a")).toBe(false);
    scheduler.advance(IDLE_MS);
    expect(activity.isBackgrounded("a")).toBe(true);
  });

  it("does not background a tab presented while an operation runs, after the operation ends", async () => {
    const { scheduler, activity } = setup();
    activity.park("a");
    const operation = deferred<void>();
    const run = activity.runAwake("a", () => operation.promise);
    activity.present("a");
    operation.resolve();
    await run;
    scheduler.advance(IDLE_MS * 5);
    expect(activity.isBackgrounded("a")).toBe(false);
  });

  it("runs operations on untracked tabs without tracking them", async () => {
    const { scheduler, applied, activity } = setup();
    await expect(activity.runAwake("hosted", async () => 7)).resolves.toBe(7);
    scheduler.advance(IDLE_MS * 5);
    expect(activity.isBackgrounded("hosted")).toBe(false);
    expect(applied).toEqual([]);
    expect(scheduler.pending).toBe(0);
  });

  it("forgets a closed tab, including a grace and an in-flight operation", async () => {
    const { scheduler, applied, activity } = setup();
    activity.park("a");
    activity.forget("a");
    scheduler.advance(IDLE_MS * 5);
    expect(applied).toEqual([]);

    activity.park("b");
    const operation = deferred<void>();
    const run = activity.runAwake("b", () => operation.promise);
    activity.forget("b");
    operation.resolve();
    await run;
    scheduler.advance(IDLE_MS * 5);
    expect(applied).toEqual([]);
    expect(scheduler.pending).toBe(0);
  });

  it("keeps tabs independent", () => {
    const { scheduler, activity } = setup();
    activity.park("a");
    scheduler.advance(IDLE_MS / 2);
    activity.park("b");
    scheduler.advance(IDLE_MS / 2);
    expect(activity.isBackgrounded("a")).toBe(true);
    expect(activity.isBackgrounded("b")).toBe(false);
    scheduler.advance(IDLE_MS / 2);
    expect(activity.isBackgrounded("b")).toBe(true);
  });
});
