import { describe, expect, it } from "vitest";
import { resolveProjectContextTarget } from "./resolve-project-context-target";

const A = { serverId: "host-1", workspaceId: "ws-a" };
const B = { serverId: "host-1", workspaceId: "ws-b" };
const OTHER_HOST = { serverId: "host-2", workspaceId: "ws-a" };

describe("resolveProjectContextTarget", () => {
  it("prefers the workspace the user is currently in", () => {
    expect(resolveProjectContextTarget([A, B], B)).toEqual(B);
  });

  it("falls back to the most recently active workspace", () => {
    // The sidebar list is ordered activity-desc, so the head is the best guess.
    expect(resolveProjectContextTarget([A, B], null)).toEqual(A);
  });

  it("ignores an active selection that belongs to another project", () => {
    expect(
      resolveProjectContextTarget([A, B], { serverId: "host-9", workspaceId: "ws-z" }),
    ).toEqual(A);
  });

  it("matches on host as well as workspace id", () => {
    // Same workspaceId on a different host is a different workspace.
    expect(resolveProjectContextTarget([A, B], OTHER_HOST)).toEqual(A);
  });

  it("returns null for a project with no workspaces", () => {
    expect(resolveProjectContextTarget([], A)).toBeNull();
  });
});
