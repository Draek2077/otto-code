import React, { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RemoteBrowserFrameHandle } from "./remote-browser-frame";
import { RemoteBrowserFrame } from "./remote-browser-frame.web";

function jpeg(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 8, 8);
  return canvas.toDataURL("image/jpeg").split(",")[1]!;
}

function pixel(canvas: HTMLCanvasElement): number[] {
  return [...canvas.getContext("2d")!.getImageData(4, 4, 1, 1).data];
}

describe("hosted browser canvas", () => {
  it("keeps the old page frame painted until the replacement is decoded", async () => {
    const ref = createRef<RemoteBrowserFrameHandle>();
    const screen = render(<RemoteBrowserFrame ref={ref} width={8} height={8} />);
    const canvas = screen.container.querySelector("canvas")!;
    const red = jpeg("red");
    const green = jpeg("green");

    await act(async () => {
      await ref.current!.present(red);
    });
    expect(pixel(canvas)[0]).toBeGreaterThan(200);

    const nextFrame = ref.current!.present(green);
    expect(pixel(canvas)[0]).toBeGreaterThan(200);
    await act(async () => {
      await nextFrame;
    });
    expect(pixel(canvas)[1]).toBeGreaterThan(100);
    expect(pixel(canvas)[0]).toBeLessThan(100);
  });

  it("routes desktop wheel and keyboard input into the hosted page", () => {
    const onWheel = vi.fn();
    const onKeyInput = vi.fn();
    const screen = render(
      <RemoteBrowserFrame width={8} height={8} onWheel={onWheel} onKeyInput={onKeyInput} />,
    );
    const canvas = screen.container.querySelector("canvas")!;

    fireEvent.wheel(canvas, { deltaX: 3, deltaY: 42 });
    fireEvent.keyDown(canvas, { key: "a" });
    fireEvent.keyDown(canvas, { key: "Backspace" });
    expect(onWheel).toHaveBeenCalledWith(3, 42);
    expect(onKeyInput).toHaveBeenNthCalledWith(1, "a", "text");
    expect(onKeyInput).toHaveBeenNthCalledWith(2, "Backspace", "key");
  });
});
