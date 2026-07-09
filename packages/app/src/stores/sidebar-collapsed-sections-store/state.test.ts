import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  setSectionsCollapsed,
  toggleProjectCollapsed,
  toggleStatusGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return { collapsedProjectKeys: new Set(), collapsedStatusGroupKeys: new Set() };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleStatusGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedStatusGroupKeys)).toEqual(["running"]);
  });

  it("collapses and expands many sections at once", () => {
    let state = emptyState();

    state = setSectionsCollapsed(state, {
      projectKeys: ["project-a", "project-b"],
      collapsed: true,
    });
    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-a", "project-b"]);

    state = setSectionsCollapsed(state, { statusGroupKeys: ["running", "done"], collapsed: true });
    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-a", "project-b"]);
    expect(Array.from(state.collapsedStatusGroupKeys)).toEqual(["running", "done"]);

    state = setSectionsCollapsed(state, { projectKeys: ["project-a"], collapsed: false });
    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedStatusGroupKeys)).toEqual(["running", "done"]);
  });

  it("keeps untouched collapse sets when no keys are provided", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a"]),
      collapsedStatusGroupKeys: new Set(["running"]),
    };

    const next = setSectionsCollapsed(state, { collapsed: false });

    expect(next.collapsedProjectKeys).toBe(state.collapsedProjectKeys);
    expect(next.collapsedStatusGroupKeys).toBe(state.collapsedStatusGroupKeys);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedStatusGroupKeys: new Set(["running"]),
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedStatusGroupKeys: ["running"],
    });
  });

  it("restores collapsed project keys from persisted preferences", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual(["project-a", "project-b"]);
    expect(Array.from(restored.collapsedStatusGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
