// The "Voice cues" toggle + its volume, rendered inside the Agents section's
// grouped card.
//
// Cues are an agent notification channel, not a Visualizer feature, so this is
// where they are switched off and where their level is set — see
// voice/use-agent-voice-cues.ts. They are their OWN audio channel: the
// Visualizer's Sound slider and speaker button drive the graph's ambience and
// have no say here. Two unrelated things, two channels.
//
// Both settings are DEVICE-LOCAL (they decide whether this device's speakers
// make noise, like the voice-mode thinking tone a card below), even though the
// rows live on a per-host page: the capability they depend on is per-host, and
// Agents is where you look for them. Same precedent as the thinking-tone row in
// speech-settings-cards.tsx.
//
// Hidden entirely when the host can't do cues, rather than shown-but-dead: it
// needs a daemon that advertises both voice-cue support and TTS.
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerVoiceCuesFeature } from "@/screens/settings/agent-personalities-section";
import { useTtsPreviewFeature } from "@/screens/settings/voice-preview-button";
import { settingsStyles } from "@/styles/settings";

const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];
const VOLUME_ROW = [settingsStyles.rowResponsive, settingsStyles.rowBorder];

// Drag updates a local draft (live feedback + percent readout) and only commits
// on release — same shape as the Visualizer's VolumeRow and appearance-section's
// FontSizeRow, so one write per gesture rather than one per tick.
function VolumeRow({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <View style={VOLUME_ROW}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Voice cue volume</Text>
        <Text style={settingsStyles.rowHint}>
          How loud cues are. Separate from the Visualizer&apos;s sound effects — muting the
          Visualizer does not silence cues. 0% is silence.
        </Text>
      </View>
      <View style={styles.volumeField}>
        <Slider
          min={0}
          max={100}
          step={5}
          value={draft}
          onValueChange={setDraft}
          onSlidingComplete={onCommit}
          accessibilityLabel="Agent voice cue volume"
          testID="host-page-agent-voice-cues-volume"
        />
        <Text style={styles.volumeValue}>{draft}%</Text>
      </View>
    </View>
  );
}

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
            for personality-backed agents — write the lines in the personality&apos;s Voice tab.
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
        <VolumeRow value={settings.agentVoiceCuesVolume} onCommit={onVolumeCommit} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  volumeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    width: { xs: "100%", sm: "auto" },
    maxWidth: 220,
    marginLeft: { xs: 0, sm: theme.spacing[4] },
  },
  volumeValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 40,
    textAlign: "right",
  },
}));
