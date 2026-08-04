import { expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { ObservedSubagentUpdate } from "./agent-sdk-types.js";

const logger = createTestLogger();

// Per-row liveness: how much work an observed subagent has done and what it is
// doing right now, so the track answers "alive or hung?" without opening the
// row. The fields are provider-reported through the neutral update; these tests
// pin the daemon-side rules that keep the readout honest.
// See docs/chat-lifecycle.md (the subagents track).
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
const OBSERVED_ID = "parent-1::sub::task-1";

function createHarness() {
  const manager = new AgentManager({ logger });
  const internals = manager as unknown as ObservedInternals;
  const ingest = (update: ObservedSubagentUpdate): void => {
    internals.onObservedSubagentUpdated(PARENT, {
      type: "observed_subagent_updated",
      provider: "claude",
      update,
    });
  };
  return { manager, ingest };
}

test("the tool-use count only ever rises, and survives a status-only settle", () => {
  const { manager, ingest } = createHarness();

  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer", toolUseCount: 12 });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.toolUseCount).toBe(12);

  ingest({ key: "task-1", status: "running", toolUseCount: 89 });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.toolUseCount).toBe(89);

  // A late progress frame reporting a stale figure must not walk the count back.
  ingest({ key: "task-1", status: "running", toolUseCount: 40 });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.toolUseCount).toBe(89);

  // The terminal notification carries no count of its own - the row keeps the
  // work it did rather than blanking at the finish line.
  ingest({ key: "task-1", status: "idle" });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.toolUseCount).toBe(89);
});

test("the current tool tracks the latest, sticks through a scalar-only refresh, and clears on settle", () => {
  const { manager, ingest } = createHarness();

  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer", currentTool: "Read" });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.currentTool).toBe("Read");

  // Not monotonic like the counters - the latest tool wins.
  ingest({ key: "task-1", status: "running", currentTool: "Bash" });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.currentTool).toBe("Bash");

  // A run-state reconcile that refreshes only the token total must not blank it.
  ingest({ key: "task-1", status: "running", cumulativeTokens: 4_800 });
  expect(manager.getObservedSubagentPayload(OBSERVED_ID)?.currentTool).toBe("Bash");

  // A finished sub-agent isn't running Bash.
  ingest({ key: "task-1", status: "idle", toolUseCount: 7 });
  const settled = manager.getObservedSubagentPayload(OBSERVED_ID);
  expect(settled).not.toHaveProperty("currentTool");
  expect(settled?.toolUseCount).toBe(7);
});

test("a provider that reports neither signal leaves both off the row", () => {
  const { manager, ingest } = createHarness();

  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer" });
  ingest({ key: "task-1", status: "idle" });

  const payload = manager.getObservedSubagentPayload(OBSERVED_ID);
  expect(payload).not.toHaveProperty("toolUseCount");
  expect(payload).not.toHaveProperty("currentTool");
});
