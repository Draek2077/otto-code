import { describe, expect, it } from "vitest";
import type { BrainSlotInput, BrainStateInput } from "./input";
import { joinBrainSlotStages } from "./input";
import {
  BRAIN_STATE_LABELS,
  deriveBrainActivity,
  deriveBrainState,
  resolveBrainActivityLabel,
  type BrainState,
} from "./state";

const READY = { running: true, reachable: true, state: "ready" } as const;

function slot(overrides: Partial<BrainSlotInput> = {}): BrainSlotInput {
  return {
    modelId: "model-a",
    residentId: "process-a",
    slot: 0,
    phase: "decode",
    stage: null,
    ...overrides,
  };
}

describe("Brain runtime state", () => {
  it.each<[BrainStateInput | null, BrainState]>([
    [null, "off"],
    [{ running: false }, "off"],
    [{ running: false, reachable: false, state: "unconfigured" }, "off"],
    [{ running: false, reachable: false, state: "unreachable" }, "unreachable"],
    [{ running: false, reachable: false, state: "starting" }, "loading"],
    [{ ...READY, state: "failed" }, "error"],
    [{ ...READY, state: "starting" }, "loading"],
    [{ ...READY, state: "stopping" }, "unloading"],
    [READY, "idle"],
    [{ ...READY, lastError: "last operation failed" }, "degraded"],
    [{ ...READY, queued: 2 }, "queued"],
    [{ ...READY, slots: { prefill: 1 } }, "prefill"],
    [{ ...READY, slots: { decode: 1 } }, "generating"],
    [{ ...READY, reasoning: true, slots: { decode: 1 } }, "thinking"],
    [{ ...READY, lastError: "stale warning", slots: { decode: 1 } }, "generating"],
  ])("derives lifecycle and aggregate signals (%#)", (input, expected) => {
    expect(deriveBrainState(input)).toBe(expected);
  });

  it.each<[string, BrainState]>([
    ["calibrate", "calibrating"],
    ["sweep", "sweeping"],
    ["benchmark", "benchmarking"],
    ["download", "downloading"],
    ["scan", "scanning"],
  ])("lets %s own its internal loads and slot work", (kind, expected) => {
    const status: BrainStateInput = {
      ...READY,
      state: "starting",
      activity: { kind },
      slots: { decode: 2, threads: [slot(), slot({ slot: 1 })] },
    };
    expect(deriveBrainState(status)).toBe(expected);
    expect(deriveBrainActivity(status)).toEqual({ kind: "single", state: expected });
  });

  it.each<[BrainSlotInput["stage"], BrainState]>([
    ["processing", "prefill"],
    ["thinking", "thinking"],
    ["generating", "generating"],
    [null, "generating"],
  ])("uses the joined actual stage in single and split pictures: %s", (stage, expected) => {
    const one: BrainStateInput = { ...READY, slots: { threads: [slot({ stage })] } };
    expect(deriveBrainState(one)).toBe(expected);
    expect(deriveBrainActivity(one)).toEqual({ kind: "single", state: expected });
    const two: BrainStateInput = {
      ...READY,
      slots: { threads: [slot({ stage }), slot({ slot: 1 })] },
    };
    expect(deriveBrainActivity(two)).toEqual({ kind: "split", slots: [expected, "generating"] });
  });

  it("does not turn an idle engine row into reasoning from a pending proxy request", () => {
    expect(
      deriveBrainActivity({
        ...READY,
        slots: { threads: [slot({ phase: "idle", stage: "thinking" })] },
      }),
    ).toEqual({ kind: "single", state: "idle" });
  });

  it("keeps engine prefill authoritative over a joined proxy stage", () => {
    expect(
      deriveBrainState({
        ...READY,
        slots: { threads: [slot({ phase: "prefill", stage: "thinking" })] },
      }),
    ).toBe("prefill");
  });

  it.each<[BrainStateInput, BrainState]>([
    [{ ...READY, state: "stopped" }, "off"],
    [{ ...READY, state: "unconfigured" }, "off"],
    [{ ...READY, running: false }, "off"],
    [{ ...READY, state: "unreachable" }, "unreachable"],
    [{ ...READY, reachable: false }, "unreachable"],
    [{ ...READY, state: "failed" }, "error"],
  ])("lifecycle overrides stale split and spectrum rows (%#)", (lifecycle, expected) => {
    for (const count of [2, 3]) {
      const threads = Array.from({ length: count }, (_, index) => slot({ slot: index }));
      expect(deriveBrainActivity({ ...lifecycle, slots: { decode: count, threads } })).toEqual({
        kind: "single",
        state: expected,
      });
    }
  });

  it("orders two independent resident slot zero rows deterministically", () => {
    const left = slot({ stage: "thinking" });
    const right = slot({ modelId: "model-b", residentId: "process-b", stage: "generating" });
    expect(deriveBrainActivity({ ...READY, slots: { threads: [right, left] } })).toEqual({
      kind: "split",
      slots: ["thinking", "generating"],
    });
  });

  it("distinguishes resident lifetimes even when they host the same model", () => {
    const threads = [slot(), slot({ residentId: "process-b" })];
    const joined = joinBrainSlotStages(threads, [{ ...threads[1], stage: "thinking" }]);
    expect(joined.map((row) => row.stage)).toEqual([null, "thinking"]);
  });

  it("joins on model, process lifetime and slot, without inventing rows for queued requests", () => {
    const threads = [slot(), slot({ modelId: "model-b", residentId: "process-b" })];
    const joined = joinBrainSlotStages(threads, [
      { ...threads[0], residentId: "old-process", stage: "thinking" },
      { ...threads[0], modelId: "other-model", stage: "thinking" },
      { ...threads[1], stage: "thinking" },
      { ...threads[1], slot: 99, stage: "processing" },
    ]);
    expect(joined.map((row) => row.stage)).toEqual([null, "thinking"]);
    expect(deriveBrainActivity({ ...READY, slots: { threads: joined } })).toEqual({
      kind: "split",
      slots: ["generating", "thinking"],
    });
  });

  it("uses the spectrum for three observed workers across resident processes", () => {
    expect(
      deriveBrainActivity({
        ...READY,
        slots: {
          threads: [slot(), slot({ residentId: "process-b" }), slot({ residentId: "process-c" })],
        },
      }),
    ).toEqual({ kind: "spectrum", count: 3 });
  });

  it("uses aggregate busy signals without guessing halves when rows are absent", () => {
    expect(deriveBrainActivity({ ...READY, slots: { decode: 4 } })).toEqual({
      kind: "single",
      state: "generating",
    });
  });

  it("labels single, dual and spectrum pictures with the frozen state sentences", () => {
    expect(resolveBrainActivityLabel({ kind: "single", state: "idle" })).toBe(
      BRAIN_STATE_LABELS.idle,
    );
    expect(resolveBrainActivityLabel({ kind: "split", slots: ["thinking", "generating"] })).toBe(
      "Brain - thinking · generating tokens",
    );
    expect(resolveBrainActivityLabel({ kind: "spectrum", count: 3 })).toBe(
      "Brain - 3 slots working",
    );
  });
});
