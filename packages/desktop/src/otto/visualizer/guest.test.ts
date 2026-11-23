import { expect, it } from "vitest";
import type { WebPreferences } from "electron";
import { hardenVisualizerPreferences, isVisualizerAttach, visualizerAllowsRequest } from "./guest";

it("accepts only the private in-memory Visualizer guest", () => {
  expect(
    isVisualizerAttach({ partition: "otto-visualizer", src: "data:text/html;charset=utf-8,hello" }),
  ).toBe(true);
  for (const input of [
    { partition: "persist:otto-visualizer", src: "data:text/html;charset=utf-8,hello" },
    { partition: "otto-visualizer", src: "https://example.test" },
    { partition: "otto-visualizer", src: "data:text/html;charset=utf-8," + "a".repeat(4_000_000) },
  ])
    expect(isVisualizerAttach(input)).toBe(false);
});
it("removes inherited app preloads and Node capabilities", () => {
  const preferences: WebPreferences = {
    preload: "/app/preload.js",
    nodeIntegration: true,
    nodeIntegrationInWorker: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
    webviewTag: true,
    allowRunningInsecureContent: true,
  };
  const params = { preload: "/app/browser-preload.js" };
  hardenVisualizerPreferences(preferences, params);
  expect(preferences).toEqual({
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
    backgroundThrottling: true,
  });
  expect(params).toEqual({});
});
it("allows embedded assets while refusing host, filesystem and external requests", () => {
  expect(visualizerAllowsRequest("data:font/woff2;base64,abc")).toBe(true);
  expect(visualizerAllowsRequest("about:blank")).toBe(true);
  for (const url of [
    "https://example.test",
    "http://127.0.0.1:6868",
    "file:///home/user",
    "javascript:alert(1)",
    "about:blank?target=outside",
  ]) {
    expect(visualizerAllowsRequest(url)).toBe(false);
  }
});
