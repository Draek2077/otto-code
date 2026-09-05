import { describe, expect, it } from "vitest";
import { resolveAgentBehaviorSettings } from "./agent-behavior-settings.js";
import {
  STALL_GUARD_DEFAULT_THRESHOLD,
  STALL_GUARD_MAX_THRESHOLD,
  STALL_GUARD_MIN_THRESHOLD,
} from "@otto-code/protocol/provider-config";

describe("agent behavior settings", () => {
  it("keeps unset behavior enabled while honoring explicit opt-outs", () => {
    expect(resolveAgentBehaviorSettings({ todoNudge: false })).toEqual({
      promptSuggestions: true,
      agentProgressSummaries: true,
      notifyOnFinishDefault: true,
      todoNudge: false,
      todoReconcileOnIdle: true,
      stallGuardThreshold: STALL_GUARD_DEFAULT_THRESHOLD,
    });
  });
  it("preserves an explicitly disabled stall guard", () => {
    expect(resolveAgentBehaviorSettings({ stallGuardThreshold: 0 }).stallGuardThreshold).toBe(0);
  });
  it("bounds user-supplied stall thresholds without accepting nonfinite values", () => {
    expect(
      resolveAgentBehaviorSettings({ stallGuardThreshold: Infinity }).stallGuardThreshold,
    ).toBe(STALL_GUARD_DEFAULT_THRESHOLD);
    expect(resolveAgentBehaviorSettings({ stallGuardThreshold: 1 }).stallGuardThreshold).toBe(
      STALL_GUARD_MIN_THRESHOLD,
    );
    expect(
      resolveAgentBehaviorSettings({ stallGuardThreshold: Number.MAX_SAFE_INTEGER })
        .stallGuardThreshold,
    ).toBe(STALL_GUARD_MAX_THRESHOLD);
  });
});
