import { describe, expect, it } from "vitest";
import { deriveVisibilityScrollRestoration } from "./visibility-scroll-restoration";

describe("retained chat visibility scroll restoration", () => {
  it("returns a following chat to the newest output", () => {
    expect(
      deriveVisibilityScrollRestoration({
        wasVisible: false,
        isVisible: true,
        followsOutput: true,
      }),
    ).toBe("stick-to-bottom");
  });

  it("keeps a detached reader at their saved position", () => {
    expect(
      deriveVisibilityScrollRestoration({
        wasVisible: false,
        isVisible: true,
        followsOutput: false,
      }),
    ).toBe("restore-reader-position");
  });

  it("does not alter the position while a tab stays visible or becomes hidden", () => {
    expect(
      deriveVisibilityScrollRestoration({
        wasVisible: true,
        isVisible: true,
        followsOutput: false,
      }),
    ).toBe("none");
    expect(
      deriveVisibilityScrollRestoration({
        wasVisible: true,
        isVisible: false,
        followsOutput: true,
      }),
    ).toBe("none");
  });
});
