import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { reenableGpuAcceleration } from "@/desktop/updates/desktop-updates";
import { useIsSoftwareRendering } from "@/desktop/use-software-rendering";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useAppSettings,
  type AppSettings,
  type VisualizerContextDisplay,
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
  { value: "square", label: "Square" },
  { value: "hexagon", label: "Hexagon" },
  { value: "octagon", label: "Octagon" },
  { value: "circle", label: "Circle" },
];

const CONTEXT_DISPLAY_OPTIONS: SegmentedControlOption<VisualizerContextDisplay>[] = [
  { value: "ring", label: "Ring" },
  { value: "bar", label: "Bar" },
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
  // Master switch for the whole Visualizer feature. Off removes the entry points
  // and keeps the render bundle out of memory (see features/feature-catalog.ts).
  // When off, the rest of this section is hidden — nothing here applies.
  const visualizerEnabled = useFeatureEnabled("visualizer");
  const handleEnabledChange = useCallback(
    (value: boolean) => {
      void updateSettings({
        featureEnabled: { ...settings.featureEnabled, visualizer: value },
      });
    },
    [settings.featureEnabled, updateSettings],
  );
  // Bloom is forced off while the desktop shell runs without GPU acceleration
  // (three full-canvas blur passes per frame — a CPU rasterizer can't afford
  // it; visualizer-panel.tsx applies the same force to the guest config). The
  // stored preference is left untouched so it comes back if the machine
  // regains hardware acceleration.
  const isSoftwareRendering = useIsSoftwareRendering();
  // The re-enable action quits and relaunches the app, so the invoke promise
  // usually never resolves — the pending state exists only to disable the
  // button and show progress during the brief window before the relaunch (or
  // to recover if the command rejects, e.g. off-desktop).
  const [reenablingGpu, setReenablingGpu] = useState(false);
  const handleReenableGpu = useCallback(() => {
    setReenablingGpu(true);
    void reenableGpuAcceleration().catch(() => setReenablingGpu(false));
  }, []);

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
  const handleContextDisplayChange = useCallback(
    (visualizerContextDisplay: VisualizerContextDisplay) => {
      void updateSettings({ visualizerContextDisplay });
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
      <SettingsSection title="Availability">
        <View style={settingsStyles.card}>
          <ToggleRow
            title="Enable Visualizer"
            hint="The live agent-orchestration graph. Turn it off to remove the header button and Runs “Visualize” action — and to keep its render bundle from ever loading into memory. Open Visualizer tabs close when disabled."
            accessibilityLabel="Enable Visualizer"
            value={visualizerEnabled}
            withBorder={false}
            onValueChange={handleEnabledChange}
            testID="settings-visualizer-enable-switch"
          />
        </View>
      </SettingsSection>
      {visualizerEnabled ? (
        <>
          <SettingsSection title="Rendering">
            <View style={settingsStyles.card}>
              {isSoftwareRendering ? (
                <View style={styles.gpuNotice}>
                  <View style={settingsStyles.rowContent}>
                    <Text style={settingsStyles.rowTitle}>GPU acceleration is off</Text>
                    <Text style={settingsStyles.rowHint}>
                      Otto turned off hardware acceleration after the GPU crashed and fell back to
                      software rendering, so bloom and other heavy effects are disabled to keep the
                      frame rate usable. If your GPU is working again, turn acceleration back on —
                      Otto will restart.
                    </Text>
                  </View>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={reenablingGpu}
                    onPress={handleReenableGpu}
                    style={styles.gpuNoticeButton}
                    testID="settings-visualizer-reenable-gpu"
                  >
                    Re-enable GPU acceleration
                  </Button>
                </View>
              ) : null}
              <ToggleRow
                title="FPS meter"
                hint="Show a small frames-per-second readout in the top-left corner. A performance diagnostic; applies live to open Visualizer tabs."
                accessibilityLabel="FPS meter"
                value={settings.visualizerShowFps}
                withBorder={false}
                onValueChange={handleShowFpsChange}
                testID="settings-visualizer-fps-switch"
              />
              <View style={qualityRowStyle}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Sharpness</Text>
                  <Text style={settingsStyles.rowHint}>
                    Canvas resolution vs. frame rate. Fast renders at 1x, Native at the
                    display&apos;s full pixel ratio — on a large 2x pane, Native can cost most of
                    the frame rate. Applies the next time a Visualizer tab loads (open tabs reload).
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
              <View style={qualityRowStyle}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>Context readout</Text>
                  <Text style={settingsStyles.rowHint}>
                    How the main agent node reports context occupancy. The ring hugs the node; the
                    bar sits under it. They show the same number, so you pick one — with the ring,
                    the token count moves up into the bar&apos;s place. Sub-agent nodes always use
                    the bar. Applies live to open Visualizer tabs.
                  </Text>
                </View>
                <SegmentedControl
                  size="sm"
                  value={settings.visualizerContextDisplay}
                  onValueChange={handleContextDisplayChange}
                  options={CONTEXT_DISPLAY_OPTIONS}
                  testID="settings-visualizer-context-display"
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
                    ? "Off while GPU acceleration is disabled — bloom needs the GPU and is the single most expensive visual effect. Re-enable acceleration above to turn it back on."
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
                accessibilityLabel={t(
                  "settings.appearance.visualizer.costOverlay.accessibilityLabel",
                )}
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
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Alert callout at the top of the Rendering card, shown only while the
  // desktop shell has fallen back to software rendering. A subtly tinted block
  // with the explanation + the "Re-enable GPU acceleration" action, so a user
  // wondering why bloom vanished finds the reason and the fix in one place
  // instead of an env var / marker file.
  gpuNotice: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.muted,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  gpuNoticeButton: {
    alignSelf: "flex-start",
  },
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
