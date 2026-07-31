/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamSegmentRenderers, StreamViewportHandle } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";

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

vi.mock("@/components/use-web-scrollbar", () => ({ useWebElementScrollbar: () => null }));

function userMessage(index: number): StreamItem {
  return {
    kind: "user_message",
    id: `message-${index}`,
    text: `Message ${index}`,
    timestamp: new Date(`2026-04-20T00:00:${String(index % 60).padStart(2, "0")}.000Z`),
  };
}

const VIRTUAL_ROW_STYLE = { height: 24 };

function createRenderers(onRowRender: () => void): StreamSegmentRenderers {
  return {
    renderHistoryVirtualizedRow: (item) => {
      onRowRender();
      return <div style={VIRTUAL_ROW_STYLE}>{item.id}</div>;
    },
    renderHistoryMountedRow: (item) => <div>{item.id}</div>,
    renderLiveHeadRow: (item) => <div>{item.id}</div>,
    renderLiveAuxiliary: () => null,
  };
}

interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * jsdom has no layout, so the scroll box is modelled by hand, including the
 * clamping. These cases turn on telling the app's own writes apart from the
 * browser dragging scrollTop down as the document shrinks, and a stub that lets
 * scrollTop sit past its maximum cannot express that difference at all.
 */
function installScrollBox(element: HTMLElement, initial: ScrollBox): ScrollBox {
  const state = { ...initial };
  const clamp = () => {
    state.scrollTop = Math.max(
      0,
      Math.min(state.scrollTop, state.scrollHeight - state.clientHeight),
    );
  };
  clamp();
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => state.scrollTop,
    set: (value: number) => {
      state.scrollTop = value;
      clamp();
    },
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => state.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => state.clientHeight,
  });
  return {
    get scrollTop() {
      return state.scrollTop;
    },
    set scrollTop(value: number) {
      state.scrollTop = value;
      clamp();
    },
    get scrollHeight() {
      return state.scrollHeight;
    },
    set scrollHeight(value: number) {
      state.scrollHeight = value;
      clamp();
    },
    get clientHeight() {
      return state.clientHeight;
    },
    set clientHeight(value: number) {
      state.clientHeight = value;
      clamp();
    },
  };
}

function installWritingScrollTo(): ReturnType<typeof vi.fn> {
  const scrollTo = vi.fn(function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop = typeof options === "object" ? (options.top ?? 0) : (y ?? 0);
  });
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
  return scrollTo;
}

