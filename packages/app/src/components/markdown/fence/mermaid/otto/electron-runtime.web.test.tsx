/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ElectronMermaidRuntime } from "./electron-runtime.web";
import type { MermaidRenderRequest } from "../render-model";

let container: HTMLDivElement;
let root: Root;
const NativeURL = URL;
const createObjectURL = vi.fn(() => "blob:diagram");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const request: MermaidRenderRequest = {
  revision: 1,
  source: "graph TD\nA-->B",
  colorScheme: "dark",
  themeKey: "otto-obsidian",
  themeVariables: { primaryColor: "#222222" },
};

function guestMessage(guest: Element, value: unknown) {
  const event = new Event("console-message");
  Object.defineProperty(event, "message", { value: `__OTTO_MERMAID__${JSON.stringify(value)}` });
  guest.dispatchEvent(event);
}

const fullscreenRequest = { ...request, themeKey: "otto-daylight" };

it("keeps inline and fullscreen guest requests, theme palettes, and artifacts isolated", async () => {
  const inlineRendered = vi.fn();
  const fullscreenRendered = vi.fn();
  const failed = vi.fn();
  act(() =>
    root.render(
      <>
        <ElectronMermaidRuntime
          request={request}
          runtimeHtml="<html>runtime</html>"
          onRendered={inlineRendered}
          onRenderFailed={failed}
        />
        <ElectronMermaidRuntime
          request={fullscreenRequest}
          runtimeHtml="<html>runtime</html>"
          onRendered={fullscreenRendered}
          onRenderFailed={failed}
        />
      </>,
    ),
  );
  const guests = Array.from(container.querySelectorAll("webview"));
  expect(guests).toHaveLength(2);
  const execute = guests.map((guest) => {
    expect(guest.getAttribute("partition")).toBe("otto-mermaid-runtime");
    const call = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(guest, "executeJavaScript", { value: call });
    return call;
  });
  await act(async () => {
    for (const guest of guests) guest.dispatchEvent(new Event("dom-ready"));
  });
  act(() => {
    for (const guest of guests) guestMessage(guest, { type: "bridgeReady" });
  });
  expect(execute[0]!.mock.calls.at(-1)?.[0]).toContain('"themeKey":"otto-obsidian"');
  expect(execute[1]!.mock.calls.at(-1)?.[0]).toContain('"themeKey":"otto-daylight"');
  expect(execute[0]!.mock.calls.at(-1)?.[0]).toContain(
    '"themeVariables":{"primaryColor":"#222222"}',
  );
  act(() =>
    guestMessage(guests[0]!, {
      type: "rendered",
      ...request,
      width: 100,
      height: 80,
      svg: '<svg viewBox="0 0 100 80"/>',
    }),
  );
  expect(inlineRendered).toHaveBeenCalledOnce();
  expect(fullscreenRendered).not.toHaveBeenCalled();
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(failed).not.toHaveBeenCalled();
  act(() => root.render(null));
  expect(container.querySelector("webview")).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagram");
  act(() => guestMessage(guests[0]!, { type: "renderError", revision: 1 }));
  expect(failed).not.toHaveBeenCalled();
});
