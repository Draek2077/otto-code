import { expect, test, vi } from "vitest";
import { kanbanProjectContext } from "./navigation-context";

const plugin = { id: "otto-kanban", serverId: "a" };
const input = { screenId: "board" };

test("active and last hints resolve only through the selected host's actual workspace", () => {
  const projectForWorkspace = vi.fn(() => "project");
  expect(
    kanbanProjectContext(plugin, input, {
      active: { serverId: "a", workspaceId: "active" },
      last: null,
      projectForWorkspace,
    }),
  ).toEqual({ screenId: "board", params: { projectHostId: "a", projectId: "project" } });
  expect(projectForWorkspace).toHaveBeenCalledWith("a", "active");
  projectForWorkspace.mockClear();
  expect(
    kanbanProjectContext(plugin, input, {
      active: { serverId: "b", workspaceId: "other" },
      last: { serverId: "a", workspaceId: "remembered" },
      projectForWorkspace,
    }),
  ).toEqual({ screenId: "board", params: { projectHostId: "a", projectId: "project" } });
  expect(projectForWorkspace).toHaveBeenCalledExactlyOnceWith("a", "remembered");
});

test("missing, removed, or other-host context never chooses the first available project", () => {
  const projectForWorkspace = vi.fn(() => null);
  expect(
    kanbanProjectContext(plugin, input, {
      active: { serverId: "b", workspaceId: "other" },
      last: null,
      projectForWorkspace,
    }),
  ).toBe(input);
  expect(projectForWorkspace).not.toHaveBeenCalled();
  expect(
    kanbanProjectContext(plugin, input, {
      active: { serverId: "a", workspaceId: "removed" },
      last: null,
      projectForWorkspace,
    }),
  ).toBe(input);
});

test("explicit project choices and unrelated plugins bypass hint resolution", () => {
  const context = { active: null, last: null, projectForWorkspace: vi.fn(() => "wrong") };
  const explicit = { screenId: "board", params: { projectHostId: "b", projectId: "explicit" } };
  expect(kanbanProjectContext(plugin, explicit, context)).toBe(explicit);
  expect(kanbanProjectContext({ ...plugin, id: "other" }, input, context)).toBe(input);
  expect(context.projectForWorkspace).not.toHaveBeenCalled();
});

test("a workspace command resolves its bound workspace without falling back to another choice", () => {
  const projectForWorkspace = vi.fn(() => "command-project");
  const command = { screenId: "board", params: { workspaceId: "command" } };
  const context = {
    active: null,
    last: { serverId: "a", workspaceId: "last" },
    projectForWorkspace,
  };
  expect(kanbanProjectContext(plugin, command, context)).toEqual({
    screenId: "board",
    params: {
      workspaceId: "command",
      projectHostId: "a",
      projectId: "command-project",
    },
  });
  expect(projectForWorkspace).toHaveBeenCalledExactlyOnceWith("a", "command");
});
