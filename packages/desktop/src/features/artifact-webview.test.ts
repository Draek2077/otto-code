import type { WebContents, WebPreferences } from "electron";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_WEBVIEW_PARTITION,
  hardenArtifactWebviewPreferences,
  isArtifactWebviewAttach,
  lockDownArtifactWebviewContents,
} from "./artifact-webview";

describe("artifact Electron preview boundary", () => {
  it("accepts only its private self-contained data document", () => {
    expect(
      isArtifactWebviewAttach({
        partition: ARTIFACT_WEBVIEW_PARTITION,
        src: "data:text/html;charset=utf-8,%3Chtml%3E%3C%2Fhtml%3E",
      }),
    ).toBe(true);
    expect(
      isArtifactWebviewAttach({
        partition: ARTIFACT_WEBVIEW_PARTITION,
        src: "https://example.test",
      }),
    ).toBe(false);
    expect(
      isArtifactWebviewAttach({ partition: "otto-browser-preview", src: "data:text/html,x" }),
    ).toBe(false);
  });

  it("removes renderer-controlled privilege and blocks all guest navigation", () => {
    const preferences = {
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      webviewTag: true,
      allowRunningInsecureContent: true,
      preload: "/untrusted-preload.js",
      preloadURL: "file:///untrusted-preload.js",
    } as unknown as WebPreferences;
    hardenArtifactWebviewPreferences(preferences);

    expect(preferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    });
    expect(preferences).not.toHaveProperty("preload");
    expect(preferences).not.toHaveProperty("preloadURL");

    let windowOpenHandler: (() => { action: string }) | undefined;
    const navigationHandlers = new Map<string, (event: { preventDefault: () => void }) => void>();
    const contents = {
      setWindowOpenHandler(handler: () => { action: string }) {
        windowOpenHandler = handler;
      },
      on(event: string, handler: (navigationEvent: { preventDefault: () => void }) => void) {
        navigationHandlers.set(event, handler);
      },
    } as unknown as WebContents;

    lockDownArtifactWebviewContents(contents);

    expect(windowOpenHandler?.()).toEqual({ action: "deny" });
    for (const eventName of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
      const preventDefault = () => calls.push(eventName);
      const calls: string[] = [];
      navigationHandlers.get(eventName)?.({ preventDefault });
      expect(calls).toEqual([eventName]);
    }
  });
});
