import React, { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { Pressable } from "react-native";
import { userEvent } from "vitest/browser";
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

/**
 * Chromium empties a DataTransfer that no real copy filled, so the payload is
 * the one part of a paste a test has to stand in for. Everything else - the
 * dispatch, React's listener, the handler - is the real thing.
 */
function firePaste(element: Element, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  element.dispatchEvent(event);
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

  it("draws a picture that arrived as bytes", async () => {
    const ref = createRef<RemoteBrowserFrameHandle>();
    const screen = render(<RemoteBrowserFrame ref={ref} width={8} height={8} />);
    const canvas = screen.container.querySelector("canvas")!;
    const bytes = Uint8Array.from(atob(jpeg("red")), (character) => character.charCodeAt(0));

    await act(async () => {
      await ref.current!.present(bytes);
    });
    expect(pixel(canvas)[0]).toBeGreaterThan(200);
    expect(pixel(canvas)[2]).toBeLessThan(100);
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

  it("forwards a right click at the canvas point without a local menu or focus border", () => {
    const onContextMenu = vi.fn();
    const screen = render(
      <RemoteBrowserFrame width={80} height={80} onContextMenu={onContextMenu} />,
    );
    const canvas = screen.container.querySelector("canvas")!;
    const bounds = canvas.getBoundingClientRect();
    const event = new MouseEvent("contextmenu", {
      button: 2,
      clientX: bounds.left + 20,
      clientY: bounds.top + 30,
      bubbles: true,
      cancelable: true,
    });

    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onContextMenu).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(canvas.style.outline).toBe("none");
  });

  it("puts the viewer's clipboard into the page rather than pressing the chord on the host", () => {
    const onKeyInput = vi.fn();
    const onPasteText = vi.fn();
    const screen = render(
      <RemoteBrowserFrame width={8} height={8} onKeyInput={onKeyInput} onPasteText={onPasteText} />,
    );
    const canvas = screen.container.querySelector("canvas")!;

    const chord = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(chord);
    firePaste(canvas, "pasted text");

    // Forwarding the chord would paste whatever the host's own Chromium holds.
    expect(onKeyInput).not.toHaveBeenCalled();
    // The default must survive keydown, or the browser raises no paste at all.
    expect(chord.defaultPrevented).toBe(false);
    expect(onPasteText).toHaveBeenCalledWith("pasted text");
  });

  it("pastes through a real shortcut after clicking the hosted page", async () => {
    const onPasteText = vi.fn();
    const onPress = vi.fn();
    const screen = render(
      <>
        <textarea defaultValue="real clipboard text" />
        <Pressable onPress={onPress}>
          <RemoteBrowserFrame width={80} height={80} onPasteText={onPasteText} />
        </Pressable>
      </>,
    );
    const canvas = screen.container.querySelector("canvas")!;

    await userEvent.click(screen.container.querySelector("textarea")!);
    await userEvent.keyboard("{Control>}a{/Control}");
    await userEvent.copy();
    await userEvent.click(canvas);
    expect(document.activeElement).toBe(canvas);
    await userEvent.paste();

    expect(onPasteText).toHaveBeenCalledWith("real clipboard text");
  });

  it("ignores a paste that carries no text", () => {
    const onPasteText = vi.fn();
    const screen = render(<RemoteBrowserFrame width={8} height={8} onPasteText={onPasteText} />);

    firePaste(screen.container.querySelector("canvas")!, "");

    expect(onPasteText).not.toHaveBeenCalled();
  });
});
