import { useCallback } from "react";
import {
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";

interface DiffScrollProps {
  children: React.ReactNode;
  scrollViewWidth: number;
  onScrollViewWidthChange: (width: number) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Overlay-scrollbar wiring, for callers that draw their own horizontal
   * scrollbar somewhere this scroller cannot reach. This scroller is nested
   * inside a vertically-scrolling list, so an overlay parented to it would be
   * pinned to the bottom of the *content*, far off screen — the owner has to
   * host it against the viewport and feed it metrics from here. Ignored on
   * native, where the platform indicator already auto-hides.
   */
  scrollRef?: React.RefObject<ScrollView | null>;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange?: (width: number, height: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

export function DiffScroll({
  children,
  onScrollViewWidthChange,
  style,
  contentContainerStyle,
  scrollRef,
  onScroll,
  onContentSizeChange,
  onLayout,
}: DiffScrollProps) {
  // On web we always hide the native indicator: either the caller renders the
  // themed overlay, or scrolling stands on trackpad / shift-wheel. Showing the
  // platform bar on narrow windows only ever meant compact web got the ugly one.
  const isCompact = useIsCompactFormFactor();
  const showNativeIndicator = onScroll ? false : isCompact;
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      onScrollViewWidthChange(e.nativeEvent.layout.width);
      onLayout?.(e);
    },
    [onScrollViewWidthChange, onLayout],
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={showNativeIndicator}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onLayout={handleLayout}
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
    >
      {children}
    </ScrollView>
  );
}
