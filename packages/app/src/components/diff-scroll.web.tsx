import { useCallback } from "react";
import { ScrollView, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";

interface DiffScrollProps {
  children: React.ReactNode;
  scrollViewWidth: number;
  onScrollViewWidthChange: (width: number) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function DiffScroll({
  children,
  onScrollViewWidthChange,
  style,
  contentContainerStyle,
}: DiffScrollProps) {
  // This per-row horizontal scroller is nested inside a vertically-scrolling
  // list, so an auto-hiding overlay scrollbar can't pin to the viewport. On
  // desktop web we drop the old always-on tinted scrollbar and hide the native
  // indicator (scrolling still works via trackpad / shift-wheel).
  const isCompact = useIsCompactFormFactor();
  const showDesktopWebScrollbar = !isCompact;
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => onScrollViewWidthChange(e.nativeEvent.layout.width),
    [onScrollViewWidthChange],
  );

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={!showDesktopWebScrollbar}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={handleLayout}
    >
      {children}
    </ScrollView>
  );
}
