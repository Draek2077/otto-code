import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useAppSettings,
  type AppSettings,
  type VisualizerRenderQuality,
} from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";

// i18n: raw English pending a translation pass (Visualizer settings) — same
// precedent as the "Default tab orientation" row in appearance-section.tsx.
// The panel-toggle rows keep their existing settings.appearance.visualizer.*
// keys (already in every locale) even though the section moved here.

interface ToggleRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: boolean;
  withBorder: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
}

function ToggleRow({
  title,
  hint,
  accessibilityLabel,
  value,
  withBorder,
  onValueChange,
  testID,
}: ToggleRowProps) {
  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

const QUALITY_OPTIONS: SegmentedControlOption<VisualizerRenderQuality>[] = [
  { value: "performance", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "sharp", label: "Sharp" },
  { value: "native", label: "Native" },
];

interface VolumeRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: number;
  onCommit: (value: number) => void;
}

// Drag updates a local draft (live feedback + percent readout) and only
// commits to device-local settings on release — same shape as
// appearance-section.tsx's FontSizeRow, so the config re-send fires once per
// gesture, not on every tick.
function VolumeRow({ title, hint, accessibilityLabel, value, onCommit }: VolumeRowProps) {
  const [draft, setDraft] = useState(value);
  // Keep the draft in sync when the committed value changes elsewhere.
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <View style={settingsStyles.rowResponsive}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.volumeField}>
        <Slider
          min={0}
          max={100}
          step={5}
          value={draft}
          onValueChange={setDraft}
          onSlidingComplete={onCommit}
          accessibilityLabel={accessibilityLabel}
          testID="settings-visualizer-volume"
        />
        <Text style={styles.volumeValue}>{draft}%</Text>
      </View>
    </View>
  );
}

