import { describe, expect, it } from "vitest";
import { computeTabDropPreview } from "@/components/split-container-tab-drop-preview";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function tab(tabId: string): WorkspaceTabDescriptor {
  return {
    key: tabId,
    tabId,
    kind: "draft",
    target: {
      kind: "draft",
      draftId: tabId,
    },
  };
}

describe("computeTabDropPreview", () => {
  const targetTabs = [tab("a"), tab("b"), tab("c"), tab("d")];

  it("returns a before-target insertion index for cross-pane drops on the left half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        orientation: "horizontal",
        activeRect: { left: 180, top: 0, width: 40, height: 30 },
        overRect: { left: 200, top: 0, width: 100, height: 30 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
    });
  });

  it("returns an after-target insertion index for cross-pane drops on the right half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        orientation: "horizontal",
        activeRect: { left: 280, top: 0, width: 40, height: 30 },
        overRect: { left: 200, top: 0, width: 100, height: 30 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
    });
  });

  it("adjusts same-pane drops so insertion indexes match arrayMove semantics", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "pane",
        activeTabId: "b",
        overPaneId: "pane",
        overTabId: "d",
        targetTabs,
        orientation: "horizontal",
        activeRect: { left: 460, top: 0, width: 40, height: 30 },
        overRect: { left: 400, top: 0, width: 100, height: 30 },
      }),
    ).toEqual({
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
    });
  });

  // Every chip in a vertical rail shares one left/width, so the horizontal
  // math is degenerate there — these cover the Y-axis branch.
  it("returns a before-target insertion index for vertical drops on the top half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        orientation: "vertical",
        activeRect: { left: 0, top: 180, width: 160, height: 30 },
        overRect: { left: 0, top: 200, width: 160, height: 30 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
    });
  });

  it("returns an after-target insertion index for vertical drops on the bottom half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        orientation: "vertical",
        activeRect: { left: 0, top: 230, width: 160, height: 30 },
        overRect: { left: 0, top: 200, width: 160, height: 30 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
    });
  });

  it("ignores the x axis for vertical strips where every chip shares one column", () => {
    // Identical left/width on both rects: the old X-center comparison would
    // have resolved this to a constant, never following the pointer.
    expect(
      computeTabDropPreview({
        activePaneId: "pane",
        activeTabId: "b",
        overPaneId: "pane",
        overTabId: "d",
        targetTabs,
        orientation: "vertical",
        activeRect: { left: 0, top: 320, width: 160, height: 30 },
        overRect: { left: 0, top: 300, width: 160, height: 30 },
      }),
    ).toEqual({
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
    });
  });
});
