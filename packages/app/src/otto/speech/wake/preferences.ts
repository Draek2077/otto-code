import { z } from "zod";
export const wakePreferenceDefaults = {
  wakeWordEnabled: false,
  wakeWordListeningPaused: false,
  wakeWordPhrase: "Hey Otto",
  wakeWordSensitivity: 0.7,
  wakeWordSilenceTimeoutMs: 1100,
  wakeWordAutoSend: false,
};
export const wakeStoredPreferences = {
  wakeWordEnabled: z.boolean().catch(false),
  wakeWordListeningPaused: z.boolean().catch(false),
  wakeWordPhrase: z.string().catch("Hey Otto"),
  wakeWordSensitivity: z.number().min(0).max(1).catch(0.7),
  wakeWordSilenceTimeoutMs: z.number().min(300).max(5000).catch(1100),
  wakeWordAutoSend: z.boolean().catch(false),
};
export type WakePreferences = typeof wakePreferenceDefaults;
export function parseWakeTuning(sensitivityText: string, silenceText: string, phraseText: string) {
  const sensitivity = Number(sensitivityText);
  const silence = Number(silenceText);
  if (
    !sensitivityText.trim() ||
    !Number.isFinite(sensitivity) ||
    sensitivity < 0 ||
    sensitivity > 1
  ) {
    throw new Error("Sensitivity must be a number from 0 to 1.");
  }
  if (!silenceText.trim() || !Number.isInteger(silence) || silence < 300 || silence > 5000) {
    throw new Error("Silence timeout must be a whole number from 300 to 5000 milliseconds.");
  }
  if (phraseText.trim().toLowerCase() !== "hey otto")
    throw new Error("This detector model supports only the phrase Hey Otto.");
  return {
    wakeWordPhrase: "Hey Otto",
    wakeWordSensitivity: sensitivity,
    wakeWordSilenceTimeoutMs: silence,
  };
}
