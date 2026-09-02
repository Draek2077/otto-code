import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuTrigger } from "./context-menu";

const captured = vi.hoisted(() => ({
  style: undefined as unknown,
  onContextMenu: undefined as ((event: unknown) => void) | undefined,
  setOpen: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  StatusBar: {},
}));

vi.mock("@/constants/platform", () => ({
  isNative: false,
  isWeb: true,
}));

vi.mock("@/components/ui/menu", () => ({
  MenuHint: () => null,
  MenuItem: () => null,
  MenuLabel: () => null,
  MenuRoot: () => null,
  MenuSeparator: () => null,
  MenuSurface: () => null,
  useMenuContext: () => ({
    open: false,
    setAnchorRect: vi.fn(),
    setOpen: captured.setOpen,
    triggerRef: undefined,
  }),
}));

vi.mock("@/components/ui/press-highlight", () => ({
  PressHighlight: (props: { style?: unknown; onContextMenu?: (event: unknown) => void }) => {
    captured.style = props.style;
    captured.onContextMenu = props.onContextMenu;
    return null;
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("ContextMenuTrigger", () => {
  it("preserves a static trigger style so the native press highlight can inherit its corners", () => {
    vi.stubGlobal("React", React);
    const rowStyle = [{ borderRadius: 8 }, { backgroundColor: "#111" }];

    renderToStaticMarkup(<ContextMenuTrigger style={rowStyle} />);

    expect(captured.style).toBe(rowStyle);
  });

  it("does not intercept a right click when the context menu is disabled", () => {
    vi.stubGlobal("React", React);
    const preventDefault = vi.fn();

    renderToStaticMarkup(<ContextMenuTrigger enabled={false} />);
    captured.onContextMenu?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(captured.setOpen).not.toHaveBeenCalled();
  });
});
