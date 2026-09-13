import { SettingsTargetText } from "@/screens/settings-search/target";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openChangelog } from "@/changelog";
import { settingsStyles } from "@/styles/settings";

export function WhatsNewRow() {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.rowResponsive, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <SettingsTargetText settingId="app-about-about-what-s-new" style={settingsStyles.rowTitle}>
          {t("changelog.title")}
        </SettingsTargetText>
        <Text style={settingsStyles.rowHint}>{t("settings.about.whatsNewHint")}</Text>
      </View>
      <Button variant="outline" size="sm" onPress={openChangelog} testID="settings-whats-new">
        {t("changelog.title")}
      </Button>
    </View>
  );
}
