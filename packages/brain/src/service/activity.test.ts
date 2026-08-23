import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveBrainPaths } from "../config/paths.js";
import type { EngineSlotTruth } from "./activity.js";
import {
  beginActivity,
  chunkHasContent,
  chunkHasReasoning,
  clearActivity,
  readActivity,
  ReasoningTracker,
  withActivity,
} from "./activity.js";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "otto-brain-activity-"));
  env = { ...process.env, OTTO_HOME: home };
  // The tests that plant a record by hand write straight to the path, so the
  // namespaced subdirectory has to exist before they do.
  mkdirSync(resolveBrainPaths(env).root, { recursive: true });
});

/** A pid high enough that no live process will ever hold it. */
const DEAD_PID = 2_147_483_646;

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("op activity", () => {
  it("reports nothing when no op is running", () => {
    expect(readActivity(env)).toBeNull();
  });

  it("round-trips an announced op", () => {
    beginActivity("calibrate", { target: "qwen3-30b", env });
    expect(readActivity(env)).toMatchObject({
      kind: "calibrate",
      target: "qwen3-30b",
      pid: process.pid,
    });
  });

  it("clears the record when the op ends", () => {
    const handle = beginActivity("sweep", { env });
    handle.end();
    expect(readActivity(env)).toBeNull();
  });

  it("clears a record whose process is gone rather than reporting forever", () => {
    // A calibrate killed with Ctrl-C never runs its own cleanup.
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({ kind: "benchmark", pid: DEAD_PID, startedAt: new Date().toISOString() }),
    );
    expect(readActivity(env)).toBeNull();
    // And it is gone from disk, not merely hidden.
    expect(readActivity(env)).toBeNull();
  });

  it("does not let an ending op clear a newer one", () => {
    const first = beginActivity("scan", { env });
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({
        kind: "benchmark",
        pid: process.pid + 1,
        startedAt: new Date().toISOString(),
      }),
    );
    first.end();
    expect(readActivity(env)).toMatchObject({ kind: "benchmark" });
    clearActivity(env);
  });

  it("ignores a kind it does not recognise", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(activityFile, JSON.stringify({ kind: "defragment", pid: process.pid }));
    expect(readActivity(env)).toBeNull();
  });

  it("survives a corrupt record", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(activityFile, "{not json");
    expect(readActivity(env)).toBeNull();
  });

  it("clamps progress into [0,1]", () => {
    const { activityFile } = resolveBrainPaths(env);
    writeFileSync(
      activityFile,
      JSON.stringify({ kind: "download", pid: process.pid, progress: 4.2 }),
    );
    expect(readActivity(env)?.progress).toBe(1);
  });

  it("clears the record even when the op throws", async () => {
    await expect(
      withActivity("benchmark", { env }, async () => {
        throw new Error("bench blew up");
      }),
    ).rejects.toThrow("bench blew up");
    expect(readActivity(env)).toBeNull();
  });

  it("never fails the op because the announce failed", async () => {
    // An unwritable home must not take the benchmark down with it.
    const result = await withActivity(
      "benchmark",
      { env: { ...process.env, OTTO_HOME: path.join(home, "no", "such", "\0bad") } },
      async () => "finished anyway",
    );
    expect(result).toBe("finished anyway");
  });
});

