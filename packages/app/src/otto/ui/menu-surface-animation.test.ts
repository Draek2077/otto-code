/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import Animated from "react-native-reanimated";
import { computePosition } from "@/components/ui/anchor";
import { menuSurfaceEntering, MENU_SURFACE_ENTERING_DURATION_MS } from "./menu-surface-animation";

// Reanimated publishes runtime JS and its matching declarations in separate trees. Exercise
// the actual implementation with its published types, without replacing it with a module mock.
const { saveSnapshot } = await vi.importActual<
  typeof import("react-native-reanimated/lib/typescript/layoutReanimation/web/componentUtils")
>("react-native-reanimated/lib/module/layoutReanimation/web/componentUtils");
const { configureWebLayoutAnimations } = await vi.importActual<
  typeof import("react-native-reanimated/lib/typescript/layoutReanimation/web/domUtils")
>("react-native-reanimated/lib/module/layoutReanimation/web/domUtils");

beforeEach(() => {
  vi.useFakeTimers();
  configureWebLayoutAnimations();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function createSurface() {
  const view = render(
    createElement(Animated.View, {
      entering: menuSurfaceEntering,
      testID: "menu-animation-surface",
    }),
  );
  const element = view.getByTestId("menu-animation-surface");
  // JSDOM has no layout engine. Supply measurements for this one element while running the
  // real positioning math and Reanimated's actual animation/snapshot/cleanup implementation.
  element.getBoundingClientRect = () => {
    const x = Number.parseFloat(element.style.left);
    const y = Number.parseFloat(element.style.top);
    const width = Number.parseFloat(element.style.width);
    const height = Number.parseFloat(element.style.height);
    return {
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({ x, y, width, height }),
    };
  };
  const place = (width: number, height: number) => {
    const result = computePosition({
      triggerRect: { x: 300, y: 700, width: 28, height: 28 },
      contentSize: { width, height },
      displayArea: { x: 0, y: 0, width: 1000, height: 800 },
      placement: "top",
      alignment: "center",
      offset: 8,
    });
    Object.assign(element.style, {
      position: "absolute",
      left: `${result.x}px`,
      top: `${result.y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    return {
      left: element.style.left,
      top: element.style.top,
      width: `${width}px`,
      height: `${height}px`,
    };
  };
  return { element, place };
}

describe("menu positioning while content changes after opening", () => {
  it.each([
    { label: "grows from loading to account reports", initial: 80, next: 340, width: 340 },
    { label: "shrinks to an empty result", initial: 340, next: 80, width: 220 },
  ])("keeps current geometry when the popup $label", async ({ initial, next, width }) => {
    const { element, place } = createSurface();
    place(260, initial);
    await vi.advanceTimersByTimeAsync(MENU_SURFACE_ENTERING_DURATION_MS);
    expect(element.style.animationDuration).toBe(`${MENU_SURFACE_ENTERING_DURATION_MS / 1000}s`);
    // This is what Reanimated's animationend handler records before the async answer arrives.
    saveSnapshot(element);

    const current = place(width, next);
    await vi.advanceTimersByTimeAsync(1000);

    expect({
      left: element.style.left,
      top: element.style.top,
      width: element.style.width,
      height: element.style.height,
    }).toEqual(current);
  });
});
