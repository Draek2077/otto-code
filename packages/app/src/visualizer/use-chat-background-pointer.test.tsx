/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View } from "react-native";
import { useChatBackgroundPointer } from "./use-chat-background-pointer.web";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.useRealTimers();
});

function setup() {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-testid="chat-visualizer-background"></div><div id="foreground"><div id="empty"></div><div data-chat-visualizer-content>Read this text</div><button>Copy</button><a href="#">File</a><span>Status text</span></div><div data-testid="chat-visualizer-composer"><div id="composer-gutter"></div><textarea></textarea></div>';
  document.body.append(root);
  const foreground = root.querySelector<HTMLElement>("#foreground")!;
  const empty = root.querySelector<HTMLElement>("#empty")!;
  const content = root.querySelector<HTMLElement>("[data-chat-visualizer-content]")!;
  root.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 400,
    width: 400,
    height: 400,
    toJSON: () => ({}),
  });
  const hitTest = vi.fn<(x: number, y: number) => Element | null>(() => empty);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  const onPeek = vi.fn();
  const onToggle = vi.fn();
  const onRestore = vi.fn();
  const rootRef = { current: root as unknown as View };
  const foregroundRef = { current: foreground as unknown as View };
  const hook = renderHook(
    ({ enabled, hidden }) =>
      useChatBackgroundPointer({
        rootRef,
        foregroundRef,
        enabled,
        hidden,
        onPeek,
        onToggle,
        onRestore,
      }),
    { initialProps: { enabled: true, hidden: false } },
  );
  const event = (target: Element, type: string, x = 100, y = 100) =>
    act(() => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, "pointerType", { value: "mouse" });
      target.dispatchEvent(e);
    });
  const click = (target: Element) => {
    event(target, "pointerdown");
    event(target, "click");
  };
  const advance = (ms = 200) => act(() => vi.advanceTimersByTime(ms));
  return {
    root,
    foreground,
    empty,
    content,
    onPeek,
    onToggle,
    onRestore,
    hook,
    event,
    click,
    hitTest,
    advance,
  };
}

