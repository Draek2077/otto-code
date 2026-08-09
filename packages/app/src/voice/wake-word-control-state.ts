import type { WakeWordState } from "@/wake-word/wake-word-listening";

export function shouldShowWakeWordToolbarButton(input: {
  featureEnabled: boolean;
  supported: boolean;
  hasDictationTab: boolean;
}): boolean {
  return input.featureEnabled && input.supported && input.hasDictationTab;
}

export function shouldStartWakeWordListening(input: {
  featureEnabled: boolean;
  listeningPaused: boolean;
  isPaneFocused: boolean;
}): boolean {
  return input.featureEnabled && !input.listeningPaused && input.isPaneFocused;
}

/** The toolbar is global, whereas detector state is owned by the focused tab.
 * A tab handoff can briefly report `disabled` while the next listener starts;
 * keep the global control green whenever listening remains armed. */
export function getWakeWordToolbarDisplayState(input: {
  listeningPaused: boolean;
  detectorState: WakeWordState;
}): WakeWordState {
  if (input.listeningPaused) return "disabled";
  return input.detectorState === "disabled" ? "listening" : input.detectorState;
}
