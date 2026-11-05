import { useCallback, useEffect, useRef, type RefObject } from "react";
import type {
  ScrollView,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import type { EditorScrollLink } from "./scroll-link";
export function useEditorPreviewScroll(ref: RefObject<ScrollView | null>, link?: EditorScrollLink) {
  const geometry = useRef({ height: 0, content: 0 });
  useEffect(
    () =>
      link?.listen("preview", (fraction) => {
        const maximum = geometry.current.content - geometry.current.height;
        if (maximum > 0 && geometry.current.height > 0)
          ref.current?.scrollTo({ y: fraction * maximum, animated: false });
      }),
    [link, ref],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    geometry.current.height = event.nativeEvent.layout.height;
  }, []);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    geometry.current.content = height;
  }, []);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const maximum = contentSize.height - layoutMeasurement.height;
      if (maximum > 0 && layoutMeasurement.height > 0)
        link?.report("preview", contentOffset.y / maximum);
    },
    [link],
  );
  return { onLayout, onContentSizeChange, onScroll, scrollEventThrottle: 16 };
}
