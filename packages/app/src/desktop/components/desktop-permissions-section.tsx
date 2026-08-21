import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "@/components/icons/material-icons";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";

const ThemedRotateCw = withUnistyles(RotateCw, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));

export function DesktopPermissionsSection() {
  const { t } = useTranslation();
  const {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    refreshPermissions,
    requestPermission,
  } = useDesktopPermissions();

  const handleRefreshPress = useCallback(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const handleRequestMicrophone = useCallback(() => {
    void requestPermission("microphone");
  }, [requestPermission]);

  const isBusy = isRefreshing || requestingPermission !== null;

  const refreshIcon = useMemo(() => <ThemedRotateCw />, []);

  // Refresh sits in a centered footer below the cards (not the section header)
  // so it never crowds the title on narrow windows.
  const refreshFooter = useMemo(
    () => (
      <View style={styles.refreshFooter}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={refreshIcon}
          onPress={handleRefreshPress}
          disabled={isBusy}
          accessibilityLabel={t("settings.permissions.refreshAccessibility")}
        >
          {isRefreshing ? t("settings.permissions.refreshing") : t("settings.permissions.refresh")}
        </Button>
      </View>
    ),
    [refreshIcon, handleRefreshPress, isBusy, isRefreshing, t],
  );

  const permissionLabels = useMemo(
    () => ({
      granted: t("settings.permissions.actions.granted"),
      request: t("settings.permissions.actions.request"),
      requesting: t("settings.permissions.actions.requesting"),
    }),
    [t],
  );

  if (!isDesktopApp) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.permissions.title")}>
      <View style={settingsStyles.card}>
        <DesktopPermissionRow
          title={t("settings.permissions.microphone")}
          status={snapshot?.microphone ?? null}
          isRequesting={requestingPermission === "microphone"}
          onRequest={handleRequestMicrophone}
          labels={permissionLabels}
        />
      </View>
      {refreshFooter}
    </SettingsSection>
  );
}
const styles = StyleSheet.create((theme) => ({
  refreshFooter: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: theme.spacing[1],
  },
}));
