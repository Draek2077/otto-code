import type { SpeechSettings } from "@getpaseo/plugin/otto/speech";
/** Paseo's OpenAI recognition endpoint uses one model for dictation and live
 * voice. Keep that relationship explicit instead of presenting an ignored edit.
 * Local recognizers retain their independent per-feature model selections.
 */
export function editSpeechRecognition(
  draft: SpeechSettings,
  role: "dictation" | "voice",
  patch: Partial<SpeechSettings["voice"]["stt"]>,
): SpeechSettings {
  const next = structuredClone(draft);
  const selected = role === "dictation" ? next.dictation : next.voice.stt;
  const other = role === "dictation" ? next.voice.stt : next.dictation;
  Object.assign(selected, patch);
  if (selected.provider === "openai" && other.provider === "openai") {
    if (patch.provider === "openai") selected.model = other.model;
    else if (patch.model !== undefined) other.model = patch.model;
  }
  return next;
}
