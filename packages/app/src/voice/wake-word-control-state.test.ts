import { describe, expect, it } from "vitest";

import {
  shouldShowWakeWordToolbarButton,
  shouldStartWakeWordListening,
} from "./wake-word-control-state";

describe("Hey Otto feature and listening controls", () => {
  it("keeps the toolbar button visible while listening is paused", () => {
    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: true,
        supported: true,
        hasDictationTab: true,
      }),
    ).toBe(true);
    expect(
      shouldStartWakeWordListening({
        featureEnabled: true,
        listeningPaused: true,
        isPaneFocused: true,
      }),
    ).toBe(false);
  });

  it("hides the toolbar button when the feature is disabled or unsupported", () => {
    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: false,
        supported: true,
        hasDictationTab: true,
      }),
    ).toBe(false);
    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: true,
        supported: false,
        hasDictationTab: true,
      }),
    ).toBe(false);

    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: true,
        supported: true,
        hasDictationTab: false,
      }),
    ).toBe(false);
  });

  it("starts listening only when the feature is enabled, not paused, and the pane is focused", () => {
    expect(
      shouldStartWakeWordListening({
        featureEnabled: true,
        listeningPaused: false,
        isPaneFocused: true,
      }),
    ).toBe(true);
    expect(
      shouldStartWakeWordListening({
        featureEnabled: false,
        listeningPaused: false,
        isPaneFocused: true,
      }),
    ).toBe(false);
  });

  it("stops listening when the pane loses focus even if the feature is enabled", () => {
    expect(
      shouldStartWakeWordListening({
        featureEnabled: true,
        listeningPaused: false,
        isPaneFocused: false,
      }),
    ).toBe(false);
  });
});
