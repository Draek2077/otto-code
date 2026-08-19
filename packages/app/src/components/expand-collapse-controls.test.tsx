/**
 * @vitest-environment jsdom
 *
 * The vitest config aliases `react-native` to react-native-web for every
 * project, so `isWeb`/`isNative` in `@/constants/platform` resolve to the web
 * values here (Platform.OS === "web") - the exact platform the nested-<button>
 * hydration warning occurred on.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpandCollapseControls } from "./expand-collapse-controls";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("@/components/icons/material-icons", () => {
  const createIcon = (name: string) => (props: { size?: number }) =>
    React.createElement("span", { "data-icon": name, "data-size": props.size });
  return {
    ListChevronsDownUp: createIcon("collapse-all"),
    ListChevronsUpDown: createIcon("expand-all"),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "message.expandCollapse.expandAll": "Expand all",
        "message.expandCollapse.collapseAll": "Collapse all",
      })[key] ?? key,
  }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
  // The vitest toolchain compiles JSX with the classic runtime, so component
  // files reference a global React.
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function render(element: React.ReactElement) {
  act(() => {
    root?.render(element);
  });
}

function pressEnter(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  });
}

describe("ExpandCollapseControls (web)", () => {
  it("keeps the controls out of the web <button> tree", () => {
    // The ExpandableBadge header row renders as a real <button> on web
    // (accessibilityRole="button"). Render the controls inside one to reproduce
    // the exact nesting that triggered "In HTML, <button> cannot be a
    // descendant of <button>".
    render(
      <button type="button">
        <ExpandCollapseControls onExpand={vi.fn()} onCollapse={vi.fn()} visible />
      </button>,
    );

    const host = container!;
    expect(host.querySelector("button button")).toBeNull();

    const expandControl = host.querySelector('[data-testid="expand-all-control"]');
    const collapseControl = host.querySelector('[data-testid="collapse-all-control"]');
    expect(expandControl?.tagName).toBe("DIV");
    expect(collapseControl?.tagName).toBe("DIV");
    // No role=button either: react-native-web only emits one when
    // accessibilityRole is set, so keep the controls unambiguous to both the
    // DOM validator and the accessibility tree.
    expect(expandControl?.getAttribute("role")).toBeNull();
    expect(collapseControl?.getAttribute("role")).toBeNull();
  });

  it("keeps the i18n control names as aria-label", () => {
    render(<ExpandCollapseControls onExpand={vi.fn()} onCollapse={vi.fn()} visible />);

    const host = container!;
    expect(
      host.querySelector('[data-testid="expand-all-control"]')?.getAttribute("aria-label"),
    ).toBe("Expand all");
    expect(
      host.querySelector('[data-testid="collapse-all-control"]')?.getAttribute("aria-label"),
    ).toBe("Collapse all");
  });

  it("stays keyboard-focusable and Enter-activatable without the button role", () => {
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    render(<ExpandCollapseControls onExpand={onExpand} onCollapse={onCollapse} visible />);

    const host = container!;
    const expandControl = host.querySelector('[data-testid="expand-all-control"]') as HTMLElement;
    const collapseControl = host.querySelector(
      '[data-testid="collapse-all-control"]',
    ) as HTMLElement;
    // react-native-web's Pressable sets tabIndex=0 unconditionally (unless
    // disabled), so dropping the role does not drop keyboard reachability.
    expect(expandControl.getAttribute("tabindex")).toBe("0");
    expect(collapseControl.getAttribute("tabindex")).toBe("0");

    pressEnter(expandControl);
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onCollapse).not.toHaveBeenCalled();

    pressEnter(collapseControl);
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
