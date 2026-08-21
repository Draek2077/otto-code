import { describe, expect, it } from "vitest";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  orderWorkspaceSelectionsForStableRender,
  pruneMountedWorkspaceSelections,
  resolveWorkspaceDeckEntries,
  shouldKeepWorkspaceDeckEntryMounted,
} from "@/screens/workspace/workspace-deck-retention";

function workspace(workspaceId: string, serverId = "server"): ActiveWorkspaceSelection {
  return { serverId, workspaceId };
}

function mountedWorkspaceIds(selections: ActiveWorkspaceSelection[]): string[] {
  return selections.map((selection) => selection.workspaceId);
}

describe("pruneMountedWorkspaceSelections", () => {
  it("retains the deck while an app-wide route temporarily clears the active workspace", () => {
    const mountedSelections = [workspace("A"), workspace("B")];

    expect(
      pruneMountedWorkspaceSelections({
        currentSelections: mountedSelections,
        activeSelection: null,
        maxMountedWorkspaces: 3,
      }),
    ).toBe(mountedSelections);
  });

  // The limit is pinned explicitly rather than left to the default: the default
  // is now the user's `mountedWorkspaceLimit`, and a test that moves whenever
  // someone retunes that default is testing the default, not the LRU.
  it("keeps the active workspace and the most recent inactive ones, up to the limit", () => {
    const mountedAfterA = pruneMountedWorkspaceSelections({
      currentSelections: [],
      activeSelection: workspace("A"),
      maxMountedWorkspaces: 3,
    });
    const mountedAfterB = pruneMountedWorkspaceSelections({
      currentSelections: mountedAfterA,
      activeSelection: workspace("B"),
      maxMountedWorkspaces: 3,
    });
    const mountedAfterC = pruneMountedWorkspaceSelections({
      currentSelections: mountedAfterB,
      activeSelection: workspace("C"),
      maxMountedWorkspaces: 3,
    });
    const mountedAfterD = pruneMountedWorkspaceSelections({
      currentSelections: mountedAfterC,
      activeSelection: workspace("D"),
      maxMountedWorkspaces: 3,
    });

    expect(mountedWorkspaceIds(mountedAfterD)).toEqual(["D", "C", "B"]);
  });

  // The thrashing case that motivated making the limit a setting: with four
  // workspaces in rotation and a limit of three, returning to the oldest is
  // always a cold mount. One higher and the whole working set stays resident.
  it("retains a four-workspace rotation once the limit covers it", () => {
    const rotate = (limit: number) =>
      ["A", "B", "C", "D", "A"].reduce<ActiveWorkspaceSelection[]>(
        (currentSelections, workspaceId) =>
          pruneMountedWorkspaceSelections({
            currentSelections,
            activeSelection: workspace(workspaceId),
            maxMountedWorkspaces: limit,
          }),
        [],
      );

    expect(mountedWorkspaceIds(rotate(3))).toEqual(["A", "D", "C"]);
    expect(mountedWorkspaceIds(rotate(4))).toEqual(["A", "D", "C", "B"]);
  });

  it("releases the excess immediately when the limit is lowered", () => {
    const mountedAtFive = ["A", "B", "C", "D", "E"].reduce<ActiveWorkspaceSelection[]>(
      (currentSelections, workspaceId) =>
        pruneMountedWorkspaceSelections({
          currentSelections,
          activeSelection: workspace(workspaceId),
          maxMountedWorkspaces: 5,
        }),
      [],
    );
    expect(mountedAtFive).toHaveLength(5);

    const mountedAfterLowering = pruneMountedWorkspaceSelections({
      currentSelections: mountedAtFive,
      activeSelection: workspace("E"),
      maxMountedWorkspaces: 2,
    });

    expect(mountedWorkspaceIds(mountedAfterLowering)).toEqual(["E", "D"]);
  });

  it("retains the active workspace", () => {
    const mountedSelections = pruneMountedWorkspaceSelections({
      currentSelections: [workspace("A")],
      activeSelection: workspace("A"),
      maxMountedWorkspaces: 3,
    });

    expect(mountedWorkspaceIds(mountedSelections)).toEqual(["A"]);
  });

  it("deduplicates retained workspace selections", () => {
    const mountedSelections = pruneMountedWorkspaceSelections({
      currentSelections: [workspace("B"), workspace("A"), workspace("B")],
      activeSelection: workspace("A"),
      maxMountedWorkspaces: 3,
    });

    expect(mountedWorkspaceIds(mountedSelections)).toEqual(["A", "B"]);
  });

  it("always allows at least the active workspace", () => {
    const mountedSelections = pruneMountedWorkspaceSelections({
      currentSelections: [workspace("A"), workspace("B")],
      activeSelection: workspace("C"),
      maxMountedWorkspaces: 0,
    });

    expect(mountedWorkspaceIds(mountedSelections)).toEqual(["C"]);
  });
});

describe("orderWorkspaceSelectionsForStableRender", () => {
  it("does not move retained native roots when the active LRU order changes", () => {
    const activeA = [workspace("A"), workspace("B")];
    const activeB = [workspace("B"), workspace("A")];

    expect(mountedWorkspaceIds(orderWorkspaceSelectionsForStableRender(activeA))).toEqual([
      "A",
      "B",
    ]);
    expect(mountedWorkspaceIds(orderWorkspaceSelectionsForStableRender(activeB))).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("resolveWorkspaceDeckEntries", () => {
  it("keeps retained workspaces rendered but inactive on an app-wide route", () => {
    expect(
      resolveWorkspaceDeckEntries({
        selections: [workspace("A"), workspace("B")],
        activeSelection: null,
      }),
    ).toEqual([
      { selection: workspace("A"), active: false },
      { selection: workspace("B"), active: false },
    ]);
  });
});

describe("shouldKeepWorkspaceDeckEntryMounted", () => {
  it("keeps the active workspace mounted even when it is missing from hydrated workspaces", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: true,
        hasHydratedWorkspaces: true,
        workspaceExists: false,
      }),
    ).toBe(true);
  });

  it("keeps inactive workspaces mounted until workspace hydration finishes", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: false,
        workspaceExists: false,
      }),
    ).toBe(true);
  });

  it("unmounts inactive workspaces that are gone after hydration", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: true,
        workspaceExists: false,
      }),
    ).toBe(false);
  });

  it("keeps inactive workspaces that still exist after hydration", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: true,
        workspaceExists: true,
      }),
    ).toBe(true);
  });
});
