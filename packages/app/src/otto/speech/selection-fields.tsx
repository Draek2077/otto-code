import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { SettingsInput, SettingsSelect, SettingsSwitch, SettingsRow } from "@/components/settings";
import type { SpeechSettings } from "@getpaseo/plugin/otto/speech";
import type { SpeechForm } from "./form-model";
import { editSpeechRecognition } from "./selection-policy";

const providers = [
  { value: "local" as const, label: "Local (on this host)" },
  { value: "openai" as const, label: "OpenAI Compatible API" },
];
function locked(state: ReturnType<SpeechForm["getSnapshot"]>, path: string) {
  return state.busy || state.origin.overrides.includes(path);
}
export function SttFields({ form, role }: { form: SpeechForm; role: "dictation" | "voice" }) {
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const prefix = role === "dictation" ? "features.dictation" : "features.voiceMode";
  const disabled = (field: string) => locked(state, `${prefix}.stt.${field}`);
  const selection = role === "dictation" ? state.draft.dictation : state.draft.voice.stt;
  const edit = useCallback(
    (patch: Partial<SpeechSettings["voice"]["stt"]>) =>
      form.edit((draft) => editSpeechRecognition(draft, role, patch)),
    [form, role],
  );
  const provider = useCallback(
    (value: "local" | "openai") =>
      edit({
        provider: value,
        model:
          value === "local"
            ? (state.origin.choices.sttModels[0]?.id ?? "parakeet-tdt-0.6b-v2-int8")
            : "whisper-1",
      }),
    [edit, state.origin.choices.sttModels],
  );
  const model = useCallback((value: string) => edit({ model: value }), [edit]);
  const language = useCallback((value: string) => edit({ language: value }), [edit]);
  const enabled = useCallback(
    (value: boolean) =>
      form.edit((draft) =>
        role === "dictation"
          ? { ...draft, dictation: { ...draft.dictation, enabled: value } }
          : { ...draft, voice: { ...draft.voice, enabled: value } },
      ),
    [form, role],
  );
  const choices = useMemo(
    () => state.origin.choices.sttModels.map((entry) => ({ value: entry.id, label: entry.label })),
    [state.origin.choices.sttModels],
  );
  return (
    <>
      {role === "dictation" ? (
        <SettingsSwitch
          label="Dictation"
          hint="Transcribe microphone recordings using this host."
          value={state.draft.dictation.enabled}
          onValueChange={enabled}
          disabled={locked(state, "features.dictation.enabled")}
        />
      ) : null}
      <SettingsSelect
        label="Recognition provider"
        value={selection.provider}
        options={providers}
        onValueChange={provider}
        disabled={disabled("provider")}
      />
      {selection.provider === "local" ? (
        <SettingsSelect
          label="Recognition model"
          value={selection.model}
          options={choices}
          onValueChange={model}
          disabled={disabled("model")}
        />
      ) : (
        <SettingsInput
          key={`${state.generation}-${selection.provider}`}
          label="Recognition model"
          hint="whisper-1, gpt-4o-transcribe, or your API's model. Shared with live voice when both use this API."
          initialValue={selection.model}
          onChangeText={model}
          disabled={disabled("model")}
        />
      )}
      <SettingsInput
        key={`language-${state.generation}`}
        label="Language"
        hint="Language code, for example en. Parakeet v3 detects its supported languages automatically."
        initialValue={selection.language}
        onChangeText={language}
        disabled={disabled("language")}
      />
    </>
  );
}

