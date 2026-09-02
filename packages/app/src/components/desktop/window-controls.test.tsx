/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chrome: {
    isMaximized: false,
    mode: "custom-windows" as const,
    visible: true,
  },
  close: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: { colors: Record<string, string> }) => unknown)({
            colors: {
              foregroundMuted: "#999",
              interactionHighlight: "#333",
            },
          })
        : factory,
  },
  withUnistyles: <T,>(component: T): T => component,
}));

vi.mock("@/desktop/electron/window", () => ({
  closeDesktopWindow: mocks.close,
  minimizeDesktopWindow: mocks.minimize,
  toggleDesktopMaximize: mocks.toggleMaximize,
}));

vi.mock("@/utils/window-chrome", () => ({
  useCustomDesktopWindowControls: () => mocks.chrome,
}));

vi.mock("@/constants/platform", () => ({ isWeb: true }));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { DesktopWindowControls } from "./window-controls";

describe("DesktopWindowControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.chrome = { isMaximized: false, mode: "custom-windows", visible: true };
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("carves the custom controls out of Electron titlebar drag hit testing", () => {
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");

    act(() => root.render(<DesktopWindowControls />));

    const controls = container.querySelector('[data-testid="desktop-window-controls"]');
    expect(controls).not.toBeNull();
    expect(setProperty).toHaveBeenCalledWith("-webkit-app-region", "no-drag");
  });
});
