import { describe, expect, it } from "vitest";
import { projectHint, resolveProjectSelection } from "./project-selection.js";

const projects = [
  { projectId: "first", projectDisplayName: "First" },
  { projectId: "second", projectDisplayName: "Second" },
];

describe("Kanban project selection", () => {
  it("keeps a valid explicit project authoritative over navigation hints", () => {
    expect(
      resolveProjectSelection({
        hostId: "a",
        projects,
        explicit: { hostId: "a", projectId: "second" },
        hint: { hostId: "a", projectId: "first" },
      }),
    ).toBe("second");
  });
  it("uses an available hint only on its owning host", () => {
    expect(
      resolveProjectSelection({
        hostId: "a",
        projects,
        explicit: null,
        hint: { hostId: "a", projectId: "second" },
      }),
    ).toBe("second");
    expect(
      resolveProjectSelection({
        hostId: "b",
        projects,
        explicit: { hostId: "a", projectId: "first" },
        hint: { hostId: "a", projectId: "second" },
      }),
    ).toBeNull();
  });
  it("does not guess the first project when context is missing or stale", () => {
    expect(
      resolveProjectSelection({ hostId: "a", projects, explicit: null, hint: null }),
    ).toBeNull();
    expect(
      resolveProjectSelection({
        hostId: "a",
        projects,
        explicit: { hostId: "a", projectId: "deleted" },
        hint: null,
      }),
    ).toBeNull();
  });
  it("requires a host-bound project hint and never treats a workspace ID as a project", () => {
    expect(projectHint({ projectId: "first" })).toBeNull();
    expect(projectHint({ projectHostId: "a", workspaceId: "workspace" })).toBeNull();
    expect(projectHint({ projectHostId: "a", projectId: "second" })).toEqual({
      hostId: "a",
      projectId: "second",
    });
  });
});
