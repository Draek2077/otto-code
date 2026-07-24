import { describe, expect, test } from "vitest";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import { revealScheduleRunWorkspace } from "./schedule-workspace-reveal.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

const CWD = process.platform === "win32" ? "C:\\repos\\otto" : "/repos/otto";
const OTHER_CWD = process.platform === "win32" ? "C:\\repos\\other" : "/repos/other";

function workspace(
  overrides: Partial<PersistedWorkspaceRecord> & { workspaceId: string },
): PersistedWorkspaceRecord {
  return {
    projectId: "prj_1",
    cwd: CWD,
    kind: "local_checkout",
    displayName: "otto",
    branch: "main",
    title: null,
    hidden: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as PersistedWorkspaceRecord;
}

function agent(id: string, workspaceId: string): StoredAgentRecord {
  return {
    id,
    provider: "claude",
    cwd: CWD,
    workspaceId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labels: {},
    lastStatus: "closed",
    config: {},
  } as unknown as StoredAgentRecord;
}

function harness(workspaces: PersistedWorkspaceRecord[], agents: StoredAgentRecord[] = []) {
  const workspaceStore = new Map(workspaces.map((w) => [w.workspaceId, w]));
  const agentStore = new Map(agents.map((a) => [a.id, a]));
  const archived: string[] = [];
  return {
    workspaceStore,
    agentStore,
    archived,
    deps: {
      workspaceRegistry: {
        get: async (id: string) => workspaceStore.get(id) ?? null,
        list: async () => [...workspaceStore.values()],
        upsert: async (record: PersistedWorkspaceRecord) => {
          workspaceStore.set(record.workspaceId, record);
        },
      },
      agentStorage: {
        list: async () => [...agentStore.values()],
        upsert: async (record: StoredAgentRecord) => {
          agentStore.set(record.id, record);
        },
      },
      archiveWorkspaceRecord: async (id: string) => {
        archived.push(id);
        const existing = workspaceStore.get(id);
        if (existing) {
          workspaceStore.set(id, { ...existing, archivedAt: "2026-01-02T00:00:00.000Z" });
        }
      },
      now: () => new Date("2026-01-02T00:00:00.000Z"),
    },
  };
}

describe("revealScheduleRunWorkspace", () => {
  test("reveals when no visible workspace occupies the directory", async () => {
    const h = harness([workspace({ workspaceId: "wks_run", hidden: true })]);

    const outcome = await revealScheduleRunWorkspace("wks_run", h.deps);

    expect(outcome).toEqual({ kind: "revealed", workspaceId: "wks_run" });
    expect(h.workspaceStore.get("wks_run")?.hidden).toBe(false);
    expect(h.archived).toEqual([]);
  });

  test("reattaches to the occupant instead of revealing a duplicate", async () => {
    const h = harness(
      [
        workspace({ workspaceId: "wks_user", title: "Qwen Development" }),
        workspace({ workspaceId: "wks_run", hidden: true }),
      ],
      [agent("agt_run", "wks_run"), agent("agt_untouched", "wks_user")],
    );

    const outcome = await revealScheduleRunWorkspace("wks_run", h.deps);

    expect(outcome).toEqual({
      kind: "reattached",
      workspaceId: "wks_run",
      occupantWorkspaceId: "wks_user",
      movedAgentIds: ["agt_run"],
    });
    // The run's agent now belongs to the workspace the user already has open...
    expect(h.agentStore.get("agt_run")?.workspaceId).toBe("wks_user");
    expect(h.agentStore.get("agt_untouched")?.workspaceId).toBe("wks_user");
    // ...the transient record is archived, and never became visible.
    expect(h.archived).toEqual(["wks_run"]);
    expect(h.workspaceStore.get("wks_run")?.hidden).toBe(true);
    expect(h.workspaceStore.get("wks_user")?.archivedAt).toBeNull();
  });

  test("ignores archived and hidden workspaces when looking for an occupant", async () => {
    const h = harness([
      workspace({ workspaceId: "wks_archived", archivedAt: "2025-12-01T00:00:00.000Z" }),
      workspace({ workspaceId: "wks_other_hidden", hidden: true }),
      workspace({ workspaceId: "wks_run", hidden: true }),
    ]);

    const outcome = await revealScheduleRunWorkspace("wks_run", h.deps);

    expect(outcome.kind).toBe("revealed");
    expect(h.workspaceStore.get("wks_run")?.hidden).toBe(false);
  });

  test("a workspace on a different directory does not count as an occupant", async () => {
    const h = harness([
      workspace({ workspaceId: "wks_elsewhere", cwd: OTHER_CWD }),
      workspace({ workspaceId: "wks_run", hidden: true }),
    ]);

    const outcome = await revealScheduleRunWorkspace("wks_run", h.deps);

    expect(outcome.kind).toBe("revealed");
  });

  test("no-ops for a missing, already-visible, or archived record", async () => {
    const h = harness([
      workspace({ workspaceId: "wks_visible", hidden: false }),
      workspace({ workspaceId: "wks_gone", hidden: true, archivedAt: "2025-12-01T00:00:00.000Z" }),
    ]);

    expect(await revealScheduleRunWorkspace("wks_missing", h.deps)).toEqual({ kind: "noop" });
    expect(await revealScheduleRunWorkspace("wks_visible", h.deps)).toEqual({ kind: "noop" });
    expect(await revealScheduleRunWorkspace("wks_gone", h.deps)).toEqual({ kind: "noop" });
    expect(h.archived).toEqual([]);
  });
});
