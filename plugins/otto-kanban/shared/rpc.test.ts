import { describe, expect, it, vi } from "vitest";
import { getBoard, getCapabilities, getProjectConfiguration, setProjectTarget } from "./rpc.js";
import { createKanbanHandlers } from "../server/contribution.js";
import type { ProjectSnapshot } from "../server/ports.js";

const binding = { hostId: "host-a", projectId: "project-a" };

function hostFixture() {
  const snapshot: ProjectSnapshot = {
    binding,
    revision: "r1",
    githubRemote: null,
    record: { kanban: { adapter: "github", boardId: "PVT_board" }, privateMetadata: "never send" },
  };
  const read = vi.fn(async () => ({ ok: true as const, value: snapshot }));
  const query = vi.fn(async () => ({
    ok: false as const,
    error: { code: "auth_required" as const, message: "Sign in with GitHub CLI on the host." },
  }));
  const setTarget = vi.fn(async () => ({ ok: true as const, value: snapshot }));
  const handlers = createKanbanHandlers({
    projects: { hostId: binding.hostId, read, setTarget },
    github: { hostId: binding.hostId, query },
  });
  return { handlers, read, query, setTarget, snapshot };
}

describe("Kanban plugin RPC boundary", () => {
  it("requires explicit host and project without accepting paths or raw records", () => {
    expect(getBoard.input.safeParse(binding).success).toBe(true);
    expect(getBoard.input.safeParse({ projectId: "project-a" }).success).toBe(false);
    expect(
      getProjectConfiguration.input.safeParse({ ...binding, rootPath: "/other" }).success,
    ).toBe(false);
  });
  it("requires a revision for target writes and rejects token slots", () => {
    expect(setProjectTarget.input.safeParse({ binding, target: null }).success).toBe(false);
    expect(
      setProjectTarget.input.safeParse({
        binding,
        expectedRevision: "r1",
        target: { adapter: "github", boardId: "7", token: "secret" },
      }).success,
    ).toBe(false);
    expect(setProjectTarget.input.parse({ binding, expectedRevision: "r1", target: null })).toEqual(
      { binding, expectedRevision: "r1", target: null },
    );
  });
  it("never includes a host's raw project record in configuration output", () => {
    expect(
      getProjectConfiguration.output.parse({
        ok: true,
        value: {
          binding,
          settingsRevision: "r1",
          target: { adapter: "github", boardId: "7" },
          record: { secret: "private host metadata" },
        },
      }),
    ).toEqual({
      ok: true,
      value: { binding, settingsRevision: "r1", target: { adapter: "github", boardId: "7" } },
    });
  });
  it("uses a single versioned host capability result", () => {
    expect(
      getCapabilities.output.parse({
        ok: true,
        value: {
          hostId: "host-a",
          contractVersion: 1,
          read: true,
          configure: true,
          providers: [{ id: "github", read: true, mutate: false }],
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        hostId: "host-a",
        contractVersion: 1,
        read: true,
        configure: true,
        providers: [{ id: "github", read: true, mutate: false }],
      },
    });
    expect(
      getCapabilities.output.safeParse({
        ok: true,
        value: { hostId: "host-a", contractVersion: 2, read: true, configure: true, providers: [] },
      }).success,
    ).toBe(false);
  });
  it("keeps unconfigured and provider errors distinct from an empty board", () => {
    expect(
      getBoard.output.parse({ status: "unconfigured", binding, settingsRevision: "r1" }),
    ).toEqual({ status: "unconfigured", binding, settingsRevision: "r1" });
    expect(
      getBoard.output.parse({
        status: "error",
        binding,
        error: { code: "scope_required", message: "The host needs board access." },
      }),
    ).toEqual({
      status: "error",
      binding,
      error: { code: "scope_required", message: "The host needs board access." },
    });
  });

  it("keeps contribution construction and capability discovery inert", () => {
    const f = hostFixture();
    expect(
      getCapabilities.output.parse(f.handlers.capabilities({ hostId: binding.hostId })),
    ).toMatchObject({
      ok: true,
      value: {
        contractVersion: 1,
        read: true,
        providers: [
          { id: "github", mutate: false },
          { id: "jira", read: false, mutate: false },
        ],
      },
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.setTarget).not.toHaveBeenCalled();
  });

  it("returns only normalized project configuration without host-private values", async () => {
    const f = hostFixture();
    expect(await f.handlers.configuration(binding)).toEqual({
      ok: true,
      value: {
        binding,
        settingsRevision: "r1",
        target: { adapter: "github", boardId: "PVT_board" },
      },
    });
    expect(f.query).not.toHaveBeenCalled();
  });

  it("keeps a missing CLI credential as a typed board error without another account attempt", async () => {
    const f = hostFixture();
    expect(await f.handlers.readBoard(binding)).toEqual({
      status: "error",
      binding,
      error: { code: "auth_required", message: "Sign in with GitHub CLI on the host." },
    });
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it("rejects other hosts before reading settings or invoking the forge", async () => {
    const f = hostFixture();
    expect(f.handlers.capabilities({ hostId: "other" })).toMatchObject({
      ok: false,
      error: { code: "wrong_host" },
    });
    expect(await f.handlers.configuration({ ...binding, hostId: "other" })).toMatchObject({
      ok: false,
      error: { code: "wrong_host" },
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
});
