import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";

export function ActionGroupingSetting() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const change = useCallback(
    (groupConsecutiveActions: boolean) => {
      void updateSettings({ groupConsecutiveActions });
    },
    [updateSettings],
  );
  return (
    <SettingsSwitch
      label={t("otto.actionGroups.setting", { defaultValue: "Group consecutive actions" })}
      hint={t("otto.actionGroups.hint", {
        defaultValue:
          "Collapse completed actions into expandable summaries. Running actions stay visible. Applies to Detailed tool calls.",
      })}
      value={settings.groupConsecutiveActions}
      onValueChange={change}
    />
  );
}
