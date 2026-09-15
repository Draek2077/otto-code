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
    // Claims the event like the real helper, so the provider's bubble fallback
    // does not reopen the menu and discard contributed actions.
    contextMenuAnchorFromEvent: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      return { x: event.clientX, y: event.clientY };
    },
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

const { TextSelectionMenuProvider, TextSelectionActionsScope } =
  await import("./text-selection-menu.web");

function selectContents(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("TextSelectionActionsScope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function renderScope(resolve: () => { beforeStandardActions: React.ReactNode } | null) {
    act(() => {
      root.render(
        <TextSelectionMenuProvider>
          <TextSelectionActionsScope resolve={resolve}>
            <p data-testid="inside">Use a mutex here.</p>
          </TextSelectionActionsScope>
          <p data-testid="outside">Unrelated label</p>
        </TextSelectionMenuProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const inside = container.querySelector("[data-testid='inside']");
    const outside = container.querySelector("[data-testid='outside']");
    if (!inside || !outside) throw new Error("Expected scope fixtures.");
    return { inside, outside };
  }

  it("prepends the scope's actions for a selection inside it", async () => {
    const resolve = vi.fn(() => ({ beforeStandardActions: <span>Chat actions</span> }));
    const { inside } = await renderScope(resolve);

    selectContents(inside);
    act(() => {
      inside.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 8 }),
      );
    });

    expect(resolve).toHaveBeenCalledWith({ selectionText: "Use a mutex here." });
    expect(container.textContent).toContain("Chat actions");
    expect(container.textContent).toContain("Copy");
  });

  it("ignores text selected outside the scope", async () => {
    const resolve = vi.fn(() => ({ beforeStandardActions: <span>Chat actions</span> }));
    const { inside, outside } = await renderScope(resolve);

    selectContents(outside);
    act(() => {
      inside.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 8 }),
      );
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Chat actions");
    expect(container.textContent).toContain("Copy");
  });
});

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
