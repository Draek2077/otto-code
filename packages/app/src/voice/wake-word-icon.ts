import type { WakeWordState } from "@/wake-word/wake-word-listening";

export type WakeWordIconKind = "microphone" | "muted" | "recording";

export function getWakeWordIconKind(state: WakeWordState): WakeWordIconKind {
  if (state === "disabled" || state === "error") return "muted";
  if (state === "recording") return "recording";
  return "microphone";
}
