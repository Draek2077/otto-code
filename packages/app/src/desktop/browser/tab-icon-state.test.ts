import { describe, expect, it } from "vitest";
import { getBrowserTabIconKind } from "./tab-icon-state";

describe("browser tab icon", () => {
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
