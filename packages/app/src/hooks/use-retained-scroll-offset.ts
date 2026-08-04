import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";

/**
 * Scroll offsets retained across remounts, keyed by surface.
 *
 * Module scope is the point: the value has to outlive the component that owns
 * the ScrollView. Session-lifetime only - nothing here is written to disk.
 */
const retainedOffsets = new Map<string, number>();

/** Offsets closer than this are the same offset (sub-pixel scroll positions). */
const OFFSET_EPSILON = 1;

/**
 * A restore attempt can land short when the list is still filling in (async
 * host list, late fonts): the ScrollView clamps to the content height it has at
 * that moment. Retry on the next few growth events, then give up so a resize
 * long after mount never yanks the reader.
 */
const MAX_RESTORE_ATTEMPTS = 4;

export function readRetainedScrollOffset(key: string): number {
  return retainedOffsets.get(key) ?? 0;
}

/** Test seam - production code never needs to reset the map. */
export function clearRetainedScrollOffsets(): void {
  retainedOffsets.clear();
}

export interface RetainedScrollOffset {
  /** Attach to the ScrollView. */
  ref: RefObject<ScrollView | null>;
  /** Attach to `onScroll` (with `scrollEventThrottle`). */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Attach to `onContentSizeChange`. */
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * Remembers where a scrollable surface was left and puts it back when the same
 * surface mounts again.
 *
 * The first attempt runs in a layout effect, before the browser paints: on web
 * the children are already in the DOM by then, so the surface's very first
 * frame is drawn at the restored offset. Restoring from `onContentSizeChange`
 * alone paints the top first and jumps a frame later - the flash.
 * `onContentSizeChange` stays as the retry for content that is still filling in
 * (and for native, where nothing is measured during the layout effect). Once
 * the reader scrolls by hand the restore is abandoned.
 */
export function useRetainedScrollOffset(key: string): RetainedScrollOffset {
  const ref = useRef<ScrollView | null>(null);
  // Captured once, at mount, so a clamped restore attempt cannot overwrite the
  // offset it is still trying to reach.
  const targetRef = useRef(readRetainedScrollOffset(key));
  const attemptsRef = useRef(0);
  const isRestoringRef = useRef(targetRef.current > OFFSET_EPSILON);
  const requestedOffsetRef = useRef<number | null>(null);

  const restore = useCallback(() => {
    if (!isRestoringRef.current) {
      return;
    }
    if (attemptsRef.current >= MAX_RESTORE_ATTEMPTS) {
      isRestoringRef.current = false;
      return;
    }
    attemptsRef.current += 1;
    requestedOffsetRef.current = targetRef.current;
    ref.current?.scrollTo({ y: targetRef.current, animated: false });
  }, []);

  useLayoutEffect(() => {
    restore();
  }, [restore]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      retainedOffsets.set(key, offset);

      if (!isRestoringRef.current) {
        return;
      }
      const requested = requestedOffsetRef.current;
      // Landing short of what we asked for is the ScrollView clamping to a
      // content height that has not finished growing - still our scroll, and
      // worth another attempt. Anything past it is the reader taking over.
      const isOurOwnScroll = requested !== null && offset <= requested + OFFSET_EPSILON;
      if (!isOurOwnScroll) {
        // The reader took over. Their position wins from here.
        isRestoringRef.current = false;
        return;
      }
      requestedOffsetRef.current = null;
      if (Math.abs(offset - targetRef.current) < OFFSET_EPSILON) {
        isRestoringRef.current = false;
      }
    },
    [key],
  );

  const onContentSizeChange = useCallback(() => {
    restore();
  }, [restore]);

  return { ref, onScroll, onContentSizeChange };
}
