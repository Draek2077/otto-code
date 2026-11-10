import { SettingsSection, SettingsCard, SettingsRow } from "@/components/settings";
/** The upstream trademark is used only in attribution, never as Otto UI identity. */
export function VisualizerAttribution() {
  return (
    <SettingsSection title="Open-source rendering">
      <SettingsCard>
        <SettingsRow
          label="Visualizer"
          hint="Render layer from Agent Flow by Simon Patole, licensed under Apache-2.0. Otto's offline bundle includes the full license. Provider collectors, the extension and the upstream relay are excluded."
        />
      </SettingsCard>
    </SettingsSection>
  );
}
