import { useCallback, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import {
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";
import {
  WebDesktopScrollbarOverlay,
  useWebDesktopScrollbarMetrics,
  type ScrollbarAxis,
  type ScrollbarMetrics,
} from "./web-desktop-scrollbar";
import { isWeb as platformIsWeb } from "@/constants/platform";

const METRICS_EPSILON = 0.5;
const HIDE_SCROLLBAR_STYLE_ID = "otto-hide-scrollbar";

function ensureHideScrollbarStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(HIDE_SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIDE_SCROLLBAR_STYLE_ID;
  style.textContent = `
    [data-hide-scrollbar] {
      scrollbar-width: none;
      -ms-overflow-style: none;
      scrollbar-gutter: auto;
    }

    [data-hide-scrollbar]::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    [data-hide-scrollbar]::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }
  `;
  document.head.appendChild(style);
}

function metricsChanged(a: ScrollbarMetrics, b: ScrollbarMetrics): boolean {
  return (
    Math.abs(a.offset - b.offset) > METRICS_EPSILON ||
    Math.abs(a.viewportSize - b.viewportSize) > METRICS_EPSILON ||
    Math.abs(a.contentSize - b.contentSize) > METRICS_EPSILON
  );
}

// ── DOM element scrollbar ────────────────────────────────────────────
// Fully automatic: listens to scroll/input/resize events on the element,
// hides the native scrollbar, and returns a themed overlay or null.

export function useWebElementScrollbar(
  elementRef: RefObject<HTMLElement | null>,
  options?: {
    enabled?: boolean;
    contentRef?: RefObject<HTMLElement | null>;
    /** Also render a horizontal overlay for elements that scroll on both axes. */
    horizontal?: boolean;
  },
): ReactNode {
  const enabled = (options?.enabled ?? true) && platformIsWeb;
  const contentRef = options?.contentRef;
  const horizontal = options?.horizontal ?? false;

  const [metrics, setMetrics] = useState<ScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });
  const [horizontalMetrics, setHorizontalMetrics] = useState<ScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = elementRef.current;
    if (!element) return;

    type ScrollbarStyle = CSSStyleDeclaration & {
      scrollbarWidth: string;
      msOverflowStyle: string;
      scrollbarGutter: string;
    };
    const style = element.style as ScrollbarStyle;
    const previousScrollbarWidth = style.scrollbarWidth;
    const previousMsOverflowStyle = style.msOverflowStyle;
    const previousScrollbarGutter = style.scrollbarGutter;

    element.setAttribute("data-hide-scrollbar", "");
    style.scrollbarWidth = "none";
    style.msOverflowStyle = "none";
    style.scrollbarGutter = "auto";
    ensureHideScrollbarStyle();

    function update() {
      const el = elementRef.current;
      if (!el) return;
      const next: ScrollbarMetrics = {
        offset: el.scrollTop,
        viewportSize: el.clientHeight,
        contentSize: el.scrollHeight,
      };
      setMetrics((prev) => (metricsChanged(prev, next) ? next : prev));
      if (horizontal) {
        const nextHorizontal: ScrollbarMetrics = {
          offset: el.scrollLeft,
          viewportSize: el.clientWidth,
          contentSize: el.scrollWidth,
        };
        setHorizontalMetrics((prev) =>
          metricsChanged(prev, nextHorizontal) ? nextHorizontal : prev,
        );
      }
    }

    element.addEventListener("scroll", update, { passive: true });
    // Do NOT add a raw "input" listener here to catch a growing scrollHeight.
    // It has been added and reverted twice (cacbbf405, then re-added by
    // 46e7f223a) because it silently eats keystrokes in the composer: a
    // target-phase listener runs before React's delegated handler, and its
    // setState — which only actually changes on a wrap, since metricsChanged
    // compares contentSize — flushes a synchronous render carrying the *stale*
    // controlled value. React then writes that stale string back onto the
    // textarea and rewinds its value tracker, so onChange never fires and the
    // wrap-triggering character is lost until it is typed a second time.
    // Scroll plus the ResizeObserver below already cover every metric update:
    // the composer's height mirror sets the textarea's inline height on wrap,
    // which trips the observer. Anything needing more must schedule off the
    // event (rAF/microtask), never synchronously in a listener.
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    const contentElement = contentRef?.current;
    if (contentElement) {
      resizeObserver.observe(contentElement);
    }

    update();

    return () => {
      element.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      element.removeAttribute("data-hide-scrollbar");
      style.scrollbarWidth = previousScrollbarWidth;
      style.msOverflowStyle = previousMsOverflowStyle;
      style.scrollbarGutter = previousScrollbarGutter;
    };
  }, [contentRef, elementRef, enabled, horizontal]);

  const onScrollToOffset = useCallback(
    (offset: number) => {
      elementRef.current?.scrollTo({ top: offset, behavior: "auto" });
    },
    [elementRef],
  );

  const onScrollToHorizontalOffset = useCallback(
    (offset: number) => {
      elementRef.current?.scrollTo({ left: offset, behavior: "auto" });
    },
    [elementRef],
  );

  if (!enabled) return null;

  return (
    <>
      <WebDesktopScrollbarOverlay enabled metrics={metrics} onScrollToOffset={onScrollToOffset} />
      {horizontal ? (
        <WebDesktopScrollbarOverlay
          enabled
          axis="horizontal"
          metrics={horizontalMetrics}
          onScrollToOffset={onScrollToHorizontalOffset}
        />
      ) : null}
    </>
  );
}

// ── RN ScrollView / FlatList scrollbar ───────────────────────────────
// Returns event handlers to wire onto your ScrollView/FlatList plus
// a renderable overlay. The overlay is null when disabled.

interface WebScrollViewScrollbar {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
  overlay: ReactNode;
}

export function useWebScrollViewScrollbar(
  scrollableRef: RefObject<ScrollView | FlatList | null>,
  options?: { enabled?: boolean; axis?: ScrollbarAxis },
): WebScrollViewScrollbar {
  const enabled = (options?.enabled ?? true) && platformIsWeb;
  const axis = options?.axis ?? "vertical";
  const metricsHook = useWebDesktopScrollbarMetrics(axis);

  const onScrollToOffset = useCallback(
    (offset: number) => {
      const scrollable = scrollableRef.current;
      if (!scrollable) return;
      if ("scrollToOffset" in scrollable) {
        scrollable.scrollToOffset({ offset, animated: false });
      } else if (axis === "horizontal") {
        scrollable.scrollTo({ x: offset, animated: false });
      } else {
        scrollable.scrollTo({ y: offset, animated: false });
      }
    },
    [axis, scrollableRef],
  );

  const overlay: ReactNode = enabled ? (
    <WebDesktopScrollbarOverlay
      enabled
      axis={axis}
      metrics={metricsHook}
      onScrollToOffset={onScrollToOffset}
    />
  ) : null;

  return {
    onScroll: metricsHook.onScroll,
    onLayout: metricsHook.onLayout,
    onContentSizeChange: metricsHook.onContentSizeChange,
    overlay,
  };
}
