import { useCallback, useEffect, useMemo, useState } from "react";
import { callPluginRpc } from "@getpaseo/plugin/client/host";
import { readSpeech, type SpeechSnapshot } from "@getpaseo/plugin/otto/speech";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { SelectField } from "@/components/ui/select-field";
import type { ProfileFields } from "./profile-fields";

interface Choice {
  id: string;
  value: string;
  label: string;
  description?: string;
  voice?: ProfileFields["voice"];
}
function voiceOptions(snapshot: SpeechSnapshot) {
  const choices: Choice[] = [{ id: "", value: "", label: "Host default" }];
  const add = (provider: string, model: string, name: string) => {
    const id = JSON.stringify([provider, model, name]);
    choices.push({
      id,
      value: id,
      label: name,
      description: provider + " · " + model,
      voice: { provider, model, name },
    });
  };
  for (const model of snapshot.choices.ttsModels.filter((m) => m.installed))
    for (const voice of model.voices) add("local", model.id, voice);
  if (snapshot.credentials.tts.effectiveSource !== "none")
    for (const model of snapshot.choices.openaiTtsModels)
      for (const voice of snapshot.choices.openaiVoices) add("openai", model, voice);
  return choices;
}
export function VoiceChoice({
  serverId,
  voice,
  change,
}: {
  serverId: string;
  voice: ProfileFields["voice"];
  change: (voice: ProfileFields["voice"]) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const [snapshot, setSnapshot] = useState<SpeechSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (client)
      void callPluginRpc(
        readSpeech,
        (method, value) => client.invokePluginRpc("otto-speech", method, value),
        { hostId: serverId },
      )
        .then((value) => {
          if (live) setSnapshot(value);
          return undefined;
        })
        .catch(() => {
          if (live) setError("Host voices could not be loaded.");
        });
    return () => {
      live = false;
    };
  }, [client, serverId]);
  const options = useMemo(() => (snapshot ? voiceOptions(snapshot) : []), [snapshot]);
  const onChange = useCallback(
    (id: string) => change(options.find((o) => o.id === id)?.voice),
    [change, options],
  );
  const selected = voice ? JSON.stringify([voice.provider, voice.model, voice.name]) : "";
  const display = useMemo(
    () =>
      voice
        ? { label: voice.name, description: voice.provider + " · " + voice.model }
        : { label: "Host default" },
    [voice],
  );
  return (
    <SelectField
      label="Spoken voice"
      value={selected}
      selectedDisplay={display}
      options={options}
      onChange={onChange}
      placeholder="Host default"
      emptyText="No host voices"
      searchable
      error={error}
      loading={!snapshot && !error}
    />
  );
}
