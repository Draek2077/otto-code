import { describe, expect, test } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildMoveChatWorkspaceOptions } from "./move-chat-options";

function workspace(overrides: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: "wks_1",
    projectId: "proj_otto",
    projectDisplayName: "otto",
    projectCustomName: null,
    projectRootPath: "/repos/otto",
    workspaceDirectory: "/repos/otto",
    projectKind: "git",
    workspaceKind: "local",
    name: "main",
    title: null,
    status: "idle",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  } as WorkspaceDescriptor;
}

describe("buildMoveChatWorkspaceOptions", () => {
  test("excludes the workspace the chat already lives in", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [workspace({ id: "wks_here" }), workspace({ id: "wks_there", name: "feature" })],
      currentWorkspaceId: "wks_here",
    });

    expect(options.map((option) => option.workspaceId)).toEqual(["wks_there"]);
  });

  test("offers workspaces in other projects, flagged as cross-project", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [
        workspace({ id: "wks_here" }),
        workspace({
          id: "wks_elsewhere",
          projectId: "proj_other",
          projectDisplayName: "other",
          name: "main",
        }),
      ],
      currentWorkspaceId: "wks_here",
    });

    expect(options).toEqual([
      {
        workspaceId: "wks_elsewhere",
        label: "main",
        projectLabel: "other",
        isCrossProject: true,
      },
    ]);
  });

  test("sorts same-project targets before cross-project ones", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [
        workspace({ id: "wks_here" }),
        workspace({ id: "wks_a_other", projectId: "proj_other", projectDisplayName: "aaa" }),
        workspace({ id: "wks_sibling", name: "feature" }),
      ],
      currentWorkspaceId: "wks_here",
    });

    expect(options.map((option) => option.workspaceId)).toEqual(["wks_sibling", "wks_a_other"]);
  });

  test("skips workspaces being archived", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [
        workspace({ id: "wks_here" }),
        workspace({ id: "wks_dying", archivingAt: "2026-07-29T00:00:00.000Z" }),
      ],
      currentWorkspaceId: "wks_here",
    });

    expect(options).toEqual([]);
  });

  test("prefers the user-set title and custom project name for labels", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [
        workspace({ id: "wks_here" }),
        workspace({
          id: "wks_titled",
          title: "  Release prep  ",
          name: "derived",
          projectCustomName: "Otto Fork",
        }),
      ],
      currentWorkspaceId: "wks_here",
    });

    expect(options[0]).toMatchObject({ label: "Release prep", projectLabel: "Otto Fork" });
  });

  test("lists everything when the chat has no owner yet", () => {
    const options = buildMoveChatWorkspaceOptions({
      workspaces: [workspace({ id: "wks_a" }), workspace({ id: "wks_b", name: "feature" })],
      currentWorkspaceId: null,
    });

    // No current project to compare against, so nothing is labelled cross-project.
    expect(options).toHaveLength(2);
    expect(options.every((option) => !option.isCrossProject)).toBe(true);
  });

  test("returns nothing when the host has no other workspaces", () => {
    expect(
      buildMoveChatWorkspaceOptions({ workspaces: undefined, currentWorkspaceId: "wks_here" }),
    ).toEqual([]);
  });
});
