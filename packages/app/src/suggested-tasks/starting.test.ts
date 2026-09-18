import { describe, expect, it } from "vitest";
import { areAllSuggestedTasksStarting } from "./starting";

describe("areAllSuggestedTasksStarting", () => {
  it("marks a single starting task as starting", () => {
    expect(areAllSuggestedTasksStarting(["task-1"], new Set(["task-1"]))).toBe(true);
  });

  it("does not mark a bulk button while only part of its queue is starting", () => {
    expect(areAllSuggestedTasksStarting(["task-1", "task-2", "task-3"], new Set(["task-1"]))).toBe(
      false,
    );
  });

  it("marks the bulk button only when every task is starting", () => {
    expect(areAllSuggestedTasksStarting(["task-1", "task-2"], new Set(["task-1", "task-2"]))).toBe(
      true,
    );
  });
});