export function TtsFields({ form }: { form: SpeechForm }) {
  const customVoice = useRef<SettingsInputHandle>(null);
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const disabled = (field: string) => locked(state, `features.voiceMode.tts.${field}`);
  const selection = state.draft.voice.tts;
  const edit = useCallback(
    (patch: Partial<SpeechSettings["voice"]["tts"]>) =>
      form.edit((draft) => ({
        ...draft,
        voice: { ...draft.voice, tts: { ...draft.voice.tts, ...patch } },
      })),
    [form],
  );
  const enabled = useCallback(
    (value: boolean) =>
      form.edit((draft) => ({ ...draft, voice: { ...draft.voice, enabled: value } })),
    [form],
  );
  const provider = useCallback(
    (value: "local" | "openai") => {
      const local = state.origin.choices.ttsModels[0];
      edit(
        value === "local"
          ? {
              provider: value,
              model: local?.id ?? "kokoro-en-v0_19",
              voice: local?.defaultVoice ?? "af",
            }
          : { provider: value, model: "tts-1", voice: "alloy" },
      );
    },
    [edit, state.origin.choices.ttsModels],
  );
  const model = useCallback(
    (value: string) => {
      const local = state.origin.choices.ttsModels.find((entry) => entry.id === value);
      edit(local ? { model: value, voice: local.defaultVoice } : { model: value });
    },
    [edit, state.origin.choices.ttsModels],
  );
  const voice = useCallback((value: string) => edit({ voice: value }), [edit]);
  const pickVoice = useCallback(
    (value: string) => {
      customVoice.current?.replaceText(value);
      voice(value);
    },
    [voice],
  );
  const speed = useCallback((value: string) => edit({ speed: Number(value) }), [edit]);
  const models = useMemo(
    () =>
      state.origin.choices.ttsModels.map((entry) => ({
        value: entry.id,
        label: `${entry.label}${entry.installed ? "" : " (download on save)"}`,
      })),
    [state.origin.choices.ttsModels],
  );
  const selectedModel = state.origin.choices.ttsModels.find(
    (entry) => entry.id === selection.model,
  );
  const voices = useMemo(
    () =>
      (
        selectedModel?.voices ??
        (selection.model === "tts-1" || selection.model === "tts-1-hd"
          ? ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
          : state.origin.choices.openaiVoices)
      ).map((value) => ({
        value,
        label: value,
      })),
    [selectedModel, selection.model, state.origin.choices.openaiVoices],
  );
  return (
    <>
      <SettingsSwitch
        label="Speech playback and voice mode"
        value={state.draft.voice.enabled}
        onValueChange={enabled}
        disabled={locked(state, "features.voiceMode.enabled")}
      />
      <SettingsSelect
        label="Speech provider"
        hint="For an API, set the URL and key under API connections and keys."
        value={selection.provider}
        options={providers}
        onValueChange={provider}
        disabled={disabled("provider")}
      />
      {selection.provider === "local" ? (
        <SettingsSelect
          label="Speech model"
          value={selection.model}
          options={models}
          onValueChange={model}
          disabled={disabled("model")}
        />
      ) : (
        <SettingsInput
          key={`model-${state.generation}-${selection.provider}`}
          label="Speech model"
          hint="tts-1, tts-1-hd, gpt-4o-mini-tts, or your API's model ID."
          initialValue={selection.model}
          onChangeText={model}
          disabled={disabled("model")}
        />
      )}
      <SettingsSelect
        label="Voice"
        value={selection.voice}
        options={voices}
        onValueChange={pickVoice}
        disabled={disabled(selection.provider === "local" ? "speakerId" : "voice")}
      />
      {selection.provider === "openai" ? (
        <SettingsInput
          key={`voice-${state.generation}`}
          ref={customVoice}
          label="Custom voice ID"
          hint="Use this for a voice provided by a compatible API."
          initialValue={selection.voice}
          onChangeText={voice}
          disabled={disabled("voice")}
        />
      ) : (
        <SettingsRow label={selectedModel?.description ?? "Local speech model"} />
      )}
      <SettingsInput
        key={`speed-${state.generation}`}
        label="Speaking speed"
        hint="0.25 to 4. Normal speed is 1."
        initialValue={String(selection.speed)}
        onChangeText={speed}
        disabled={disabled("speed")}
      />
    </>
  );
}
