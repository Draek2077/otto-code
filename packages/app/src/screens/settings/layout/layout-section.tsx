import { SettingsTargetText } from "@/screens/settings-search/target";
import { settingsTargetIdsForPersistence } from "@/screens/settings-search-catalog";
import { Fragment, useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import {
  useAppSettings,
  type OpenInSidePanePreferences,
  type PullRequestOpenLocation,
} from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const SOURCES = [
  "explorerFiles",
  "explorerChanges",
  "chatFiles",
  "diffFiles",
  "subagents",
  "pullRequests",
  "changesLinks",
] as const satisfies readonly (keyof OpenInSidePanePreferences)[];

type OpenDestination = PullRequestOpenLocation;

function destinationTriggerStyle({
  pressed,
  open,
}: PressableStateCallbackType & { open?: boolean }) {
  return [styles.destinationTrigger, (pressed || open) && styles.destinationTriggerActive];
}

function LayoutPreferenceRow({
  source,
  value,
  pullRequestDestination,
  first,
  onDestinationChange,
}: {
  source: keyof OpenInSidePanePreferences;
  value: boolean;
  pullRequestDestination?: PullRequestOpenLocation;
  first: boolean;
  onDestinationChange: (
    source: keyof OpenInSidePanePreferences,
    destination: OpenDestination,
  ) => void;
}) {
  const { t } = useTranslation();
  const destination: OpenDestination = pullRequestDestination ?? (value ? "side" : "main");
  const destinationLabel = t(`settings.layout.openInSidePane.destinations.${destination}`);
  const selectMain = useCallback(
    () => onDestinationChange(source, "main"),
    [onDestinationChange, source],
  );
  const selectSide = useCallback(
    () => onDestinationChange(source, "side"),
    [onDestinationChange, source],
  );
  const selectExplorer = useCallback(
    () => onDestinationChange(source, "explorer"),
    [onDestinationChange, source],
  );
  const label = t(`settings.layout.openInSidePane.sources.${source}.label`);
  return (
    <View style={[settingsStyles.row, first ? null : settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <SettingsTargetText
          settingId={
            source === "pullRequests"
              ? "app-layout-open-location-pull-requests"
              : settingsTargetIdsForPersistence("layout", `openInSidePane.${source}`)
          }
          style={settingsStyles.rowTitle}
        >
          {label}
        </SettingsTargetText>
      </View>
      <DropdownMenu>
        <DropdownTrigger
          style={destinationTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${destinationLabel}`}
        >
          <Text style={styles.destinationLabel}>{destinationLabel}</Text>
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={180}>
          <DropdownMenuItem selected={destination === "main"} onSelect={selectMain}>
            {t("settings.layout.openInSidePane.destinations.main")}
          </DropdownMenuItem>
          <DropdownMenuItem selected={destination === "side"} onSelect={selectSide}>
            {t("settings.layout.openInSidePane.destinations.side")}
          </DropdownMenuItem>
          {source === "pullRequests" ? (
            <DropdownMenuItem selected={destination === "explorer"} onSelect={selectExplorer}>
              {t("settings.layout.openInSidePane.destinations.explorer")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

export function LayoutSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleDestinationChange = useCallback(
    (source: keyof OpenInSidePanePreferences, destination: OpenDestination) => {
      void updateSettings((current) => ({
        openInSidePane: { ...current.openInSidePane, [source]: destination === "side" },
        ...(source === "pullRequests" ? { pullRequestOpenLocation: destination } : {}),
      }));
    },
    [updateSettings],
  );
  return (
    <SettingsSection title={t("settings.layout.openInSidePane.title")}>
      <View style={settingsStyles.card}>
        {SOURCES.map((source, index) => (
          <Fragment key={source}>
            <LayoutPreferenceRow
              source={source}
              value={settings.openInSidePane[source]}
              pullRequestDestination={
                source === "pullRequests" ? settings.pullRequestOpenLocation : undefined
              }
              first={index === 0}
              onDestinationChange={handleDestinationChange}
            />
          </Fragment>
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  destinationTrigger: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  destinationTriggerActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  destinationLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
