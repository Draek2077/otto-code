import { useCallback, type ReactNode, type Ref } from "react";
import { Pressable, Text, View, type PressableProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { resolveBrainActivityLabel } from "@/components/brain/brain-state";
import { BrainStateIcon } from "@/components/brain/brain-state-icon";
import { useBrainRail } from "@/components/brain/use-brain-rail-state";
import { Gauge, Home, Settings, type IconComponent } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { compactUp, ICON_SIZE, type Theme } from "@/styles/theme";

type SidebarTheme = Theme;

function footerIconButtonStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [
    styles.footerIconButton,
    Boolean(hovered) && !pressed && styles.footerIconButtonHovered,
    Boolean(pressed) && styles.footerIconButtonPressed,
  ];
}

function activeFooterIconButtonStyle(state: { hovered?: boolean; pressed?: boolean }) {
  return [
    styles.footerIconButton,
    styles.footerIconButtonActive,
    Boolean(state.hovered) && !state.pressed && styles.footerIconButtonHovered,
    Boolean(state.pressed) && styles.footerIconButtonPressed,
  ];
}

// Accent marks the surface you are already on - the same `accentBright` the
// header's Sidebar, Explorer, Visualizer and Voice Cues toggles use for their
// on-state. Hover stays plain foreground: hovering a button is not the same
// claim as being on its page.
function footerIconColor(theme: SidebarTheme, state: { active: boolean; hovered: boolean }) {
  if (state.active) {
    return theme.colors.accentBright;
  }
  return state.hovered ? theme.colors.foreground : theme.colors.foregroundMuted;
}

export function FooterIconButton({
  buttonRef,
  onPress,
  testID,
  accessibilityLabel,
  icon: Icon,
  renderIcon,
  iconSize,
  theme,
  active = false,
  ...pressableProps
}: {
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  icon?: IconComponent;
  renderIcon?: (input: { size: number; color: string }) => ReactNode;
  iconSize?: number;
  theme: SidebarTheme;
  buttonRef?: Ref<View>;
  // Persistent selected state - keeps the hover backdrop and foreground icon
  // color, marking the surface the user is already on.
  active?: boolean;
} & Omit<PressableProps, "onPress" | "testID" | "style" | "children">) {
  const isCompactLayout = useIsCompactFormFactor();
  // Footer icons are always scaled up on every form factor, and another 1.5x on
  // compact so they stay comfortably tappable. Static ICON_SIZE (not
  // theme.iconSize) - the theme tokens are already doubled on compact by
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
      {({ hovered }) => {
        const size = isCompactLayout ? baseIconSize * 1.5 : baseIconSize;
        const color = footerIconColor(theme, { active, hovered: Boolean(hovered) });
        if (renderIcon) {
          return renderIcon({ size, color });
        }
        return Icon ? <Icon size={size} color={color} /> : null;
      }}
    </Pressable>
  );
}

export type SidebarFooterNavItem = "home" | "settings" | "stats" | "brain";

/**
 * Which footer destination the current route is on, so the row marks Home and
 * Metrics the same way the Settings screen already marks its own button.
 *
 * Substring matches, not equality: each of these has a host-scoped twin
 * (`/h/<serverId>/open-project`, `/h/<serverId>/settings`) and Settings has
 * section sub-routes (`/settings/projects/...`). Ordered most specific first -
 * nothing here is a substring of another, but the order documents the intent.
 */
export function resolveSidebarFooterActiveItem(pathname: string): SidebarFooterNavItem | undefined {
  if (pathname.includes("/stats")) {
    return "stats";
  }
  // Settings is checked before Brain, and must stay that way: Settings still
  // owns a per-host Brain section (`/settings/hosts/<id>/brain`) for connection
  // and security, which is a different surface from the Brain page. Checking
  // Brain first marks the rail "Brain" while the reader is in Settings.
  if (pathname.includes("/settings")) {
    return "settings";
  }
  if (pathname.includes("/brain")) {
    return "brain";
  }
  if (pathname.includes("/open-project")) {
    return "home";
  }
  return undefined;
}

function FooterNavTooltipContent({ label }: { label: string }) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
    </View>
  );
}

/**
 * The footer icon bar shared by the workspace sidebar and the settings sidebar,
 * so the app's primary navigation stays reachable (and visually identical) on
 * both surfaces. The testIDs are shared on purpose: the two sidebars are never
 * mounted at the same time.
 *
 * Two groups, split apart: the destinations you navigate to (Home, Brain,
 * Metrics) lead, and the app-level controls (the host picker, Settings) trail.
 */
export function SidebarFooterNavRow({
  theme,
  labels,
  onHome,
  onSettings,
  onStats,
  onBrain,
  activeItem,
  settingsButtonRef,
  children,
}: {
  theme: SidebarTheme;
  labels: { home: string; settings: string; stats: string };
  onHome: () => void;
  onSettings: () => void;
  onStats: () => void;
  // Absent on the settings sidebar footer, which has no Brain destination of
  // its own to mark.
  onBrain?: () => void;
  activeItem?: SidebarFooterNavItem;
  settingsButtonRef?: Ref<View>;
  // Extra trailing controls, rendered in the trailing group before Settings -
  // the workspace sidebar puts its host picker here.
  children?: ReactNode;
}) {
  // The Brain button reports the local AI host's state rather than being a
  // static glyph: it is the only always-visible surface the brain has, and a
  // model loading or a benchmark owning the machine is the sort of thing you
  // need to see without navigating to look for it.
  const brainRail = useBrainRail();
  const brainState = brainRail.state;
  const isCompact = useIsCompactFormFactor();
  const renderBrainIcon = useCallback(
    ({ size }: { size: number }) => (
      <BrainStateIcon
        state={brainState}
        size={size}
        theme={theme}
        compact={isCompact}
        activity={brainRail.activity}
      />
    ),
    [brainState, brainRail.activity, theme, isCompact],
  );
  // Every state - idle included - carries the state's own sentence, so the
  // tooltip reads "Brain - idle" at rest rather than dropping the state. With
  // two slots working the sentence names each half; three or more just count.
  const brainLabel = brainRail.label ?? resolveBrainActivityLabel(brainRail.activity);

  return (
    <View style={styles.footerBar}>
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
        {onBrain ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild triggerRefProp="buttonRef">
              <FooterIconButton
                onPress={onBrain}
                testID="sidebar-brain"
                accessibilityLabel={brainLabel}
                renderIcon={renderBrainIcon}
                theme={theme}
                active={activeItem === "brain"}
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <FooterNavTooltipContent label={brainLabel} />
            </TooltipContent>
          </Tooltip>
        ) : null}
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
      <View style={styles.footerIconRow}>
        {children}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Fills whichever footer container mounts it, so the two groups sit against
  // opposite edges of the sidebar.
  footerBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
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
    backgroundColor: theme.colors.surfaceInteractiveHover,
  },
  footerIconButtonActive: {
    backgroundColor: theme.colors.surfaceInteractiveSelected,
  },
  footerIconButtonPressed: {
    backgroundColor: theme.colors.surfaceInteractivePressed,
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
