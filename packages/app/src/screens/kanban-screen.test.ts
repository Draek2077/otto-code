import { describe, expect, it } from "vitest";
import { resolveKanbanScreenBodyState } from "./kanban-screen-state";

describe("resolveKanbanScreenBodyState", () => {
  it("shows the spinner while loading with no boards yet", () => {
    expect(resolveKanbanScreenBodyState({ isLoading: true, boardCount: 0 })).toEqual({
      kind: "loading",
    });
  });

  it("shows the empty state when nothing is loading and no boards exist", () => {
    expect(resolveKanbanScreenBodyState({ isLoading: false, boardCount: 0 })).toEqual({
      kind: "empty",
    });
  });

  it("shows the picker once at least one board is known", () => {
    expect(resolveKanbanScreenBodyState({ isLoading: false, boardCount: 3 })).toEqual({
      kind: "picker",
    });
  });

  it("keeps the picker even while a refresh is in flight", () => {
    expect(resolveKanbanScreenBodyState({ isLoading: true, boardCount: 1 })).toEqual({
      kind: "picker",
    });
  });
});
