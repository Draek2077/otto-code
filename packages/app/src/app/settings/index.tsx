import { Redirect } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { getLastSettingsRoute } from "@/stores/last-settings-view";
import { buildSettingsSectionRoute } from "@/utils/host-routes";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();

  if (!isCompactLayout) {
    // Return to the sub-page the user last visited this session; General on first open.
    return <Redirect href={getLastSettingsRoute() ?? buildSettingsSectionRoute("general")} />;
  }

  return <SettingsScreen view={ROOT_VIEW} />;
}
