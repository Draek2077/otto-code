/** App-owned graphics and operational surfaces behind the narrow built-in plugin bridge. */
import { useEffect, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useReducedMotion } from "react-native-reanimated";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import type { InstalledPlugin } from "@/plugins/types";
import type { Theme } from "@/styles/theme";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppSettings, resolveContentMaxWidth } from "@/hooks/use-settings";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { BrainLifecycleProvider } from "../lifecycle";
import { BrainHostIcon } from "../host-icon";
import { useBrainUiSnapshot } from "../use-brain-ui";
import { presentBrainSnapshot } from "../bridge";
import { BrainScreen as OperationalScreen } from "../screens/brain-screen";
import { BrainSettings as SettingsScreen } from "../settings/settings";
import type { BrainScreenTheme } from "../screens/theme";
import { BrainRpc } from "./rpc";
import { BrainConnectionState } from "./connection-state";
import { BrainSettingsFacade } from "./settings-port";
import { BrainScreenFacade } from "./screen-port";

function projectTheme(theme: Theme): BrainScreenTheme {
  return Object.assign({}, theme, {
    fontSize: { ...theme.fontSize, xs: theme.fontSize.sm },
    colors: {
      ...theme.colors,
      statusOnline: theme.colors.statusDotSuccess,
      statusInfo: theme.colors.statusDotRunning,
      statusWarningMuted: theme.colors.statusWarning,
      surfaceHover: theme.colors.surfaceSidebarHover,
      surfaceCode: theme.colors.surface0,
      surfaceControlTrack: theme.colors.surface2,
      surfaceInteractiveSelected: theme.colors.surface3,
      surfaceInteractiveHover: theme.colors.surface3,
      surfaceInteractivePressed: theme.colors.surface4,
    },
  });
}
const themeProps = (theme: Theme) => ({ brainTheme: projectTheme(theme) });
const iconProps = (theme: Theme) => ({ palette: projectTheme(theme).colors });
const styles = StyleSheet.create((theme) => ({
  settings: { padding: theme.spacing[4], gap: theme.spacing[4] },
  intro: { padding: theme.spacing[4], gap: theme.spacing[4], alignItems: "center" },
}));
function Lifecycle({ children }: { children: ReactNode }) {
  const visible = useAppVisible();
  const reducedMotion = useReducedMotion();
  return (
    <BrainLifecycleProvider active={visible} animationsEnabled={true} reducedMotion={reducedMotion}>
      {children}
    </BrainLifecycleProvider>
  );
}
function Available({
  serverId,
  silent,
  children,
}: {
  serverId: string;
  silent?: boolean;
  children: ReactNode;
}) {
  // COMPAT(ottoBrain): added in v0.10.0; remove after 2027-04-23 when the host floor is v0.10.0.
  const available = useHostFeature(serverId, "ottoBrain");
  if (!available)
    return silent ? null : <Alert variant="info" description="Update the host to use Brain." />;
  return children;
}

export function createBrainPluginUi(
  installation: InstalledPlugin,
  navigation: { openBrain(): void; openSettings(): void },
): typeof import("@getpaseo/plugin/client/otto-brain") {
  const host = { serverId: installation.serverId, label: installation.serverId };
  const core = new BrainConnectionState(new BrainRpc(installation.invoke));
  const screen = new BrainScreenFacade(core, host, navigation);
  const settings = new BrainSettingsFacade(core, host, navigation.openBrain);
  installation.lifetime.signal.addEventListener(
    "abort",
    () => {
      screen.close();
      settings.close();
      core.close();
    },
    { once: true },
  );
  function Operational(props: PluginScreenProps & { brainTheme: BrainScreenTheme }) {
    const snapshot = useBrainUiSnapshot(screen.ui);
    if (snapshot.enabled === false)
      return (
        <View style={styles.intro}>
          <Alert
            variant="info"
            title="Brain is disabled"
            description="Enable Brain in this host's settings to use its local or Remote Brain."
          />
          <Button onPress={navigation.openSettings}>Open Brain settings</Button>
        </View>
      );
    return (
      <OperationalScreen
        embedded
        port={screen}
        theme={props.brainTheme}
        selectedHostId={props.host.id}
      />
    );
  }
  function Screen(props: PluginScreenProps & { brainTheme: BrainScreenTheme }) {
    const { settings: preferences } = useAppSettings();
    const width = resolveContentMaxWidth(preferences);
    const padding = props.brainTheme.spacing[4];
    useEffect(
      () => screen.setPresentation(props.host.label, width, padding),
      [props.host.label, width, padding],
    );
    return (
      <Available serverId={props.host.id}>
        <Lifecycle>
          <Operational {...props} />
        </Lifecycle>
      </Available>
    );
  }
  function Settings(props: PluginSurfaceProps) {
    const visible = useAppVisible();
    const retained = useRetainedPanelActive();
    useEffect(() => settings.setHostLabel(props.host.label), [props.host.label]);
    return (
      <Available serverId={props.host.id}>
        <ScrollView contentContainerStyle={styles.settings}>
          <SettingsScreen port={settings} active={visible && retained} />
        </ScrollView>
      </Available>
    );
  }
  function Icon({
    size,
    palette,
  }: {
    size: number;
    color: string;
    palette: BrainScreenTheme["colors"];
  }) {
    return <BrainHostIcon bridge={screen.ui} palette={palette} size={size} />;
  }
  const ThemedIcon = withUnistyles(Icon, iconProps);
  function SidebarContent(props: PluginSidebarItemProps) {
    const presentation = presentBrainSnapshot(useBrainUiSnapshot(screen.ui));
    if (!presentation.visible) return null;
    return (
      <SidebarHeaderRow
        icon={ThemedIcon}
        label={presentation.label}
        accessibilityLabel={presentation.label}
        onPress={navigation.openBrain}
        isActive={props.currentScreen?.screenId === "brain"}
        variant="inline"
        testID="otto-brain-sidebar"
      />
    );
  }
  function Sidebar(props: PluginSidebarItemProps) {
    return (
      <Available serverId={props.host.id} silent>
        <Lifecycle>
          <SidebarContent {...props} />
        </Lifecycle>
      </Available>
    );
  }
  return {
    BrainScreen: withUnistyles(Screen, themeProps),
    BrainSettings: Settings,
    BrainSidebar: Sidebar,
  };
}
