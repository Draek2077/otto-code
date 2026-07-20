import { describe, expect, it } from "vitest";
import { isFileQueryEnabled, resolveFilePreviewState } from "./file-pane-enabled";

describe("isFileQueryEnabled", () => {
  it("reads when there is a target, the tab is active, and the app is visible", () => {
    expect(isFileQueryEnabled({ hasReadTarget: true, isTabActive: true, isAppVisible: true })).toBe(
      true,
    );
  });

  it("does not read while the tab is hidden", () => {
    expect(
      isFileQueryEnabled({ hasReadTarget: true, isTabActive: false, isAppVisible: true }),
    ).toBe(false);
  });

  it("does not read while the app is backgrounded", () => {
    expect(
      isFileQueryEnabled({ hasReadTarget: true, isTabActive: true, isAppVisible: false }),
    ).toBe(false);
  });

  it("does not read without a resolved file target", () => {
    expect(
      isFileQueryEnabled({ hasReadTarget: false, isTabActive: true, isAppVisible: true }),
    ).toBe(false);
  });
});

describe("resolveFilePreviewState", () => {
  it("loads while a gated read is pending, whether or not it has been issued yet", () => {
    // React Query reports the disabled→enabled flip on tab activation identically to a completed
    // empty read: no data, no fetch in flight. Calling that unavailable is what made the message
    // flash before the content appeared.
    expect(
      resolveFilePreviewState({ hasReadTarget: true, isPending: true, hasPreview: false }),
    ).toBe("loading");
  });

  it("is unavailable once a read resolved with nothing to show", () => {
    expect(
      resolveFilePreviewState({ hasReadTarget: true, isPending: false, hasPreview: false }),
    ).toBe("unavailable");
  });

  it("is unavailable rather than spinning forever when there is nothing to read", () => {
    // A disconnected host never enables the query, so isPending stays true indefinitely.
    expect(
      resolveFilePreviewState({ hasReadTarget: false, isPending: true, hasPreview: false }),
    ).toBe("unavailable");
  });

  it("is ready whenever there is a preview, including during a background refetch", () => {
    expect(
      resolveFilePreviewState({ hasReadTarget: true, isPending: false, hasPreview: true }),
    ).toBe("ready");
    expect(
      resolveFilePreviewState({ hasReadTarget: true, isPending: true, hasPreview: true }),
    ).toBe("ready");
  });
});
