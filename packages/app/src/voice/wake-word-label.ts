import type { WakeWordState } from "@/wake-word/wake-word-listening";

const WAKE_WORD_LABELS: Record<WakeWordState, string> = {
  error: "Hey Otto - error",
  listening: "Hey Otto - detecting",
  disabled: "Hey Otto - disabled",
  recording: "Hey Otto - recording",
  processing: "Hey Otto - processing",
};

export function getWakeWordLabel(state: WakeWordState): string {
  return WAKE_WORD_LABELS[state];
}
