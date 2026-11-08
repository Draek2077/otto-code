import { expect, test, vi } from "vitest";
import { ScheduleRuntime, ScheduleExecutionError, type PreparedScheduleTarget } from "./runtime.js";
import { ScheduleError } from "./files.js";
import type { ScheduleAudit, StoredSchedule } from "./types.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function record(): StoredSchedule {
  const target = {
    type: "artifact-update" as const,
    source: {
      scope: { hostId: "host", target: { kind: "project" as const, id: "project" } },
      id: "artifact",
      location: "repository" as const,
    },
    designFingerprint: "a".repeat(64),
    update: { type: "data" as const, json: "{}" },
  };
  return {
    id: "schedule",
    name: null,
    prompt: "Refresh",
    target,
    cadence: { type: "every", everyMs: 60000 },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    maxRuns: null,
    expiresAt: null,
    otto: {
      version: 1,
      scope: { hostId: "host", projectId: "project" },
      location: "repository",
      storeKey: "origin",
    },
    runs: [
      {
        id: "run",
        scheduledFor: "now",
        startedAt: "now",
        endedAt: null,
        status: "running",
        agentId: null,
        output: null,
        error: null,
        otto: { requestedTarget: target },
      },
    ],
  };
}
function fixture() {
  const release = vi.fn();
  const execute = vi.fn<PreparedScheduleTarget["execute"]>(async () => ({
    agentId: null,
    output: "Updated",
    audit: { disposition: "succeeded" },
  }));
  const prepare = vi.fn(
    async (): Promise<PreparedScheduleTarget> => ({
      audit: {
        resolved: { kind: "artifact", id: "artifact", title: "Report", revision: "a".repeat(64) },
      },
      execute,
      release,
    }),
  );
  const runtime = new ScheduleRuntime({ prepare });
  const stamp = vi.fn(async (_audit: Partial<ScheduleAudit>) => {});
  const legacy = vi.fn(async () => ({ agentId: null, output: "Legacy" }));
  const input = { schedule: record(), runId: "run", stamp, legacy };
  return { runtime, release, execute, prepare, stamp, legacy, input };
}
test("native schedules retain their existing runner and do not consume extended capacity", async () => {
  const f = fixture();
  const native = {
    ...record(),
    target: { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000001" },
  };
  for (let index = 0; index < 8; index++) expect(f.runtime.acquire(native)).toBeTypeOf("function");
  expect(await f.runtime.execute({ ...f.input, schedule: native })).toEqual({
    agentId: null,
    output: "Legacy",
  });
  expect(f.legacy).toHaveBeenCalledTimes(1);
  expect(f.prepare).not.toHaveBeenCalled();
});
test("five extended reservations are bounded and each release is idempotent", () => {
  const f = fixture();
  const releases = Array.from({ length: 5 }, () => f.runtime.acquire(record()));
  expect(f.runtime.acquire(record())).toBeNull();
  const first = releases[0];
  if (!first) throw new Error("Missing fixture reservation");
  first();
  first();
  expect(f.runtime.acquire(record())).toBeTypeOf("function");
  expect(f.runtime.acquire(record())).toBeNull();
});
test("pre-effect audit is durable before execution and a failed stamp admits no target", async () => {
  const f = fixture();
  f.stamp.mockRejectedValueOnce(new Error("Store publication failed"));
  await expect(f.runtime.execute(f.input)).rejects.toMatchObject({
    disposition: "repair_required",
  });
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledTimes(1);
});
test("resolved identity precedes the effect and accepted result audit is stamped before return", async () => {
  const f = fixture();
  f.execute.mockImplementationOnce(async () => {
    expect(f.stamp).toHaveBeenCalledTimes(1);
    return {
      agentId: null,
      output: "Updated",
      audit: { disposition: "succeeded", executor: "data-only" },
    };
  });
  const result = await f.runtime.execute(f.input);
  expect(result.output).toBe("Updated");
  expect(f.stamp.mock.calls[0][0].resolved?.id).toBe("artifact");
  expect(f.stamp.mock.calls[1][0]).toEqual({ disposition: "succeeded", executor: "data-only" });
  expect(f.release).toHaveBeenCalledTimes(1);
});
test.each(["busy", "unavailable"] as const)(
  "pre-effect %s waits for the next cadence without retries",
  async (kind) => {
    const f = fixture();
    vi.useFakeTimers();
    try {
      f.prepare.mockRejectedValueOnce(new ScheduleError(kind, "Target owner is unavailable"));
      const failure = await f.runtime.execute(f.input).catch((error) => error);
      expect(failure).toMatchObject({ disposition: "failed", repairReason: undefined });
      expect(f.stamp).not.toHaveBeenCalled();
      const run = record().runs[0];
      expect(f.runtime.settle(record(), run, { error: failure }).pauseReason).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(f.prepare).toHaveBeenCalledTimes(1);
      expect(f.execute).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);
test("unknown outcomes after admission always pause for inspection", async () => {
  const f = fixture();
  f.execute.mockRejectedValueOnce(new Error("Uncertain publication"));
  const failure = await f.runtime.execute(f.input).catch((error) => error);
  expect(failure).toMatchObject({ disposition: "unknown" });
  const settled = f.runtime.settle(record(), record().runs[0], { error: failure });
  expect(settled.run.otto?.disposition).toBe("unknown");
  expect(settled.pauseReason).toContain("Inspect this run");
});
test("canceling the exact owned run revokes late output and refuses a foreign identity", async () => {
  const f = fixture();
  const entered = deferred<void>(),
    finish = deferred<void>();
  let published = false;
  f.execute.mockImplementationOnce(async (signal) => {
    entered.resolve();
    await finish.promise;
    signal.throwIfAborted();
    published = true;
    return { agentId: null, output: "Late" };
  });
  const pending = f.runtime.execute(f.input).catch((error) => error);
  await entered.promise;
  await expect(f.runtime.cancel("foreign", "run")).rejects.toMatchObject({ kind: "conflict" });
  await f.runtime.cancel("schedule", "run");
  expect(await pending).toMatchObject({ disposition: "canceled" });
  finish.resolve();
  await Promise.resolve();
  expect(published).toBe(false);
  expect(f.release).toHaveBeenCalledTimes(1);
});
test("stop settles its wait without depending on a noncooperative executor", async () => {
  const f = fixture();
  const entered = deferred<void>();
  f.execute.mockImplementationOnce(async () => {
    entered.resolve();
    return new Promise(() => {});
  });
  const pending = f.runtime.execute(f.input).catch((error) => error);
  await entered.promise;
  await f.runtime.stop();
  expect(await pending).toMatchObject({ disposition: "unknown" });
  expect(f.runtime.acquire(record())).toBeNull();
  expect(f.release).toHaveBeenCalledTimes(1);
});
test("an aborted pending preflight releases its eventual token and never starts a target", async () => {
  const f = fixture();
  const entered = deferred<void>(),
    prepared = deferred<PreparedScheduleTarget>();
  f.prepare.mockImplementationOnce(async () => {
    entered.resolve();
    return prepared.promise;
  });
  const pending = f.runtime.execute(f.input).catch((error) => error);
  await entered.promise;
  await f.runtime.cancel("schedule", "run");
  expect(await pending).toBeInstanceOf(ScheduleExecutionError);
  prepared.resolve({ audit: {}, execute: f.execute, release: f.release });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.release).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.stamp).not.toHaveBeenCalled();
});
test("restart and unclassified settlement failures retain audit but prohibit automatic replay", () => {
  const f = fixture();
  const current = record();
  const recovered = f.runtime.recover(current, current.runs[0]);
  expect(recovered.run.otto?.requestedTarget).toEqual(current.target);
  expect(recovered.run.otto?.disposition).toBe("unknown");
  expect(recovered.pauseReason).toContain("not replayed");
  const settled = f.runtime.settle(current, current.runs[0], {
    error: new Error("Cleanup failed"),
  });
  expect(settled.run.otto?.disposition).toBe("unknown");
  expect(settled.pauseReason).toContain("Inspect this run");
});

test("confirmed owner settlement preserves a completion that wins the cancellation race", async () => {
  const f = fixture();
  const entered = deferred<void>(),
    finish = deferred<{ agentId: null; output: string }>();
  f.execute.mockImplementationOnce(async () => {
    entered.resolve();
    return finish.promise;
  });
  f.prepare.mockResolvedValueOnce({
    audit: {},
    execute: f.execute,
    release: f.release,
    cancel: async () => {
      finish.resolve({ agentId: null, output: "Already completed" });
      return "settled";
    },
  });
  const pending = f.runtime.execute(f.input);
  await entered.promise;
  await f.runtime.cancel("schedule", "run");
  expect(await pending).toEqual({ agentId: null, output: "Already completed" });
});
test("failed target cancellation is unknown and pauses instead of claiming success", async () => {
  const f = fixture();
  const entered = deferred<void>();
  f.execute.mockImplementationOnce(async () => {
    entered.resolve();
    return new Promise(() => {});
  });
  f.prepare.mockResolvedValueOnce({
    audit: {},
    execute: f.execute,
    release: f.release,
    cancel: async () => {
      throw new Error("Owner unavailable");
    },
  });
  const pending = f.runtime.execute(f.input).catch((error) => error);
  await entered.promise;
  await expect(f.runtime.cancel("schedule", "run")).rejects.toMatchObject({ kind: "unavailable" });
  const error = await pending;
  expect(error).toMatchObject({ disposition: "unknown" });
  expect(f.runtime.settle(record(), record().runs[0], { error }).pauseReason).toContain(
    "could not be confirmed",
  );
});
