import { describe, expect, it } from "vitest";
import {
  buildClaudeFeatures,
  describeClaudeFastModeUnavailability,
  readClaudeFastModeRuntimeStatus,
} from "./feature-definitions.js";

describe("Claude fast mode runtime status", () => {
  it("reads the fast mode fields the CLI puts on init and result messages", () => {
    expect(
      readClaudeFastModeRuntimeStatus({
        type: "result",
        fast_mode_state: "off",
        fast_mode_disabled_reason: "extra_usage_disabled",
      }),
    ).toEqual({ state: "off", disabledReason: "extra_usage_disabled" });
    expect(readClaudeFastModeRuntimeStatus({ type: "result" })).toBeNull();
  });

  it("surfaces an account without usage credits on the Fast toggle", () => {
    const [feature] = buildClaudeFeatures({
      modelId: "claude-opus-5-5",
      fastModeEnabled: true,
      fastModeStatus: { state: "off", disabledReason: "extra_usage_disabled" },
    });
    expect(feature).toMatchObject({ id: "fast_mode", value: true });
    expect(feature?.type === "toggle" && feature.unavailableReason).toContain("extra usage");
  });

  it("reports nothing when fast mode is on or availability is still being checked", () => {
    expect(describeClaudeFastModeUnavailability({ state: "on", disabledReason: null })).toBe(
      undefined,
    );
    expect(describeClaudeFastModeUnavailability({ state: "off", disabledReason: "pending" })).toBe(
      undefined,
    );
    const [feature] = buildClaudeFeatures({
      modelId: "claude-opus-5-5",
      fastModeEnabled: true,
      fastModeStatus: { state: "on", disabledReason: null },
    });
    expect(feature).not.toHaveProperty("unavailableReason");
  });

  it("explains a rate-limit cooldown and unrecognized reasons", () => {
    expect(
      describeClaudeFastModeUnavailability({ state: "cooldown", disabledReason: null }),
    ).toContain("rate limit");
    expect(
      describeClaudeFastModeUnavailability({ state: "off", disabledReason: "some_new_reason" }),
    ).toBe("Fast mode is currently unavailable.");
  });
});
