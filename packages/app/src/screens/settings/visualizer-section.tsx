import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useIsSoftwareRendering } from "@/desktop/use-software-rendering";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useAppSettings,
  type AppSettings,
  type VisualizerNodeShape,
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
  disabled?: boolean;
  testID?: string;
}

function ToggleRow({
  title,
  hint,
  accessibilityLabel,
  value,
  withBorder,
  onValueChange,
  disabled = false,
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
        disabled={disabled}
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

const NODE_SHAPE_OPTIONS: SegmentedControlOption<VisualizerNodeShape>[] = [
  { value: "hexagon", label: "Hexagon" },
  { value: "square", label: "Square" },
  { value: "octagon", label: "Octagon" },
  { value: "circle", label: "Circle" },
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
  // Bloom is forced off while the desktop shell runs without GPU acceleration
  // (three full-canvas blur passes per frame — a CPU rasterizer can't afford
  // it; visualizer-panel.tsx applies the same force to the guest config). The
  // stored preference is left untouched so it comes back if the machine
  // regains hardware acceleration.
  const isSoftwareRendering = useIsSoftwareRendering();

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
  const handleNodeShapeChange = useCallback(
    (visualizerNodeShape: VisualizerNodeShape) => {
      void updateSettings({ visualizerNodeShape });
    },
    [updateSettings],
  );
  const handleBloomChange = useCallback(
    (value: boolean) => setSetting("visualizerRenderBloom", value),
    [setSetting],
  );
  const handleNodeGlowChange = useCallback(
    (value: boolean) => setSetting("visualizerRenderNodeGlow", value),
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
  const handleShowFpsChange = useCallback(
    (value: boolean) => setSetting("visualizerShowFps", value),
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
  const handleCostOverlayChange = useCallback(
    (value: boolean) => setSetting("visualizerPanelCostOverlay", value),
    [setSetting],
  );
  const handleVolumeCommit = useCallback(
    (value: number) => setSetting("visualizerSoundVolume", value),
    [setSetting],
  );
  const handleVoiceCuesChange = useCallback(
    (value: boolean) => setSetting("visualizerVoiceCues", value),
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
            title="FPS meter"
            hint="Show a small frames-per-second readout in the top-left corner. A performance diagnostic; applies live to open Visualizer tabs."
            accessibilityLabel="FPS meter"
            value={settings.visualizerShowFps}
            withBorder
            onValueChange={handleShowFpsChange}
            testID="settings-visualizer-fps-switch"
          />
          <View style={qualityRowStyle}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Node shape</Text>
              <Text style={settingsStyles.rowHint}>
                The silhouette drawn for each agent node on the graph. Applies live to open
                Visualizer tabs.
              </Text>
            </View>
            <SegmentedControl
              size="sm"
              value={settings.visualizerNodeShape}
              onValueChange={handleNodeShapeChange}
              options={NODE_SHAPE_OPTIONS}
              testID="settings-visualizer-node-shape"
            />
          </View>
          <ToggleRow
            title="Node glow"
            hint="The soft holographic halo drawn around each agent node. The node body and ring stay; this only toggles the surrounding glow."
            accessibilityLabel="Node glow"
            value={settings.visualizerRenderNodeGlow}
            withBorder
            onValueChange={handleNodeGlowChange}
            testID="settings-visualizer-node-glow-switch"
          />
          <ToggleRow
            title="Bloom"
            hint={
              isSoftwareRendering
                ? "Forced off — this machine is running without GPU acceleration, and bloom is the single most expensive visual effect."
                : "A whole-viewport blurred echo of the scene, composited over everything for a holographic haze. The single most expensive visual effect. (The per-node halo is the separate 'Node glow' toggle above.)"
            }
            accessibilityLabel="Bloom"
            value={isSoftwareRendering ? false : settings.visualizerRenderBloom}
            withBorder
            onValueChange={handleBloomChange}
            disabled={isSoftwareRendering}
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
        </View>
      </SettingsSection>
      <SettingsSection title="Panels">
        <View style={settingsStyles.card}>
          <ToggleRow
            title={t("settings.appearance.visualizer.timeline.title")}
            hint={t("settings.appearance.visualizer.timeline.hint")}
            accessibilityLabel={t("settings.appearance.visualizer.timeline.accessibilityLabel")}
            value={settings.visualizerPanelTimeline}
            withBorder={false}
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
            hint="Sound effect loudness — mute with the speaker button in the Visualizer."
            accessibilityLabel="Visualizer sound volume"
            value={settings.visualizerSoundVolume}
            onCommit={handleVolumeCommit}
          />
          <ToggleRow
            title="Voice cues"
            hint="Speak a short line in the agent's personality voice when its node joins the graph, first starts thinking, and finishes. Only the main agent speaks, only for personality-backed agents, and only on a host with text-to-speech. Follows the volume above."
            accessibilityLabel="Visualizer voice cues"
            value={settings.visualizerVoiceCues}
            withBorder
            onValueChange={handleVoiceCuesChange}
            testID="settings-visualizer-voice-cues-switch"
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
  // Slider + percent readout, mirroring appearance-section.tsx's sizeField:
  // capped width so the field centers under the label when the row stacks on
  // the narrowest widths instead of running edge-to-edge.
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
