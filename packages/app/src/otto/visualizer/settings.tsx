import { useCallback, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { useAppSettings } from "@/hooks/use-settings";
import {
  SettingsSection,
  SettingsCard,
  SettingsSwitch,
  SettingsSelect,
  SettingsRow,
} from "@/components/settings";
import { Alert } from "@/components/ui/alert";
import type { VisualizerPreferences } from "./preferences";
type SwitchKey = {
  [Key in keyof VisualizerPreferences]: VisualizerPreferences[Key] extends boolean ? Key : never;
}[keyof VisualizerPreferences];
const panels: Array<{ key: SwitchKey; label: string }> = [
  { key: "visualizerPanelTimeline", label: "Timeline" },
  { key: "visualizerPanelFileAttention", label: "File activity" },
  { key: "visualizerPanelCostOverlay", label: "Reported cost" },
  { key: "visualizerPanelFailures", label: "Tool failures" },
  { key: "visualizerPanelStats", label: "Node statistics" },
];
const rendering: Array<{ key: SwitchKey; label: string }> = [
  { key: "visualizerRenderBloom", label: "Bloom" },
  { key: "visualizerRenderNodeGlow", label: "Node glow" },
  { key: "visualizerRenderStars", label: "Stars" },
  { key: "visualizerRenderBackdrop", label: "Backdrop" },
  { key: "visualizerShowFps", label: "Frame-rate meter" },
  { key: "visualizerHudHidden", label: "Hide graph controls" },
  { key: "visualizerSoundMuted", label: "Mute graph effects" },
];
const qualityOptions = ["performance", "balanced", "sharp", "native"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const shapes = ["circle", "square", "hexagon", "octagon"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));
const context = [
  { value: "ring", label: "Ring" },
  { value: "bar", label: "Bar" },
];
const volumes = Array.from({ length: 11 }, (_, index) => ({
  value: String(index * 10),
  label: `${index * 10}%`,
}));
const pipSizes = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
];
function PreferenceSwitch({
  field,
  label,
  value,
  save,
}: {
  field: SwitchKey;
  label: string;
  value: boolean;
  save(patch: Partial<VisualizerPreferences>): void;
}) {
  const change = useCallback((enabled: boolean) => save({ [field]: enabled }), [field, save]);
  return <SettingsSwitch label={label} value={value} onValueChange={change} />;
}
function Fields() {
  const { settings, updateSettings } = useAppSettings();
  const [error, setError] = useState("");
  const save = useCallback(
    (patch: Partial<VisualizerPreferences>) => {
      setError("");
      void updateSettings(patch).catch(() =>
        setError("The Visualizer preference could not be saved. Try the selection again."),
      );
    },
    [updateSettings],
  );
  const quality = useCallback(
    (value: string) => {
      if (
        value === "performance" ||
        value === "balanced" ||
        value === "sharp" ||
        value === "native"
      )
        save({ visualizerRenderQuality: value });
    },
    [save],
  );
  const shape = useCallback(
    (value: string) => {
      if (value === "circle" || value === "square" || value === "hexagon" || value === "octagon")
        save({ visualizerNodeShape: value });
    },
    [save],
  );
  const occupancy = useCallback(
    (value: string) => {
      if (value === "ring" || value === "bar") save({ visualizerContextDisplay: value });
    },
    [save],
  );
  const volume = useCallback(
    (value: string) => save({ visualizerSoundVolume: Number(value) }),
    [save],
  );
  const pipSize = useCallback(
    (value: string) => {
      if (value === "small" || value === "medium") save({ visualizerPipSize: value });
    },
    [save],
  );
  return (
    <>
      <SettingsSection
        title="Visualizer"
        info="Device preferences for the session graph, picture in picture and chat background."
      >
        <SettingsCard>
          <SettingsSelect
            label="Rendering quality"
            hint="Higher quality uses a larger canvas. Performance limits display density to 1×."
            value={settings.visualizerRenderQuality}
            options={qualityOptions}
            onValueChange={quality}
          />
          <SettingsSelect
            label="Agent shape"
            value={settings.visualizerNodeShape}
            options={shapes}
            onValueChange={shape}
          />
          <SettingsSelect
            label="Context occupancy"
            value={settings.visualizerContextDisplay}
            options={context}
            onValueChange={occupancy}
          />
          <SettingsSelect
            label="Picture-in-picture size"
            value={settings.visualizerPipSize}
            options={pipSizes}
            onValueChange={pipSize}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Panels">
        <SettingsCard>
          {panels.map((item) => (
            <PreferenceSwitch
              key={item.key}
              field={item.key}
              label={item.label}
              value={settings[item.key]}
              save={save}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Rendering and sound">
        <SettingsCard>
          {rendering.map((item) => (
            <PreferenceSwitch
              key={item.key}
              field={item.key}
              label={item.label}
              value={settings[item.key]}
              save={save}
            />
          ))}
          <SettingsSelect
            label="Graph effects volume"
            value={String(settings.visualizerSoundVolume)}
            options={volumes}
            onValueChange={volume}
          />
          <SettingsRow
            label="Activity voice cues"
            hint="Speech settings control spoken activity and replies independently of the graph. The Visualizer does not start another voice queue."
          />
        </SettingsCard>
      </SettingsSection>
      {error ? <Alert variant="error" description={error} /> : null}
    </>
  );
}
export function VisualizerSettings() {
  return (
    <QueryClientProvider client={queryClient}>
      <Fields />
    </QueryClientProvider>
  );
}
