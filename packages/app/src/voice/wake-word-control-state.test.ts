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
      }),
    ).toBe(true);
    expect(
      shouldStartWakeWordListening({
        featureEnabled: true,
        listeningPaused: true,
      }),
    ).toBe(false);
  });

  it("hides the toolbar button when the feature is disabled or unsupported", () => {
    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: false,
        supported: true,
      }),
    ).toBe(false);
    expect(
      shouldShowWakeWordToolbarButton({
        featureEnabled: true,
        supported: false,
      }),
    ).toBe(false);
  });

  it("starts listening only when the feature is enabled and not paused", () => {
    expect(
      shouldStartWakeWordListening({
        featureEnabled: true,
        listeningPaused: false,
      }),
    ).toBe(true);
    expect(
      shouldStartWakeWordListening({
        featureEnabled: false,
        listeningPaused: false,
      }),
    ).toBe(false);
  });
});
