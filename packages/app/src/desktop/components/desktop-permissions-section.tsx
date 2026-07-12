import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { RotateCw } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";

export function DesktopPermissionsSection() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    isSendingTestNotification,
    testNotificationError,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  } = useDesktopPermissions();

  const errorTextStyle = useMemo(
    () => [styles.errorText, { color: theme.colors.destructive }],
    [theme.colors.destructive],
  );

  const handleRefreshPress = useCallback(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const handleRequestNotifications = useCallback(() => {
    void requestPermission("notifications");
  }, [requestPermission]);

  const handleRequestMicrophone = useCallback(() => {
    void requestPermission("microphone");
  }, [requestPermission]);

  const handleSendTestNotification = useCallback(() => {
    void sendTestNotification();
  }, [sendTestNotification]);

  const isBusy = isRefreshing || requestingPermission !== null;
  const notificationsGranted = snapshot?.notifications.state === "granted";

  const refreshIcon = useMemo(
    () => <RotateCw size={theme.iconSize.md} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.md, theme.colors.foregroundMuted],
  );

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
      busyExtraAction: (label: string) => t("settings.permissions.actions.busySuffix", { label }),
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
          title={t("settings.permissions.notifications")}
          status={snapshot?.notifications ?? null}
          isRequesting={requestingPermission === "notifications"}
          onRequest={handleRequestNotifications}
          labels={permissionLabels}
          extraActionLabel={t("settings.permissions.test")}
          isExtraActionBusy={isSendingTestNotification}
          isExtraActionDisabled={!notificationsGranted || isBusy}
          onExtraAction={handleSendTestNotification}
        />
        {testNotificationError ? <Text style={errorTextStyle}>{testNotificationError}</Text> : null}
        <DesktopPermissionRow
          title={t("settings.permissions.microphone")}
          showBorder
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
  errorText: {
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  refreshFooter: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: theme.spacing[1],
  },
}));
