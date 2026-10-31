import { useCallback, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { Alert } from "@/components/ui/alert";
import type { SpeechPreferences } from "./preferences";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  SettingsCollapsibleRow,
} from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";
const volumes = Array.from({ length: 11 }, (_, index) => ({
  value: String(index * 10),
  label: `${index * 10}%`,
}));
function SpeechDeviceFields() {
  const { settings, updateSettings } = useAppSettings();
  const [error, setError] = useState("");
  const savePreference = useCallback(
    (value: Partial<SpeechPreferences>) => {
      setError("");
      void updateSettings(value).catch(() =>
        setError("The device speech preference could not be saved. Try selecting it again."),
      );
    },
    [updateSettings],
  );
  const volume = useCallback(
    (value: string) => {
      savePreference({ voicePlaybackVolume: Number(value) });
    },
    [savePreference],
  );
  const tone = useCallback(
    (value: boolean) => {
      savePreference({ voiceThinkingTone: value });
    },
    [savePreference],
  );
  const cues = useCallback(
    (value: boolean) => {
      savePreference({ agentVoiceCues: value });
    },
    [savePreference],
  );
  const muted = useCallback(
    (value: boolean) => {
      savePreference({ agentVoiceCuesMuted: value });
    },
    [savePreference],
  );
  const cueVolume = useCallback(
    (value: string) => {
      savePreference({ agentVoiceCuesVolume: Number(value) });
    },
    [savePreference],
  );
  return (
    <SettingsSection
      title="This device"
      info="These preferences control this device's speaker. Recognition and speech models run on the selected host."
    >
      {error ? <Alert variant="error" description={error} /> : null}
      <SettingsCard>
        <SettingsSelect
          label="Playback volume"
          value={String(settings.voicePlaybackVolume)}
          options={volumes}
          onValueChange={volume}
        />
        <SettingsSwitch
          label="Thinking tone"
          hint="A quiet repeating tone while live voice is waiting for a reply."
          value={settings.voiceThinkingTone}
          onValueChange={tone}
        />
        <SettingsCollapsibleRow label="Agent voice cues">
          <SettingsSwitch
            label="Spoken activity cues"
            hint="Short starting, thinking, waiting and completion cues. Chats with automatic reading use their replies instead."
            value={settings.agentVoiceCues}
            onValueChange={cues}
          />
          <SettingsSwitch
            label="Mute activity cues"
            value={settings.agentVoiceCuesMuted}
            onValueChange={muted}
          />
          <SettingsSelect
            label="Cue volume"
            value={String(settings.agentVoiceCuesVolume)}
            options={volumes}
            onValueChange={cueVolume}
          />
        </SettingsCollapsibleRow>
      </SettingsCard>
    </SettingsSection>
  );
}
export function SpeechDeviceSettings() {
  // Plugin surfaces have their own query cache. Device audio preferences belong
  // to the existing app cache read by the speaker and activity subscribers.
  return (
    <QueryClientProvider client={queryClient}>
      <SpeechDeviceFields />
    </QueryClientProvider>
  );
}
