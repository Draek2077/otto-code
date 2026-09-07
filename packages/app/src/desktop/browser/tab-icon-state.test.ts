import { describe, expect, it } from "vitest";
import { getBrowserTabIconKind, getBrowserTabLoadingStatus } from "./tab-icon-state";

describe("browser tab icon", () => {
  it("uses the shared loading indicator only while the page is loading", () => {
    expect(getBrowserTabLoadingStatus(true)).toBe("running");
    expect(getBrowserTabLoadingStatus(false)).toBeNull();
  });

  it("returns to the Globe when a page favicon fails to load", () => {
    expect(
      getBrowserTabIconKind({
        faviconUrl: "https://example.com/favicon.svg",
        faviconFailed: true,
        isPreview: false,
      }),
    ).toBe("globe");
  });

  it("keeps preview tabs distinct from normal browser tabs", () => {
    expect(
      getBrowserTabIconKind({
        faviconUrl: "https://example.com/favicon.svg",
        faviconFailed: false,
        isPreview: true,
      }),
    ).toBe("preview");
  });
});
