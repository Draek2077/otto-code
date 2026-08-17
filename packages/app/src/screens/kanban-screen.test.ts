import { describe, expect, it } from "vitest";
import { resolveKanbanScreenBodyState } from "./kanban-screen-state";

const base = {
  isLoading: false,
  hostCount: 1,
  projectCount: 1,
  selectedProject: { serverId: "host-1", projectId: "proj-1", hasTarget: true },
  boardError: null as string | null,
  boardCount: 1,
};

describe("resolveKanbanScreenBodyState", () => {
  it("resolves to no-hosts when no host advertises the feature", () => {
    expect(resolveKanbanScreenBodyState({ ...base, hostCount: 0 })).toEqual({
      kind: "no-hosts",
    });
  });

  it("prefers no-hosts over loading", () => {
    expect(
      resolveKanbanScreenBodyState({ ...base, hostCount: 0, isLoading: true, boardCount: 0 }),
    ).toEqual({ kind: "no-hosts" });
  });

  it("shows the spinner while loading with no boards yet", () => {
    expect(resolveKanbanScreenBodyState({ ...base, isLoading: true, boardCount: 0 })).toEqual({
      kind: "loading",
    });
  });

  it("keeps the board state while a refresh is in flight", () => {
    expect(resolveKanbanScreenBodyState({ ...base, isLoading: true, boardCount: 2 })).toEqual({
      kind: "board",
    });
  });

  it("resolves to no-projects when the selected host has no projects", () => {
    expect(
      resolveKanbanScreenBodyState({ ...base, projectCount: 0, selectedProject: null }),
    ).toEqual({ kind: "no-projects" });
  });

  it("resolves to no-projects when nothing is selected yet", () => {
    expect(resolveKanbanScreenBodyState({ ...base, selectedProject: null, boardCount: 0 })).toEqual(
      { kind: "no-projects" },
    );
  });

  it("resolves to unconfigured when the selected project has no target", () => {
    expect(
      resolveKanbanScreenBodyState({
        ...base,
        selectedProject: { serverId: "host-9", projectId: "proj-9", hasTarget: false },
      }),
    ).toEqual({ kind: "unconfigured", serverId: "host-9", projectId: "proj-9" });
  });

  it("prefers unconfigured over boardError", () => {
    expect(
      resolveKanbanScreenBodyState({
        ...base,
        selectedProject: { serverId: "host-9", projectId: "proj-9", hasTarget: false },
        boardError: "boom",
      }),
    ).toEqual({ kind: "unconfigured", serverId: "host-9", projectId: "proj-9" });
  });

  it("resolves to error when the board list failed", () => {
    expect(resolveKanbanScreenBodyState({ ...base, boardError: "boom", boardCount: 0 })).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("resolves to board once boards are known", () => {
    expect(resolveKanbanScreenBodyState(base)).toEqual({ kind: "board" });
  });

  it("prefers error over board when the board list also failed", () => {
    expect(resolveKanbanScreenBodyState({ ...base, boardError: "boom", boardCount: 3 })).toEqual({
      kind: "error",
      message: "boom",
    });
  });
});
