// The "Voice volume" slider - how loud the agent is when it SPEAKS TO YOU:
// voice mode, auto-speech, and the per-message play button (plus voice mode's
// thinking tone, which is part of the same conversation).
//
// It sits beside the cue rows because this is the question people actually
// arrive with - "the voice is too loud" - and until now the app had no answer
// to it. Playback ran at whatever the host synthesized, and the only two volume
// sliders in the product belonged to other channels: voice cues (a
// notification) and the Visualizer (ambience for a graph). Three channels, three
// sliders, no mixing between them; see voice/audio-gain.ts.
//
// DEVICE-LOCAL, on a per-host page, for the same reason the cue rows and the
// thinking-tone row are: it decides what this device's speakers do, but the
// capability it depends on is per-host and Agents is where you look for it.
//
// Hidden when the host cannot synthesize speech at all - there is nothing to
// set a level for. Defaults to 50, level with the cue and Visualizer sliders;
// speech previously played at whatever the host synthesized, so the default
// makes it quieter than it was rather than preserving that.
import { useCallback } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { SettingsVolumeRow } from "@/screens/settings/settings-volume-row";
import { useTtsPreviewFeature } from "@/screens/settings/voice-preview-button";

export function VoicePlaybackVolumeRow({ serverId }: { serverId: string }) {
  const canSpeak = useTtsPreviewFeature(serverId);
  const { settings, updateSettings } = useAppSettings();

  const onCommit = useCallback(
    (next: number) => {
      void updateSettings({ voicePlaybackVolume: next });
    },
    [updateSettings],
  );

  if (!canSpeak) {
    return null;
  }

  return (
    <SettingsVolumeRow
      title="Voice volume"
      hint="How loud the agent is when it reads a reply aloud - voice mode, auto-speech, and the play button on a message. Its own channel, separate from voice cues and the Visualizer. 0% is silence."
      value={settings.voicePlaybackVolume}
      onCommit={onCommit}
      accessibilityLabel="Voice volume"
      testID="host-page-voice-playback-volume"
      rowTestID="host-page-voice-playback-volume-row"
    />
  );
}
