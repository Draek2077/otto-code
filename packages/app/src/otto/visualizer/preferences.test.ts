import { expect, it } from "vitest";
import { z } from "zod";
import {
  visualizerStoredPreferences,
  visualizerPreferenceDefaults,
  visualizerPlacement,
  visualizerSwitchEnabled,
  visualizerSwitchPatch,
} from "./preferences";
import { visualizerConfig } from "./config";
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

it("switches the shared right-hand panel in one write and keeps Timeline independent", () => {
  let preferences = {
    ...visualizerPreferenceDefaults,
    visualizerPanelTimeline: true,
    visualizerPanelFileAttention: true,
  };
  preferences = { ...preferences, ...visualizerSwitchPatch("visualizerPanelCostOverlay", true) };
  expect(visualizerConfig(preferences, "tab").panels).toEqual({
    timeline: true,
    fileAttention: false,
    costOverlay: true,
    failures: false,
    stats: false,
  });
  preferences = { ...preferences, ...visualizerSwitchPatch("visualizerPanelFailures", true) };
  expect(visualizerSwitchEnabled(preferences, "visualizerPanelCostOverlay")).toBe(false);
  expect(visualizerSwitchEnabled(preferences, "visualizerPanelFailures")).toBe(true);
  expect(visualizerConfig(preferences, "pip").panels?.failures).toBe(false);
  expect(visualizerSwitchPatch("visualizerPanelTimeline", false)).toEqual({
    visualizerPanelTimeline: false,
  });
});

it("does not reopen stale lower-priority panels when closing a conflicting saved selection", () => {
  const previous = {
    ...visualizerPreferenceDefaults,
    visualizerPanelFileAttention: true,
    visualizerPanelCostOverlay: true,
    visualizerPanelFailures: true,
  };
  expect(visualizerSwitchEnabled(previous, "visualizerPanelFileAttention")).toBe(true);
  expect(visualizerSwitchEnabled(previous, "visualizerPanelCostOverlay")).toBe(false);
  const closed = { ...previous, ...visualizerSwitchPatch("visualizerPanelFileAttention", false) };
  expect(visualizerConfig(closed, "tab").panels).toEqual(
    visualizerConfig(visualizerPreferenceDefaults, "tab").panels,
  );
  expect(previous.visualizerPanelCostOverlay).toBe(true);
});
