import { describe, expect, it } from "vitest";
import type { SubagentRow } from "./select";
import {
  buildSubagentRowPresentationData,
  formatCompactTokenCount,
  formatHeaderLabel,
  formatSubagentElapsed,
  isSubagentRowRunning,
  isSubagentRowTidyEligible,
  partitionSubagentRows,
  resolveRowLabel,
  resolveSubagentRowAction,
  selectSubagentsToAutoClear,
  SUBAGENT_AUTO_CLEAR_SETTLE_MS,
  sumSubagentTokens,
} from "./track-presentation";

function row(overrides: Partial<SubagentRow> & Pick<SubagentRow, "id">): SubagentRow {
  return {
    id: overrides.id,
    provider: overrides.provider ?? "codex",
    title: overrides.title ?? `Agent ${overrides.id}`,
    status: overrides.status ?? "idle",
    requiresAttention: overrides.requiresAttention ?? false,
    createdAt: overrides.createdAt ?? new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-04-20T00:00:00.000Z"),
    attend: overrides.attend,
    cumulativeTokens: overrides.cumulativeTokens,
    personalityName: overrides.personalityName,
    personalitySpinner: overrides.personalitySpinner,
  };
}

describe("formatHeaderLabel", () => {
  it("uses singular 'active sub-agent' for a single active row", () => {
    expect(formatHeaderLabel(partitionSubagentRows([row({ id: "a" })]))).toBe("1 active sub-agent");
  });

  it("uses plural 'active sub-agents' for two active rows", () => {
    expect(formatHeaderLabel(partitionSubagentRows([row({ id: "a" }), row({ id: "b" })]))).toBe(
      "2 active sub-agents",
    );
  });

  it("summarizes both groups when active and completed rows coexist", () => {
    expect(
      formatHeaderLabel(
        partitionSubagentRows([
          row({ id: "a", status: "running" }),
          row({ id: "b", status: "closed" }),
          row({ id: "c", status: "closed" }),
        ]),
      ),
    ).toBe("1 active sub-agent · 2 completed sub-agents");
  });

  it("shows only the completed clause when nothing is active", () => {
    expect(
      formatHeaderLabel(
        partitionSubagentRows([
          row({ id: "a", status: "closed" }),
          row({ id: "b", status: "error" }),
          row({ id: "c", status: "idle", attend: "observed" }),
        ]),
      ),
    ).toBe("3 completed sub-agents");
  });

  it("keeps attention-flagged terminal rows in the active count", () => {
    expect(
      formatHeaderLabel(
        partitionSubagentRows([
          row({ id: "a", status: "error", requiresAttention: true }),
          row({ id: "b", status: "closed" }),
        ]),
      ),
    ).toBe("1 active sub-agent · 1 completed sub-agent");
  });
});

describe("formatCompactTokenCount", () => {
  it("returns null for absent, zero, or negative totals", () => {
    expect(formatCompactTokenCount(undefined)).toBe(null);
    expect(formatCompactTokenCount(null)).toBe(null);
    expect(formatCompactTokenCount(0)).toBe(null);
    expect(formatCompactTokenCount(-5)).toBe(null);
  });

  it("renders raw counts below 1000", () => {
    expect(formatCompactTokenCount(934)).toBe("934");
  });

  it("renders thousands with a k suffix, trimming trailing .0", () => {
    expect(formatCompactTokenCount(12_300)).toBe("12.3k");
    expect(formatCompactTokenCount(2000)).toBe("2k");
    expect(formatCompactTokenCount(150_000)).toBe("150k");
  });

  it("renders millions with an M suffix", () => {
    expect(formatCompactTokenCount(1_200_000)).toBe("1.2M");
  });

  it("tips values that would round to 1000k into the M tier", () => {
    expect(formatCompactTokenCount(999_499)).toBe("999k");
    expect(formatCompactTokenCount(999_500)).toBe("1M");
  });
});

describe("sumSubagentTokens", () => {
  it("sums cumulative tokens across rows, ignoring rows without a total", () => {
    expect(
      sumSubagentTokens([
        row({ id: "a", cumulativeTokens: 1000 }),
        row({ id: "b" }),
        row({ id: "c", cumulativeTokens: 2500 }),
      ]),
    ).toBe(3500);
  });
});

describe("formatHeaderLabel with token totals", () => {
  it("appends the summed fan-out cost across active and completed rows", () => {
    expect(
      formatHeaderLabel(
        partitionSubagentRows([
          row({ id: "a", status: "running", cumulativeTokens: 12_000 }),
          row({ id: "b", status: "closed", cumulativeTokens: 300 }),
        ]),
      ),
    ).toBe("1 active sub-agent · 1 completed sub-agent · 12.3k tokens");
  });

  it("omits the token clause when no row reports a total", () => {
    expect(formatHeaderLabel(partitionSubagentRows([row({ id: "a" }), row({ id: "b" })]))).toBe(
      "2 active sub-agents",
    );
  });

  it("adds already-cleared tokens back into the header total so the clear isn't lossy", () => {
    // One completed row worth 300 tokens left in the track, plus 12k already
    // cleared out of it — the total must still read the full 12.3k.
    expect(
      formatHeaderLabel(
        partitionSubagentRows([row({ id: "a", status: "closed", cumulativeTokens: 300 })]),
        12_000,
      ),
    ).toBe("1 completed sub-agent · 12.3k tokens");
  });

  it("shows the cleared total even when every row has been cleared away", () => {
    // No rows left in the track (all cleared), but their tokens are preserved.
    expect(formatHeaderLabel(partitionSubagentRows([]), 5000)).toBe("5k tokens");
  });
});

