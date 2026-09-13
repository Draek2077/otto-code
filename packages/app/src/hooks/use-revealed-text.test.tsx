/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRevealedText } from "./use-revealed-text";

let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;

function Transcript({ text, active }: { text: string; active: boolean }) {
  return <span>{useRevealedText(text, "streaming", active)}</span>;
}

beforeEach(() => {
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("paces visible additions, cancels hidden work, and resumes at the latest snapshot", () => {
  act(() => root.render(<Transcript text="First" active />));
  act(() => root.render(<Transcript text="First visible addition" active />));
  expect(container.textContent).toBe("First");
  expect(frames.size).toBe(1);

  act(() => root.render(<Transcript text="First visible addition" active={false} />));
  expect(frames.size).toBe(0);
  expect(container.textContent).toBe("First visible addition");

  act(() => root.render(<Transcript text="First visible addition plus hidden output" active />));
  expect(container.textContent).toBe("First visible addition plus hidden output");
  expect(frames.size).toBe(0);

  act(() =>
    root.render(
      <Transcript text="First visible addition plus hidden output and live text" active />,
    ),
  );
  expect(container.textContent).toBe("First visible addition plus hidden output");
  expect(frames.size).toBe(1);
});
