import type { SpeechTtsSelection } from "@getpaseo/plugin/otto/speech";
import { LocalTtsModelIdSchema } from "../../speech/providers/local/models.js";
import { localTtsVoices } from "./model-catalog.js";
export const openaiVoiceNames: readonly string[] = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];
export function utteranceVoice(
  host: SpeechTtsSelection,
  selection: SpeechTtsSelection | undefined,
  profileVoice = false,
): SpeechTtsSelection {
  if (!selection) return host;
  if (selection.provider !== host.provider || selection.model !== host.model) {
    if (profileVoice) return host;
    throw new Error("Save the speech provider and model before previewing.");
  }
  if (!profileVoice) return selection;
  const local = LocalTtsModelIdSchema.safeParse(host.model);
  const available =
    host.provider === "openai"
      ? openaiVoiceNames.includes(selection.voice)
      : local.success && localTtsVoices(local.data).includes(selection.voice);
  return available ? { ...host, voice: selection.voice } : host;
}
