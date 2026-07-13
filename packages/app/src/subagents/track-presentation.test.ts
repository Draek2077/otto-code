import { describe, expect, it } from "vitest";
import type { SubagentRow } from "./select";
import {
  buildSubagentRowPresentationData,
  formatCompactTokenCount,
  formatHeaderLabel,
  isSubagentRowTidyEligible,
  partitionSubagentRows,
  resolveRowLabel,
  resolveSubagentRowAction,
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
    attend: overrides.attend,
    cumulativeTokens: overrides.cumulativeTokens,
  };
}

describe("formatHeaderLabel", () => {
  it("uses singular 'subagent' for a single row", () => {
    expect(formatHeaderLabel([row({ id: "a" })])).toBe("1 subagent");
  });

  it("uses plural 'subagents' for two rows with no running rows", () => {
    expect(formatHeaderLabel([row({ id: "a" }), row({ id: "b" })])).toBe("2 subagents");
  });

  it("appends the running count when at least one row is running", () => {
    expect(
      formatHeaderLabel([row({ id: "a", status: "running" }), row({ id: "b" }), row({ id: "c" })]),
    ).toBe("3 subagents · 1 running");
  });

  it("counts every running row in the suffix", () => {
    expect(
      formatHeaderLabel([
        row({ id: "a", status: "running" }),
        row({ id: "b", status: "running" }),
        row({ id: "c", requiresAttention: true }),
        row({ id: "d" }),
        row({ id: "e" }),
      ]),
    ).toBe("5 subagents · 2 running");
  });

  it("ignores requiresAttention on non-running rows in the header copy", () => {
    expect(
      formatHeaderLabel([
        row({ id: "a", status: "error", requiresAttention: false }),
        row({ id: "b", status: "idle", requiresAttention: false }),
        row({ id: "c", status: "idle", requiresAttention: true }),
      ]),
    ).toBe("3 subagents");
  });

  it("still counts running rows even when they require attention", () => {
    expect(
      formatHeaderLabel([
        row({ id: "a", status: "error", requiresAttention: true }),
        row({ id: "b", status: "running", requiresAttention: true }),
        row({ id: "c", status: "idle", requiresAttention: true }),
      ]),
    ).toBe("3 subagents · 1 running");
  });

  it("uses singular 'subagent' for a single row that requires attention upstream", () => {
    expect(formatHeaderLabel([row({ id: "a", requiresAttention: true })])).toBe("1 subagent");
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
  it("appends the summed fan-out cost when any row reports tokens", () => {
    expect(
      formatHeaderLabel([
        row({ id: "a", status: "running", cumulativeTokens: 12_000 }),
        row({ id: "b", status: "idle", cumulativeTokens: 300 }),
      ]),
    ).toBe("2 subagents · 1 running · 12.3k tokens");
  });

  it("omits the token clause when no row reports a total", () => {
    expect(formatHeaderLabel([row({ id: "a" }), row({ id: "b" })])).toBe("2 subagents");
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
});
