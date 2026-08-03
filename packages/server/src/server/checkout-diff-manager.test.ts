import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { toCheckoutErrorMock } = vi.hoisted(() => ({
  toCheckoutErrorMock: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}));

vi.mock("./checkout-git-utils.js", () => ({
  toCheckoutError: toCheckoutErrorMock,
}));

import type pino from "pino";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPendingManager() {
  const watches: Array<{
    cwd: string;
    onChange: () => void;
    unsubscribeCalls: number;
    resolve(): void;
  }> = [];
  const workspaceGitService = {
    getCheckoutDiff: async () => ({ diff: "", structured: [] }),
    requestWorkingTreeWatch: (cwd: string, onChange: () => void) => {
      const pending = createDeferred<{ repoRoot: string | null; unsubscribe: () => void }>();
      const watch = {
        cwd,
        onChange,
        unsubscribeCalls: 0,
        resolve: () => {
          pending.resolve({
            repoRoot: "/tmp/repo",
            unsubscribe: () => {
              watch.unsubscribeCalls += 1;
            },
          });
        },
      };
      watches.push(watch);
      return pending.promise;
    },
  };
  const logger = { child: () => logger, warn: () => {} };
  const manager = new CheckoutDiffManager({
    logger: logger as unknown as pino.Logger,
    ottoHome: "/tmp/otto-test",
    workspaceGitService,
  });
  return { manager, watches };
}

