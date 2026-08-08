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
import { Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerVoiceCuesFeature } from "@/screens/settings/agent-personalities-section";
import { SettingsVolumeRow } from "@/screens/settings/settings-volume-row";
import { useTtsPreviewFeature } from "@/screens/settings/voice-preview-button";
import { settingsStyles } from "@/styles/settings";
import { getWakeWordCapability } from "@/wake-word/wake-word-capability";

const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];

export function AgentVoiceCuesRow({ serverId }: { serverId: string }) {
  const canSpeakCues = useVisualizerVoiceCuesFeature(serverId);
  const canPreviewVoice = useTtsPreviewFeature(serverId);
  const { settings, updateSettings } = useAppSettings();
  const wakeWordCapability = getWakeWordCapability();
  const wakeWordSupported = wakeWordCapability.available;

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
  const onWakeWordEnabled = useCallback(
    (next: boolean) => void updateSettings({ wakeWordEnabled: next }),
    [updateSettings],
  );
  const onWakeWordDelivery = useCallback(
    (value: string) => void updateSettings({ wakeWordAutoSend: value === "send" }),
    [updateSettings],
  );
  const onWakeWordPhrase = useCallback(
    (value: string) => void updateSettings({ wakeWordPhrase: value }),
    [updateSettings],
  );
  const onWakeWordNumber = useCallback(
    (key: "wakeWordSensitivity" | "wakeWordSilenceTimeoutMs", value: string) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) void updateSettings({ [key]: parsed });
    },
    [updateSettings],
  );
  const onWakeWordSensitivity = useCallback(
    (value: string) => onWakeWordNumber("wakeWordSensitivity", value),
    [onWakeWordNumber],
  );
  const onWakeWordSilenceTimeout = useCallback(
    (value: string) => onWakeWordNumber("wakeWordSilenceTimeoutMs", value),
    [onWakeWordNumber],
  );

  return (
    <>
      {canSpeakCues && canPreviewVoice ? (
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
      ) : null}
      {canSpeakCues && canPreviewVoice && settings.agentVoiceCues ? (
        <SettingsVolumeRow
          title="Voice cue volume"
          hint="How loud cues are. Separate from the Visualizer's sound effects - muting the Visualizer does not silence cues. 0% is silence."
          value={settings.agentVoiceCuesVolume}
          onCommit={onVolumeCommit}
          accessibilityLabel="Agent voice cue volume"
          testID="host-page-agent-voice-cues-volume"
        />
      ) : null}
      <View style={ROW_WITH_BORDER} testID="wake-word-settings">
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Hey Otto</Text>
          <Text style={settingsStyles.rowHint}>
            {wakeWordSupported
              ? "Off by default. When enabled, a local/native detector listens for the phrase; idle audio is never sent to Otto, the daemon, or any provider. When disabled, the detector is not started and the microphone is not opened. Use the workspace microphone button to pause listening without disabling Hey Otto."
              : (wakeWordCapability.reason ??
                "Unavailable in this build. Hey Otto requires a bundled native on-device keyword model.")}
          </Text>
        </View>
        <Switch
          value={wakeWordSupported && settings.wakeWordEnabled}
          onValueChange={onWakeWordEnabled}
          accessibilityLabel="Enable Hey Otto"
          testID="wake-word-enabled-switch"
          disabled={!wakeWordSupported}
        />
      </View>
      {wakeWordSupported && settings.wakeWordEnabled ? (
        <>
          <View style={ROW_WITH_BORDER}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Wake phrase</Text>
              <Text style={settingsStyles.rowHint}>
                This model currently supports only the built-in Hey Otto phrase.
              </Text>
            </View>
            <TextInput
              value={settings.wakeWordPhrase}
              onChangeText={onWakeWordPhrase}
              style={styles.input}
              testID="wake-word-phrase"
            />
          </View>
          <View style={ROW_WITH_BORDER}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Detector sensitivity</Text>
              <Text style={settingsStyles.rowHint}>
                Higher values make detection easier but may increase false activations.
              </Text>
            </View>
            <TextInput
              value={String(settings.wakeWordSensitivity)}
              onChangeText={onWakeWordSensitivity}
              keyboardType="decimal-pad"
              style={styles.input}
              testID="wake-word-sensitivity"
            />
          </View>
          <View style={ROW_WITH_BORDER}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Silence timeout (ms)</Text>
              <Text style={settingsStyles.rowHint}>
                How long silence ends the one-utterance recording.
              </Text>
            </View>
            <TextInput
              value={String(settings.wakeWordSilenceTimeoutMs)}
              onChangeText={onWakeWordSilenceTimeout}
              keyboardType="number-pad"
              style={styles.input}
              testID="wake-word-silence-timeout"
            />
          </View>
          <View style={ROW_WITH_BORDER}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>After dictation</Text>
            </View>
            <SegmentedControl
              value={settings.wakeWordAutoSend ? "send" : "insert"}
              onValueChange={onWakeWordDelivery}
              options={[
                { value: "insert", label: "Insert" },
                { value: "send", label: "Send" },
              ]}
              testID="wake-word-after-dictation"
            />
          </View>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  input: {
    minWidth: 84,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
  },
}));
