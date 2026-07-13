import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, View } from "react-native";
import { getSidebarRowAnchorNode, type MeasurableNode } from "./sidebar-row-anchors";
import { useSidebarRevealStore } from "@/stores/sidebar-reveal-store";

// Distance kept between a revealed row and the viewport edge.
const REVEAL_PADDING = 16;
// A just-navigated/just-created row may mount a few frames after the reveal
// request (navigation + virtualization). Poll a short while for it to appear.
const MAX_ATTEMPTS = 30;

// Temporary reveal diagnostics. Forced ON (not gated on __DEV__) so it prints in
// production-style desktop bundles too. Remove once verified on-device.
const DEBUG_REVEAL = true;
function debugReveal(...args: unknown[]): void {
  if (DEBUG_REVEAL) {
    console.warn("[SidebarReveal]", ...args);
  }
}

export interface ScrollToCapable {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
}

function measureInWindowAsync(node: MeasurableNode): Promise<{ y: number; height: number }> {
  return new Promise((resolve) => {
    node.measureInWindow((_x, y, _w, height) => resolve({ y, height }));
  });
}

// Reveal controller for ONE sidebar scroll container. Wire the returned onScroll
// onto the ScrollView (to track the live offset) and pass the container View ref
// (for the viewport bounds) plus the scrollable ref (for scrollTo). Subscribes to
// the shared reveal request and, when the target row is mounted in THIS
// container, scrolls the minimum needed to bring it fully into view. If the row
// isn't in this container (wrong group mode, or a collapsed/virtualized row that
// never mounts) it simply no-ops after the retry budget.
export function useSidebarRevealController(
  containerRef: RefObject<View | null>,
  scrollRef: RefObject<ScrollToCapable | null>,
): {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const request = useSidebarRevealStore((s) => s.request);
  const offsetRef = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    if (!request) {
      return;
    }
    debugReveal("request", request.key, "token", request.token);
    let cancelled = false;
    let attempts = 0;

    const attempt = async () => {
      if (cancelled) {
        return;
      }
      const node = getSidebarRowAnchorNode(request.key);
      const container = containerRef.current;
      const scroll = scrollRef.current;
      if (!node || !container || !scroll) {
        if (attempts++ < MAX_ATTEMPTS) {
          requestAnimationFrame(() => void attempt());
          return;
        }
        debugReveal("gave up", request.key, {
          node: Boolean(node),
          container: Boolean(container),
          scroll: Boolean(scroll),
          scrollToType: typeof scroll?.scrollTo,
        });
        return;
      }

      const [row, viewport] = await Promise.all([
        measureInWindowAsync(node),
        measureInWindowAsync(container),
      ]);
      if (cancelled) {
        return;
      }

      // Row position relative to the viewport's top edge.
      const relativeTop = row.y - viewport.y;
      const relativeBottom = relativeTop + row.height;
      const current = offsetRef.current;

      let target: number | null = null;
      if (relativeTop < REVEAL_PADDING) {
        target = current + relativeTop - REVEAL_PADDING;
      } else if (relativeBottom > viewport.height - REVEAL_PADDING) {
        target = current + relativeBottom - (viewport.height - REVEAL_PADDING);
      }

      debugReveal("measured", request.key, {
        row,
        viewport,
        relativeTop,
        relativeBottom,
        currentOffset: current,
        target,
        scrollToType: typeof scroll.scrollTo,
      });

      if (target !== null) {
        scroll.scrollTo({ y: Math.max(0, target), animated: true });
      }
    };

    requestAnimationFrame(() => void attempt());
    return () => {
      cancelled = true;
    };
  }, [request, containerRef, scrollRef]);

  return { onScroll };
}