describe("createWebStreamStrategy", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let originalScrollTo: HTMLElement["scrollTo"] | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let originalGetBoundingClientRect: PropertyDescriptor | undefined;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      configurable: true,
    });
    originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = vi.fn();
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 24;
      },
    });
    originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );
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
    if (originalScrollTo) {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
    }
    if (originalGetBoundingClientRect) {
      Object.defineProperty(
        HTMLElement.prototype,
        "getBoundingClientRect",
        originalGetBoundingClientRect,
      );
    } else {
      // jsdom defines it on Element, not HTMLElement, so there is nothing to put
      // back, so the override has to be removed or it leaks into the next case.
      Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
    }
    vi.restoreAllMocks();
  });

  it("mounts virtualized history without recursive row measurement updates", () => {
    const rowRenderCount = vi.fn();
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyVirtualized = Array.from({ length: 16 }, (_, index) => userMessage(index));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <>
          {strategy.render({
            agentId: "agent",
            segments: {
              historyVirtualized,
              historyMounted: [],
              liveHead: [],
            },
            boundary: {
              hasVirtualizedHistory: true,
              hasMountedHistory: false,
              hasLiveHead: false,
            },
            renderers: createRenderers(rowRenderCount),
            listEmptyComponent: null,
            viewportRef,
            routeBottomAnchorRequest: null,
            isAuthoritativeHistoryReady: true,
            onNearBottomChange: vi.fn(),
            onNearHistoryStart: vi.fn(),
            isLoadingOlderHistory: false,
            hasOlderHistory: false,
            scrollEnabled: true,
            listStyle: null,
            baseListContentContainerStyle: null,
            forwardListContentContainerStyle: null,
          })}
        </>,
      );
    });

    expect(rowRenderCount.mock.calls.length).toBeGreaterThan(0);
    expect(rowRenderCount.mock.calls.length).toBeLessThanOrEqual(historyVirtualized.length);
  });

  it("fires near-history-start when the user scrolls near the top", async () => {
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const onNearHistoryStart = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <>
          {strategy.render({
            agentId: "agent",
            segments: {
              historyVirtualized: [],
              historyMounted: [userMessage(1), userMessage(2)],
              liveHead: [],
            },
            boundary: {
              hasVirtualizedHistory: false,
              hasMountedHistory: true,
              hasLiveHead: false,
            },
            renderers: createRenderers(vi.fn()),
            listEmptyComponent: null,
            viewportRef,
            routeBottomAnchorRequest: null,
            isAuthoritativeHistoryReady: true,
            onNearBottomChange: vi.fn(),
            onNearHistoryStart,
            isLoadingOlderHistory: false,
            hasOlderHistory: true,
            scrollEnabled: true,
            listStyle: null,
            baseListContentContainerStyle: null,
            forwardListContentContainerStyle: null,
          })}
        </>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    Object.defineProperty(scrollContainer, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 64 });

    act(() => {
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });

    expect(onNearHistoryStart).toHaveBeenCalledTimes(1);
  });

  it("keeps initial route entry anchored when delayed route readiness arrives before user scroll", async () => {
    const scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const top = typeof options === "object" ? (options.top ?? 0) : (y ?? 0);
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: top,
      });
    });
    HTMLElement.prototype.scrollTo = scrollTo;

    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const routeBottomAnchorRequest = {
      agentId: "agent",
      reason: "initial-entry" as const,
      requestKey: "server:agent:initial-entry",
    };
    const renderInput = {
      agentId: "agent",
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: false,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: {
            historyVirtualized: [],
            historyMounted: [],
            liveHead: [],
          },
          isAuthoritativeHistoryReady: false,
        }),
      );
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    const scrollElement = scrollContainer;
    Object.defineProperty(scrollElement, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollElement, "scrollHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollElement, "scrollTop", { configurable: true, value: 0 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    scrollTo.mockClear();

    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    Object.defineProperty(scrollElement, "scrollHeight", { configurable: true, value: 1400 });
    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: {
            historyVirtualized: [],
            historyMounted,
            liveHead: [],
          },
          boundary: {
            hasVirtualizedHistory: false,
            hasMountedHistory: true,
            hasLiveHead: false,
          },
          isAuthoritativeHistoryReady: true,
        }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scrollTo).toHaveBeenCalled();
    expect(scrollElement.scrollTop).toBe(1400);
  });

  it("does not force bottom on delayed route readiness after the user scrolls away", async () => {
    const scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const top = typeof options === "object" ? (options.top ?? 0) : (y ?? 0);
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: top,
      });
    });
    HTMLElement.prototype.scrollTo = scrollTo;

    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    const routeBottomAnchorRequest = {
      agentId: "agent",
      reason: "initial-entry" as const,
      requestKey: "server:agent:initial-entry",
    };
    const renderInput = {
      agentId: "agent",
      segments: {
        historyVirtualized: [],
        historyMounted,
        liveHead: [],
      },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          isAuthoritativeHistoryReady: false,
        }),
      );
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    Object.defineProperty(scrollContainer, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 1400 });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 1000 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();

    act(() => {
      scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: -240 }));
    });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 520 });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          isAuthoritativeHistoryReady: true,
        }),
      );
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not force bottom after upward wheel when cached scroll top is stale", async () => {
    const scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const top = typeof options === "object" ? (options.top ?? 0) : (y ?? 0);
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: top,
      });
    });
    HTMLElement.prototype.scrollTo = scrollTo;

    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    const routeBottomAnchorRequest = {
      agentId: "agent",
      reason: "initial-entry" as const,
      requestKey: "server:agent:initial-entry",
    };
    const renderInput = {
      agentId: "agent",
      segments: {
        historyVirtualized: [],
        historyMounted,
        liveHead: [],
      },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          isAuthoritativeHistoryReady: false,
        }),
      );
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    Object.defineProperty(scrollContainer, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 1491 });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 0 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();

    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 991 });
    act(() => {
      scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: -900 }));
    });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 91 });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 0 });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 2531 });
    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          isAuthoritativeHistoryReady: true,
        }),
      );
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("detaches on a bare upward scroll, as the overlay scrollbar thumb produces", async () => {
    const scrollTo = installWritingScrollTo();
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    const renderInput = {
      agentId: "agent",
      segments: { historyVirtualized: [], historyMounted, liveHead: [] },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest: null,
      isAuthoritativeHistoryReady: true,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(strategy.render(renderInput));
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    const metrics = installScrollBox(scrollContainer, {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();

    // Dragging the overlay scrollbar writes scrollTop from a different element:
    // no wheel, no pointerdown, no touchmove ever reaches the scroll container.
    metrics.scrollTop = 900;
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    // A stream flush arrives while the reader is up there.
    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: { ...renderInput.segments, liveHead: [userMessage(20)] },
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scrollTo).not.toHaveBeenCalled();
    expect(metrics.scrollTop).toBe(900);
  });

  it("keeps following when a shrinking document clamps scrollTop", async () => {
    const scrollTo = installWritingScrollTo();
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    const renderInput = {
      agentId: "agent",
      segments: { historyVirtualized: [], historyMounted, liveHead: [] },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest: null,
      isAuthoritativeHistoryReady: true,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(strategy.render(renderInput));
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    const metrics = installScrollBox(scrollContainer, {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(metrics.scrollTop).toBe(1600);
    scrollTo.mockClear();

    // A run of tool calls folds into one group: the document loses 600px and the
    // browser drags scrollTop down with it. That is not the reader scrolling up.
    metrics.scrollHeight = 1400;
    expect(metrics.scrollTop).toBe(1000);
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: { ...renderInput.segments, liveHead: [userMessage(20)] },
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  it("holds the reader's row still when content above it changes height", async () => {
    installWritingScrollTo();
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const historyMounted = Array.from({ length: 20 }, (_, index) => userMessage(index));
    const renderInput = {
      agentId: "agent",
      segments: { historyVirtualized: [], historyMounted, liveHead: [] },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest: null,
      isAuthoritativeHistoryReady: true,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(strategy.render(renderInput));
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    const metrics = installScrollBox(scrollContainer, {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
    });

    // Every row is 100px tall and stacked in id order. `contentShiftPx` is how
    // much taller everything above the transcript has just become.
    let contentShiftPx = 0;
    const ROW_HEIGHT_PX = 100;
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement): DOMRect {
        if (this === scrollContainer) {
          return { top: 0, height: metrics.clientHeight } as DOMRect;
        }
        const rowIndex = Number(this.textContent?.replace("message-", "") ?? "0");
        return {
          top: contentShiftPx + rowIndex * ROW_HEIGHT_PX - metrics.scrollTop,
          height: ROW_HEIGHT_PX,
        } as DOMRect;
      },
    });

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    // The reader drags up. message-5 lands exactly at the top of the viewport.
    metrics.scrollTop = 500;
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    // Now everything above them grows by 300px: older history splicing in, a
    // collapsed group unfolding, a code block finishing its highlight pass.
    contentShiftPx = 300;
    metrics.scrollHeight = 2300;
    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: { ...renderInput.segments, liveHead: [userMessage(20)] },
        }),
      );
    });

    // Compensated exactly: message-5 is still pinned to the top of the viewport.
    expect(metrics.scrollTop).toBe(800);
  });

  it("reattaches follow-output when a small scroll range returns to bottom", async () => {
    const scrollTo = vi.fn(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      const top = typeof options === "object" ? (options.top ?? 0) : (y ?? 0);
      Object.defineProperty(this, "scrollTop", {
        configurable: true,
        value: top,
      });
    });
    HTMLElement.prototype.scrollTo = scrollTo;

    const strategy = createWebStreamStrategy({ isMobileBreakpoint: true });
    const viewportRef = React.createRef<StreamViewportHandle>();
    const renderInput = {
      agentId: "agent",
      segments: {
        historyVirtualized: [],
        historyMounted: [userMessage(1), userMessage(2)],
        liveHead: [],
      },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: true,
        hasLiveHead: false,
      },
      renderers: createRenderers(vi.fn()),
      listEmptyComponent: null,
      viewportRef,
      routeBottomAnchorRequest: null,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          isAuthoritativeHistoryReady: true,
        }),
      );
    });

    const scrollContainer = container.querySelector('[data-testid="agent-chat-scroll"]');
    if (!(scrollContainer instanceof HTMLElement)) {
      throw new Error("Expected agent chat scroll container");
    }
    Object.defineProperty(scrollContainer, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(scrollContainer, "scrollHeight", { configurable: true, value: 550 });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 50 });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();

    act(() => {
      scrollContainer.dispatchEvent(new WheelEvent("wheel", { deltaY: -30 }));
    });
    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 20 });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(scrollContainer, "scrollTop", { configurable: true, value: 50 });
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });
    scrollTo.mockClear();

    act(() => {
      root?.render(
        strategy.render({
          ...renderInput,
          segments: {
            ...renderInput.segments,
            liveHead: [userMessage(3)],
          },
          isAuthoritativeHistoryReady: true,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(scrollTo).toHaveBeenCalled();
  });
});
