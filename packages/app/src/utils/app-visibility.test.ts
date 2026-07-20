import { afterEach, describe, expect, it } from "vitest";
import { getIsAppActivelyVisible, getIsAppInForeground } from "./app-visibility";

function stubDocument(input: { visibilityState: string; hasFocus: boolean }): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: input.visibilityState,
      hasFocus: () => input.hasFocus,
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

describe("getIsAppInForeground", () => {
  it("is false while the app is backgrounded", () => {
    stubDocument({ visibilityState: "visible", hasFocus: true });
    expect(getIsAppInForeground("background")).toBe(false);
    expect(getIsAppInForeground("inactive")).toBe(false);
  });

  it("is false in a hidden browser tab", () => {
    stubDocument({ visibilityState: "hidden", hasFocus: false });
    expect(getIsAppInForeground("active")).toBe(false);
  });

  it("stays true when the window is visible but unfocused", () => {
    // The file preview gates its read on this. Focus leaves the host document
    // for an Electron <webview>, devtools, or a second window — none of which
    // stop a visible pane from needing its content. Only the stricter
    // "actively viewed" question cares about focus.
    stubDocument({ visibilityState: "visible", hasFocus: false });
    expect(getIsAppInForeground("active")).toBe(true);
    expect(getIsAppActivelyVisible("active")).toBe(false);
  });
});
