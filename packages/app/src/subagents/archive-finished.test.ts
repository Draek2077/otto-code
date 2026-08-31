import { describe, expect, it } from "vitest";
import { createArchiveFinishedSubagents, type ManagedSubagentSnapshot } from "./archive-finished";
import type { OttoSubagentRow, ProviderSubagentRow } from "./select";

function otto(id: string, status: OttoSubagentRow["status"] = "idle"): OttoSubagentRow {
  return {
    kind: "otto",
    id,
    provider: "codex",
    title: id,
    description: null,
    subtitle: null,
    status,
    requiresAttention: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function provider(
  id: string,
  status: ProviderSubagentRow["status"] = "completed",
): ProviderSubagentRow {
  return {
    kind: "provider",
    id,
    parentAgentId: "parent",
    provider: "codex",
    title: id,
    description: null,
    subtitle: null,
    status,
    requiresAttention: false,
    createdAt: new Date(),
  };
}

function managed(
  id: string,
  status: ManagedSubagentSnapshot["status"] = "idle",
  overrides: Partial<ManagedSubagentSnapshot> = {},
): ManagedSubagentSnapshot {
  return {
    id,
    status,
    parentAgentId: "parent",
    archivedAt: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createArchiveFinishedSubagents", () => {
  it("dismisses provider rows before sequential managed archives and reports combined progress", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const current = new Map([
      ["first", managed("first")],
      ["second", managed("second")],
      ["resumed", managed("resumed", "running")],
    ]);
    const events: string[] = [];
    const archive = createArchiveFinishedSubagents(
      [provider("native"), otto("first"), otto("second", "error"), otto("resumed")],
      {
        parentAgentId: "parent",
        getManagedSubagent: (id) => current.get(id),
        archiveManagedSubagent: (id) => {
          events.push(`archive:${id}`);
          return id === "first" ? first.promise : second.promise;
        },
        dismissProviderSubagents: (ids) => events.push(`dismiss:${ids.join(",")}`),
      },
    );
    const progress: string[] = [];
    archive.subscribe(() => {
      const status = archive.getState().status;
      if (status.kind === "archiving") {
        progress.push(`${status.completedCount}/${status.totalCount}`);
      }
    });

    const operation = archive.archiveFinished();
    expect(archive.getState()).toEqual({
      eligibleCount: 4,
      status: { kind: "archiving", completedCount: 1, totalCount: 4 },
    });
    expect(events).toEqual(["dismiss:native", "archive:first"]);

    first.resolve();
    await Promise.resolve();
    expect(archive.getState()).toEqual({
      eligibleCount: 4,
      status: { kind: "archiving", completedCount: 2, totalCount: 4 },
    });
    expect(events).toEqual(["dismiss:native", "archive:first", "archive:second"]);

    second.resolve();
    await expect(operation).resolves.toEqual({
      archivedOttoIds: ["first", "second"],
      dismissedProviderIds: ["native"],
      skippedOttoIds: ["resumed"],
      failures: [],
    });
    expect(progress).toEqual(["0/4", "1/4", "2/4", "3/4", "4/4"]);
    expect(archive.getState()).toEqual({ eligibleCount: 4, status: { kind: "idle" } });
  });

  it("retains failure through optimistic rollback, retries current rows, and resets for a later eligible-set change", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const retry = deferred<void>();
    const current = new Map([
      ["first", managed("first")],
      ["second", managed("second")],
    ]);
    const responses = [first.promise, second.promise, retry.promise];
    const calls: string[] = [];
    const archive = createArchiveFinishedSubagents([otto("first"), otto("second")], {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: (id) => {
        calls.push(id);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected archive");
        return response;
      },
      dismissProviderSubagents: () => undefined,
    });

    const firstAttempt = archive.archiveFinished();
    archive.setRows([otto("second")]);
    const firstError = new Error("first failed");
    first.reject(firstError);
    await Promise.resolve();
    second.resolve();
    archive.setRows([]);
    await expect(firstAttempt).resolves.toEqual({
      archivedOttoIds: ["second"],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [{ id: "first", error: firstError }],
    });

    expect(archive.getState()).toEqual({
      eligibleCount: 0,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });
    archive.setRows([otto("first")]);

    expect(archive.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });
    expect(calls).toEqual(["first", "second"]);

    archive.setRows([otto("first", "error")]);
    expect(archive.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });

    const retryAttempt = archive.archiveFinished();
    expect(archive.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "archiving", completedCount: 0, totalCount: 1 },
    });
    expect(calls).toEqual(["first", "second", "first"]);
    const retryError = new Error("retry failed");
    retry.reject(retryError);
    await expect(retryAttempt).resolves.toEqual({
      archivedOttoIds: [],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [{ id: "first", error: retryError }],
    });

    expect(archive.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });
    archive.setRows([otto("first"), otto("later")]);
    expect(archive.getState()).toEqual({ eligibleCount: 2, status: { kind: "idle" } });
  });

  it("keeps retained failure for eligible status changes and row reorder, then resets on membership change", async () => {
    const firstError = new Error("first failed");
    const secondError = new Error("second failed");
    const current = new Map([
      ["first", managed("first")],
      ["second", managed("second")],
    ]);
    const archive = createArchiveFinishedSubagents([otto("first"), otto("second")], {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: async (id) => {
        throw id === "first" ? firstError : secondError;
      },
      dismissProviderSubagents: () => undefined,
    });

    const operation = archive.archiveFinished();
    archive.setRows([]);
    await operation;
    archive.setRows([otto("first"), otto("second")]);

    archive.setRows([otto("second", "error"), otto("first", "error")]);
    expect(archive.getState()).toEqual({
      eligibleCount: 2,
      status: { kind: "failed", failedCount: 2, totalCount: 2 },
    });

    archive.setRows([otto("second", "error")]);
    expect(archive.getState()).toEqual({ eligibleCount: 1, status: { kind: "idle" } });
  });

  it("clears retry state when the authoritative failed child is running", async () => {
    const current = new Map([["failed", managed("failed")]]);
    const archive = createArchiveFinishedSubagents([otto("failed")], {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: async () => {
        current.set("failed", managed("failed", "running"));
        throw new Error("archive failed");
      },
      dismissProviderSubagents: () => undefined,
    });

    const operation = archive.archiveFinished();
    archive.setRows([]);
    await operation;
    archive.setRows([otto("failed", "running")]);

    expect(archive.getState()).toEqual({ eligibleCount: 0, status: { kind: "idle" } });
    await expect(archive.archiveFinished()).resolves.toEqual({
      archivedOttoIds: [],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [],
    });
  });

  it("clears retry state when the authoritative failed child is initializing", async () => {
    const current = new Map([["failed", managed("failed")]]);
    const archive = createArchiveFinishedSubagents([otto("failed")], {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: async () => {
        current.set("failed", managed("failed", "initializing"));
        throw new Error("archive failed");
      },
      dismissProviderSubagents: () => undefined,
    });

    const operation = archive.archiveFinished();
    archive.setRows([]);
    await operation;
    archive.setRows([otto("failed", "initializing")]);

    expect(archive.getState()).toEqual({ eligibleCount: 0, status: { kind: "idle" } });
    await expect(archive.archiveFinished()).resolves.toEqual({
      archivedOttoIds: [],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [],
    });
  });

  it.each([
    ["is missing", (current: Map<string, ManagedSubagentSnapshot>) => current.delete("failed")],
    [
      "is archived",
      (current: Map<string, ManagedSubagentSnapshot>) =>
        current.set("failed", managed("failed", "idle", { archivedAt: new Date() })),
    ],
    [
      "belongs to a different parent",
      (current: Map<string, ManagedSubagentSnapshot>) =>
        current.set("failed", managed("failed", "idle", { parentAgentId: "other-parent" })),
    ],
  ])(
    "clears retry state when the authoritative failed child %s",
    async (_label, updateSnapshot) => {
      const error = new Error("archive failed");
      const current = new Map([["failed", managed("failed")]]);
      const archive = createArchiveFinishedSubagents([otto("failed")], {
        parentAgentId: "parent",
        getManagedSubagent: (id) => current.get(id),
        archiveManagedSubagent: async () => {
          updateSnapshot(current);
          throw error;
        },
        dismissProviderSubagents: () => undefined,
      });

      await expect(archive.archiveFinished()).resolves.toEqual({
        archivedOttoIds: [],
        dismissedProviderIds: [],
        skippedOttoIds: [],
        failures: [{ id: "failed", error }],
      });
      expect(archive.getState()).toEqual({ eligibleCount: 1, status: { kind: "idle" } });
    },
  );

  it("retains only eligible rolled-back failures and retries only those children", async () => {
    const firstError = new Error("first failed");
    const secondError = new Error("second failed");
    const current = new Map([
      ["first", managed("first")],
      ["second", managed("second")],
    ]);
    const calls: string[] = [];
    const archive = createArchiveFinishedSubagents([otto("first"), otto("second")], {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: async (id) => {
        calls.push(id);
        if (calls.length === 1) throw firstError;
        if (calls.length === 2) {
          current.set("second", managed("second", "running"));
          throw secondError;
        }
      },
      dismissProviderSubagents: () => undefined,
    });

    const operation = archive.archiveFinished();
    archive.setRows([]);
    await expect(operation).resolves.toEqual({
      archivedOttoIds: [],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [
        { id: "first", error: firstError },
        { id: "second", error: secondError },
      ],
    });
    archive.setRows([otto("first"), otto("second", "running")]);

    expect(archive.getState()).toEqual({
      eligibleCount: 1,
      status: { kind: "failed", failedCount: 1, totalCount: 1 },
    });
    await expect(archive.archiveFinished()).resolves.toEqual({
      archivedOttoIds: ["first"],
      dismissedProviderIds: [],
      skippedOttoIds: [],
      failures: [],
    });
    expect(calls).toEqual(["first", "second", "first"]);
  });

  it("rechecks each managed child and skips resumed, missing, archived, reparented, running, and initializing rows", async () => {
    const rows = [
      otto("first"),
      otto("resumed"),
      otto("missing"),
      otto("archived"),
      otto("reparented"),
      otto("running"),
      otto("initializing"),
    ];
    const current = new Map<string, ManagedSubagentSnapshot>([
      ["first", managed("first")],
      ["resumed", managed("resumed")],
      ["archived", managed("archived", "idle", { archivedAt: new Date() })],
      ["reparented", managed("reparented", "idle", { parentAgentId: "other-parent" })],
      ["running", managed("running", "running")],
      ["initializing", managed("initializing", "initializing")],
    ]);
    const archived: string[] = [];
    const archive = createArchiveFinishedSubagents(rows, {
      parentAgentId: "parent",
      getManagedSubagent: (id) => current.get(id),
      archiveManagedSubagent: async (id) => {
        archived.push(id);
        current.set("resumed", managed("resumed", "running"));
      },
      dismissProviderSubagents: () => undefined,
    });

    await expect(archive.archiveFinished()).resolves.toEqual({
      archivedOttoIds: ["first"],
      dismissedProviderIds: [],
      skippedOttoIds: ["resumed", "missing", "archived", "reparented", "running", "initializing"],
      failures: [],
    });

    expect(archived).toEqual(["first"]);
    expect(archive.getState()).toEqual({ eligibleCount: 7, status: { kind: "idle" } });
  });

  it("dismisses finished provider rows locally without removing their descriptors", async () => {
    const finished = provider("finished");
    const running = provider("running", "running");
    const descriptors = new Map([
      ["finished", finished],
      ["running", running],
    ]);
    const dismissed: string[][] = [];
    const archive = createArchiveFinishedSubagents([...descriptors.values()], {
      parentAgentId: "parent",
      getManagedSubagent: () => undefined,
      archiveManagedSubagent: async () => undefined,
      dismissProviderSubagents: (ids) => dismissed.push(ids),
    });

    await expect(archive.archiveFinished()).resolves.toEqual({
      archivedOttoIds: [],
      dismissedProviderIds: ["finished"],
      skippedOttoIds: [],
      failures: [],
    });

    expect(dismissed).toEqual([["finished"]]);
    expect(descriptors.get("finished")).toBe(finished);
    expect(descriptors.get("running")).toBe(running);
  });
});
