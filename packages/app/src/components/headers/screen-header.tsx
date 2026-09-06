import { useMemo, type ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { SPACING } from "@/styles/theme";
import { WindowChromeSafeArea } from "@/utils/window-chrome";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";

interface ScreenHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  leftStyle?: StyleProp<ViewStyle>;
  rightStyle?: StyleProp<ViewStyle>;
  borderless?: boolean;
  onRowLayout?: (event: LayoutChangeEvent) => void;
}

const HEADER_HORIZONTAL_PADDING = SPACING[2];

/**
 * Shared frame for the home/back headers so we only maintain padding, border,
 * and safe-area logic in one place.
 */
export function ScreenHeader({
  left,
  right,
  leftStyle,
  rightStyle,
  borderless,
  onRowLayout,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const isMobile = useIsCompactFormFactor();
  // Only add extra padding on mobile for better touch targets; on desktop, only use safe area insets
  const topPadding = isMobile ? HEADER_TOP_PADDING_MOBILE : 0;

  const innerStyle = useMemo(
    () => [styles.inner, { paddingTop: insets.top + topPadding }],
    [insets.top, topPadding],
  );
  const leftCombinedStyle = useMemo(() => [styles.left, leftStyle], [leftStyle]);
  const rightCombinedStyle = useMemo(() => [styles.right, rightStyle], [rightStyle]);
  const headerStyle = useMemo(
    () => [styles.header, borderless && styles.headerBorderless],
    [borderless],
  );
  const borderLineStyle = useMemo(
    () => [styles.borderLine, borderless && styles.borderLineHidden],
    [borderless],
  );

  return (
    <View style={headerStyle}>
      <View style={innerStyle}>
        <WindowChromeSafeArea
          placement="inline"
          horizontalPadding={HEADER_HORIZONTAL_PADDING}
          onLayout={onRowLayout}
          style={styles.row}
        >
          <TitlebarDragRegion />
          <View style={leftCombinedStyle}>{left}</View>
          <View style={rightCombinedStyle}>{right}</View>
          <View pointerEvents="none" style={borderLineStyle} />
        </WindowChromeSafeArea>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    backgroundColor: theme.colors.surfaceChrome,
  },
  // A borderless header is used by screens whose content owns the whole page
  // surface. Keep the drag strip and toggle, but do not introduce a second
  // painted band above the content.
  headerBorderless: {
    backgroundColor: theme.colors.surface0,
  },
  inner: {},
  row: {
    position: "relative",
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    userSelect: "none",
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  // Rendered as an absolutely-positioned overlay (not a real borderBottomWidth)
  // so it doesn't shrink `row`'s content box by 1px on only one side - that
  // asymmetry is what pushed the centered header content up and left a visible
  // gap above this line.
  borderLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
  borderLineHidden: {
    backgroundColor: "transparent",
  },
}));
