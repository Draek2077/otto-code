/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContextMenuContentBoundary } from "./context-menu-content-boundary";

const onError = vi.fn();

function Throwing(): React.ReactElement {
  throw new Error("AssistantFileLinkResolverProvider is required for assistant file links.");
}

describe("ChatContextMenuContentBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onError.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  // A named declaration, not an inline arrow: it keeps the `expect(...)` cases
  // inside the nested-callback budget.
  function render(node: React.ReactNode): void {
    act(() => {
      root.render(node);
    });
  }

  it("renders contributed content untouched", () => {
    render(
      <ChatContextMenuContentBoundary onError={onError} resetKey={1}>
        <span data-testid="content">Open file</span>
      </ChatContextMenuContentBoundary>,
    );

    expect(container.querySelector("[data-testid='content']")?.textContent).toBe("Open file");
  });

  it("contains a throwing contributor instead of letting it reach the root boundary", () => {
    expect(() =>
      render(
        <ChatContextMenuContentBoundary onError={onError} resetKey={1}>
          <Throwing />
        </ChatContextMenuContentBoundary>,
      ),
    ).not.toThrow();

    expect(container.textContent).toBe("");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("retries content when a new menu opens", () => {
    render(
      <ChatContextMenuContentBoundary onError={onError} resetKey={1}>
        <Throwing />
      </ChatContextMenuContentBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);

    render(
      <ChatContextMenuContentBoundary onError={onError} resetKey={2}>
        <span data-testid="content">Copy link</span>
      </ChatContextMenuContentBoundary>,
    );

    expect(container.querySelector("[data-testid='content']")?.textContent).toBe("Copy link");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
