import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PanelLeft, PanelLeftClose } from "@/components/icons/material-icons";
import { compactUp, type Theme } from "@/styles/theme";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton } from "./header-toggle-button";
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

const MOBILE_MENU_LINE_WIDTH = 16;
const MOBILE_MENU_LINE_SHORT_WIDTH = 8;
const MOBILE_MENU_LINE_HEIGHT = 2;

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

function MobileMenuIcon() {
  return (
    <View style={styles.mobileMenuIcon} pointerEvents="none">
      <View style={styles.mobileMenuLine} />
      <View style={styles.mobileMenuLine} />
      <View style={mobileMenuShortLineStyle} />
    </View>
  );
}

export function SidebarMenuToggle({
  style,
  tooltipSide = "right",
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

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("shell.menu.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
      accessibilityState={accessibilityState}
    >
      {isMobile ? (
        <MobileMenuIcon />
      ) : (
        ({ hovered, pressed }) => {
          if (isOpen) {
            return <ThemedPanelLeftClose uniProps={accentMdMapping} />;
          }
          return (
            <ThemedPanelLeft uniProps={hovered || pressed ? foregroundMdMapping : mutedMdMapping} />
          );
        }
      )}
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
  mobileMenuIcon: {
    width: compactUp(MOBILE_MENU_LINE_WIDTH),
    height: compactUp(12),
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  mobileMenuLine: {
    width: compactUp(MOBILE_MENU_LINE_WIDTH),
    height: compactUp(MOBILE_MENU_LINE_HEIGHT),
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  mobileMenuLineShort: {
    width: compactUp(MOBILE_MENU_LINE_SHORT_WIDTH),
  },
}));

const mobileMenuShortLineStyle = [styles.mobileMenuLine, styles.mobileMenuLineShort];