describe("ReasoningTracker", () => {
  it("reports processing from request start until the first model delta", () => {
    const tracker = new ReasoningTracker();
    tracker.begin();
    expect(tracker.snapshot).toEqual({
      activeRequests: 1,
      processing: 1,
      thinking: 0,
      generating: 0,
    });
  });

  it("is inactive until reasoning is seen", () => {
    const tracker = new ReasoningTracker();
    expect(tracker.active).toBe(false);
    const lease = tracker.begin();
    lease.observe('data: {"delta":{"type":"text_delta","text":"hi"}}');
    expect(tracker.active).toBe(false);
  });

  it("goes active on a reasoning delta", () => {
    const tracker = new ReasoningTracker();
    tracker.begin().observe('data: {"delta":{"type":"thinking_delta","thinking":"hmm"}}');
    expect(tracker.active).toBe(true);
  });

  it("stops thinking once content starts", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    expect(tracker.active).toBe(true);
    lease.observe('{"content":"the answer"}');
    expect(tracker.active).toBe(false);
  });

  it("distinguishes parallel processing, thinking, and generating requests", () => {
    const tracker = new ReasoningTracker();
    tracker.begin();
    tracker.begin().observe('{"reasoning_content":"hmm"}');
    tracker.begin().observe('{"content":"answer"}');
    expect(tracker.snapshot).toEqual({
      activeRequests: 3,
      processing: 1,
      thinking: 1,
      generating: 1,
    });
  });

  it("recognises a stage field split across transport chunks", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('data: {"delta":{"reasoning_');
    lease.observe('content":"hmm"}}\n\n');
    expect(tracker.snapshot.thinking).toBe(1);
  });

  it("tracks runtimes that leave reasoning inside think tags", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"content":"<think>"}');
    lease.observe('{"content":"working through it"}');
    expect(tracker.snapshot.thinking).toBe(1);
    lease.observe('{"content":"</think>"}');
    expect(tracker.snapshot.generating).toBe(1);
  });

  it("does not go back to thinking after content has started", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"content":"the answer"}');
    lease.observe('{"reasoning_content":"more"}');
    expect(tracker.active).toBe(false);
  });

  it("keeps one request's thought alive while another finishes", () => {
    const tracker = new ReasoningTracker();
    const a = tracker.begin();
    const b = tracker.begin();
    a.observe('{"reasoning_content":"hmm"}');
    b.observe('{"reasoning_content":"also hmm"}');
    expect(tracker.count).toBe(2);
    a.end();
    expect(tracker.active).toBe(true);
    b.end();
    expect(tracker.active).toBe(false);
  });

  it("releases the flag when a stream is abandoned", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.end();
    expect(tracker.active).toBe(false);
  });

  it("gives every lease its own request, so two callers cannot share a stage", () => {
    const tracker = new ReasoningTracker();
    const a = tracker.begin();
    const b = tracker.begin();
    expect(a.id).not.toBe(b.id);
    a.end();
    expect(tracker.snapshot.activeRequests).toBe(1);
  });

  it("makes a released lease inert, so a late chunk cannot resurrect the stage", () => {
    // The interrupt path: the client's socket close releases the request, and
    // the upstream socket then flushes a chunk that was already buffered. If
    // that chunk could re-create the request, nothing would be left to end it,
    // and the rail would claim "thinking" over an idle engine until the service
    // restarted.
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.end();
    lease.observe('{"reasoning_content":"trailing"}');
    lease.setSlot(2);
    expect(tracker.active).toBe(false);
    expect(tracker.snapshot.activeRequests).toBe(0);
  });

  it("survives a lease being released more than once", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.end();
    lease.end();
    expect(tracker.snapshot.activeRequests).toBe(0);
  });
});

