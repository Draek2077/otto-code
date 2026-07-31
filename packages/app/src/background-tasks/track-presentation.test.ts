import { describe, expect, it } from "vitest";
import type { BackgroundShellTaskRow } from "./select";
import {
  BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS,
  formatBackgroundTaskElapsed,
  formatHeaderLabel,
  isBackgroundTaskRowFailed,
  isBackgroundTaskRowRunning,
  partitionBackgroundTaskRows,
  resolveBackgroundTaskRowAction,
  resolveBackgroundTaskRowGroup,
  resolveRowLabel,
  selectBackgroundTasksToAutoClear,
} from "./track-presentation";

function row(
  overrides: Partial<BackgroundShellTaskRow> & Pick<BackgroundShellTaskRow, "id">,
): BackgroundShellTaskRow {
  return {
    id: overrides.id,
    provider: overrides.provider ?? "claude",
    command: overrides.command,
    description: overrides.description,
    status: overrides.status ?? "running",
    requiresAttention: overrides.requiresAttention ?? false,
    createdAt: overrides.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T00:00:00.000Z",
  };
}

describe("formatHeaderLabel", () => {
  it("uses singular wording for a single row in a group", () => {
    expect(formatHeaderLabel(partitionBackgroundTaskRows([row({ id: "a", status: "idle" })]))).toBe(
      "1 completed background task",
    );
  });

  it("omits the active group when nothing is active", () => {
    expect(
      formatHeaderLabel(
        partitionBackgroundTaskRows([
          row({ id: "a", status: "idle" }),
          row({ id: "b", status: "idle" }),
        ]),
      ),
    ).toBe("2 completed background tasks");
  });

  it("reports both groups, mirroring the list's own split", () => {
    expect(
      formatHeaderLabel(
        partitionBackgroundTaskRows([
          row({ id: "a", status: "running" }),
          row({ id: "b", status: "idle" }),
          row({ id: "c", status: "idle" }),
        ]),
      ),
    ).toBe("1 active background task · 2 completed background tasks");
  });

  it("counts a failure in its own group, never as completed", () => {
    expect(
      formatHeaderLabel(
        partitionBackgroundTaskRows([row({ id: "a", status: "error", requiresAttention: true })]),
      ),
    ).toBe("1 failed background task");
  });

  it("reports all three groups in order", () => {
    expect(
      formatHeaderLabel(
        partitionBackgroundTaskRows([
          row({ id: "a", status: "running" }),
          row({ id: "b", status: "idle" }),
          row({ id: "c", status: "error" }),
        ]),
      ),
    ).toBe("1 active background task · 1 completed background task · 1 failed background task");
  });
});

describe("resolveBackgroundTaskRowGroup", () => {
  it("files a running row as active", () => {
    expect(resolveBackgroundTaskRowGroup(row({ id: "a", status: "running" }))).toBe("active");
  });

  it("files idle and closed rows as completed", () => {
    expect(resolveBackgroundTaskRowGroup(row({ id: "a", status: "idle" }))).toBe("completed");
    expect(resolveBackgroundTaskRowGroup(row({ id: "a", status: "closed" }))).toBe("completed");
  });

  it("files an errored row as failed", () => {
    expect(resolveBackgroundTaskRowGroup(row({ id: "a", status: "error" }))).toBe("failed");
  });

  it("keys off status alone, never the attention flag", () => {
    // The flag rides along on a failure but must not drive grouping: reading it
    // instead of `status` is what once pinned failures in the active list.
    expect(
      resolveBackgroundTaskRowGroup(row({ id: "a", status: "idle", requiresAttention: true })),
    ).toBe("completed");
    expect(
      resolveBackgroundTaskRowGroup(row({ id: "a", status: "error", requiresAttention: false })),
    ).toBe("failed");
  });
});

describe("isBackgroundTaskRowFailed", () => {
  it("is true only for the error status", () => {
    expect(isBackgroundTaskRowFailed(row({ id: "a", status: "error" }))).toBe(true);
    expect(isBackgroundTaskRowFailed(row({ id: "a", status: "idle" }))).toBe(false);
    expect(isBackgroundTaskRowFailed(row({ id: "a", status: "closed" }))).toBe(false);
    expect(isBackgroundTaskRowFailed(row({ id: "a", status: "running" }))).toBe(false);
  });
});

