import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  readSpeech,
  saveSpeech,
  retrySpeech,
  type SpeechSnapshot,
} from "@getpaseo/plugin/otto/speech";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsCollapsibleRow,
  SettingsSelect,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openSpeechForm, type SpeechForm } from "./form-model";
import { SttFields, TtsFields } from "./selection-fields";
import { SpeechApiFields } from "./credentials";
import { SpeechDeviceSettings } from "./device-settings";
import { useSpeechPlayback } from "./playback-context";
import { IDLE_SPEECH_PLAYBACK } from "./playback";

const confirmReload = () =>
  confirmDialog({
    title: "Reload speech settings?",
    message: "Discard unsaved edits and load the host's saved settings?",
    confirmLabel: "Discard and reload",
  });
const turnDetectors = [
  { value: "local" as const, label: "Local voice activity detection" },
  { value: "openai" as const, label: "API (if supported by the host)" },
];
const noSubscription = () => () => {};
const idle = () => IDLE_SPEECH_PLAYBACK;
function Preview({ form }: { form: SpeechForm }) {
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const playback = useSpeechPlayback();
  const current = useSyncExternalStore(
    playback?.subscribe ?? noSubscription,
    playback?.getSnapshot ?? idle,
  );
  const key = `${state.origin.hostId}:preview`;
  const playing = current.key === key;
  const previewHint = playing
    ? { generating: "Generating preview…", playing: "Playing preview…", idle: "Preview stopped." }[
        current.phase
      ]
    : "Save a provider or model change first. Preview never records from your microphone.";
  const preview = useCallback(() => {
    if (playing) playback?.stop();
    else
      playback?.speak({
        hostId: state.origin.hostId,
        key,
        text: "Hello, this is Otto and this is your selected voice.",
        selection: state.draft.voice.tts,
      });
  }, [playing, playback, state.origin.hostId, key, state.draft.voice.tts]);
  return (
    <>
      <SettingsRow label="Voice preview" hint={previewHint}>
        <Button
          variant="outline"
          size="sm"
          disabled={!playback || state.busy || !state.draft.voice.enabled}
          onPress={preview}
        >
          {playing ? "Stop preview" : "Preview voice"}
        </Button>
      </SettingsRow>
      {current.error ? <Alert variant="error" description={current.error} /> : null}
    </>
  );
}
function SpeechStatus({ form }: { form: SpeechForm }) {
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const refresh = useCallback(() => {
    void form.refresh();
  }, [form]);
  const retry = useCallback(() => {
    void form.retry();
  }, [form]);
  const readiness = state.origin.readiness;
  return (
    <SettingsCard>
      <SettingsRow label="Recognition" hint={readiness.dictation.message} />
      <SettingsRow label="Playback" hint={readiness.tts.message} />
      <SettingsRow label="Live voice" hint={readiness.voice.message} />
      {readiness.downloading ? (
        <SettingsRow label="Downloading speech models" hint={readiness.missingModels.join(", ")} />
      ) : null}
      {readiness.pendingSettings || readiness.applyingSettings ? (
        <SettingsRow
          label="Applying settings"
          hint="An active recording or utterance finishes before its speech engine is replaced."
        />
      ) : null}
      {readiness.error ? (
        <SettingsRow label="Speech needs attention" hint={readiness.error}>
          <Button
            variant="outline"
            size="sm"
            onPress={retry}
            disabled={state.busy || state.blocked}
          >
            Retry setup
          </Button>
        </SettingsRow>
      ) : null}
      <SettingsRow label="Host status">
        <Button variant="outline" size="sm" onPress={refresh} disabled={state.busy}>
          Refresh
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
function SpeechActions({ form }: { form: SpeechForm }) {
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  const save = useCallback(() => {
    void form.save();
  }, [form]);
  const reload = useCallback(() => {
    void form.reload();
  }, [form]);
  return (
    <SettingsCard>
      <SettingsRow
        label="Host speech settings"
        hint="Models download on this host when enabled and saved. Recording begins only through the microphone or voice controls."
      >
        <Button
          size="sm"
          onPress={save}
          disabled={state.busy || state.blocked || !state.dirty}
          loading={state.busy}
        >
          Save
        </Button>
        <Button size="sm" variant="outline" onPress={reload} disabled={state.busy}>
          Reload saved
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
function Loaded({
  hostId,
  initial,
  active,
}: {
  hostId: string;
  initial: SpeechSnapshot;
  active: boolean;
}) {
  const read = useRpc(readSpeech);
  const save = useRpc(saveSpeech);
  const retry = useRpc(retrySpeech);
  const [form] = useState(() =>
    openSpeechForm(initial, {
      read: () => read({ hostId }),
      save,
      retry: (expectedRevision) => retry({ hostId, expectedRevision }),
      confirmReload,
    }),
  );
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  useEffect(() => {
    form.setActive(active);
  }, [form, active]);
  useEffect(() => () => form.close(), [form]);
  const turnDetection = useCallback(
    (value: "local" | "openai") =>
      form.edit((draft) => ({ ...draft, voice: { ...draft.voice, turnDetection: value } })),
    [form],
  );
  return (
    <>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.notice ? <Alert variant="info" description={state.notice} /> : null}
      {state.origin.overrides.length ? (
        <Alert
          variant="info"
          description="Some speech settings are controlled by this host's environment. Those values cannot be changed here."
        />
      ) : null}
      <SettingsSection
        title="Speech recognition"
        info="Dictation keeps Paseo's existing recording and composer behavior."
      >
        <SettingsCard>
          <SttFields form={form} role="dictation" />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Text to speech">
        <SettingsCard>
          <TtsFields form={form} />
          <Preview form={form} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Advanced">
        <SettingsCard>
          <SettingsCollapsibleRow label="Live voice recognition">
            <SttFields form={form} role="voice" />
            <SettingsSelect
              label="Turn detection"
              value={state.draft.voice.turnDetection}
              options={turnDetectors}
              onValueChange={turnDetection}
              disabled={state.busy}
            />
          </SettingsCollapsibleRow>
          <SettingsCollapsibleRow label="API connections and keys">
            <SpeechApiFields form={form} endpoint="stt" />
            <SpeechApiFields form={form} endpoint="tts" />
          </SettingsCollapsibleRow>
        </SettingsCard>
      </SettingsSection>
      <SpeechActions form={form} />
      <SettingsSection title="Host readiness">
        <SpeechStatus form={form} />
      </SettingsSection>
      <SpeechDeviceSettings />
    </>
  );
}
function Opening({ hostId, active }: { hostId: string; active: boolean }) {
  const read = useRpc(readSpeech);
  const [initial, setInitial] = useState<SpeechSnapshot | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!active || initial) return;
    let valid = true;
    void read({ hostId })
      .then((result) => {
        if (valid) setInitial(result);
        return undefined;
      })
      .catch(() => {
        if (valid) setError("The host could not read speech settings.");
      });
    return () => {
      valid = false;
    };
  }, [read, hostId, active, initial, attempt]);
  if (initial) return <Loaded hostId={hostId} initial={initial} active={active} />;
  return (
    <SettingsCard>
      <SettingsRow label={error || "Loading Speech…"}>
        {error ? (
          <Button size="sm" variant="outline" onPress={retry}>
            Retry
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsCard>
  );
}
export function HostSpeechSettings(props: PluginSurfaceProps) {
  return <Opening key={props.host.id} hostId={props.host.id} active={props.active !== false} />;
}
