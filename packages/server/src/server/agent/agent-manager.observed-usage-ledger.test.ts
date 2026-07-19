import { expect, test } from "vitest";

import type { UsageEvent } from "@otto-code/protocol/messages";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { AgentUsage, ObservedSubagentUpdate } from "./agent-sdk-types.js";

const logger = createTestLogger();

// Block 4 of [[subagent-real-accounting]]: when an observed subagent settles,
// its REAL usage split is written as one itemized ledger row, attributed to the
// owning chat so it groups under the parent. No split ⇒ no row.
interface ObservedInternals {
  onObservedSubagentUpdated(
    agent: { id: string; cwd: string; workspaceId?: string },
    event: {
      type: "observed_subagent_updated";
      provider: "claude";
      update: ObservedSubagentUpdate;
    },
  ): void;
}

const PARENT = { id: "parent-1", cwd: "/tmp/project" };

function createHarness() {
  const usageEvents: UsageEvent[] = [];
  const manager = new AgentManager({ logger, onUsageEvent: (event) => usageEvents.push(event) });
  const internals = manager as unknown as ObservedInternals;
  return { manager, usageEvents, internals };
}

function update(over: Partial<ObservedSubagentUpdate> & { key: string }): {
  type: "observed_subagent_updated";
  provider: "claude";
  update: ObservedSubagentUpdate;
} {
  return {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { status: "running", ...over },
  };
}

const HAIKU_SPLIT: AgentUsage = {
  inputTokens: 4,
  cachedInputTokens: 68161,
  cacheCreationInputTokens: 726,
  outputTokens: 913,
};

test("records one subagent ledger row at settle, attributed to the owning chat", () => {
  const { usageEvents, internals } = createHarness();

  // A running usage update carrying the real split + the subagent's own model.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({
      key: "task-1",
      subAgentType: "Explore",
      status: "running",
      usage: HAIKU_SPLIT,
      model: "claude-haiku-4-5-20251001",
    }),
  );
  // Nothing written while still running.
  expect(usageEvents).toHaveLength(0);

  // It settles.
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  expect(usageEvents).toHaveLength(1);
  const row = usageEvents[0]!;
  expect(row.kind).toBe("subagent");
  // tokensIn = input + cache-read + cache-creation; cachedTokensIn = cache-read.
  expect(row.tokensIn).toBe(4 + 68161 + 726);
  expect(row.cachedTokensIn).toBe(68161);
  expect(row.tokensOut).toBe(913);
  // Priced on the subagent's own model, grouped under the parent chat.
  expect(row.model).toBe("claude-haiku-4-5-20251001");
  expect(row.subtype).toBe("Explore");
  expect(row.agentId).toBe("parent-1");
  // Cost is 0 until per-subagent pricing lands (block 5).
  expect(row.costMicroUsd).toBe(0);
});

test("does not write a second row when a duplicate terminal update arrives", () => {
  const { usageEvents, internals } = createHarness();

  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", usage: HAIKU_SPLIT }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));
  // A late/duplicate terminal update (e.g. a run-state reconcile after a live settle).
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "closed" }));

  expect(usageEvents).toHaveLength(1);
});

test("a continued sub-agent gets a second row for the delta, not a dropped stream", () => {
  const { usageEvents, internals } = createHarness();

  // Stream 1: settles with its totals.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({
      key: "task-1",
      status: "running",
      usage: { ...HAIKU_SPLIT, totalCostUsd: 0.05 },
      model: "claude-haiku-4-5-20251001",
    }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));
  expect(usageEvents).toHaveLength(1);
  expect(usageEvents[0]!.tokensOut).toBe(913);
  expect(usageEvents[0]!.costMicroUsd).toBe(50_000);

  // Stream 2: it is continued/steered under the SAME key, so its running totals
  // grow, then it settles again. Only the increment is recorded.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({
      key: "task-1",
      status: "running",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 70_000,
        cacheCreationInputTokens: 800,
        outputTokens: 1_500,
        totalCostUsd: 0.08,
      },
      model: "claude-haiku-4-5-20251001",
    }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  expect(usageEvents).toHaveLength(2);
  const second = usageEvents[1]!;
  // Deltas: out 1500−913, cache-read 70000−68161, in 10−4, cache-write 800−726.
  expect(second.tokensOut).toBe(1_500 - 913);
  expect(second.cachedTokensIn).toBe(70_000 - 68_161);
  expect(second.tokensIn).toBe(10 - 4 + (70_000 - 68_161) + (800 - 726));
  // Cost delta only: $0.08 − $0.05 = $0.03.
  expect(second.costMicroUsd).toBe(30_000);
});

