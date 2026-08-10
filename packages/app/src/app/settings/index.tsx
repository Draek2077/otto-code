import SettingsScreen from "@/screens/settings-screen";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  return <SettingsScreen view={ROOT_VIEW} />;
}
