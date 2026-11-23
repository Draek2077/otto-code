import { useCallback } from "react";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsButton,
  SettingsExpander,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { providerSettings } from "../shared/settings.js";
import { Connections } from "./connections.js";

export function ConnectionScreen({ host }: PluginSurfaceProps) {
  const settings = useSettings(providerSettings);
  const reload = useCallback(() => void settings.reload(), [settings]);
  // COMPAT(ottoConnectionUi): added in Otto 0.10.0, remove after 2027-04-22 once the client floor includes this bridge.
  if (!SettingsButton || !SettingsExpander)
    return (
      <SettingsSection title="Connections">
        <SettingsCard>
          <SettingsRow label="Update the Otto app to manage connections." />
        </SettingsCard>
      </SettingsSection>
    );
  if (settings.status !== "ready")
    return (
      <SettingsSection title="Connections">
        <SettingsCard>
          <SettingsRow
            label={settings.status === "loading" ? "Loading connections..." : settings.error}
          />
          {settings.status !== "loading" && (
            <SettingsAction label="Read host settings again" actionLabel="Retry" onPress={reload} />
          )}
        </SettingsCard>
      </SettingsSection>
    );
  return <Connections settings={settings} host={host} />;
}
