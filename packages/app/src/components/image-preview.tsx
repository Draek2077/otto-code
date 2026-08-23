import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as RNImage,
  ScrollView as RNScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import Svg, { Defs, Pattern, Rect, SvgXml } from "react-native-svg";
import { FitScreen, Minus, Plus } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { isWeb } from "@/constants/platform";
import { compactUp, type Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { formatFileSize } from "@/utils/format-file-size";
import type { ImageDimensions } from "@/components/image-dimensions";
import {
  fitScale,
  formatZoomPercent,
  isAtZoomLimit,
  nextZoomStep,
  scaledSize,
} from "@/components/image-zoom";
import type { IconSizeProp } from "@/components/icons/icon-size";

// The read-only image view inside a file tab. There is no editor and no split
// mode for an image - `file-tab-pane` withholds the whole mode bar for a
// non-text file - so this component owns the entire pane and can spend the
// bottom-right corner on its own controls.
//
// Panning is scrolling. Both platforms already have a tuned, momentum-carrying,
// scrollbar-drawing scroller, and a hand-rolled translate-the-image pan would
// reimplement it worse. Web additionally gets drag-to-pan on top, because a
// mouse cannot flick a scroll view; on native the drag *is* the scroll.

/** Breathing room around the image, and the margin `fit` measures against. */
const IMAGE_PADDING = 16;

/** Half the checker square, in px. Small enough to read as texture, not pattern. */
const CHECKER_TILE = 8;

const CHECKER_PATTERN_ID = "otto-image-checkerboard";

// Cast because React Native's CursorValue admits only "auto" | "pointer"; this
// is the repo's idiom for a web-only cursor (see the explorer's resize handle).
const GRAB_CURSOR = isWeb && ({ cursor: "grab" } as object);
const GRABBING_CURSOR = isWeb && ({ cursor: "grabbing" } as object);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const strongIconColor = (theme: Theme) => ({ color: theme.colors.foreground });

const ThemedMinus = withUnistyles(Minus);
const ThemedPlus = withUnistyles(Plus);
const ThemedFitScreen = withUnistyles(FitScreen);

/**
 * The transparency checker behind the image.
 *
 * A leaf wrapped with `withUnistyles` rather than a themed stylesheet, because
 * `fill` is an SVG presentation attribute, not a React Native style - the
 * sanctioned route for a theme-reactive non-`style` prop (see
 * docs/unistyles.md). Only this node re-renders on a theme change.
 */
function CheckerboardBase({
  // `withUnistyles` types every wrapped prop as optional, so the fills need a
  // literal fallback rather than relying on the mapping always having run.
  base = "transparent",
  tint = "transparent",
}: {
  base?: string;
  tint?: string;
}) {
  return (
    <Svg style={RNStyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern
          id={CHECKER_PATTERN_ID}
          width={CHECKER_TILE * 2}
          height={CHECKER_TILE * 2}
          patternUnits="userSpaceOnUse"
        >
          <Rect width={CHECKER_TILE * 2} height={CHECKER_TILE * 2} fill={base} />
          <Rect width={CHECKER_TILE} height={CHECKER_TILE} fill={tint} />
          <Rect
            x={CHECKER_TILE}
            y={CHECKER_TILE}
            width={CHECKER_TILE}
            height={CHECKER_TILE}
            fill={tint}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${CHECKER_PATTERN_ID})`} />
    </Svg>
  );
}

const Checkerboard = withUnistyles(CheckerboardBase);

const checkerColors = (theme: Theme) => ({
  base: theme.colors.surface1,
  tint: theme.colors.surface2,
});

function ZoomButton({
  label,
  Icon,
  iconSize,
  disabled,
  selected,
  testID,
  onPress,
}: {
  label: string;
  Icon: typeof ThemedPlus;
  iconSize: IconSizeProp;
  disabled?: boolean;
  selected?: boolean;
  testID: string;
  onPress: () => void;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.zoomButton,
      (Boolean(hovered) || pressed) && !disabled && styles.zoomButtonHovered,
      selected && styles.zoomButtonSelected,
      disabled && styles.zoomButtonDisabled,
    ],
    [disabled, selected],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        testID={testID}
        onPress={onPress}
        style={buttonStyle}
      >
        <Icon size={iconSize} uniProps={selected ? strongIconColor : mutedIconColor} />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ZoomControls({
  scale,
  isFit,
  onZoomOut,
  onZoomIn,
  onActualSize,
  onFit,
}: {
  scale: number;
  isFit: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onActualSize: () => void;
  onFit: () => void;
}) {
  const { t } = useTranslation();
  const percentStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.zoomButton,
      styles.zoomPercentButton,
      (Boolean(hovered) || pressed) && styles.zoomButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.zoomBar} testID="image-preview-zoom-bar">
      <ZoomButton
        label={t("panels.file.image.zoomOut")}
        Icon={ThemedMinus}
        iconSize="md"
        disabled={isAtZoomLimit(scale, -1)}
        testID="image-preview-zoom-out"
        onPress={onZoomOut}
      />
      <Tooltip delayDuration={300}>
        <TooltipTrigger
          accessibilityRole="button"
          accessibilityLabel={t("panels.file.image.actualSize")}
          testID="image-preview-actual-size"
          onPress={onActualSize}
          style={percentStyle}
        >
          <Text style={styles.zoomPercentText}>{formatZoomPercent(scale)}</Text>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{t("panels.file.image.actualSize")}</Text>
        </TooltipContent>
      </Tooltip>
      <ZoomButton
        label={t("panels.file.image.zoomIn")}
        Icon={ThemedPlus}
        iconSize="md"
        disabled={isAtZoomLimit(scale, 1)}
        testID="image-preview-zoom-in"
        onPress={onZoomIn}
      />
      <View style={styles.zoomDivider} />
      <ZoomButton
        label={t("panels.file.image.fitToWindow")}
        Icon={ThemedFitScreen}
        iconSize="md"
        selected={isFit}
        testID="image-preview-fit"
        onPress={onFit}
      />
    </View>
  );
}

export interface ImagePreviewProps {
  /** Blob (web) or file:// (native) URL for a raster image; null for the SVG branch. */
  uri: string | null;
  /** Raw SVG markup, used where the platform `Image` cannot decode it. */
  svgXml: string | null;
  /** Natural pixel size, or null for a container we could not measure. */
  dimensions: ImageDimensions | null;
  /** Bytes on disk; shown if the image turns out to be undecodable after all. */
  byteSize: number;
  /**
   * What identifies "the same image" for the purpose of keeping the zoom. The
   * path, not the URI: a tab revisit refetches and can hand back a fresh URL for
   * a file that has not changed, and resetting the zoom on that would undo the
   * user's zoom every time they looked at another tab.
   */
  sourceKey: string;
  showWebScrollbar: boolean;
}

export function ImagePreview({
  uri,
  svgXml,
  dimensions,
  byteSize,
  sourceKey,
  showWebScrollbar,
}: ImagePreviewProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  /** Null means "fit" - a mode, not a number, so it survives a pane resize. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const verticalRef = useRef<RNScrollView>(null);
  const horizontalRef = useRef<RNScrollView>(null);
  const containerRef = useRef<View>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ pageX: number; pageY: number; x: number; y: number } | null>(null);

  const verticalScrollbar = useWebScrollViewScrollbar(verticalRef, { enabled: showWebScrollbar });
  const horizontalScrollbar = useWebScrollViewScrollbar(horizontalRef, {
    enabled: showWebScrollbar,
    axis: "horizontal",
  });

  // A new file starts fitted: a zoom level chosen for the last image says
  // nothing about this one.
  useEffect(() => {
    setZoom(null);
    setFailed(false);
    offsetRef.current = { x: 0, y: 0 };
  }, [sourceKey]);

  const viewport = useMemo(
    () => ({
      width: Math.max(0, layout.width - IMAGE_PADDING * 2),
      height: Math.max(0, layout.height - IMAGE_PADDING * 2),
    }),
    [layout.height, layout.width],
  );

  const fit = fitScale(dimensions, viewport);
  const scale = zoom ?? fit;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Everything past here needs a ratio. Without one there is nothing to zoom
  // against, so the controls would be lying about what they do.
  const canZoom = dimensions !== null;
  const box = useMemo(
    () => (dimensions ? scaledSize(dimensions, scale) : null),
    [dimensions, scale],
  );
  const canPan = Boolean(
    box && (box.width > viewport.width + 1 || box.height > viewport.height + 1),
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  const handleVerticalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current.y = event.nativeEvent.contentOffset.y;
      verticalScrollbar.onScroll(event);
    },
    [verticalScrollbar],
  );
  const handleHorizontalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current.x = event.nativeEvent.contentOffset.x;
      horizontalScrollbar.onScroll(event);
    },
    [horizontalScrollbar],
  );

  const zoomIn = useCallback(() => setZoom(nextZoomStep(scaleRef.current, 1)), []);
  const zoomOut = useCallback(() => setZoom(nextZoomStep(scaleRef.current, -1)), []);
  const actualSize = useCallback(() => setZoom(1), []);
  const toFit = useCallback(() => setZoom(null), []);
  const handleError = useCallback(() => setFailed(true), []);

  // Ctrl/Cmd + wheel is the zoom gesture everywhere a pointer exists, and it is
  // also what a trackpad pinch reports - so this one listener covers both. It
  // has to be a real DOM listener registered non-passively: `preventDefault` is
  // what stops the browser zooming the whole app instead, and React Native has
  // no wheel prop to hang it on. Native has no equivalent; the buttons are the
  // zoom there.
  useEffect(() => {
    if (!isWeb || !canZoom) {
      return;
    }
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      setZoom(nextZoomStep(scaleRef.current, event.deltaY < 0 ? 1 : -1));
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [canZoom]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const panHandlers = useMemo(() => {
    // Web only: on native the scroll view already owns the drag, and claiming
    // the responder here would take panning away rather than add it.
    if (!isWeb || !canPan) {
      return null;
    }
    return {
      onStartShouldSetResponder: () => true,
      onResponderGrant: (event: GestureResponderEvent) => {
        dragRef.current = {
          pageX: event.nativeEvent.pageX,
          pageY: event.nativeEvent.pageY,
          x: offsetRef.current.x,
          y: offsetRef.current.y,
        };
        setDragging(true);
      },
      onResponderMove: (event: GestureResponderEvent) => {
        const start = dragRef.current;
        if (!start) {
          return;
        }
        horizontalRef.current?.scrollTo({
          x: start.x - (event.nativeEvent.pageX - start.pageX),
          animated: false,
        });
        verticalRef.current?.scrollTo({
          y: start.y - (event.nativeEvent.pageY - start.pageY),
          animated: false,
        });
      },
      onResponderRelease: endDrag,
      onResponderTerminate: endDrag,
    };
  }, [canPan, endDrag]);

  const boxStyle = useMemo(
    () => [
      styles.imageBox,
      canPan && (dragging ? GRABBING_CURSOR : GRAB_CURSOR),
      box ? inlineUnistylesStyle({ width: box.width, height: box.height }) : null,
    ],
    [box, canPan, dragging],
  );

  if (failed || (!uri && !svgXml)) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
        <Text style={styles.metaText}>{formatFileSize({ size: byteSize })}</Text>
      </View>
    );
  }

  const surface = svgXml ? (
    <SvgXml xml={svgXml} width="100%" height="100%" onError={handleError} />
  ) : (
    <RNImage
      source={imageSourceFor(uri)}
      style={RNStyleSheet.absoluteFill}
      // A no-op once the box carries the natural aspect ratio, and the honest
      // fallback when there is no natural size to build one from.
      resizeMode="contain"
      onError={handleError}
    />
  );

  // No measured size: no ratio, so no zoom, no pan, and nothing for the
  // scrollers to scroll. Skipping them entirely also skips the question of what
  // a percentage height resolves to inside a nested scroll view - this branch
  // is exactly the pre-viewer behaviour, kept as the graceful degradation.
  if (!canZoom) {
    return (
      <View style={styles.container}>
        <View style={styles.plainFit}>
          <Checkerboard uniProps={checkerColors} />
          {surface}
        </View>
      </View>
    );
  }

  return (
    <View ref={containerRef} style={styles.container} onLayout={handleLayout}>
      <RNScrollView
        ref={verticalRef}
        style={styles.scroller}
        contentContainerStyle={contentStyles.vertical}
        onLayout={verticalScrollbar.onLayout}
        onScroll={handleVerticalScroll}
        onContentSizeChange={verticalScrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showWebScrollbar}
      >
        <RNScrollView
          ref={horizontalRef}
          horizontal
          nestedScrollEnabled
          contentContainerStyle={contentStyles.horizontal}
          onLayout={horizontalScrollbar.onLayout}
          onScroll={handleHorizontalScroll}
          onContentSizeChange={horizontalScrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={!showWebScrollbar}
        >
          <View style={boxStyle} {...(panHandlers ?? {})}>
            <Checkerboard uniProps={checkerColors} />
            {surface}
          </View>
        </RNScrollView>
      </RNScrollView>
      {verticalScrollbar.overlay}
      {horizontalScrollbar.overlay}
      <ZoomControls
        scale={scale}
        isFit={zoom === null}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onActualSize={actualSize}
        onFit={toFit}
      />
    </View>
  );
}

function imageSourceFor(uri: string | null) {
  return uri ? { uri } : undefined;
}

// Layout only, and deliberately outside the themed sheet: a ScrollView's
// content container is not the prop Unistyles registers, so a themed value
// here would go stale on native and vanish entirely on web (docs/unistyles.md).
const contentStyles = RNStyleSheet.create({
  vertical: {
    flexGrow: 1,
    justifyContent: "center",
  },
  horizontal: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: IMAGE_PADDING,
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  scroller: {
    flex: 1,
  },
  imageBox: {
    position: "relative",
    overflow: "hidden",
  },
  // The unmeasured fallback: fill the pane and let `contain` letterbox.
  plainFit: {
    flex: 1,
    margin: IMAGE_PADDING,
    position: "relative",
    overflow: "hidden",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  metaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  zoomBar: {
    position: "absolute",
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: compactUp(2),
    borderRadius: compactUp(8),
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  zoomButton: {
    padding: compactUp(theme.spacing[1]),
    borderRadius: compactUp(6),
  },
  zoomButtonHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  zoomButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  zoomButtonDisabled: {
    opacity: 0.4,
  },
  zoomPercentButton: {
    paddingHorizontal: compactUp(theme.spacing[2]),
    minWidth: compactUp(48),
    alignItems: "center",
  },
  zoomPercentText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    // Stops the bar twitching sideways as the percentage changes width.
    fontVariant: ["tabular-nums"],
  },
  zoomDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: compactUp(theme.spacing[1]),
    backgroundColor: theme.colors.border,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
