import type { WakeWordState } from "@/wake-word/wake-word-listening";

const WAKE_WORD_LABELS: Record<WakeWordState, string> = {
  error: "Hey Otto: Disabled",
  listening: "Hey Otto: Detecting",
  disabled: "Hey Otto: Disabled",
  recording: "Hey Otto: Recording",
  processing: "Hey Otto: Processing",
};

/** The detector can still be starting while the globally armed title-bar
 * control is visually enabled. Keep that distinct from active detection. */
export function getWakeWordLabel(input: {
  detectorState: WakeWordState;
  displayedState: WakeWordState;
  listeningPaused: boolean;
}): string {
  if (!input.listeningPaused && input.detectorState === "disabled") {
    return "Hey Otto: Enabled";
  }
  return WAKE_WORD_LABELS[input.displayedState];
}
