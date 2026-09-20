import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Gesture } from "react-native-gesture-handler";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { ExplorerSidebarDock } from "./explorer-sidebar";

interface ChildrenProps {
  children: ReactNode;
}

vi.mock("@/components/retained-panel", () => ({
  RetainedPanel: ({ children }: ChildrenProps) => children,
}));
vi.mock("@/utils/window-chrome", () => ({
  WindowChromeRegion: ({ children }: ChildrenProps) => children,
  WindowChromeSafeArea: ({ children }: ChildrenProps) => children,
}));
vi.mock("@/components/desktop/titlebar-drag-region", () => ({
  TitlebarDragRegion: () => null,
}));
vi.mock("@/screens/workspace/explorer-sidebar-tab-rail", () => ({
  ExplorerSidebarTabRail: () => null,
}));
vi.mock("@/screens/workspace/workspace-panel-host", () => ({
  WorkspacePanelHost: () => null,
}));
vi.mock("@/hooks/use-interface-mode", () => ({
  useIsDeveloperMode: () => true,
}));
vi.mock("@/components/toast-host", () => ({
  useToastHost: () => ({}),
  ToastViewport: () => null,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
const explorerPane = { id: "explorer", tabIds: [], focusedTabId: null };
const noTabs: never[] = [];
const noClosingTabs = new Set<string>();
const noOp = vi.fn();
const rejectContentBuild = () => {
  throw new Error("No empty Explorer tab should request content");
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("ExplorerSidebarDock", () => {
  it("owns the visible inner border and routes drags through the shared resize handle", async () => {
    container = document.createElement("div");
    container.style.cssText =
      "position:fixed;left:20px;top:20px;width:320px;height:300px;overflow:hidden;display:flex";
    document.body.appendChild(container);
    root = createRoot(container);
    const onResize = vi.fn();
    const resizeGesture = Gesture.Pan()
      .minDistance(0)
      .onUpdate((event) => onResize(event.translationX));

    act(() =>
      root.render(
        <ExplorerSidebarDock
          pane={explorerPane}
          uiTabs={noTabs}
          normalizedServerId="server"
          normalizedWorkspaceId="workspace"
          isWorkspaceFocused
          hasPullRequest={false}
          closingTabIds={noClosingTabs}
          activeDragTabId={null}
          tabDropPreview={null}
          onSelectTab={noOp}
          onCloseTab={noOp}
          onCreateNewTab={noOp}
          onMoveTabToMain={noOp}
          onReorderTabsInPane={noOp}
          buildPaneContentModel={rejectContentBuild}
          resizeGesture={resizeGesture}
          resizePressed={false}
        />,
      ),
    );

    const sidebar = container.querySelector<HTMLElement>(
      '[data-testid="workspace-explorer-sidebar"]',
    )!;
    const separator = container.querySelector<HTMLElement>(
      '[data-testid="workspace-explorer-sidebar-resize-handle"]',
    )!;
    const sidebarRect = sidebar.getBoundingClientRect();
    const separatorRect = separator.getBoundingClientRect();

    expect(getComputedStyle(sidebar).borderLeftWidth).toBe("1px");
    expect(separator).toHaveAttribute("role", "separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separatorRect.left).toBeLessThan(sidebarRect.left);
    expect(separatorRect.right).toBeGreaterThan(sidebarRect.left);
    expect(separatorRect.height).toBe(sidebarRect.height);
    const hitTarget = document.elementFromPoint(
      sidebarRect.left + 2,
      sidebarRect.top + sidebarRect.height / 2,
    );
    expect(separator.contains(hitTarget), hitTarget?.outerHTML).toBe(true);

    await act(async () => {
      await page.getByTestId("workspace-explorer-sidebar-resize-handle").hover();
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    const highlight = container.querySelector<HTMLElement>(
      '[data-testid="workspace-explorer-sidebar-resize-handle-highlight"]',
    )!;
    const highlightRect = highlight.getBoundingClientRect();
    expect(highlightRect.left).toBe(sidebarRect.left);
    expect(highlightRect.width).toBe(1);

    const x = sidebarRect.left + 2;
    const y = sidebarRect.top + sidebarRect.height / 2;
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
        }),
      );
      await Promise.resolve();
      separator.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          clientX: x - 10,
          clientY: y,
        }),
      );
      await Promise.resolve();
      separator.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          clientX: x - 120,
          clientY: y,
        }),
      );
      await Promise.resolve();
      separator.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          clientX: x - 120,
          clientY: y,
        }),
      );
      await Promise.resolve();
    });

    await expect.poll(() => onResize.mock.lastCall?.[0]).toBe(-120);
  });
});
