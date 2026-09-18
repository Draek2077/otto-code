/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rebasePipFractionForContainer,
  resolvePipOffset,
  useVisualizerPipDrag,
} from "./use-visualizer-pip-drag";

afterEach(cleanup);

describe("rebasePipFractionForContainer", () => {
  const pip = { width: 200, height: 150 };
  const previousContainer = { width: 1000, height: 800 };
  const nextContainer = { width: 1500, height: 1000 };

  it("keeps a left/top PIP inset from those edges", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer,
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 0.25, y: 0.2 },
    });

    expect(resolvePipOffset({ container: nextContainer, pip, fraction })).toEqual({
      left: 200,
      top: 130,
    });
  });

  it("keeps a right/bottom PIP inset from those edges", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer,
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 0.75, y: 0.8 },
    });

    expect(resolvePipOffset({ container: nextContainer, pip, fraction })).toEqual({
      left: 1100,
      top: 720,
    });
  });

  it("clamps to the visible edge when the window becomes too small", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer: { width: 160, height: 100 },
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 1, y: 1 },
    });

    expect(fraction).toEqual({ x: 0, y: 0 });
  });
});

function pointerEvent(type: string, x: number, y: number): MouseEvent {
  const event = new MouseEvent(type, { clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function startDrag(
  handler: NonNullable<ReturnType<typeof useVisualizerPipDrag>["handlers"]["onPointerDown"]>,
) {
  handler({
    currentTarget: null,
    nativeEvent: { pointerId: 1, clientX: 300, clientY: 200 },
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as Parameters<typeof handler>[0]);
}

describe("PIP drag lifecycle", () => {
  const pip = { width: 200, height: 150 };
  const fraction = { x: 0.25, y: 0.2 };

  it("resolves the saved position on first measurement without rebasing from zero", () => {
    const { result, rerender } = renderHook(
      ({ container }) => useVisualizerPipDrag({ container, pip, fraction, onCommit: () => {} }),
      { initialProps: { container: { width: 0, height: 0 } } },
    );
    rerender({ container: { width: 1000, height: 800 } });
    expect(result.current.offset).toEqual({ left: 200, top: 130 });
  });

  it("starts at the displayed position after resizing and retains the drop while saving", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ container }) => useVisualizerPipDrag({ container, pip, fraction, onCommit }),
      { initialProps: { container: { width: 1000, height: 800 } } },
    );
    rerender({ container: { width: 1500, height: 1000 } });
    expect(result.current.offset).toEqual({ left: 200, top: 130 });
    act(() => startDrag(result.current.handlers.onPointerDown!));
    expect(result.current.offset).toEqual({ left: 200, top: 130 });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 350, 250));
    });
    expect(result.current.offset).toEqual({ left: 250, top: 180 });
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 350, 250));
    });
    expect(result.current.dragging).toBe(false);
    expect(result.current.offset).toEqual({ left: 250, top: 180 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ x: 250 / 1300, y: 180 / 850 });
  });

  it("removes window listeners when switching away during a drag", () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVisualizerPipDrag({ container: { width: 1000, height: 800 }, pip, fraction, onCommit }),
    );
    act(() => startDrag(result.current.handlers.onPointerDown!));
    unmount();
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 350, 250));
      window.dispatchEvent(pointerEvent("pointerup", 350, 250));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
