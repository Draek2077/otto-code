import { describe, expect, it } from "vitest";
import type { Run } from "@otto-code/protocol/workflow";
import type { RunWithHost } from "@/hooks/use-runs";
import type { Agent } from "@/stores/session-store";
import {
  applyRunFilters,
  describeRunTerminalPresentation,
  describeRunTerminalReason,
  formatRunSpend,
  matchesStatusFilter,
  phaseStatusVariant,
  runStatusLabel,
  runStatusVariant,
  selectRunTotals,
} from "./runs-screen-presentation";

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-test",
    title: "Test Workflow",
    status: "running",
    phases: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  } as Run;
}

describe("Workflow cancellation presentation", () => {
  it("uses a warning label and the persisted cancellation reason instead of failure treatment", () => {
    const canceled = run({
      status: "canceled",
      error: 'Rejected at gate "Review change": Needs a security review.',
    });

    expect(runStatusLabel(canceled)).toBe("Canceled");
    expect(runStatusVariant(canceled.status)).toBe("warning");
    expect(phaseStatusVariant("canceled")).toBe("warning");
    expect(describeRunTerminalReason(canceled)).toBe(
      'Rejected at gate "Review change": Needs a security review.',
    );
    expect(describeRunTerminalPresentation(canceled)).toEqual({
      reason: 'Rejected at gate "Review change": Needs a security review.',
      tone: "warning",
    });
  });

  it("keeps canceled Workflow history discoverable without placing it in failures", () => {
    const failed = { ...run({ id: "run-failed", status: "failed" }), serverId: "host-a" };
    const canceled = { ...run({ id: "run-canceled", status: "canceled" }), serverId: "host-a" };
    const history: RunWithHost[] = [failed, canceled];

    expect(matchesStatusFilter(failed, "failed")).toBe(true);
    expect(matchesStatusFilter(canceled, "failed")).toBe(false);
    expect(matchesStatusFilter(canceled, "canceled")).toBe(true);
    expect(applyRunFilters(history, { status: "canceled", cwd: undefined })).toEqual([canceled]);
  });

  it("keeps unknown legacy statuses readable and discoverable through All", () => {
    const legacy = run({ status: "interrupted_by_legacy_host" });

    expect(runStatusLabel(legacy)).toBe("interrupted_by_legacy_host");
    expect(runStatusVariant(legacy.status)).toBe("warning");
    expect(matchesStatusFilter(legacy, "all")).toBe(true);
    expect(matchesStatusFilter(legacy, "canceled")).toBe(false);
  });
});

describe("Workflow spend", () => {
  // The conductor is the chat that declared the run, not part of it. Its spend
  // never counts, however large, and a run with no worker has spent nothing.
  const agents = new Map([
    [
      "conductor",
      {
        cumulativeTokens: 900_000,
        cumulativeUsage: { cachedInputTokens: 900_000, costUsd: 9 },
      } as unknown as Agent,
    ],
    [
      "worker",
      {
        cumulativeTokens: 60_000,
        cumulativeUsage: {
          inputTokens: 10_000,
          cachedInputTokens: 50_000,
          costUsd: 0.1,
          costCoverage: "complete",
        },
      } as unknown as Agent,
    ],
  ]);

  it("counts the run's own chats and never the conductor", () => {
    const totals = selectRunTotals(
      run({
        conductorAgentId: "conductor",
        phases: [
          {
            id: "impl",
            type: "implement",
            title: "Build",
            task: "b",
            status: "running",
            candidates: [{ agentId: "worker", status: "running" }],
          },
        ],
      } as Partial<Run>),
      agents,
    );

    expect(totals).toMatchObject({ tokens: 60_000, cachedInputTokens: 50_000 });
    expect(totals?.costUsd).toBeCloseTo(0.1);
    expect(formatRunSpend(totals!)).toBe("$0.10 · 60k tok (83% cached)");
  });

  it("shows nothing for a run that has not spawned a worker, even while its conductor spends", () => {
    expect(
      selectRunTotals(run({ conductorAgentId: "conductor", status: "pending" }), agents),
    ).toBeNull();
  });
});
