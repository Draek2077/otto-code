/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";
import {
  clearRetainedScrollOffsets,
  readRetainedScrollOffset,
  useRetainedScrollOffset,
} from "./use-retained-scroll-offset";

function scrollEvent(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { x: 0, y } },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}

/**
 * Mounts the hook with a stand-in ScrollView already attached. The ref is
 * assigned during render, the way React attaches a real one - before the layout
 * effect that runs the first restore.
 */
function mountWithScrollView(key: string) {
  const scrollTo = vi.fn();
  const view = { scrollTo } as unknown as ScrollView;
  const rendered = renderHook(() => {
    const retained = useRetainedScrollOffset(key);
    retained.ref.current = view;
    return retained;
  });
  return { ...rendered, scrollTo };
}

/** Leaves `offset` behind for the next mount of `key`. */
function leaveOffsetBehind(key: string, offset: number): void {
  const previous = mountWithScrollView(key);
  previous.result.current.onScroll(scrollEvent(offset));
  previous.unmount();
}

describe("useRetainedScrollOffset", () => {
  beforeEach(() => {
    clearRetainedScrollOffsets();
  });

  it("does not scroll when nothing was retained", () => {
    const { result, scrollTo } = mountWithScrollView("menu");

    result.current.onContentSizeChange(200, 800);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("restores the previous mount's offset before the first paint", () => {
    leaveOffsetBehind("menu", 320);
    expect(readRetainedScrollOffset("menu")).toBe(320);

    const { scrollTo } = mountWithScrollView("menu");

    // The layout effect, not onContentSizeChange: no frame is drawn at the top.
    expect(scrollTo).toHaveBeenCalledWith({ y: 320, animated: false });
  });

  it("retries when the first attempt clamps short of the target", () => {
    leaveOffsetBehind("menu", 320);
    const { result, scrollTo } = mountWithScrollView("menu");

    // The list is still filling in, so the mount attempt only reaches 100.
    result.current.onScroll(scrollEvent(100));

    // It grows, and the retry lands.
    result.current.onContentSizeChange(200, 800);
    result.current.onScroll(scrollEvent(320));

    expect(scrollTo).toHaveBeenNthCalledWith(1, { y: 320, animated: false });
    expect(scrollTo).toHaveBeenNthCalledWith(2, { y: 320, animated: false });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("stops restoring once the offset is reached", () => {
    leaveOffsetBehind("menu", 320);
    const { result, scrollTo } = mountWithScrollView("menu");

    result.current.onScroll(scrollEvent(320));
    result.current.onContentSizeChange(200, 900);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("abandons the restore when the reader scrolls first", () => {
    leaveOffsetBehind("menu", 320);
    const { result, scrollTo } = mountWithScrollView("menu");

    // Past what we asked for: this is the reader, not our clamp.
    result.current.onScroll(scrollEvent(460));
    result.current.onContentSizeChange(200, 900);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(readRetainedScrollOffset("menu")).toBe(460);
  });

  it("gives up after a bounded number of attempts", () => {
    leaveOffsetBehind("menu", 320);
    const { result, scrollTo } = mountWithScrollView("menu");

    for (let i = 0; i < 8; i += 1) {
      result.current.onScroll(scrollEvent(0));
      result.current.onContentSizeChange(200, 300);
    }

    expect(scrollTo).toHaveBeenCalledTimes(4);
  });

  it("keeps separate positions per key", () => {
    const menu = mountWithScrollView("menu");
    const detail = mountWithScrollView("detail");

    menu.result.current.onScroll(scrollEvent(120));
    detail.result.current.onScroll(scrollEvent(480));

    expect(readRetainedScrollOffset("menu")).toBe(120);
    expect(readRetainedScrollOffset("detail")).toBe(480);
  });
});