describe("partitionSubagentRows", () => {
  it("keeps running and initializing rows active", () => {
    const { active, completed } = partitionSubagentRows([
      row({ id: "a", status: "running" }),
      row({ id: "b", status: "initializing" }),
    ]);
    expect(active.map((r) => r.id)).toEqual(["a", "b"]);
    expect(completed).toEqual([]);
  });

  it("tidies terminal, non-attention rows into the completed group", () => {
    const { active, completed } = partitionSubagentRows([
      row({ id: "done", status: "idle", attend: "observed" }),
      row({ id: "stopped", status: "closed" }),
    ]);
    expect(active).toEqual([]);
    expect(completed.map((r) => r.id)).toEqual(["done", "stopped"]);
  });

  it("keeps a failed (attention) row active so the failure stays visible", () => {
    const { active, completed } = partitionSubagentRows([
      row({ id: "failed", status: "error", requiresAttention: true }),
      row({ id: "done", status: "idle", attend: "observed" }),
    ]);
    expect(active.map((r) => r.id)).toEqual(["failed"]);
    expect(completed.map((r) => r.id)).toEqual(["done"]);
  });

  it("keeps an attention-flagged terminal row active even without an error status", () => {
    expect(
      isSubagentRowTidyEligible(
        row({ id: "a", status: "idle", attend: "observed", requiresAttention: true }),
      ),
    ).toBe(false);
    expect(isSubagentRowTidyEligible(row({ id: "b", status: "idle", attend: "observed" }))).toBe(
      true,
    );
  });

  it("treats idle as completion only for observed rows", () => {
    // A native create_agent subagent idles *between turns* — it may still be
    // mid-conversation with its orchestrator, so it must not tidy (or become
    // eligible for "Clear all") just because a turn finished.
    expect(isSubagentRowTidyEligible(row({ id: "native", status: "idle" }))).toBe(false);
    expect(
      isSubagentRowTidyEligible(row({ id: "native", status: "idle", attend: "attended" })),
    ).toBe(false);
    // Terminal states tidy regardless of attendability.
    expect(isSubagentRowTidyEligible(row({ id: "native", status: "closed" }))).toBe(true);
    expect(isSubagentRowTidyEligible(row({ id: "native", status: "error" }))).toBe(true);
  });

  it("keeps pinned rows active even when tidy-eligible", () => {
    // The track pins a row the user just stopped so it doesn't vanish into the
    // collapsed Completed group under their pointer.
    const rows = [
      row({ id: "just-stopped", status: "closed" }),
      row({ id: "long-done", status: "closed" }),
    ];
    const { active, completed } = partitionSubagentRows(rows, new Set(["just-stopped"]));
    expect(active.map((r) => r.id)).toEqual(["just-stopped"]);
    expect(completed.map((r) => r.id)).toEqual(["long-done"]);
  });
});

