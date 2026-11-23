import type { SpeechForm } from "./form-model";

/** Preview must use the acknowledged selection and an installed, ready engine. */
export function speechPreviewState(state: ReturnType<SpeechForm["getSnapshot"]>) {
  if (!state.draft.voice.enabled)
    return { ready: false, hint: "Enable speech playback to preview a voice." };
  if (state.blocked) return { ready: false, hint: "Reload host settings before previewing." };
  if (state.busy || state.dirty)
    return { ready: false, hint: "Waiting for speech settings to finish updating." };
  const { readiness, choices, settings } = state.origin;
  const local = settings.voice.tts.provider === "local";
  const installed =
    !local ||
    choices.ttsModels.some((model) => model.id === settings.voice.tts.model && model.installed);
  if (
    !installed ||
    !readiness.tts.available ||
    readiness.downloading ||
    readiness.pendingSettings ||
    readiness.applyingSettings
  )
    return { ready: false, hint: "Waiting for the host speech engine." };
  return { ready: true, hint: "Preview never records from your microphone." };
}