describe("partitionBackgroundTaskRows", () => {
  it("splits rows three ways: running, completed, and failed", () => {
    const rows = [
      row({ id: "a", status: "running" }),
      row({ id: "b", status: "idle" }),
      row({ id: "c", status: "error", requiresAttention: true }),
      row({ id: "d", status: "closed" }),
    ];
    const { active, completed, failed } = partitionBackgroundTaskRows(rows);
    expect(active.map((r) => r.id)).toEqual(["a"]);
    expect(completed.map((r) => r.id)).toEqual(["b", "d"]);
    expect(failed.map((r) => r.id)).toEqual(["c"]);
  });

  it("never files a terminal row as active", () => {
    // No pinning: a terminal row belongs to a terminal group the moment it is
    // terminal, so nothing can sit in the active list claiming to be running.
    const rows = [row({ id: "a", status: "idle" }), row({ id: "b", status: "error" })];
    const { active, completed, failed } = partitionBackgroundTaskRows(rows);
    expect(active).toEqual([]);
    expect(completed.map((r) => r.id)).toEqual(["a"]);
    expect(failed.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("selectBackgroundTasksToAutoClear", () => {
  const NOW = new Date("2026-04-20T00:10:00.000Z").getTime();
  const settled = new Date(NOW - BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS - 1000).toISOString();
  const fresh = new Date(NOW - 500).toISOString();

  it("selects settled rows of the requested group", () => {
    const due = selectBackgroundTasksToAutoClear(
      [
        row({ id: "done", status: "idle", updatedAt: settled }),
        row({ id: "closed", status: "closed", updatedAt: settled }),
      ],
      { group: "completed", settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS, now: NOW },
    );
    expect(due.map((r) => r.id)).toEqual(["done", "closed"]);
  });

  it("leaves a just-finished row alone until it settles", () => {
    const due = selectBackgroundTasksToAutoClear(
      [row({ id: "just-done", status: "idle", updatedAt: fresh })],
      {
        group: "completed",
        settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS,
        now: NOW,
      },
    );
    expect(due).toEqual([]);
  });

  it("never selects running rows", () => {
    const due = selectBackgroundTasksToAutoClear(
      [row({ id: "running", status: "running", updatedAt: settled })],
      { group: "completed", settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS, now: NOW },
    );
    expect(due).toEqual([]);
  });

  it("keeps the two groups' sweeps apart, so one setting can't clear the other's rows", () => {
    const rows = [
      row({ id: "done", status: "idle", updatedAt: settled }),
      row({ id: "failed", status: "error", updatedAt: settled }),
    ];
    const input = { settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS, now: NOW };
    expect(
      selectBackgroundTasksToAutoClear(rows, { ...input, group: "completed" }).map((r) => r.id),
    ).toEqual(["done"]);
    expect(
      selectBackgroundTasksToAutoClear(rows, { ...input, group: "failed" }).map((r) => r.id),
    ).toEqual(["failed"]);
  });

  it("skips excluded ids (already clearing or previously attempted)", () => {
    const due = selectBackgroundTasksToAutoClear(
      [
        row({ id: "a", status: "idle", updatedAt: settled }),
        row({ id: "b", status: "idle", updatedAt: settled }),
      ],
      {
        group: "completed",
        settleMs: BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS,
        now: NOW,
        excludeIds: new Set(["a"]),
      },
    );
    expect(due.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("resolveBackgroundTaskRowAction", () => {
  it("offers stop while running", () => {
    expect(resolveBackgroundTaskRowAction("running")).toBe("stop");
  });

  it("offers clear once terminal", () => {
    expect(resolveBackgroundTaskRowAction("idle")).toBe("clear");
    expect(resolveBackgroundTaskRowAction("error")).toBe("clear");
    expect(resolveBackgroundTaskRowAction("closed")).toBe("clear");
  });
});

describe("isBackgroundTaskRowRunning", () => {
  it("is true only for running", () => {
    expect(isBackgroundTaskRowRunning("running")).toBe(true);
    expect(isBackgroundTaskRowRunning("idle")).toBe(false);
  });
});

describe("formatBackgroundTaskElapsed", () => {
  it("returns null while running", () => {
    expect(formatBackgroundTaskElapsed(row({ id: "a", status: "running" }))).toBeNull();
  });

  it("formats the frozen createdAt→updatedAt duration once terminal", () => {
    const result = formatBackgroundTaskElapsed(
      row({
        id: "a",
        status: "idle",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:03:12.000Z",
      }),
    );
    expect(result).toBe("3m 12s");
  });
});

describe("resolveRowLabel", () => {
  it("prefers the command", () => {
    expect(resolveRowLabel(row({ id: "a", command: "npm test", description: "desc" }))).toBe(
      "npm test",
    );
  });

  it("falls back to the description when there is no command", () => {
    expect(resolveRowLabel(row({ id: "a", description: "Running tests" }))).toBe("Running tests");
  });

  it("falls back to a generic label when neither is present", () => {
    expect(resolveRowLabel(row({ id: "a" }))).toBe("Shell command");
  });
});