describe("chat visualizer background gestures", () => {
  it("peeks and toggles only on empty space, leaving bubbles, links and buttons alone", () => {
    const s = setup();
    s.event(s.empty, "pointermove");
    s.advance();
    expect(s.onPeek).toHaveBeenLastCalledWith(true);
    for (const target of [
      s.content,
      s.root.querySelector("button")!,
      s.root.querySelector("a")!,
      s.root.querySelector("span")!,
    ]) {
      s.event(target, "pointermove");
      expect(s.onPeek).toHaveBeenLastCalledWith(false);
      s.click(target);
    }
    expect(s.onToggle).not.toHaveBeenCalled();
    s.click(s.empty);
    expect(s.onToggle).toHaveBeenCalledTimes(1);
  });

  it("clears the hover hint throughout the Composer, including its empty gutter", () => {
    const s = setup();
    const composer = s.root.querySelector('[data-testid="chat-visualizer-composer"]')!;
    for (const target of [
      composer,
      composer.querySelector("div")!,
      composer.querySelector("textarea")!,
    ]) {
      s.event(s.empty, "pointermove");
      s.advance();
      expect(s.onPeek).toHaveBeenLastCalledWith(true);
      s.event(target, "pointermove");
      expect(s.onPeek).toHaveBeenLastCalledWith(false);
      s.click(target);
    }
    expect(s.onToggle).not.toHaveBeenCalled();
    s.event(s.empty, "pointermove");
    s.advance();
    expect(s.onPeek).toHaveBeenLastCalledWith(true);
  });

  it("waits for a pause, ignores tiny jitter, and keeps peeking while moving within open space", () => {
    const s = setup();
    s.event(s.empty, "pointermove");
    s.advance(100);
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
    expect(s.hitTest).not.toHaveBeenCalled();
    s.event(s.empty, "pointermove", 120, 100);
    s.advance(100);
    s.event(s.empty, "pointermove", 122, 101);
    s.advance(99);
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
    s.advance(1);
    expect(s.onPeek).toHaveBeenLastCalledWith(true);
    s.onPeek.mockClear();
    s.event(s.empty, "pointermove", 180, 100);
    expect(s.onPeek).not.toHaveBeenCalledWith(false);
    s.event(s.content, "pointermove");
    expect(s.onPeek).toHaveBeenLastCalledWith(false);
  });

  it("rejects short vertical gaps but permits a 10px clearance and narrow side gutters", () => {
    const s = setup();
    s.hitTest.mockImplementation((_x, y) => (y <= 92 || y >= 108 ? s.content : s.empty));
    s.event(s.empty, "pointermove");
    s.advance(1000);
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
    // A message immediately beside the left gutter must not block its hint.
    s.hitTest.mockImplementation((x) => (x >= 8 ? s.content : s.empty));
    s.event(s.empty, "pointermove", 3, 100);
    s.advance();
    expect(s.onPeek).toHaveBeenLastCalledWith(true);
    s.event(s.content, "pointermove");
    s.onPeek.mockClear();
    // Twenty pixels of vertical space is enough; the previous 48px rule is gone.
    s.hitTest.mockImplementation((_x, y) => (y < 190 || y > 210 ? s.content : s.empty));
    s.event(s.empty, "pointermove", 200, 200);
    s.advance();
    expect(s.onPeek).toHaveBeenLastCalledWith(true);
  });

  it.each(["pointerleave", "pointercancel", "pointerdown", "scroll"])(
    "cancels a pending hover on %s",
    (type) => {
      const s = setup();
      s.event(s.empty, "pointermove");
      s.advance(100);
      s.event(s.root, type);
      s.advance(1000);
      expect(s.onPeek).not.toHaveBeenCalledWith(true);
    },
  );

  it("cancels a transient gap crossing, rechecks newly arrived content, and clears timers on disable", () => {
    const s = setup();
    s.event(s.empty, "pointermove");
    s.advance(100);
    s.event(s.content, "pointermove");
    s.advance(1000);
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
    s.event(s.empty, "pointermove");
    s.hitTest.mockReturnValue(s.content);
    s.advance();
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
    s.hitTest.mockReturnValue(s.empty);
    s.event(s.empty, "pointermove");
    s.hook.rerender({ enabled: false, hidden: false });
    s.advance(1000);
    expect(s.onPeek).not.toHaveBeenCalledWith(true);
  });

  it("does not hide after a drag, a scrollbar gesture, or a click clearing text selection", () => {
    const s = setup();
    s.event(s.empty, "pointerdown");
    s.event(s.empty, "pointermove", 60);
    s.event(s.empty, "click");
    const range = document.createRange();
    range.selectNodeContents(s.content);
    document.getSelection()!.addRange(range);
    s.event(s.empty, "pointerdown");
    document.getSelection()!.removeAllRanges();
    s.event(s.empty, "click");
    s.empty.dataset.testid = "agent-chat-scroll";
    s.empty.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    s.event(s.empty, "pointerdown", 95);
    s.event(s.empty, "click", 95);
    expect(s.onToggle).not.toHaveBeenCalled();
  });

  it("keeps hidden content mounted but inert, restores with Escape and cleans up on disable", () => {
    const s = setup();
    s.hook.rerender({ enabled: true, hidden: true });
    expect(
      s.root.querySelector<HTMLElement>('[data-testid="chat-visualizer-background"]')!.inert,
    ).toBe(true);
    expect(s.foreground.inert).toBe(true);
    expect(s.content.isConnected).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(s.onRestore).toHaveBeenCalledTimes(1);
    s.hook.rerender({ enabled: false, hidden: true });
    expect(s.foreground.inert).toBe(false);
    s.click(s.empty);
    expect(s.onToggle).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(s.onRestore).toHaveBeenCalledTimes(1);
  });
});
