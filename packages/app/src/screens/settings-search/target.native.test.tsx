// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollView, View } from "react-native";
import { ScrollViewportContext } from "@/components/ui/scroll-viewport-context";
import { SettingsSearchContent, SettingsSearchProvider, SettingsTargetText } from "./target";

const native = vi.hoisted(() => ({
  measure: vi.fn(),
  measureInWindow: vi.fn(),
  accessibilityFocus: vi.fn(),
}));
vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("react-native", async () => {
  const R = await import("react");
  const Component = R.forwardRef<unknown, { children?: React.ReactNode }>((props, ref) => {
    R.useImperativeHandle(ref, () => ({
      measureLayout: native.measure,
      measureInWindow: native.measureInWindow,
    }));
    return R.createElement("span", null, props.children);
  });
  return {
    Text: Component,
    View: Component,
    findNodeHandle: () => 42,
    AccessibilityInfo: { setAccessibilityFocus: native.accessibilityFocus },
  };
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  native.measureInWindow.mockImplementation((success) => success(0, 0, 100, 22));
  native.measure.mockImplementation((_parent, success) => success(0, 220, 100, 22));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function nativeScrollRef(
  scrollTo: ScrollView["scrollTo"] = vi.fn<ScrollView["scrollTo"]>(),
): React.RefObject<ScrollView> {
  return { current: { scrollTo } } as unknown as React.RefObject<ScrollView>;
}
function nativeViewport(scrollTo: ScrollView["scrollTo"]) {
  return { scroll: nativeScrollRef(scrollTo), content: { current: {} } as React.RefObject<View> };
}

describe("native Settings row reveal", () => {
  it("measures against the nearest sheet content and scrolls its existing owner", async () => {
    const outer = nativeScrollRef();
    const innerScrollTo = vi.fn();
    const inner = nativeViewport(innerScrollTo);
    await act(async () =>
      root.render(
        <SettingsSearchContent settingId="row" scroll={outer}>
          <ScrollViewportContext.Provider value={inner}>
            <SettingsTargetText settingId="row">Not an English lookup</SettingsTargetText>
          </ScrollViewportContext.Provider>
        </SettingsSearchContent>,
      ),
    );
    expect(native.measure.mock.calls[0]?.[0]).toBe(inner.content.current);
    expect(innerScrollTo).toHaveBeenCalledWith({ y: 196, animated: true });
    expect(outer.current.scrollTo).not.toHaveBeenCalled();
    expect(native.accessibilityFocus).toHaveBeenCalledWith(42);
  });

  it("keeps a request pending while an asynchronous label has not mounted", async () => {
    const scrollTo = vi.fn();
    const scroll = nativeScrollRef(scrollTo);
    await act(async () =>
      root.render(
        <SettingsSearchContent settingId="row" scroll={scroll}>
          Loading
        </SettingsSearchContent>,
      ),
    );
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        <SettingsSearchContent settingId="row" scroll={scroll}>
          <SettingsTargetText settingId="row">通知</SettingsTargetText>
        </SettingsSearchContent>,
      ),
    );
    expect(scrollTo).toHaveBeenCalledOnce();
  });
  it("lets a standalone sheet host own the request without a body wrapper", async () => {
    const scrollTo = vi.fn();
    const viewport = nativeViewport(scrollTo);
    await act(async () =>
      root.render(
        <SettingsSearchProvider settingId="row">
          <ScrollViewportContext.Provider value={viewport}>
            <SettingsTargetText settingId="row">Selected provider</SettingsTargetText>
          </ScrollViewportContext.Provider>
        </SettingsSearchProvider>,
      ),
    );
    expect(container.querySelectorAll("span")).toHaveLength(1);
    expect(native.measure.mock.calls[0]?.[0]).toBe(viewport.content.current);
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it("accessibility-focuses a visible fixed sheet action without inventing a scroll owner", async () => {
    await act(async () =>
      root.render(
        <SettingsSearchProvider settingId="fixed">
          <SettingsTargetText settingId="fixed">Fixed header action</SettingsTargetText>
        </SettingsSearchProvider>,
      ),
    );
    expect(native.measure).not.toHaveBeenCalled();
    expect(native.measureInWindow).toHaveBeenCalledOnce();
    expect(native.accessibilityFocus).toHaveBeenCalledWith(42);
  });
});
