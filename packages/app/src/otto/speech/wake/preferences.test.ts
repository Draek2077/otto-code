import { describe, expect, it } from "vitest";
import { z } from "zod";
import { wakePreferenceDefaults, wakeStoredPreferences, parseWakeTuning } from "./preferences";
describe("preserved wake preferences", () => {
  it("keeps listening and automatic sending off for a fresh device", () => {
    expect(z.object(wakeStoredPreferences).parse({})).toEqual(wakePreferenceDefaults);
  });
  it("preserves opt-in, pause, tuning and an unsupported old phrase without resetting it", () => {
    const old = {
      wakeWordEnabled: true,
      wakeWordListeningPaused: true,
      wakeWordAutoSend: true,
      wakeWordPhrase: "Saved custom phrase",
      wakeWordSensitivity: 0.63,
      wakeWordSilenceTimeoutMs: 1450,
    };
    expect(z.object(wakeStoredPreferences).parse(old)).toEqual(old);
  });
  it("accepts the full original tuning range through explicit apply", () => {
    expect(parseWakeTuning("0.63", "1450", " hey otto ")).toEqual({
      wakeWordPhrase: "Hey Otto",
      wakeWordSensitivity: 0.63,
      wakeWordSilenceTimeoutMs: 1450,
    });
    expect(parseWakeTuning("0", "300", "Hey Otto").wakeWordSensitivity).toBe(0);
    expect(parseWakeTuning("1", "5000", "Hey Otto").wakeWordSilenceTimeoutMs).toBe(5000);
  });
  it.each([
    ["", "1100", "Hey Otto"],
    ["1.1", "1100", "Hey Otto"],
    ["0.7", "1100.5", "Hey Otto"],
    ["0.7", "299", "Hey Otto"],
    ["0.7", "1100", "Another phrase"],
  ])(
    "rejects invalid tuning without manufacturing saved values (%s/%s/%s)",
    (sensitivity, silence, phrase) => {
      expect(() => parseWakeTuning(sensitivity, silence, phrase)).toThrow();
    },
  );
});
