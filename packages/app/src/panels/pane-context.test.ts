import { describe, expect, it } from "vitest";
import { createPaneFocusContextValue } from "@/panels/pane-context";

describe("createPaneFocusContextValue", () => {
  it("derives interactivity from both workspace and pane focus", () => {
    expect(
      createPaneFocusContextValue({
        isWorkspaceFocused: true,
        isPaneFocused: true,
      }),
    ).toEqual({
      isWorkspaceFocused: true,
      isPaneFocused: true,
      isInteractive: true,
      isVisible: true,
      focusPane: expect.any(Function),
    });
    expect(
      createPaneFocusContextValue({
        isWorkspaceFocused: false,
        isPaneFocused: true,
      }),
    ).toEqual({
      isWorkspaceFocused: false,
      isPaneFocused: true,
      isInteractive: false,
      isVisible: false,
      focusPane: expect.any(Function),
    });
  });

  it("keeps a companion pane visible while unfocused when isVisible is given", () => {
    // A split pane that is on screen (frontmost tab, workspace focused) but not
    // the focused pane: not interactive, still visible.
    expect(
      createPaneFocusContextValue({
        isWorkspaceFocused: true,
        isPaneFocused: false,
        isVisible: true,
      }),
    ).toMatchObject({
      isInteractive: false,
      isVisible: true,
    });
  });

  it("defaults isVisible to the focused value when omitted", () => {
    expect(
      createPaneFocusContextValue({
        isWorkspaceFocused: true,
        isPaneFocused: false,
      }),
    ).toMatchObject({ isVisible: false });
  });
});
