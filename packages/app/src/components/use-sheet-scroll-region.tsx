import { useCallback, useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";
import { SheetSeamFade, type SheetSeamFadeSurface } from "@/components/sheet-seam-fade";
import { useScrollEdgeFades } from "@/components/use-scroll-edge-fades";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";

export interface SheetScrollRegion {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
  /** Feed straight to the scroll view: the native bar hides when ours shows. */
  showsVerticalScrollIndicator: boolean;
  /**
   * Seam fades plus the themed scrollbar overlay, in paint order. Render as a
   * later sibling of the scroll view inside a relatively positioned container.
   */
  decorations: ReactNode;
}

/**
 * The full dialog scroll-region treatment in one call: top/bottom seam fades
 * that dissolve content into the sheet background, and the themed hover-hiding
 * web scrollbar in place of the browser's.
 *
 * Every scrolling region inside a dialog goes through this — the sheet body,
 * each tab pane — so they all behave identically instead of each one wiring
 * `useScrollEdgeFades` and `useWebScrollViewScrollbar` together by hand (and
 * drifting).
 */
export function useSheetScrollRegion(
  scrollRef: RefObject<ScrollView | FlatList | null>,
  {
    surface,
    webScrollbar,
  }: {
    /** Sheet background the fades dissolve into — see `SheetSeamFade`. */
    surface: SheetSeamFadeSurface;
    /** False on native and on the mobile bottom sheet, which keep the OS bar. */
    webScrollbar: boolean;
  },
): SheetScrollRegion {
  const scrollbar = useWebScrollViewScrollbar(scrollRef, { enabled: webScrollbar });
  const edgeFades = useScrollEdgeFades(scrollRef as RefObject<ScrollView | null>);

  // The scrollbar overlay and the edge fades both need the same three
  // callbacks; fan each one out rather than making either hook aware of the
  // other.
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollbar.onScroll(event);
      edgeFades.onScroll(event);
    },
    [scrollbar, edgeFades],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      scrollbar.onLayout(event);
      edgeFades.onLayout(event);
    },
    [scrollbar, edgeFades],
  );
  const onContentSizeChange = useCallback(
    (width: number, height: number) => {
      scrollbar.onContentSizeChange(width, height);
      edgeFades.onContentSizeChange(width, height);
    },
    [scrollbar, edgeFades],
  );

  const decorations = useMemo(
    () => (
      <>
        {/*
         * Fades sit after the scroll view (so they paint over the content) but
         * before the scrollbar overlay (so the scrollbar stays visible over
         * them) — paint order only, no zIndex, matching the chat pane fades.
         */}
        <SheetSeamFade
          edge="top"
          surface={surface}
          visible={edgeFades.showTopFade}
          animated={edgeFades.hasScrolled}
        />
        <SheetSeamFade
          edge="bottom"
          surface={surface}
          visible={edgeFades.showBottomFade}
          animated={edgeFades.hasScrolled}
        />
        {scrollbar.overlay}
      </>
    ),
    [
      surface,
      edgeFades.showTopFade,
      edgeFades.showBottomFade,
      edgeFades.hasScrolled,
      scrollbar.overlay,
    ],
  );

  return {
    onScroll,
    onLayout,
    onContentSizeChange,
    showsVerticalScrollIndicator: !webScrollbar,
    decorations,
  };
}
