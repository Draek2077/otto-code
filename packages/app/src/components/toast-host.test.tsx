import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@/styles/theme";
import { darkTheme, lightTheme } from "@/styles/theme";
import { ToastViewport, type ToastState, type ToastVariant } from "./toast-host";

const fixture = vi.hoisted(() => ({ theme: null as Theme | null }));
vi.mock("react-native-unistyles", async () => {
  const { darkTheme: theme } = await import("@/styles/theme");
  return {
    StyleSheet: { create: (factory: (theme: Theme) => unknown) => factory(theme) },
    withUnistyles:
      (Component: React.ComponentType<Record<string, unknown>>) =>
      ({ uniProps, ...props }: { uniProps: (theme: Theme) => Record<string, unknown> }) =>
        React.createElement(Component, { ...props, ...uniProps(fixture.theme ?? theme) }),
  };
});
vi.mock("@/components/icons/material-icons", () => ({
  Info: (props: { color: string; size: string }) => (
    <span data-icon="info" data-color={props.color} data-size={props.size} />
  ),
  AlertTriangle: (props: { color: string; size: string }) => (
    <span data-icon="alert" data-color={props.color} data-size={props.size} />
  ),
  CheckCircle2: (props: { color: string; size: string }) => (
    <span data-icon="success" data-color={props.color} data-size={props.size} />
  ),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
  resolveChatMaxWidth: () => undefined,
  HEADER_INNER_HEIGHT: 46,
  HEADER_INNER_HEIGHT_MOBILE: 56,
  HEADER_TOP_PADDING_MOBILE: 8,
}));
vi.mock("@/constants/platform", () => ({ isWeb: true, isNative: false }));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: () => false,
  selectIsAgentListOpen: () => false,
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useActiveWorkspaceSelection: () => null,
}));
vi.mock("@/stores/workspace-layout-store", () => ({ useWorkspaceLayoutStore: () => undefined }));
vi.mock("@/lib/overlay-root", () => ({ getOverlayRoot: vi.fn(), OVERLAY_Z: { toast: 1 } }));

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  fixture.theme = null;
  vi.unstubAllGlobals();
});

const dismiss = () => undefined;
function render(variant: ToastVariant, icon?: React.ReactNode) {
  const toast: ToastState = {
    id: 1,
    content: "Notice",
    nativeMessage: "Notice",
    variant,
    durationMs: null,
    icon,
  };
  return renderToStaticMarkup(
    React.createElement(ToastViewport, { placement: "panel", onDismiss: dismiss, toast }),
  );
}

describe("shared toast SDK variants", () => {
  it.each([darkTheme, lightTheme])(
    "renders information and warning with the active theme's semantic glyph colors",
    (theme) => {
      fixture.theme = theme;
      const info = render("info");
      expect(info).toContain('data-icon="info"');
      expect(info).toContain(`data-color="${theme.colors.statusInfo}"`);
      expect(info).toContain('data-size="mdPlus"');
      const warning = render("warning");
      expect(warning).toContain('data-icon="alert"');
      expect(warning).toContain(`data-color="${theme.colors.statusWarning}"`);
      expect(warning).toContain('role="alert"');
      expect(warning).toContain("Notice");
    },
  );

  it("retains default, success, error and caller-supplied icon behavior", () => {
    expect(render("default")).not.toContain("data-icon");
    expect(render("success")).toContain('data-icon="success"');
    expect(render("error")).toContain(`data-color="${darkTheme.colors.destructive}"`);
    const custom = render("warning", <span data-icon="custom" />);
    expect(custom).toContain('data-icon="custom"');
    expect(custom).not.toContain('data-icon="alert"');
  });
});
