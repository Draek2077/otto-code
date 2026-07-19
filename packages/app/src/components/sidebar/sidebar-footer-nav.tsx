import type { Ref } from "react";
import { Pressable, Text, View, type PressableProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Gauge, Home, Settings, type IconComponent } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { compactUp, ICON_SIZE, type Theme } from "@/styles/theme";

type SidebarTheme = Theme;

function footerIconButtonStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [
    styles.footerIconButton,
    (Boolean(hovered) || Boolean(pressed)) && styles.footerIconButtonHovered,
  ];
}

function activeFooterIconButtonStyle(state: { hovered?: boolean; pressed?: boolean }) {
  return [...footerIconButtonStyle(state), styles.footerIconButtonActive];
}

export function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  accessibilityLabel,
  icon: Icon,
  iconSize,
  theme,
  active = false,
  ...pressableProps
}: {
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  icon: IconComponent;
  iconSize?: number;
  theme: SidebarTheme;
  buttonRef?: Ref<View>;
  // Persistent selected state — keeps the hover backdrop and foreground icon
  // color, marking the surface the user is already on.
  active?: boolean;
} & Omit<PressableProps, "onPress" | "testID" | "style" | "children">) {
  const isCompactLayout = useIsCompactFormFactor();
  // Footer icons are always scaled up on every form factor, and another 1.5x on
  // compact so they stay comfortably tappable. Static ICON_SIZE (not
  // theme.iconSize) — the theme tokens are already doubled on compact by
  // applyAppearance, which would compound here.
  const baseIconSize = iconSize ?? ICON_SIZE.md * 1.5;
  return (
    <Pressable
      {...pressableProps}
      ref={buttonRef}
      style={active ? activeFooterIconButtonStyle : footerIconButtonStyle}
      testID={testID}
      nativeID={testID}
      collapsable={false}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
    >
      {({ hovered }) => (
        <Icon
          size={isCompactLayout ? baseIconSize * 1.5 : baseIconSize}
          color={active || hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      )}
    </Pressable>
  );
}

function FooterNavTooltipContent({ label }: { label: string }) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
    </View>
  );
}

/**
 * The Home / Settings / Metrics icon row shared by the workspace sidebar footer
 * and the settings sidebar footer, so the app's primary navigation stays
 * reachable (and visually identical) on both surfaces. The testIDs are shared
 * on purpose: the two sidebars are never mounted at the same time.
 */
export function SidebarFooterNavRow({
  theme,
  labels,
  onHome,
  onSettings,
  onStats,
  activeItem,
  settingsButtonRef,
}: {
  theme: SidebarTheme;
  labels: { home: string; settings: string; stats: string };
  onHome: () => void;
  onSettings: () => void;
  onStats: () => void;
  activeItem?: "home" | "settings" | "stats";
  settingsButtonRef?: Ref<View>;
}) {
  return (
    <View style={styles.footerIconRow}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild triggerRefProp="buttonRef">
          <FooterIconButton
            onPress={onHome}
            testID="sidebar-home"
            accessibilityLabel={labels.home}
            icon={Home}
            theme={theme}
            active={activeItem === "home"}
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <FooterNavTooltipContent label={labels.home} />
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild triggerRefProp="buttonRef">
          <FooterIconButton
            buttonRef={settingsButtonRef}
            onPress={onSettings}
            testID="sidebar-settings"
            accessibilityLabel={labels.settings}
            icon={Settings}
            theme={theme}
            active={activeItem === "settings"}
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <FooterNavTooltipContent label={labels.settings} />
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild triggerRefProp="buttonRef">
          <FooterIconButton
            onPress={onStats}
            testID="sidebar-stats"
            accessibilityLabel={labels.stats}
            icon={Gauge}
            theme={theme}
            active={activeItem === "stats"}
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <FooterNavTooltipContent label={labels.stats} />
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  footerIconButton: {
    // 1.5x on compact to wrap the icons' matching compact upscale.
    width: compactUp(theme.spacing[8], 1.5),
    height: compactUp(theme.spacing[8], 1.5),
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderRadius: theme.borderRadius.lg,
  },
  footerIconButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  footerIconButtonActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));
