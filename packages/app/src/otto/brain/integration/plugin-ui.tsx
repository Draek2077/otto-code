/** App-owned graphics and operational surfaces behind the narrow built-in plugin bridge. */
import { lazy, useCallback, useEffect, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useReducedMotion } from "react-native-reanimated";
import type {
  PluginScreenProps,
  PluginSurfaceProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import type { Theme } from "@/styles/theme";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppSettings, resolveContentMaxWidth } from "@/hooks/use-settings";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { density } from "@/styles/density";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { BrainLifecycleProvider } from "../lifecycle";
import { BrainHostIcon } from "../host-icon";
import { useBrainUiSnapshot } from "../use-brain-ui";
import { sidebarPresentation } from "./status-mapping";
import type { BrainScreenTheme } from "../screens/theme";
import type { BrainUiContext } from "./client-bridge";

const OperationalScreen = lazy(async () => ({
  default: (await import("../screens/brain-screen")).BrainScreen,
}));
const SettingsScreen = lazy(async () => ({
  default: (await import("../settings/settings")).BrainSettings,
}));

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
  navigationIcon: {
    width: density.iconButton,
    height: density.iconButton,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  navigationHighlight: { backgroundColor: theme.colors.interactionHighlight },
  tooltip: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
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

export function createBrainUiComponents({
  screen,
  settings,
  navigation,
}: BrainUiContext): typeof import("@getpaseo/plugin/client/otto-brain") {
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
  function SidebarContent({ openScreen, currentScreen }: PluginSidebarItemProps) {
    const presentation = sidebarPresentation(useBrainUiSnapshot(screen.ui));
    // Use the surface-owned navigation so compact sidebar dismissal and host
    // selection follow the same path as every Paseo plugin row.
    const openBrain = useCallback(() => openScreen({ screenId: "brain" }), [openScreen]);
    if (!presentation.visible) return null;
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <PressHighlight
            accessibilityRole="button"
            accessibilityLabel={presentation.label}
            aria-selected={currentScreen?.screenId === "brain"}
            onPress={openBrain}
            style={[
              styles.navigationIcon,
              currentScreen?.screenId === "brain" && styles.navigationHighlight,
            ]}
            highlightStyle={styles.navigationHighlight}
            testID="otto-brain-sidebar"
          >
            <DensityIcon icon={ThemedIcon} size="md" color="foregroundMuted" />
          </PressHighlight>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" testID="otto-brain-state-tooltip">
          <Text style={styles.tooltip}>{presentation.label}</Text>
        </TooltipContent>
      </Tooltip>
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
