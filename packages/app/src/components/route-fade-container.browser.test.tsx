import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { KeyedFadeContainer } from "./route-fade-container";

vi.mock("@/hooks/use-animations-enabled", () => ({ useAnimationsEnabled: () => true }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.getElementById("overlay-root")?.remove();
  root = undefined;
  container = undefined;
});

it("places the route veil above resident browser surfaces", async () => {
  container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:40px;top:30px;width:320px;height:240px;display:flex";
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <KeyedFadeContainer transitionKey="workspace-a">
        <div>Workspace content</div>
      </KeyedFadeContainer>,
    );
  });

  const veil = document.querySelector<HTMLElement>('[data-testid="route-fade-veil"]');
  expect(veil).not.toBeNull();
  const overlaySurface = veil?.parentElement;
  const overlayRoot = document.getElementById("overlay-root");
  expect(overlaySurface?.parentElement).toBe(overlayRoot);

  const browserHost = document.createElement("div");
  browserHost.style.position = "fixed";
  browserHost.style.zIndex = "0";
  document.body.appendChild(browserHost);

  await expect.poll(() => overlaySurface?.getBoundingClientRect().width).toBe(320);
  expect(overlaySurface?.getBoundingClientRect()).toMatchObject({
    left: 40,
    top: 30,
    width: 320,
    height: 240,
  });
  expect(Number(overlayRoot?.style.zIndex)).toBeGreaterThan(Number(browserHost.style.zIndex));

  act(() => {
    root?.render(
      <KeyedFadeContainer transitionKey="workspace-b" ready={false}>
        <div>Incoming workspace content</div>
      </KeyedFadeContainer>,
    );
  });
  expect(veil?.style.opacity).toBe("1");

  browserHost.remove();
});