test("carries the model round-trip count onto the row, delta'd per stream", () => {
  const { usageEvents, internals } = createHarness();

  // Stream 1: 10 rounds.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", usage: HAIKU_SPLIT, usageRounds: 10 }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));
  expect(usageEvents[0]!.rounds).toBe(10);

  // Stream 2: grows to 14 rounds total ⇒ this row covers the 4 new ones.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({
      key: "task-1",
      status: "running",
      usage: { ...HAIKU_SPLIT, outputTokens: 2_000 },
      usageRounds: 14,
    }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  expect(usageEvents).toHaveLength(2);
  expect(usageEvents[1]!.rounds).toBe(4);
});

test("staged parent de-inflation accumulates only the delta cost across streams", () => {
  const { internals, manager } = createHarness();

  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", usage: { ...HAIKU_SPLIT, totalCostUsd: 0.05 } }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));
  internals.onObservedSubagentUpdated(
    PARENT,
    update({
      key: "task-1",
      status: "running",
      usage: { ...HAIKU_SPLIT, outputTokens: 2_000, totalCostUsd: 0.08 },
    }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  // Total staged = 0.05 + 0.03 delta = 0.08 (the sub-agent's true full cost),
  // never 0.05 + 0.08 (which would over-subtract from the parent).
  const residual = manager as unknown as ResidualInternals;
  expect(residual.pendingSubagentCostMicroUsdByParent.get("parent-1")).toBe(80_000);
});

test("settles with no split ⇒ no ledger row (honest blank, never fabricated)", () => {
  const { usageEvents, internals } = createHarness();

  // Only a scalar cumulative total was ever known (e.g. a starved workflow child),
  // never a real per-frame split — so there is nothing honest to itemize.
  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", cumulativeTokens: 1200 }),
  );
  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "idle", cumulativeTokens: 4800 }),
  );

  expect(usageEvents).toHaveLength(0);
});

// The subagent's cost is priced upstream (in the Claude provider) and rides on
// update.usage.totalCostUsd; the manager surfaces it on the row AND remembers it
// so the parent can be de-inflated by exactly that amount (parent-residual).
interface ResidualInternals {
  pendingSubagentCostMicroUsdByParent: Map<string, number>;
  residualParentCostMicroUsd(agentId: string, usage: AgentUsage): number | undefined;
}

test("subagent row carries its priced cost and stages it for parent de-inflation", () => {
  const { usageEvents, internals, manager } = createHarness();
  const priced = { ...HAIKU_SPLIT, totalCostUsd: 0.05 };

  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", usage: priced, model: "claude-haiku-4-5-20251001" }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  // The row shows the subagent's real cost (0.05 USD = 50_000 micro-USD).
  expect(usageEvents).toHaveLength(1);
  expect(usageEvents[0]!.costMicroUsd).toBe(50_000);

  // And that cost is staged under the owning chat, ready to back out of the tree.
  const residual = manager as unknown as ResidualInternals;
  expect(residual.pendingSubagentCostMicroUsdByParent.get("parent-1")).toBe(50_000);

  // The parent's residual = whole-tree cost (0.20 USD) − the subagent's 0.05 USD,
  // and reading it drains the bucket so the next turn starts clean.
  expect(residual.residualParentCostMicroUsd("parent-1", { totalCostUsd: 0.2 })).toBe(150_000);
  expect(residual.pendingSubagentCostMicroUsdByParent.has("parent-1")).toBe(false);
  expect(residual.residualParentCostMicroUsd("parent-1", { totalCostUsd: 0.2 })).toBeUndefined();
});

test("residual clamps at 0 when the subagent price table over-charges the tree", () => {
  const { internals, manager } = createHarness();
  const priced = { ...HAIKU_SPLIT, totalCostUsd: 0.5 };

  internals.onObservedSubagentUpdated(
    PARENT,
    update({ key: "task-1", status: "running", usage: priced }),
  );
  internals.onObservedSubagentUpdated(PARENT, update({ key: "task-1", status: "idle" }));

  const residual = manager as unknown as ResidualInternals;
  // Tree cost (0.10) < staged subagent cost (0.50): clamp at 0, never negative.
  expect(residual.residualParentCostMicroUsd("parent-1", { totalCostUsd: 0.1 })).toBe(0);
});
