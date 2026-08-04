// The "Voice cues" toggle + its volume, rendered inside the Agents section's
// grouped card.
//
// Cues are an agent notification channel, not a Visualizer feature, so this is
// where they are switched off and where their level is set - see
// voice/use-agent-voice-cues.ts. They are their OWN audio channel: the
// Visualizer's Sound slider and speaker button drive the graph's ambience, the
// Voice volume row below drives spoken replies, and neither has any say here.
// Three unrelated things, three channels.
//
// Both settings are DEVICE-LOCAL (they decide whether this device's speakers
// make noise, like the voice-mode thinking tone a card below), even though the
// rows live on a per-host page: the capability they depend on is per-host, and
// Agents is where you look for them. Same precedent as the thinking-tone row in
// speech-settings-cards.tsx.
//
// Hidden entirely when the host can't do cues, rather than shown-but-dead: it
// needs a daemon that advertises both voice-cue support and TTS.
import { useCallback } from "react";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerVoiceCuesFeature } from "@/screens/settings/agent-personalities-section";
import { SettingsVolumeRow } from "@/screens/settings/settings-volume-row";
import { useTtsPreviewFeature } from "@/screens/settings/voice-preview-button";
import { settingsStyles } from "@/styles/settings";

const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];

export function AgentVoiceCuesRow({ serverId }: { serverId: string }) {
  const canSpeakCues = useVisualizerVoiceCuesFeature(serverId);
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  const { settings, updateSettings } = useAppSettings();

  const onValueChange = useCallback(
    (next: boolean) => {
      void updateSettings({ agentVoiceCues: next });
    },
    [updateSettings],
  );
  const onVolumeCommit = useCallback(
    (next: number) => {
      void updateSettings({ agentVoiceCuesVolume: next });
    },
    [updateSettings],
  );

  if (!canSpeakCues || !canPreviewVoice) {
    return null;
  }

  return (
    <>
      <View style={ROW_WITH_BORDER} testID="host-page-agent-voice-cues">
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Voice cues</Text>
          <Text style={settingsStyles.rowHint}>
            Speak a short line in the agent&apos;s personality voice when it starts, first starts
            thinking, waits on its sub-agents, and finishes. Only the main agent speaks, and only
            for personality-backed agents - write the lines in the personality&apos;s Voice tab.
            Plays wherever you are in the app, whether or not the Visualizer is open. To silence
            them temporarily, use the speech button in the workspace header instead.
          </Text>
        </View>
        <Switch
          value={settings.agentVoiceCues}
          onValueChange={onValueChange}
          accessibilityLabel="Agent voice cues"
          testID="host-page-agent-voice-cues-switch"
        />
      </View>
      {settings.agentVoiceCues ? (
        <SettingsVolumeRow
          title="Voice cue volume"
          hint="How loud cues are. Separate from the Visualizer's sound effects - muting the Visualizer does not silence cues. 0% is silence."
          value={settings.agentVoiceCuesVolume}
          onCommit={onVolumeCommit}
          accessibilityLabel="Agent voice cue volume"
          testID="host-page-agent-voice-cues-volume"
        />
      ) : null}
    </>
  );
}