describe("CheckoutDiffManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toCheckoutErrorMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createManager(options?: {
    repoRoot?: string | null;
    getCheckoutDiffImplementation?: ReturnType<typeof vi.fn>;
  }) {
    const unsubscribe = vi.fn();
    let onChange: (() => void) | null = null;
    const mockRequestWorkingTreeWatch = vi.fn(async (_cwd: string, listener: () => void) => {
      onChange = listener;
      return {
        repoRoot: options?.repoRoot === undefined ? "/tmp/repo" : options.repoRoot,
        unsubscribe,
      };
    });

    const workspaceGitService = {
      subscribe: vi.fn(),
      peekSnapshot: vi.fn(),
      getSnapshot: vi.fn(),
      getCheckoutDiff:
        options?.getCheckoutDiffImplementation ?? vi.fn(async () => ({ diff: "", structured: [] })),
      refresh: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      requestWorkingTreeWatch: mockRequestWorkingTreeWatch,
      dispose: vi.fn(),
    };

    const logger = {
      child: () => logger,
      warn: vi.fn(),
    };

    const manager = new CheckoutDiffManager({
      logger: logger as unknown as pino.Logger,
      ottoHome: "/tmp/otto-test",
      workspaceGitService: workspaceGitService as unknown as WorkspaceGitService,
    });

    return {
      manager,
      workspaceGitService,
      mockRequestWorkingTreeWatch,
      unsubscribe,
      getOnChange: () => onChange,
    };
  }

  test("subscribe requests a working tree watch with the correct cwd", async () => {
    const { manager, mockRequestWorkingTreeWatch } = createManager();

    await manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
      },
      () => {},
    );

    expect(mockRequestWorkingTreeWatch).toHaveBeenCalledWith(
      "/tmp/repo/packages/server",
      expect.any(Function),
    );
  });

  test("unsubscribe calls the working tree watch unsubscribe", async () => {
    const { manager, unsubscribe } = createManager();

    const subscription = await manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
      },
      () => {},
    );

    subscription.unsubscribe();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("cancels a subscription while its working tree watch is still opening", async () => {
    const { manager, watches } = createPendingManager();
    const abort = new AbortController();

    const pendingSubscription = manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
        signal: abort.signal,
      },
      () => {},
    );
    abort.abort();
    watches[0].resolve();
    await pendingSubscription;

    expect(watches[0].unsubscribeCalls).toBe(1);
    expect(manager.getMetrics()).toEqual({
      checkoutDiffTargetCount: 0,
      checkoutDiffSubscriptionCount: 0,
      checkoutDiffWatcherCount: 0,
      checkoutDiffFallbackRefreshTargetCount: 0,
    });
  });

  test("shares one opening target between concurrent subscriptions", async () => {
    const { manager, watches } = createPendingManager();

    const firstSubscription = manager.subscribe(
      { cwd: "/tmp/repo/packages/server", compare: { mode: "uncommitted" } },
      () => {},
    );
    const secondSubscription = manager.subscribe(
      { cwd: "/tmp/repo/packages/server", compare: { mode: "uncommitted" } },
      () => {},
    );

    expect(watches).toHaveLength(1);
    watches[0].resolve();
    const [first, second] = await Promise.all([firstSubscription, secondSubscription]);
    expect(manager.getMetrics().checkoutDiffSubscriptionCount).toBe(2);

    first.unsubscribe();
    expect(watches[0].unsubscribeCalls).toBe(0);
    second.unsubscribe();
    expect(watches[0].unsubscribeCalls).toBe(1);
  });

  test("diffCwd uses repoRoot from the working tree watch result", async () => {
    const { manager, workspaceGitService } = createManager({ repoRoot: "/tmp/repo" });

    await manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
      },
      () => {},
    );

    expect(workspaceGitService.getCheckoutDiff).toHaveBeenCalledWith(
      "/tmp/repo",
      expect.objectContaining({ mode: "uncommitted", includeStructured: true }),
      undefined,
    );
  });

  interface DiffState {
    diff: string;
    files: Array<Record<string, unknown>>;
  }

  /**
   * Stands in for the real service: the structured read is the raw read plus the parsed and
   * highlighted half, so both must answer from the same underlying working tree.
   */
  function createDiffSource(initial: DiffState) {
    let current = initial;
    const getCheckoutDiff = vi.fn(async (_cwd: string, options: { includeStructured?: boolean }) =>
      options.includeStructured === true
        ? { diff: current.diff, structured: current.files }
        : { diff: current.diff },
    );
    return {
      getCheckoutDiff,
      setDiff(next: DiffState) {
        current = next;
      },
      structuredCallCount: () =>
        getCheckoutDiff.mock.calls.filter((call) => call[1].includeStructured === true).length,
    };
  }

  test("diff refresh is triggered when the working tree watch callback fires", async () => {
    const source = createDiffSource({
      diff: "raw-a",
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" }],
    });

    const { manager, getOnChange } = createManager({
      getCheckoutDiffImplementation: source.getCheckoutDiff,
    });
    const listener = vi.fn();

    await manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
      },
      listener,
    );

    const onChange = getOnChange();
    expect(onChange).toBeTypeOf("function");

    source.setDiff({
      diff: "raw-b",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
    });
    onChange?.();
    await vi.advanceTimersByTimeAsync(150);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      cwd: "/tmp/repo/packages/server",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
      error: null,
    });
  });

  test("watch-triggered refresh forces a cache bypass on getCheckoutDiff", async () => {
    const source = createDiffSource({
      diff: "raw-a",
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" }],
    });

    const { manager, getOnChange } = createManager({
      getCheckoutDiffImplementation: source.getCheckoutDiff,
    });

    await manager.subscribe(
      {
        cwd: "/tmp/repo/packages/server",
        compare: { mode: "uncommitted" },
      },
      vi.fn(),
    );

    expect(source.getCheckoutDiff).toHaveBeenNthCalledWith(
      1,
      "/tmp/repo",
      expect.objectContaining({ mode: "uncommitted" }),
      undefined,
    );

    source.setDiff({
      diff: "raw-b",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
    });
    const onChange = getOnChange();
    onChange?.();
    await vi.advanceTimersByTimeAsync(150);

    for (const watchFiredCall of source.getCheckoutDiff.mock.calls.slice(1)) {
      expect(watchFiredCall[2]).toEqual({
        force: true,
        reason: expect.stringContaining("working-tree"),
      });
    }
    expect(source.structuredCallCount()).toBe(2);
  });

  test("an unchanged raw diff skips structuring, highlighting and the listener fan-out", async () => {
    const source = createDiffSource({
      diff: "raw-a",
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" }],
    });

    const { manager, getOnChange } = createManager({
      getCheckoutDiffImplementation: source.getCheckoutDiff,
    });
    const listener = vi.fn();

    await manager.subscribe(
      { cwd: "/tmp/repo/packages/server", compare: { mode: "uncommitted" } },
      listener,
    );
    expect(source.structuredCallCount()).toBe(1);

    getOnChange()?.();
    await vi.advanceTimersByTimeAsync(150);

    // The wakeup cost one raw read and nothing else.
    expect(source.getCheckoutDiff).toHaveBeenCalledTimes(2);
    expect(source.getCheckoutDiff.mock.calls[1][1]).toMatchObject({ includeStructured: false });
    expect(source.structuredCallCount()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  test("a changed raw diff falls through to the structured read on the next wakeup", async () => {
    const source = createDiffSource({
      diff: "raw-a",
      files: [{ path: "a.ts", additions: 1, deletions: 0, status: "modified" }],
    });

    const { manager, getOnChange } = createManager({
      getCheckoutDiffImplementation: source.getCheckoutDiff,
    });
    const listener = vi.fn();

    await manager.subscribe(
      { cwd: "/tmp/repo/packages/server", compare: { mode: "uncommitted" } },
      listener,
    );

    getOnChange()?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(listener).not.toHaveBeenCalled();

    source.setDiff({
      diff: "raw-b",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
    });
    getOnChange()?.();
    await vi.advanceTimersByTimeAsync(150);

    expect(source.structuredCallCount()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      cwd: "/tmp/repo/packages/server",
      files: [{ path: "b.ts", additions: 2, deletions: 0, status: "modified" }],
      error: null,
    });
  });

  test("a failed raw probe still runs the full read so subscribers see the error", async () => {
    let failProbe = false;
    const getCheckoutDiff = vi.fn(
      async (_cwd: string, options: { includeStructured?: boolean }) => {
        if (options.includeStructured !== true) {
          if (failProbe) {
            throw new Error("probe exploded");
          }
          return { diff: "raw-a" };
        }
        return { diff: "raw-a", structured: [{ path: "a.ts" }] };
      },
    );

    const { manager, getOnChange } = createManager({
      getCheckoutDiffImplementation: getCheckoutDiff,
    });
    const listener = vi.fn();

    await manager.subscribe(
      { cwd: "/tmp/repo/packages/server", compare: { mode: "uncommitted" } },
      listener,
    );

    failProbe = true;
    getOnChange()?.();
    await vi.advanceTimersByTimeAsync(150);

    const structuredCalls = getCheckoutDiff.mock.calls.filter(
      (call) => call[1].includeStructured === true,
    );
    expect(structuredCalls).toHaveLength(2);
  });

  test("falls back to cwd when the working tree watch returns no repo root", async () => {
    const { manager, workspaceGitService } = createManager({ repoRoot: null });

    await manager.subscribe(
      {
        cwd: "/tmp/plain",
        compare: { mode: "uncommitted" },
      },
      () => {},
    );

    expect(workspaceGitService.getCheckoutDiff).toHaveBeenCalledWith(
      "/tmp/plain",
      expect.objectContaining({ mode: "uncommitted", includeStructured: true }),
      undefined,
    );
  });
});
