import { useCallback, useSyncExternalStore } from "react";
import { SettingsInput, SettingsSelect, SettingsRow } from "@/components/settings";
import type { SpeechForm } from "./form-model";
const intents = [
  { value: "keep" as const, label: "Keep existing" },
  { value: "replace" as const, label: "Replace" },
  { value: "remove" as const, label: "Remove endpoint key" },
];
export function SpeechApiFields({ form, endpoint }: { form: SpeechForm; endpoint: "stt" | "tts" }) {
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const title = endpoint === "stt" ? "Recognition" : "Speech";
  const urlKey = endpoint === "stt" ? "sttBaseUrl" : "ttsBaseUrl";
  const intent = state.credentials[endpoint];
  const url = useCallback(
    (value: string) =>
      form.edit((draft) => ({ ...draft, openai: { ...draft.openai, [urlKey]: value } })),
    [form, urlKey],
  );
  const mode = useCallback(
    (kind: "keep" | "replace" | "remove") =>
      form.credential(endpoint, kind === "replace" ? { kind, value: "" } : { kind }),
    [form, endpoint],
  );
  const secret = useCallback(
    (value: string) => form.credential(endpoint, { kind: "replace", value }),
    [form, endpoint],
  );
  const status = state.origin.credentials[endpoint];
  return (
    <>
      <SettingsInput
        key={`url-${state.generation}`}
        label={`${title} API URL`}
        initialValue={state.draft.openai[urlKey]}
        onChangeText={url}
        disabled={state.busy}
      />
      <SettingsRow
        label={`${title} API key`}
        hint={`Current source: ${status.effectiveSource}. Keys stay on this host. Removing an endpoint key leaves any shared or environment key in place.`}
      />
      <SettingsSelect
        label={`${title} key action`}
        value={intent.kind}
        options={intents}
        onValueChange={mode}
        disabled={state.busy}
      />
      {intent.kind === "replace" ? (
        <SettingsInput
          key={`key-${state.generation}`}
          label={`New ${title.toLowerCase()} API key`}
          initialValue={intent.value}
          onChangeText={secret}
          secureTextEntry
          disabled={state.busy}
        />
      ) : null}
    </>
  );
}
