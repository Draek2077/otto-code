import {
  forwardRef,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

export interface FloatingSurfaceProps extends Omit<ComponentProps<typeof Animated.View>, "style"> {
  frameStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export const FloatingSurface = forwardRef<View, FloatingSurfaceProps>(function FloatingSurface(
  { frameStyle, style, ...props },
  ref,
): ReactElement {
  const inlineFrameStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(frameStyle);
    return flattened ? inlineUnistylesStyle(stripUnistylesMetadata(flattened)) : undefined;
  }, [frameStyle]);
  const surfaceStyle = useMemo(
    () => appendStyle(style, inlineFrameStyle),
    [inlineFrameStyle, style],
  );
  return <Animated.View {...props} ref={ref} style={surfaceStyle} />;
});

export interface FloatingScrollViewProps {
  bounces?: boolean;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  showsVerticalScrollIndicator?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function FloatingScrollView({
  bounces,
  children,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator,
  style,
}: FloatingScrollViewProps): ReactElement {
  const inlineStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(style);
    return flattened ? inlineUnistylesStyle(stripUnistylesMetadata(flattened)) : undefined;
  }, [style]);

  const scrollRef = useRef<ScrollView>(null);
  const isCompact = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isCompact;
  const scrollbar = useWebScrollViewScrollbar(scrollRef, {
    enabled: showDesktopWebScrollbar,
  });

  const scrollView = (
    <ScrollView
      ref={scrollRef}
      bounces={bounces}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showDesktopWebScrollbar ? false : showsVerticalScrollIndicator}
      onLayout={scrollbar.onLayout}
      onScroll={scrollbar.onScroll}
      onContentSizeChange={scrollbar.onContentSizeChange}
      scrollEventThrottle={16}
      style={inlineStyle}
    >
      {children}
    </ScrollView>
  );

  if (!showDesktopWebScrollbar) {
    return scrollView;
  }

  // Wrap the scroll view so the auto-hiding overlay scrollbar can position
  // against it. The wrapper sizes to the scroll view (which keeps whatever
  // height/flex bound the caller applied via `style`), so the overlay aligns
  // to the real viewport and stays inert when the content does not overflow.
  return (
    <View>
      {scrollView}
      {scrollbar.overlay}
    </View>
  );
}

function appendStyle(
  style: StyleProp<ViewStyle>,
  extraStyle: ViewStyle | undefined,
): StyleProp<ViewStyle> {
  if (!extraStyle) {
    return style;
  }
  if (Array.isArray(style)) {
    return [...style, extraStyle];
  }
  return [style, extraStyle];
}

function stripUnistylesMetadata(style: ViewStyle): ViewStyle {
  const cleanStyle: Record<string, unknown> = { ...style };
  for (const key of Object.keys(cleanStyle)) {
    if (key.startsWith("unistyles_")) {
      delete cleanStyle[key];
    }
  }
  return cleanStyle as ViewStyle;
}
