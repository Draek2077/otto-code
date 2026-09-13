import { describe, expect, it } from "vitest";
import {
  resolveWorkingDiffComparisonFromState,
  selectWorkingDiffComparisonInState,
  type WorkingDiffComparisonState,
  workingDiffComparisonKey,
} from "./state";

const checkout = { serverId: "server-1", workspaceId: "workspace-1", cwd: "/repo" };
const emptyState = (): WorkingDiffComparisonState => ({ overrides: {} });

describe("working diff comparison", () => {
  it("scopes default selection to the checkout, independent of review identity", () => {
    expect(workingDiffComparisonKey(checkout)).toBe(
      "working-diff:server=server-1:workspace=workspace-1",
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: "workspace-2" })).not.toBe(
      workingDiffComparisonKey(checkout),
    );
    expect(workingDiffComparisonKey({ ...checkout, workspaceId: null, cwd: "/repo/" })).toBe(
      "working-diff:server=server-1:cwd=%2Frepo",
    );
  });

  it("uses live checkout dirtiness until the reader selects a comparison", () => {
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), { ...checkout, isDirty: true }),
    ).toBe("uncommitted");
    expect(
      resolveWorkingDiffComparisonFromState(emptyState(), { ...checkout, isDirty: false }),
    ).toBe("base");
  });

  it.each(["uncommitted", "base"] as const)(
    "keeps manual %s through commits, new edits, and remount reads",
    (comparison) => {
      const state = selectWorkingDiffComparisonInState(emptyState(), { ...checkout, comparison });
      // A commit, another edit, and a second commit cannot move the reader's view.
      for (const isDirty of [true, false, true, false]) {
        expect(resolveWorkingDiffComparisonFromState(state, { ...checkout, isDirty })).toBe(
          comparison,
        );
      }
      expect(
        resolveWorkingDiffComparisonFromState(state, {
          ...checkout,
          isDirty: comparison === "base",
        }),
      ).toBe(comparison);
    },
  );

  it("shares one manual selection between checkout consumers and isolates other workspaces/hosts", () => {
    let state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      comparison: "base",
    });
    expect(resolveWorkingDiffComparisonFromState(state, { ...checkout, isDirty: true })).toBe(
      "base",
    );
    expect(
      resolveWorkingDiffComparisonFromState(state, {
        ...checkout,
        workspaceId: "workspace-2",
        isDirty: true,
      }),
    ).toBe("uncommitted");
    expect(
      resolveWorkingDiffComparisonFromState(state, {
        ...checkout,
        serverId: "server-2",
        isDirty: true,
      }),
    ).toBe("uncommitted");
    state = selectWorkingDiffComparisonInState(state, { ...checkout, comparison: "uncommitted" });
    expect(resolveWorkingDiffComparisonFromState(state, { ...checkout, isDirty: false })).toBe(
      "uncommitted",
    );
  });
  it("retains independent Otto surface selections after commit without touching review keys", () => {
    let state = selectWorkingDiffComparisonInState(emptyState(), {
      ...checkout,
      modeScope: "main-diff-tab",
      comparison: "uncommitted",
    });
    state = selectWorkingDiffComparisonInState(state, {
      ...checkout,
      modeScope: "compact-explorer",
      comparison: "base",
    });
    for (const isDirty of [true, false, true]) {
      expect(
        resolveWorkingDiffComparisonFromState(state, {
          ...checkout,
          modeScope: "main-diff-tab",
          isDirty,
        }),
      ).toBe("uncommitted");
      expect(
        resolveWorkingDiffComparisonFromState(state, {
          ...checkout,
          modeScope: "compact-explorer",
          isDirty,
        }),
      ).toBe("base");
      expect(resolveWorkingDiffComparisonFromState(state, { ...checkout, isDirty })).toBe(
        isDirty ? "uncommitted" : "base",
      );
    }
  });
});