export function VisualizerSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();

  const setSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      void updateSettings({ [key]: value } as Partial<AppSettings>);
    },
    [updateSettings],
  );

  const handleQualityChange = useCallback(
    (visualizerRenderQuality: VisualizerRenderQuality) => {
      void updateSettings({ visualizerRenderQuality });
    },
    [updateSettings],
  );
  const handleBloomChange = useCallback(
    (value: boolean) => setSetting("visualizerRenderBloom", value),
    [setSetting],
  );
  const handleStarsChange = useCallback(
    (value: boolean) => setSetting("visualizerRenderStars", value),
    [setSetting],
  );
  const handleBackdropChange = useCallback(
    (value: boolean) => setSetting("visualizerRenderBackdrop", value),
    [setSetting],
  );
  const handleHexGridChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelHexGrid", value),
    [setSetting],
  );
  const handleMessageFeedChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelMessageFeed", value),
    [setSetting],
  );
  const handleTimelineChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelTimeline", value),
    [setSetting],
  );
  const handleFileAttentionChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelFileAttention", value),
    [setSetting],
  );
  const handleTranscriptChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelTranscript", value),
    [setSetting],
  );
  const handleCostOverlayChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelCostOverlay", value),
    [setSetting],
  );
  const handleVolumeCommit = useCallback(
    (value: number) => setSetting("visualizerSoundVolume", value),
    [setSetting],
  );

  const qualityRowStyle = useMemo(
    () => [settingsStyles.rowResponsive, settingsStyles.rowBorder],
    [],
  );

  return (
    <>
      <SettingsSection title="Rendering">
        <View style={settingsStyles.card}>
          <View style={qualityRowStyle}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Sharpness</Text>
              <Text style={settingsStyles.rowHint}>
                Canvas resolution vs. frame rate. Fast renders at 1x, Native at the display&apos;s
                full pixel ratio — on a large 2x pane, Native can cost most of the frame rate.
                Applies the next time a Visualizer tab loads (open tabs reload).
              </Text>
            </View>
            <SegmentedControl
              size="sm"
              value={settings.visualizerRenderQuality}
              onValueChange={handleQualityChange}
              options={QUALITY_OPTIONS}
              testID="settings-visualizer-quality"
            />
          </View>
          <ToggleRow
            title="Bloom glow"
            hint="The soft holographic glow composited over the whole scene. The single most expensive visual effect — turning it off also removes the blurry 'echo' of bright elements."
            accessibilityLabel="Bloom glow"
            value={settings.visualizerRenderBloom}
            withBorder
            onValueChange={handleBloomChange}
            testID="settings-visualizer-bloom-switch"
          />
          <ToggleRow
            title="Background stars"
            hint="The drifting parallax star field behind the graph."
            accessibilityLabel="Background stars"
            value={settings.visualizerRenderStars}
            withBorder
            onValueChange={handleStarsChange}
            testID="settings-visualizer-stars-switch"
          />
          <ToggleRow
            title="Backdrop"
            hint="The deep-space background fill and the ambient spotlight that follows the active agent."
            accessibilityLabel="Backdrop"
            value={settings.visualizerRenderBackdrop}
            withBorder
            onValueChange={handleBackdropChange}
            testID="settings-visualizer-backdrop-switch"
          />
          <ToggleRow
            title={t("settings.appearance.visualizer.hexGrid.title")}
            hint={t("settings.appearance.visualizer.hexGrid.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.hexGrid.accessibilityLabel")}
            value={settings.visualizerPanelHexGrid}
            withBorder
            onValueChange={handleHexGridChange}
            testID="settings-visualizer-hex-grid-switch"
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Panels">
        <View style={settingsStyles.card}>
          <ToggleRow
            title={t("settings.appearance.visualizer.messageFeed.title")}
            hint={t("settings.appearance.visualizer.messageFeed.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.messageFeed.accessibilityLabel")}
            value={settings.visualizerPanelMessageFeed}
            withBorder={false}
            onValueChange={handleMessageFeedChange}
            testID="settings-visualizer-message-feed-switch"
          />
          <ToggleRow
            title={t("settings.appearance.visualizer.timeline.title")}
            hint={t("settings.appearance.visualizer.timeline.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.timeline.accessibilityLabel")}
            value={settings.visualizerPanelTimeline}
            withBorder
            onValueChange={handleTimelineChange}
            testID="settings-visualizer-timeline-switch"
          />
          <ToggleRow
            title={t("settings.appearance.visualizer.fileAttention.title")}
            hint={t("settings.appearance.visualizer.fileAttention.hint")}
            accessibilityLabel={t(
              "settings.appearance.visualizer.fileAttention.accessibilityLabel",
            )}
            value={settings.visualizerPanelFileAttention}
            withBorder
            onValueChange={handleFileAttentionChange}
            testID="settings-visualizer-file-attention-switch"
          />
          <ToggleRow
            title={t("settings.appearance.visualizer.transcript.title")}
            hint={t("settings.appearance.visualizer.transcript.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.transcript.accessibilityLabel")}
            value={settings.visualizerPanelTranscript}
            withBorder
            onValueChange={handleTranscriptChange}
            testID="settings-visualizer-transcript-switch"
          />
          <ToggleRow
            title={t("settings.appearance.visualizer.costOverlay.title")}
            hint={t("settings.appearance.visualizer.costOverlay.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.costOverlay.accessibilityLabel")}
            value={settings.visualizerPanelCostOverlay}
            withBorder
            onValueChange={handleCostOverlayChange}
            testID="settings-visualizer-cost-overlay-switch"
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Sound">
        <View style={settingsStyles.card}>
          <VolumeRow
            title="Volume"
            hint="Level for the Visualizer's procedural sound effects (agent spawn, tool activity, completion, errors) when unmuted. Use the speaker button inside the Visualizer to mute or unmute — that choice is remembered across sessions."
            accessibilityLabel="Visualizer sound volume"
            value={settings.visualizerSoundVolume}
            onCommit={handleVolumeCommit}
          />
        </View>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Mirrors appearance-section.tsx's rowWithBorder (settingsStyles.row +
  // rowBorder are separate style objects; RN Switch rows want one).
  rowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  // Slider + percent readout, mirroring appearance-section.tsx's sizeField.
  volumeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    width: { xs: "100%", sm: "auto" },
  },
  volumeValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 40,
    textAlign: "right",
  },
}));
