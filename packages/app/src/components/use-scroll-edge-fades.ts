import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";
import type { RefObject } from "react";
import { isWeb } from "@/constants/platform";

// Sub-pixel slack: fractional scroll offsets (momentum landing, browser zoom,
// content measured at a non-integer height) must still count as "at the edge",
// or a fade flickers back in over a scroll region the user has fully bottomed
// out on.
const EDGE_EPSILON = 2;

export interface ScrollEdgeFades {
  /** True once the view is scrolled away from the top. */
  showTopFade: boolean;
  /** True while there is still content below the fold. */
  showBottomFade: boolean;
  /**
   * False until the first scroll event. Feed it to the fades' `animated` prop
   * so the edges resolve instantly while the view is still measuring itself
   * (mount, tab switch, content growth) and only cross-fade once the user is
   * actually driving the scroll.
   */
  hasScrolled: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * Tracks whether a scroll view has content hidden above or below the fold, so
 * edge fades can be shown only where there is something to dissolve into —
 * no top fade at the top, no bottom fade at the bottom, and neither when the
 * content does not overflow at all.
 *
 * Metrics live in refs and only the two booleans are state, so the common case
 * (scrolling through the middle) re-renders nothing; a render happens only when
 * an edge is actually crossed.
 */
// react-native-web's ScrollView exposes its scrollable DOM element here. Native
// ScrollView has the same method but returns a host component handle, which is
// why the measurement below is web-gated.
function getScrollElement(ref: RefObject<ScrollView | null>): HTMLElement | null {
  const scrollable = ref.current as { getScrollableNode?: () => unknown } | null;
  const node = scrollable?.getScrollableNode?.();
  return node && node instanceof HTMLElement ? node : null;
}

export function useScrollEdgeFades(scrollRef: RefObject<ScrollView | null>): ScrollEdgeFades {
  const offsetRef = useRef(0);
  const viewportRef = useRef(0);
  const contentRef = useRef(0);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [hasScrolled, setHasScrolled] = useState(false);

  const recompute = useCallback(() => {
    const maxOffset = contentRef.current - viewportRef.current;
    const overflows = maxOffset > EDGE_EPSILON;
    const top = overflows && offsetRef.current > EDGE_EPSILON;
    const bottom = overflows && offsetRef.current < maxOffset - EDGE_EPSILON;
    setEdges((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom },
    );
  }, []);

  // `onLayout`/`onContentSizeChange` land *after* the first paint, so a fade
  // driven only by them visibly arrives a beat behind the dialog. Reading the
  // DOM in a layout effect forces the reflow synchronously and settles the
  // fades before the browser paints, so they are already at rest when the
  // dialog appears. The ResizeObserver keeps that true as the viewport or the
  // content resizes without a scroll.
  useLayoutEffect(() => {
    if (!isWeb) return;
    const element = getScrollElement(scrollRef);
    if (!element) return;
    const measure = () => {
      offsetRef.current = element.scrollTop;
      viewportRef.current = element.clientHeight;
      contentRef.current = element.scrollHeight;
      recompute();
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }
    return () => resizeObserver.disconnect();
  }, [scrollRef, recompute]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = event.nativeEvent.contentOffset.y;
      // Scroll events carry fresher viewport/content metrics than the layout
      // callbacks on web, where a resize can land without an onLayout.
      viewportRef.current = event.nativeEvent.layoutMeasurement.height;
      contentRef.current = event.nativeEvent.contentSize.height;
      // Flipped in the same batch as the edge change this event causes, so the
      // very first scroll already animates — it is only the pre-scroll,
      // measurement-driven resolution that snaps.
      setHasScrolled(true);
      recompute();
    },
    [recompute],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportRef.current = event.nativeEvent.layout.height;
      recompute();
    },
    [recompute],
  );

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentRef.current = height;
      recompute();
    },
    [recompute],
  );

  // Stable identity while the edges hold, so consumers composing these
  // callbacks with another hook's don't rebuild them on every render.
  return useMemo(
    () => ({
      showTopFade: edges.top,
      showBottomFade: edges.bottom,
      hasScrolled,
      onScroll,
      onLayout,
      onContentSizeChange,
    }),
    [edges.top, edges.bottom, hasScrolled, onScroll, onLayout, onContentSizeChange],
  );
}