describe("ReasoningTracker.reconcile", () => {
  const IDLE_ENGINE: EngineSlotTruth = { busySlots: new Set<number>(), busyCount: 0 };
  /**
   * The reaper needs several contradicting samples in a row, and it ignores
   * anything that has shown a sign of life recently. Both are deliberate, so
   * the tests drive them explicitly rather than waiting on a clock.
   */
  const sampleRepeatedly = (tracker: ReasoningTracker, truth: EngineSlotTruth, times = 5) => {
    const reaped: ReturnType<ReasoningTracker["reconcile"]> = [];
    for (let i = 0; i < times; i += 1) reaped.push(...tracker.reconcile(truth));
    return reaped;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Move past the grace period a live request is protected by. */
  const goQuiet = () => vi.advanceTimersByTime(10_000);

  it("clears a leaked stage once the engine has contradicted it enough times", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.setSlot(0);
    goQuiet();
    const reaped = sampleRepeatedly(tracker, IDLE_ENGINE);
    expect(reaped).toHaveLength(1);
    expect(reaped[0].stage).toBe("thinking");
    expect(reaped[0].slotId).toBe(0);
    expect(tracker.active).toBe(false);
  });

  it("never clears a request the engine still reports as busy on its own slot", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.setSlot(1);
    goQuiet();
    const busy: EngineSlotTruth = { busySlots: new Set([1]), busyCount: 1 };
    expect(sampleRepeatedly(tracker, busy)).toEqual([]);
    expect(tracker.active).toBe(true);
  });

  it("clears one chat's leak while another chat keeps generating", () => {
    // The whole point of checking the request's own slot rather than a global
    // busy count: a leak must not have to wait for the host to go quiet.
    const tracker = new ReasoningTracker();
    const leaked = tracker.begin();
    leaked.observe('{"reasoning_content":"hmm"}');
    leaked.setSlot(0);
    const live = tracker.begin();
    live.observe('{"reasoning_content":"still going"}');
    live.setSlot(1);
    goQuiet();
    const reaped = sampleRepeatedly(tracker, { busySlots: new Set([1]), busyCount: 1 });
    expect(reaped.map((entry) => entry.slotId)).toEqual([0]);
    expect(tracker.snapshot.activeRequests).toBe(1);
  });

  it("spares a request that is still streaming, whatever the engine says", () => {
    // Proof of life outranks the engine sample: a request that is producing
    // chunks is running by definition, and a sample that disagrees is stale.
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.setSlot(0);
    for (let i = 0; i < 5; i += 1) {
      goQuiet();
      lease.observe('{"reasoning_content":"still here"}');
      expect(tracker.reconcile(IDLE_ENGINE)).toEqual([]);
    }
    expect(tracker.active).toBe(true);
  });

  it("spares a freshly dispatched request the engine has not picked up yet", () => {
    // The honest window: begun, pinned, and the engine has not started it.
    const tracker = new ReasoningTracker();
    tracker.begin().setSlot(0);
    expect(sampleRepeatedly(tracker, IDLE_ENGINE)).toEqual([]);
    expect(tracker.snapshot.activeRequests).toBe(1);
  });

  it("needs the contradiction to hold, not just to happen once", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.setSlot(0);
    goQuiet();
    // Two strikes, then the engine says it is busy after all: the case resets.
    expect(tracker.reconcile(IDLE_ENGINE)).toEqual([]);
    expect(tracker.reconcile(IDLE_ENGINE)).toEqual([]);
    expect(tracker.reconcile({ busySlots: new Set([0]), busyCount: 1 })).toEqual([]);
    expect(tracker.reconcile(IDLE_ENGINE)).toEqual([]);
    expect(tracker.snapshot.activeRequests).toBe(1);
  });

  it("will not clear an unpinned request while anything at all is running", () => {
    // Nothing joins this request to a row, so a busy host is ambiguous, and
    // ambiguity is not evidence.
    const tracker = new ReasoningTracker();
    tracker.begin().observe('{"reasoning_content":"hmm"}');
    goQuiet();
    expect(sampleRepeatedly(tracker, { busySlots: new Set([0]), busyCount: 1 })).toEqual([]);
    expect(tracker.active).toBe(true);
  });

  it("clears an unpinned request once the engine reports nothing running", () => {
    const tracker = new ReasoningTracker();
    tracker.begin().observe('{"reasoning_content":"hmm"}');
    goQuiet();
    expect(sampleRepeatedly(tracker, IDLE_ENGINE)).toHaveLength(1);
    expect(tracker.active).toBe(false);
  });

  it("reaps nothing when the slot sample failed", () => {
    // No truth, no sweep. A brain that cannot see its engine must not start
    // guessing which of its requests are real.
    const tracker = new ReasoningTracker();
    tracker.begin().observe('{"reasoning_content":"hmm"}');
    goQuiet();
    expect(sampleRepeatedly(tracker, { busySlots: null, busyCount: null })).toEqual([]);
    expect(tracker.active).toBe(true);
  });

  it("falls back to the whole-host rule when the engine reports no per-slot rows", () => {
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.setSlot(0);
    goQuiet();
    // A count but no rows: the pin cannot be checked, so a busy host spares it.
    expect(sampleRepeatedly(tracker, { busySlots: null, busyCount: 1 })).toEqual([]);
    expect(sampleRepeatedly(tracker, { busySlots: null, busyCount: 0 })).toHaveLength(1);
  });

  it("drops slot pins when the engine relaunches, so a stale pin cannot shield a leak", () => {
    // Slot ids do not survive a relaunch. A dead request pinned to slot 0 would
    // otherwise be protected forever by whatever new work lands on slot 0.
    const tracker = new ReasoningTracker();
    const lease = tracker.begin();
    lease.observe('{"reasoning_content":"hmm"}');
    lease.setSlot(0);
    goQuiet();
    tracker.forgetSlots();
    expect(tracker.snapshot.slotStages).toBeUndefined();
    // Now only the whole-host rule applies, and a quiet engine clears it.
    expect(sampleRepeatedly(tracker, { busySlots: new Set([0]), busyCount: 1 })).toEqual([]);
    expect(sampleRepeatedly(tracker, IDLE_ENGINE)).toHaveLength(1);
  });
});

describe("chunk predicates", () => {
  it("recognises both API shapes' reasoning", () => {
    expect(chunkHasReasoning('{"type":"thinking_delta"}')).toBe(true);
    expect(chunkHasReasoning('{"reasoning_content":"x"}')).toBe(true);
    expect(chunkHasReasoning('{"content":"x"}')).toBe(false);
    expect(chunkHasReasoning('{"content":"a reasoning answer"}')).toBe(false);
  });

  it("recognises both API shapes' content", () => {
    expect(chunkHasContent('{"type":"text_delta","text":"x"}')).toBe(true);
    expect(chunkHasContent('{"content":"x"}')).toBe(true);
    // An empty content delta is not content: it rides on every chunk of some
    // builds and would end the thought on the very first one.
    expect(chunkHasContent('{"content":""}')).toBe(false);
  });

  it("treats tool-call output as generation rather than silent processing", () => {
    expect(chunkHasContent('{"delta":{"tool_calls":[{"index":0}]}}')).toBe(true);
    expect(chunkHasContent('{"type":"input_json_delta","partial_json":"{}"}')).toBe(true);
  });
});
