import { useCallback, useState, type RefObject } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";
import {
  OverlayScrollbar,
  type OverlayScrollbarMetrics,
} from "@/components/ui/overlay-scrollbar/overlay-scrollbar";
import { isWeb } from "@/constants/platform";
import { useBrainSurfaceActive } from "../../lifecycle";
export function useWebScrollViewScrollbar(ref: RefObject<ScrollView | null>) {
  const active = useBrainSurfaceActive();
  const [metrics, setMetrics] = useState<OverlayScrollbarMetrics>({
    offset: 0,
    viewportSize: 0,
    contentSize: 0,
  });
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (!active || height <= 0) return;
      setMetrics((previous) => ({ ...previous, viewportSize: height }));
    },
    [active],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (!active || height <= 0) return;
      setMetrics((previous) => ({ ...previous, contentSize: height }));
    },
    [active],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentSize, contentOffset } = event.nativeEvent;
      if (!active || layoutMeasurement.height <= 0) return;
      setMetrics({
        offset: contentOffset.y,
        viewportSize: layoutMeasurement.height,
        contentSize: contentSize.height,
      });
    },
    [active],
  );
  const onScrollToOffset = useCallback(
    (offset: number) => ref.current?.scrollTo({ y: offset, animated: false }),
    [ref],
  );
  const overlay =
    isWeb && active ? (
      <OverlayScrollbar metrics={metrics} onScrollToOffset={onScrollToOffset} />
    ) : null;
  return { onLayout, onContentSizeChange, onScroll, overlay };
}
