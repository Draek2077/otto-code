/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const {
  applySpellcheckAction,
  emitSpellcheckContext,
  setSpellcheckContextHandler,
  clearSpellcheckContextHandler,
} = vi.hoisted(() => {
  let spellcheckContextHandler: ((payload: unknown) => void) | null = null;
  return {
    applySpellcheckAction: vi.fn(async () => true),
    emitSpellcheckContext: (payload: unknown) => spellcheckContextHandler?.(payload),
    setSpellcheckContextHandler: (handler: (payload: unknown) => void) => {
      spellcheckContextHandler = handler;
    },
    clearSpellcheckContextHandler: () => {
      spellcheckContextHandler = null;
    },
  };
});

vi.mock("expo-clipboard", () => ({
  getStringAsync: vi.fn(async () => ""),
  setStringAsync: vi.fn(async () => true),
}));

vi.mock("@/components/ui/context-menu", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    ContextMenu: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    ContextMenuContent: ({ children }: { children: React.ReactNode }) =>
      createElement("div", { "data-testid": "text-menu" }, children),
    ContextMenuItem: ({
      children,
      disabled,
      onSelect,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onSelect?: () => void;
    }) => createElement("button", { type: "button", disabled, onClick: onSelect }, children),
    ContextMenuSeparator: () => createElement("hr"),
    contextMenuAnchorFromEvent: (event: MouseEvent) => ({ x: event.clientX, y: event.clientY }),
  };
});

vi.mock("@/components/ui/shortcut", () => ({
  Shortcut: () => null,
}));

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    events: {
      on: (_event: string, handler: (payload: unknown) => void) => {
        setSpellcheckContextHandler(handler);
        return () => clearSpellcheckContextHandler();
      },
    },
    menu: { applySpellcheckAction },
  }),
}));

const { TextSelectionMenuProvider } = await import("./text-selection-menu.web");

describe("TextSelectionMenuProvider spellcheck", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearSpellcheckContextHandler();
    vi.clearAllMocks();
  });

  it("adds native suggestions above the shared edit group and applies the opaque action", async () => {
    act(() => {
      root.render(
        <TextSelectionMenuProvider>
          <textarea data-testid="composer" defaultValue="teh" />
        </TextSelectionMenuProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const composer = container.querySelector<HTMLTextAreaElement>("[data-testid='composer']");
    if (!composer) throw new Error("Expected Composer textarea.");

    act(() => {
      composer.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 42, clientY: 84 }),
      );
      emitSpellcheckContext({
        token: "spellcheck-7",
        x: 42,
        y: 84,
        suggestions: ["the"],
        canAddToDictionary: true,
      });
    });

    expect(container.textContent).toContain("the");
    expect(container.textContent).toContain("Add to Dictionary");
    expect(container.textContent).toContain("Cut");

    const suggestion = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "the",
    );
    if (!suggestion) throw new Error("Expected spellcheck suggestion.");
    act(() => {
      suggestion.click();
    });

    expect(applySpellcheckAction).toHaveBeenCalledWith({
      token: "spellcheck-7",
      kind: "replace",
      suggestion: "the",
    });
  });
});