describe("selectSubagentsToAutoClear", () => {
  const NOW = new Date("2026-04-20T00:10:00.000Z").getTime();
  const settled = new Date(NOW - SUBAGENT_AUTO_CLEAR_SETTLE_MS - 1000);
  const fresh = new Date(NOW - 500);

  it("selects tidy-eligible rows that have settled past the delay", () => {
    const due = selectSubagentsToAutoClear(
      [
        row({ id: "done", status: "closed", updatedAt: settled }),
        row({ id: "observed-idle", status: "idle", attend: "observed", updatedAt: settled }),
      ],
      { settleMs: SUBAGENT_AUTO_CLEAR_SETTLE_MS, now: NOW },
    );
    expect(due.map((r) => r.id)).toEqual(["done", "observed-idle"]);
  });

  it("leaves a just-finished row alone until it settles", () => {
    const due = selectSubagentsToAutoClear(
      [row({ id: "just-done", status: "closed", updatedAt: fresh })],
      { settleMs: SUBAGENT_AUTO_CLEAR_SETTLE_MS, now: NOW },
    );
    expect(due).toEqual([]);
  });

  it("never selects running or attention rows, matching the completed group", () => {
    const due = selectSubagentsToAutoClear(
      [
        row({ id: "running", status: "running", updatedAt: settled }),
        row({ id: "failed", status: "error", requiresAttention: true, updatedAt: settled }),
        row({ id: "native-idle", status: "idle", updatedAt: settled }),
      ],
      { settleMs: SUBAGENT_AUTO_CLEAR_SETTLE_MS, now: NOW },
    );
    expect(due).toEqual([]);
  });

  it("skips excluded ids (already archiving or previously attempted)", () => {
    const due = selectSubagentsToAutoClear(
      [
        row({ id: "a", status: "closed", updatedAt: settled }),
        row({ id: "b", status: "closed", updatedAt: settled }),
      ],
      { settleMs: SUBAGENT_AUTO_CLEAR_SETTLE_MS, now: NOW, excludeIds: new Set(["a"]) },
    );
    expect(due.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("resolveSubagentRowAction", () => {
  it("offers Stop while initializing or running", () => {
    expect(resolveSubagentRowAction("initializing")).toBe("stop");
    expect(resolveSubagentRowAction("running")).toBe("stop");
  });

  it("offers Archive once the subagent reaches a terminal state", () => {
    expect(resolveSubagentRowAction("idle")).toBe("archive");
    expect(resolveSubagentRowAction("error")).toBe("archive");
    expect(resolveSubagentRowAction("closed")).toBe("archive");
  });
});

describe("isSubagentRowRunning", () => {
  it("is true while initializing or running", () => {
    expect(isSubagentRowRunning("initializing")).toBe(true);
    expect(isSubagentRowRunning("running")).toBe(true);
  });

  it("is false for terminal states", () => {
    expect(isSubagentRowRunning("idle")).toBe(false);
    expect(isSubagentRowRunning("error")).toBe(false);
    expect(isSubagentRowRunning("closed")).toBe(false);
  });
});

describe("formatSubagentElapsed", () => {
  it("returns null while the row is still running (the track live-ticks instead)", () => {
    expect(formatSubagentElapsed(row({ id: "a", status: "running" }))).toBe(null);
    expect(formatSubagentElapsed(row({ id: "b", status: "initializing" }))).toBe(null);
  });

  it("freezes a terminal row's run duration from createdAt → updatedAt", () => {
    expect(
      formatSubagentElapsed(
        row({
          id: "a",
          status: "closed",
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:03:12.000Z"),
        }),
      ),
    ).toBe("3m 12s");
  });

  it("clamps a non-monotonic updatedAt to 0s rather than a negative duration", () => {
    expect(
      formatSubagentElapsed(
        row({
          id: "a",
          status: "error",
          createdAt: new Date("2026-04-20T00:00:05.000Z"),
          updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        }),
      ),
    ).toBe("0s");
  });
});

describe("resolveRowLabel", () => {
  it("returns null when title is not a string", () => {
    expect(resolveRowLabel(null as unknown as SubagentRow["title"])).toBe(null);
  });

  it("returns null for whitespace-only titles", () => {
    expect(resolveRowLabel("   ")).toBe(null);
  });

  it("returns null for the placeholder 'new agent' regardless of case", () => {
    expect(resolveRowLabel("new agent")).toBe(null);
    expect(resolveRowLabel("New Agent")).toBe(null);
    expect(resolveRowLabel("  NEW AGENT  ")).toBe(null);
  });

  it("returns the trimmed title for real names", () => {
    expect(resolveRowLabel("  Build the thing  ")).toBe("Build the thing");
  });
});

describe("buildSubagentRowPresentationData", () => {
  it("namespaces the key with a subagent prefix", () => {
    expect(buildSubagentRowPresentationData(row({ id: "child-a" })).key).toBe("subagent_child-a");
  });

  it("marks the row ready when the title resolves to a real label", () => {
    const presentation = buildSubagentRowPresentationData(row({ id: "a", title: "Build it" }));
    expect(presentation.titleState).toBe("ready");
    expect(presentation.label).toBe("Build it");
  });

  it("marks the row loading and blanks the label for the placeholder title", () => {
    const presentation = buildSubagentRowPresentationData(row({ id: "a", title: "new agent" }));
    expect(presentation.titleState).toBe("loading");
    expect(presentation.label).toBe("");
  });

  it("maps a running row to the running status bucket so callers render the synced loader", () => {
    expect(buildSubagentRowPresentationData(row({ id: "a", status: "running" })).statusBucket).toBe(
      "running",
    );
  });

  it("maps an idle row to the done status bucket so callers render the static provider icon", () => {
    expect(buildSubagentRowPresentationData(row({ id: "a", status: "idle" })).statusBucket).toBe(
      "done",
    );
  });

  it("ignores requiresAttention on the source row when computing the bucket", () => {
    expect(
      buildSubagentRowPresentationData(row({ id: "a", status: "idle", requiresAttention: true }))
        .statusBucket,
    ).toBe("done");
  });

  it("prefixes the personality name onto the chat title", () => {
    const presentation = buildSubagentRowPresentationData(
      row({ id: "a", title: "Build it", personalityName: "Sage" }),
    );
    expect(presentation.label).toBe("Sage: Build it");
    expect(presentation.titleState).toBe("ready");
  });

  it("shows the personality name alone while the chat title is still loading", () => {
    const presentation = buildSubagentRowPresentationData(
      row({ id: "a", title: "new agent", personalityName: "Sage" }),
    );
    expect(presentation.label).toBe("Sage");
    expect(presentation.titleState).toBe("ready");
  });
});
