import { describe, expect, it } from "vitest";
import { isConfirmedMissingTimelineAgent, projectTimelineSyncFailure } from "./missing-agent";

describe("confirmed missing timeline agent", () => {
  it("recognizes the matching host response as Error or projected message", () => {
    expect(isConfirmedMissingTimelineAgent(new Error("Agent not found: agent-a"), "agent-a")).toBe(
      true,
    );
    expect(isConfirmedMissingTimelineAgent("Agent not found: agent-a", "agent-a")).toBe(true);
  });
  it.each([
    "timeout",
    "File not found",
    "Agent not found: agent-b",
    "Proxy: Agent not found: agent-a",
    null,
  ])("does not claim deletion for %s", (error) => {
    expect(isConfirmedMissingTimelineAgent(error, "agent-a")).toBe(false);
  });
});

it("projects truthful missing copy while retaining manual retry progress", () => {
  expect(
    projectTimelineSyncFailure(
      { status: "sync_error", isRetrying: true },
      "Agent not found: agent-a",
      "agent-a",
    ),
  ).toEqual({
    showHistorySyncMissing: true,
    showHistorySyncError: false,
    isRetryingHistorySync: true,
  });
  expect(
    projectTimelineSyncFailure({ status: "sync_error", isRetrying: false }, "timeout", "agent-a"),
  ).toEqual({
    showHistorySyncMissing: false,
    showHistorySyncError: true,
    isRetryingHistorySync: false,
  });
  expect(
    projectTimelineSyncFailure({ status: "idle" }, "Agent not found: agent-a", "agent-a"),
  ).toEqual({
    showHistorySyncMissing: false,
    showHistorySyncError: false,
    isRetryingHistorySync: false,
  });
});
