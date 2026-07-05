import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { getIsElectronRuntime, getIsElectronRuntimeMac } from "@/constants/layout";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

// Electron desktop wrapper only (irrelevant to the plain web client), and
// Windows/Linux only: on mac, closing the window already leaves Otto running via
// the dock (no interception needed), so the setting has nothing to opt out of there.
export function DesktopWindowBehaviorSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useDesktopSettings();
  const [isUpdatingMinimizeOnClose, setIsUpdatingMinimizeOnClose] = useState(false);
  const [isUpdatingStartMinimized, setIsUpdatingStartMinimized] = useState(false);

  const handleToggleMinimizeOnClose = useCallback(() => {
    setIsUpdatingMinimizeOnClose(true);
    void updateSettings({ tray: { minimizeOnClose: !settings.tray.minimizeOnClose } })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => {
        setIsUpdatingMinimizeOnClose(false);
      });
  }, [settings.tray.minimizeOnClose, updateSettings]);

  const handleToggleStartMinimized = useCallback(() => {
    setIsUpdatingStartMinimized(true);
    void updateSettings({ tray: { startMinimized: !settings.tray.startMinimized } })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => {
        setIsUpdatingStartMinimized(false);
      });
  }, [settings.tray.startMinimized, updateSettings]);

  if (!getIsElectronRuntime() || getIsElectronRuntimeMac()) {
    return null;
  }

  return (
    <SettingsSection title={t("desktop.window.title")} testID="host-page-window-behavior-card">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("desktop.window.minimizeToTray.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("desktop.window.minimizeToTray.hint")}</Text>
          </View>
          <Switch
            value={settings.tray.minimizeOnClose}
            onValueChange={handleToggleMinimizeOnClose}
            disabled={isUpdatingMinimizeOnClose}
            accessibilityLabel={t("desktop.window.minimizeToTray.title")}
          />
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("desktop.window.startMinimized.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("desktop.window.startMinimized.hint")}</Text>
          </View>
          <Switch
            value={settings.tray.startMinimized}
            onValueChange={handleToggleStartMinimized}
            disabled={isUpdatingStartMinimized}
            accessibilityLabel={t("desktop.window.startMinimized.title")}
          />
        </View>
      </View>
    </SettingsSection>
  );
}
