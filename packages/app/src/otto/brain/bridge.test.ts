import { describe, expect, it } from "vitest";
import { presentBrainSnapshot, type BrainUiSnapshot } from "./bridge";
import { deriveBrainActivity } from "./state";
import { isBrainMotionEnabled } from "./motion";

const LIVE: BrainUiSnapshot = {
  serverId: "selected-host",
  enabled: true,
  connection: "connected",
  status: {
    running: true,
    reachable: true,
    state: "ready",
    slots: {
      threads: [
        { modelId: "a", residentId: "a-1", slot: 0, phase: "decode", stage: "thinking" },
        { modelId: "b", residentId: "b-1", slot: 0, phase: "decode", stage: "generating" },
      ],
    },
  },
};

describe("injected Brain presentation", () => {
  it("uses the selected host's actual dual activity and accessible sentence", () => {
    expect(presentBrainSnapshot(LIVE)).toEqual({
      state: "thinking",
      activity: { kind: "split", slots: ["thinking", "generating"] },
      label: "Brain - thinking · generating tokens",
      visible: true,
      disabled: false,
    });
  });

  it("lets explicit disablement override a retained busy snapshot", () => {
    expect(presentBrainSnapshot({ ...LIVE, enabled: false })).toEqual({
      state: "off",
      activity: { kind: "single", state: "off" },
      label: "Brain - Disabled",
      visible: false,
      disabled: true,
    });
  });

  it.each(["connecting", "disconnected"] as const)(
    "does not animate stale runtime rows while %s",
    (connection) => {
      expect(presentBrainSnapshot({ ...LIVE, connection })).toEqual({
        state: "unreachable",
        activity: { kind: "single", state: "unreachable" },
        label: "Brain - unreachable",
        visible: true,
        disabled: false,
      });
    },
  );

  it("keeps the rail visible until host enablement is known", () => {
    expect(presentBrainSnapshot({ ...LIVE, enabled: undefined }).visible).toBe(true);
  });

  it.each([
    { active: false, animationsEnabled: true, reducedMotion: false },
    { active: true, animationsEnabled: false, reducedMotion: false },
    { active: true, animationsEnabled: true, reducedMotion: true },
  ])("stops motion without losing real dual-slot state: %j", (policy) => {
    expect(isBrainMotionEnabled(policy)).toBe(false);
    expect(presentBrainSnapshot(LIVE).activity).toEqual(deriveBrainActivity(LIVE.status));
    expect(presentBrainSnapshot(LIVE).label).toBe("Brain - thinking · generating tokens");
  });

  it("allows motion only on a visible surface with both preferences permitting it", () => {
    expect(
      isBrainMotionEnabled({ active: true, animationsEnabled: true, reducedMotion: false }),
    ).toBe(true);
  });
});
