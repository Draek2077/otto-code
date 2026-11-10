import { expect, it } from "vitest";
import { z } from "zod";
import {
  visualizerStoredPreferences,
  visualizerPreferenceDefaults,
  visualizerPlacement,
} from "./preferences";
const stored = z.object(visualizerStoredPreferences);
it("retains 0.9 device identities, false choices, zero volume and exact placement fractions", () => {
  const input = {
    ...visualizerPreferenceDefaults,
    visualizerSoundMuted: true,
    visualizerSoundVolume: 0,
    visualizerPipX: 0,
    visualizerPipY: 1,
    visualizerPipSize: "medium",
    visualizerRenderQuality: "native",
  };
  expect(stored.parse(input)).toEqual(input);
});
it("normalizes malformed persisted options at the one storage boundary", () => {
  expect(
    stored.parse({
      visualizerSoundVolume: -1,
      visualizerPipX: Number.NaN,
      visualizerNodeShape: "unknown",
    }),
  ).toEqual(visualizerPreferenceDefaults);
});
it("selects one placement for old independent flags without writing or deleting settings", () => {
  const previous = {
    ...visualizerPreferenceDefaults,
    visualizerPipOpen: true,
    visualizerBackgroundOpen: true,
    visualizerSurface: "background" as const,
  };
  expect(visualizerPlacement(previous)).toBe("background");
  expect(visualizerPlacement({ ...previous, visualizerSurface: "pip" })).toBe("pip");
  expect(previous.visualizerPipOpen).toBe(true);
});
