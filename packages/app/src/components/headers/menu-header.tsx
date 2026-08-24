import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PanelLeft, PanelLeftClose } from "@/components/icons/material-icons";
import { type Theme } from "@/styles/theme";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton, headerIconSlotStyle } from "./header-toggle-button";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
}

const ThemedPanelLeft = withUnistyles(PanelLeft);
const ThemedPanelLeftClose = withUnistyles(PanelLeftClose);

const accentMdMapping = (theme: Theme) => ({
  color: theme.colors.accentBright,
  size: theme.iconSize.md,
});
const foregroundMdMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.md,
});
const mutedMdMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.md,
});
// Compact carries its size through the `size` prop instead, so the mobile
// mappings only supply colour - matching the explorer toggle on the right.
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function SidebarMenuToggle({
  style,
  tooltipSide = "bottom",
  testID = "menu-button",
  nativeID = "menu-button",
}: SidebarMenuToggleProps = {}) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useShortcutKeys("toggle-left-sidebar");
  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  // Compact pairs this button with the explorer toggle on the opposite end of
  // the same header row, so it takes the same trimmed slot: matching padding
  // against a symmetric row inset puts both glyphs the same distance from
  // their screen edge, at the same touch-target size.
  const slotStyle = useMemo(
    () => (isMobile ? [headerIconSlotStyle.compactSlot, style] : style),
    [isMobile, style],
  );

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("shell.menu.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      shortcutDiscoveryAction="sidebar.toggle.left"
      testID={testID}
      nativeID={nativeID}
      style={slotStyle}
      active={isOpen}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
      accessibilityState={accessibilityState}
    >
      {({ hovered, pressed }) => {
        // The same left-panel glyph pair in both form factors; only the icon
        // scale differs, so mobile matches the explorer toggle opposite it.
        if (isMobile) {
          return isOpen ? (
            <ThemedPanelLeftClose size="chromeLg" uniProps={accentColorMapping} />
          ) : (
            <ThemedPanelLeft
              size="chromeLg"
              uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
            />
          );
        }
        return isOpen ? (
          <ThemedPanelLeftClose uniProps={accentMdMapping} />
        ) : (
          <ThemedPanelLeft uniProps={hovered || pressed ? foregroundMdMapping : mutedMdMapping} />
        );
      }}
    </HeaderToggleButton>
  );
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
}));
