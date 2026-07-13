import { expect, test } from "vitest";

import type { AgentSnapshotPayload } from "../messages.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { ObservedSubagentUpdate } from "./agent-sdk-types.js";

const logger = createTestLogger();

// Observed subagents are ephemeral registry projections (no ManagedAgent, no
// stored record). These tests drive the registry through the same private
// ingest hook the provider stream uses, then exercise the archive path added
// for the subagents-cleanup charter (Items 2 + 6).
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

function createHarness() {
  const manager = new AgentManager({ logger });
  const snapshots: AgentSnapshotPayload[] = [];
  manager.subscribe((event) => {
    if (event.type === "observed_agent_state") {
      snapshots.push(event.payload);
    }
  });
  const internals = manager as unknown as ObservedInternals;
  const ingest = (update: ObservedSubagentUpdate) => {
    internals.onObservedSubagentUpdated(
      { id: "parent-1", cwd: "/tmp/project" },
      { type: "observed_subagent_updated", provider: "claude", update },
    );
  };
  return { manager, snapshots, ingest };
}

const OBSERVED_ID = "parent-1::sub::task-1";

test("archiveObservedSubagent retires the projection and dispatches an archived snapshot", async () => {
  const { manager, snapshots, ingest } = createHarness();
  ingest({ key: "task-1", taskId: "t-1", status: "running", subAgentType: "code-explorer" });

  const { archivedAt } = await manager.archiveObservedSubagent(OBSERVED_ID);

  const last = snapshots.at(-1);
  expect(last?.id).toBe(OBSERVED_ID);
  expect(last?.archivedAt).toBe(archivedAt);
  // Archiving a still-live row transitions it to a terminal state (the stop
  // itself is best-effort — here the parent session is gone, which must not
  // block the archive).
  expect(last?.status).toBe("closed");
  expect(last?.requiresAttention).toBe(false);
  // The projection stays fetchable so an open pane can still hydrate it.
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.archivedAt).toBe(archivedAt);
});

test("a late provider update cannot resurrect an archived row", async () => {
  const { manager, snapshots, ingest } = createHarness();
  ingest({ key: "task-1", taskId: "t-1", status: "running", subAgentType: "code-explorer" });

  const { archivedAt } = await manager.archiveObservedSubagent(OBSERVED_ID);
  // The provider's final task_notification lands after the user archived.
  ingest({ key: "task-1", taskId: "t-1", status: "idle", description: "All done" });

  const last = snapshots.at(-1);
  expect(last?.archivedAt).toBe(archivedAt);
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.archivedAt).toBe(archivedAt);
});

test("archiving an already-archived observed subagent is idempotent", async () => {
  const { manager, ingest } = createHarness();
  ingest({ key: "task-1", status: "idle", subAgentType: "code-explorer" });

  const first = await manager.archiveObservedSubagent(OBSERVED_ID);
  const second = await manager.archiveObservedSubagent(OBSERVED_ID);

  expect(second.archivedAt).toBe(first.archivedAt);
});

test("archiving a terminal row keeps its final status", async () => {
  const { manager, snapshots, ingest } = createHarness();
  ingest({ key: "task-1", status: "idle", subAgentType: "code-explorer" });

  await manager.archiveObservedSubagent(OBSERVED_ID);

  expect(snapshots.at(-1)?.status).toBe("idle");
});

test("archiveObservedSubagent throws for an unknown id", async () => {
  const { manager } = createHarness();

  await expect(manager.archiveObservedSubagent("parent-1::sub::missing")).rejects.toThrow(
    "Observed subagent not found",
  );
});
