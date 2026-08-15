import {
  forwardRef,
  useCallback,
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
import { FLOATING_LAYER_NO_DRAG_STYLE } from "@/components/desktop/app-region";
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
  // Floating surfaces exist only while their panel is open, so carving them
  // out of Electron's window-drag rects here can't punch persistent holes in
  // the titlebar drag strip. Without this, panels portaled inside #root
  // (e.g. the workspace hover card) are click-dead over drag regions.
  const surfaceStyle = useMemo(
    () =>
      appendStyle(appendStyle(style, inlineFrameStyle), FLOATING_LAYER_NO_DRAG_STYLE ?? undefined),
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
  /** Consumers may retain a popup's reader position without replacing its scrollbar policy. */
  onContentSizeChange?: ScrollViewProps["onContentSizeChange"];
  onScroll?: ScrollViewProps["onScroll"];
}

export const FloatingScrollView = forwardRef<ScrollView, FloatingScrollViewProps>(
  function FloatingScrollView(
    {
      bounces,
      children,
      contentContainerStyle,
      keyboardShouldPersistTaps,
      onContentSizeChange,
      onScroll,
      showsVerticalScrollIndicator,
      style,
    },
    forwardedRef,
  ): ReactElement {
    const inlineStyle = useMemo(() => {
      const flattened = StyleSheet.flatten(style);
      return flattened ? inlineUnistylesStyle(stripUnistylesMetadata(flattened)) : undefined;
    }, [style]);

    const scrollRef = useRef<ScrollView>(null);
    const setScrollRef = useCallback(
      (node: ScrollView | null) => {
        scrollRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );
    const isCompact = useIsCompactFormFactor();
    const showDesktopWebScrollbar = isWeb && !isCompact;
    const scrollbar = useWebScrollViewScrollbar(scrollRef, {
      enabled: showDesktopWebScrollbar,
    });
    const handleScroll = useCallback<NonNullable<ScrollViewProps["onScroll"]>>(
      (event) => {
        scrollbar.onScroll(event);
        onScroll?.(event);
      },
      [onScroll, scrollbar],
    );
    const handleContentSizeChange = useCallback<
      NonNullable<ScrollViewProps["onContentSizeChange"]>
    >(
      (width, height) => {
        scrollbar.onContentSizeChange(width, height);
        onContentSizeChange?.(width, height);
      },
      [onContentSizeChange, scrollbar],
    );

    const scrollView = (
      <ScrollView
        ref={setScrollRef}
        bounces={bounces}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={
          showDesktopWebScrollbar ? false : showsVerticalScrollIndicator
        }
        onLayout={scrollbar.onLayout}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
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
  },
);

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
