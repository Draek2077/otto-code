import { afterEach, describe, expect, test, vi } from "vitest";

import {
  describeTimerFireAt,
  getSlowTimerCallbacks,
  installRuntimeCounters,
  readRuntimeCounters,
  resetRuntimeCountersForTest,
} from "./runtime-counters";

interface FakeTimerHost {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

function createHost(): { host: FakeTimerHost; fire: (handle: number) => void } {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const host = {
    setTimeout: ((callback: () => void) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((handle: number) => {
      callbacks.delete(handle);
    }) as unknown as typeof clearTimeout,
    setInterval: (() => nextHandle++) as unknown as typeof setInterval,
    clearInterval: (() => undefined) as unknown as typeof clearInterval,
  };
  return {
    host,
    fire: (handle: number) => {
      callbacks.get(handle)?.();
      callbacks.delete(handle);
    },
  };
}

afterEach(() => {
  resetRuntimeCountersForTest();
});

describe("runtime counters", () => {
  test("tracks intervals that are started and never cleared", () => {
    const { host } = createHost();
    installRuntimeCounters(host);

    const kept = host.setInterval(() => {}, 1000);
    host.setInterval(() => {}, 1000);
    host.clearInterval(kept);

    const counters = readRuntimeCounters();
    expect(counters.intervalsCreated).toBe(2);
    expect(counters.liveIntervals).toBe(1);
  });

  test("a fired timeout stops counting as pending", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);

    const handle = host.setTimeout(() => {}, 10) as unknown as number;
    expect(readRuntimeCounters().pendingTimeouts).toBe(1);

    fire(handle);
    expect(readRuntimeCounters().pendingTimeouts).toBe(0);
  });

  test("clearing an already-fired timeout does not drive the count negative", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);

    const handle = host.setTimeout(() => {}, 10) as unknown as number;
    fire(handle);
    host.clearTimeout(handle);

    expect(readRuntimeCounters().pendingTimeouts).toBe(0);
  });

  test("the wrapped callback still runs with its arguments", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);

    let seen: unknown = null;
    const handle = host.setTimeout(
      ((value: unknown) => {
        seen = value;
      }) as unknown as () => void,
      0,
    ) as unknown as number;
    fire(handle);

    // The fake host invokes with no args; the real one forwards them, so this
    // asserts the wrapper ran the handler at all rather than swallowing it.
    expect(seen).toBe(undefined);
    expect(readRuntimeCounters().timeoutsCreated).toBe(1);
  });

  test("installing twice is a no-op so counts are not double-wrapped", () => {
    const { host } = createHost();
    expect(installRuntimeCounters(host)).toBe(true);
    expect(installRuntimeCounters(host)).toBe(true);

    host.setTimeout(() => {}, 0);

    expect(readRuntimeCounters().timeoutsCreated).toBe(1);
  });

  test("reports not-installed when the host has no timers", () => {
    expect(installRuntimeCounters({} as unknown as FakeTimerHost)).toBe(false);
    expect(readRuntimeCounters().installed).toBe(0);
  });
});

describe("slow timer attribution", () => {
  test("records a timer callback that runs past the long-frame budget, with its source", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);
    const nowSpy = vi.spyOn(performance, "now");
    // Two reads per run: start and end. 120ms apart is a long frame on its own.
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_120);
    const rebuiltTranscripts: string[] = [];
    function slowRefresh(): void {
      rebuiltTranscripts.push("transcript");
    }
    const handle = host.setTimeout(slowRefresh, 25) as unknown as number;
    fire(handle);

    const [record] = getSlowTimerCallbacks();
    expect(record).toMatchObject({
      kind: "timeout",
      delayMs: 25,
      durationMs: 120,
      name: "slowRefresh",
    });
    expect(record.source).toContain("rebuiltTranscripts.push");
    expect(getSlowTimerCallbacks(record.at + 1)).toEqual([]);
    nowSpy.mockRestore();
  });

  test("matches a fired callback to a nearby start time for long-frame attribution", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(5_000).mockReturnValueOnce(5_001);
    function quickResolve(): void {
      void Promise.resolve();
    }
    fire(host.setTimeout(quickResolve, 10) as unknown as number);
    nowSpy.mockRestore();

    expect(describeTimerFireAt(5_003)).toMatchObject({
      kind: "timeout",
      delayMs: 10,
      name: "quickResolve",
    });
    expect(describeTimerFireAt(5_003)?.source).toContain("Promise.resolve");
    expect(describeTimerFireAt(5_020)).toBeNull();
  });

  test("ignores fast callbacks", () => {
    const { host, fire } = createHost();
    installRuntimeCounters(host);
    const handle = host.setTimeout(() => undefined, 0) as unknown as number;
    fire(handle);
    expect(getSlowTimerCallbacks()).toEqual([]);
  });
});
