import { describe, expect, it } from "vitest";
import {
  reduceComplete,
  reduceExit,
  reduceGoToStep,
  reduceNext,
  reduceStart,
  type TutorialSnapshot,
} from "./state";

const idle: TutorialSnapshot = { status: "idle", stepIndex: 0 };

describe("reduceStart", () => {
  it("starts a tour from idle at step 0", () => {
    expect(reduceStart(idle)).toEqual({ status: "running", stepIndex: 0 });
  });

  it("is a no-op when already running", () => {
    const running: TutorialSnapshot = { status: "running", stepIndex: 2 };
    expect(reduceStart(running)).toBe(running);
  });

  it("is a no-op when already completed (never restarts)", () => {
    const done: TutorialSnapshot = { status: "completed", stepIndex: 4 };
    expect(reduceStart(done)).toBe(done);
  });
});

describe("reduceNext", () => {
  it("advances the step index while running", () => {
    expect(reduceNext({ status: "running", stepIndex: 1 })).toEqual({
      status: "running",
      stepIndex: 2,
    });
  });

  it("does nothing when not running", () => {
    expect(reduceNext(idle)).toBe(idle);
  });
});

describe("reduceGoToStep", () => {
  it("jumps to a step while running and clamps below zero", () => {
    expect(reduceGoToStep({ status: "running", stepIndex: 0 }, 3)).toEqual({
      status: "running",
      stepIndex: 3,
    });
    expect(reduceGoToStep({ status: "running", stepIndex: 2 }, -5)).toEqual({
      status: "running",
      stepIndex: 0,
    });
  });

  it("does nothing when not running", () => {
    expect(reduceGoToStep(idle, 2)).toBe(idle);
  });
});

describe("reduceComplete / reduceExit", () => {
  it("completes to a terminal status", () => {
    expect(reduceComplete({ status: "running", stepIndex: 4 })).toEqual({
      status: "completed",
      stepIndex: 4,
    });
  });

  it("exits to a terminal status", () => {
    expect(reduceExit()).toEqual({ status: "completed", stepIndex: 0 });
  });
});
