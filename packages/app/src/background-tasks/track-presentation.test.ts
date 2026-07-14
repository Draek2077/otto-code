import { describe, expect, it } from "vitest";
import type { BackgroundShellTaskRow } from "./select";
import {
  formatBackgroundTaskElapsed,
  formatHeaderLabel,
  isBackgroundTaskRowRunning,
  isBackgroundTaskRowTidyEligible,
  partitionBackgroundTaskRows,
  resolveBackgroundTaskRowAction,
  resolveRowLabel,
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
  it("uses singular 'background task' for a single row", () => {
    expect(formatHeaderLabel([row({ id: "a", status: "idle" })])).toBe("1 background task");
  });

  it("uses plural 'background tasks' for two rows with no running rows", () => {
    expect(
      formatHeaderLabel([row({ id: "a", status: "idle" }), row({ id: "b", status: "idle" })]),
    ).toBe("2 background tasks");
  });

  it("appends the running count when at least one row is running", () => {
    expect(
      formatHeaderLabel([
        row({ id: "a", status: "running" }),
        row({ id: "b", status: "idle" }),
        row({ id: "c", status: "idle" }),
      ]),
    ).toBe("3 background tasks · 1 running");
  });
});

describe("isBackgroundTaskRowTidyEligible", () => {
  it("is not eligible while running", () => {
    expect(isBackgroundTaskRowTidyEligible(row({ id: "a", status: "running" }))).toBe(false);
  });

  it("is eligible once idle/error/closed", () => {
    expect(isBackgroundTaskRowTidyEligible(row({ id: "a", status: "idle" }))).toBe(true);
    expect(isBackgroundTaskRowTidyEligible(row({ id: "a", status: "error" }))).toBe(true);
    expect(isBackgroundTaskRowTidyEligible(row({ id: "a", status: "closed" }))).toBe(true);
  });

  it("stays active when it requires attention even if terminal", () => {
    expect(
      isBackgroundTaskRowTidyEligible(row({ id: "a", status: "error", requiresAttention: true })),
    ).toBe(false);
  });
});

describe("partitionBackgroundTaskRows", () => {
  it("splits running/attention rows into active and terminal rows into completed", () => {
    const rows = [
      row({ id: "a", status: "running" }),
      row({ id: "b", status: "idle" }),
      row({ id: "c", status: "error", requiresAttention: true }),
    ];
    const { active, completed } = partitionBackgroundTaskRows(rows);
    expect(active.map((r) => r.id)).toEqual(["a", "c"]);
    expect(completed.map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps a pinned id active even when tidy-eligible", () => {
    const rows = [row({ id: "a", status: "idle" })];
    const { active, completed } = partitionBackgroundTaskRows(rows, new Set(["a"]));
    expect(active.map((r) => r.id)).toEqual(["a"]);
    expect(completed).toEqual([]);
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
