import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWidgetPreloadPath, isWidgetWebviewAttach } from "./widget-webview";

describe("isWidgetWebviewAttach", () => {
  it("matches only the widget partition on a data: document", () => {
    expect(
      isWidgetWebviewAttach({
        partition: "otto-widget-preview",
        src: "data:text/html;charset=utf-8,x",
      }),
    ).toBe(true);
    expect(
      isWidgetWebviewAttach({ partition: "otto-artifact-preview", src: "data:text/html,x" }),
    ).toBe(false);
    expect(isWidgetWebviewAttach({ partition: "otto-widget-preview", src: "https://x" })).toBe(
      false,
    );
  });
});

describe("getWidgetPreloadPath", () => {
  // Regression: the path used to resolve against this module's own directory,
  // which is dist/features/ once compiled - one level below where
  // src/widget-preload.ts is emitted. Electron ignores a missing preload
  // silently, so the only symptom was every widget stuck at its initial height.
  it("resolves to a sibling of the preload source, not into this module's directory", () => {
    const resolved = getWidgetPreloadPath();

    expect(path.basename(resolved)).toBe("widget-preload.js");
    expect(path.dirname(resolved)).toBe(path.resolve(__dirname, ".."));
    // The emitted .js sits wherever the .ts sits; assert against the source so
    // the test holds without a build step.
    expect(existsSync(path.join(path.dirname(resolved), "widget-preload.ts"))).toBe(true);
  });
});
