import { describe, expect, it, vi } from "vitest";
import { createBoardService } from "./read-service.js";
import { prepareTargetUpdate } from "./project-config.js";
import type { ProjectSnapshot } from "./ports.js";
import { failure, type Board } from "../shared/model.js";

const binding = { hostId: "host-a", projectId: "project-a" };
const board: Board = {
  provider: "github",
  id: "PVT_board",
  title: "Shared",
  url: null,
  revision: "v1",
  capabilities: { read: true, create: false, link: false, move: false, edit: false, remove: false },
  columns: [],
  cards: [],
};

function fixture(record: unknown = { kanban: { adapter: "github", boardId: "PVT_board" } }) {
  let current: ProjectSnapshot = { binding, revision: "r1", record, githubRemote: null };
  const readProject = vi.fn(async () => ({ ok: true as const, value: current }));
  const readBoard = vi.fn(async () => ({ ok: true as const, value: board }));
  const setTarget = vi.fn(
    async (input: Parameters<import("./ports.js").ProjectBoardPort["setTarget"]>[0]) => {
      const update = prepareTargetUpdate({
        snapshot: current,
        expectedRevision: input.expectedRevision,
        target: input.target,
      });
      if (!update.ok) return update;
      current = { ...current, record: update.value, revision: "r2" };
      return { ok: true as const, value: current };
    },
  );
  const service = createBoardService({
    projects: { hostId: "host-a", read: readProject, setTarget },
    github: { read: readBoard },
  });
  return { service, readProject, readBoard, setTarget };
}

describe("host/project board read service", () => {
  it("is inert until explicitly called, then returns a host/project-bound read-only board", async () => {
    const f = fixture();
    expect(f.readProject).not.toHaveBeenCalled();
    expect(f.readBoard).not.toHaveBeenCalled();
    expect(await f.service.read(binding)).toEqual({
      status: "ready",
      binding,
      settingsRevision: "r1",
      board,
    });
    expect(f.readBoard).toHaveBeenCalledWith({
      binding,
      target: { kind: "node", id: "PVT_board" },
    });
  });

  it("rejects another host before reading settings or a provider", async () => {
    const f = fixture();
    expect(await f.service.read({ ...binding, hostId: "host-b" })).toMatchObject({
      status: "error",
      error: { code: "wrong_host" },
    });
    expect(
      await f.service.setTarget({
        binding: { ...binding, hostId: "host-b" },
        expectedRevision: "r1",
        target: null,
      }),
    ).toMatchObject({ ok: false, error: { code: "wrong_host" } });
    expect(f.readProject).not.toHaveBeenCalled();
    expect(f.readBoard).not.toHaveBeenCalled();
    expect(f.setTarget).not.toHaveBeenCalled();
  });

  it("rejects a project snapshot returned under the wrong identity", async () => {
    const f = fixture();
    f.readProject.mockResolvedValue({
      ok: true,
      value: {
        binding: { ...binding, projectId: "other" },
        revision: "r1",
        record: {},
        githubRemote: null,
      },
    });
    expect(await f.service.read(binding)).toMatchObject({
      status: "error",
      error: { code: "wrong_host" },
    });
    expect(f.readBoard).not.toHaveBeenCalled();
  });

  it("provides an unconfigured state without calling GitHub", async () => {
    const f = fixture({ kanban: null });
    expect(await f.service.read(binding)).toEqual({
      status: "unconfigured",
      binding,
      settingsRevision: "r1",
    });
    expect(f.readBoard).not.toHaveBeenCalled();
  });

  it("keeps corrupt and unsupported provider settings visible as errors", async () => {
    const corrupt = fixture({ kanban: { adapter: "github", boardId: 2 } });
    expect(await corrupt.service.read(binding)).toMatchObject({
      status: "error",
      error: { code: "invalid_settings" },
    });
    expect(corrupt.readBoard).not.toHaveBeenCalled();
    const jira = fixture({ kanban: { adapter: "jira", boardId: "2" } });
    expect(await jira.service.read(binding)).toMatchObject({
      status: "error",
      error: { code: "unsupported" },
    });
    expect(jira.readBoard).not.toHaveBeenCalled();
  });

  it("returns typed host/auth/scope errors without using another project or account", async () => {
    for (const code of ["project_not_found", "auth_required", "scope_required"] as const) {
      const service = createBoardService({
        projects: {
          hostId: "host-a",
          read: async () => failure(code, "Safe host diagnostic"),
          setTarget: async () => failure(code, "Safe host diagnostic"),
        },
        github: {
          read: async () => {
            throw new Error("must not run");
          },
        },
      });
      expect(await service.read(binding)).toEqual({
        status: "error",
        binding,
        error: { code, message: "Safe host diagnostic" },
      });
    }
  });

  it("updates the explicit project's target with revision control", async () => {
    const f = fixture({ kanban: null, future: { keep: true } });
    expect(
      await f.service.setTarget({
        binding,
        expectedRevision: "r1",
        target: { adapter: "github", boardId: "https://github.com/orgs/shared/projects/4" },
      }),
    ).toEqual({
      ok: true,
      value: {
        binding,
        settingsRevision: "r2",
        target: { adapter: "github", boardId: "4", boardOwner: "shared" },
      },
    });
    expect(f.setTarget).toHaveBeenCalledWith({
      binding,
      expectedRevision: "r1",
      target: { adapter: "github", boardId: "4", boardOwner: "shared" },
    });
    expect(
      await f.service.setTarget({ binding, expectedRevision: "r1", target: null }),
    ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
  });

  it("rejects absent revisions and credential-like input before using the write port", async () => {
    const f = fixture();
    expect(
      await f.service.setTarget({ binding, expectedRevision: "", target: null }),
    ).toMatchObject({ ok: false, error: { code: "revision_conflict" } });
    expect(
      await f.service.setTarget({
        binding,
        expectedRevision: "r1",
        target: { adapter: "github", boardId: "ghp_secret" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_target" } });
    expect(f.setTarget).not.toHaveBeenCalled();
  });

  it("does not leak unexpected host exceptions", async () => {
    const f = fixture();
    f.readProject.mockRejectedValue(new Error("credential secret"));
    expect(await f.service.read(binding)).toEqual({
      status: "error",
      binding,
      error: { code: "unavailable", message: "The owning host could not read Project Settings." },
    });
  });
});
