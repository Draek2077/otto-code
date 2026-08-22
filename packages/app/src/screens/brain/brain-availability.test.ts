import { describe, expect, it } from "vitest";
import type { BrainHostStatus } from "@otto-code/protocol/messages";
import { resolveBrainAvailability, resolveBrainOverviewError } from "./brain-availability";

const runningStatus: BrainHostStatus = { running: true, state: "ready" };

describe("resolveBrainAvailability", () => {
  it("reports a disconnected host before checking capabilities", () => {
    expect(resolveBrainAvailability({ isConnected: false, status: null })).toEqual({
      title: "This host is not connected",
      description:
        "Otto cannot reach this host's daemon, so the brain is unavailable. Start the daemon on that machine and try again.",
    });
  });

  it("passes through the brain's failure reason", () => {
    expect(
      resolveBrainAvailability({
        isConnected: true,
        status: { running: false, state: "failed", lastError: "The remote brain did not answer." },
      }),
    ).toEqual({
      title: "The brain is unavailable",
      description: "The remote brain did not answer.",
    });
  });

  it("reports a stopped brain instead of a missing capability", () => {
    expect(
      resolveBrainAvailability({
        isConnected: true,
        status: { running: false, state: "stopped" },
      }),
    ).toEqual({
      title: "The brain is stopped",
      description: "Start the brain on this host to use this tab.",
    });
  });

  it("does not replace capability gaps while the brain is healthy", () => {
    expect(resolveBrainAvailability({ isConnected: true, status: runningStatus })).toBeNull();
  });

  it("marks Overview as degraded when its host connection drops", () => {
    expect(
      resolveBrainOverviewError({
        isConnected: false,
        error: null,
        phase: "running",
        lastError: null,
      }),
    ).toEqual({
      title: "This host is not connected",
      description: "Otto cannot reach this host's daemon, so the brain status is unavailable.",
    });
  });

  it("does not degrade Overview for a healthy brain", () => {
    expect(
      resolveBrainOverviewError({
        isConnected: true,
        error: null,
        phase: "running",
        lastError: null,
      }),
    ).toBeNull();
  });
});
