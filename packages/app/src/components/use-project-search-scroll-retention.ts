import { useCallback, useRef, type RefObject } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import {
  readProjectSearchScrollOffset,
  rememberProjectSearchScrollOffset,
} from "@/stores/project-search-session-store";

/** Below this, a scroll event is the list settling at the top, not the reader. */
const READER_SCROLL_EPSILON = 1;

interface ScrollbarHandlers {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * Carries the results list's scroll position across the pane's unmount, on top
 * of whatever handlers the web scrollbar already needs.
 *
 * Returning to a retained 256-file result set at the top of the list is barely
 * better than losing it, so the offset is remembered as the reader scrolls and
 * re-applied on the way back in. It is held outside React (it changes every
 * scroll frame) and restored only once the list has grown tall enough to hold
 * it, because rows mount over several frames and an early `scrollToOffset`
 * would be clamped to a list that is still short.
 */
export function useProjectSearchScrollRetention<ItemT>({
  scopeKey,
  listRef,
  scrollbar,
}: {
  scopeKey: string;
  listRef: RefObject<FlatList<ItemT> | null>;
  scrollbar: ScrollbarHandlers;
}): ScrollbarHandlers {
  const restoredRef = useRef(false);
  const viewportHeightRef = useRef(0);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollbar.onScroll(event);
      const offset = event.nativeEvent.contentOffset.y;
      // A scroll away from the top before the restore has landed is the reader
      // moving the list themselves, and the remembered position is theirs to
      // overwrite from here. Left pending, it would fire the moment the list
      // grew tall enough and yank them off wherever they had scrolled to.
      if (!restoredRef.current && offset > READER_SCROLL_EPSILON) {
        restoredRef.current = true;
      }
      // Before that, the list is still reporting offsets from its own mounting;
      // recording those would overwrite the position to return to.
      if (restoredRef.current) {
        rememberProjectSearchScrollOffset(scopeKey, offset);
      }
    },
    [scopeKey, scrollbar],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      scrollbar.onLayout(event);
      viewportHeightRef.current = event.nativeEvent.layout.height;
    },
    [scrollbar],
  );

  const onContentSizeChange = useCallback(
    (width: number, height: number) => {
      scrollbar.onContentSizeChange(width, height);
      if (restoredRef.current) {
        return;
      }
      const offset = readProjectSearchScrollOffset(scopeKey);
      if (offset <= 0) {
        restoredRef.current = true;
        return;
      }
      if (height < offset + viewportHeightRef.current) {
        return;
      }
      restoredRef.current = true;
      listRef.current?.scrollToOffset({ offset, animated: false });
    },
    [listRef, scopeKey, scrollbar],
  );

  return { onScroll, onLayout, onContentSizeChange };
}
