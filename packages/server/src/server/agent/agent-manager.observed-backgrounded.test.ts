import { expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { ObservedSubagentUpdate } from "./agent-sdk-types.js";

const logger = createTestLogger();

// `backgrounded` marks an observed run that outlives an interrupt of the owning
// chat's turn. The client reads it to decide whether an interrupting send is
// destructive at all — a warning that counts backgrounded runs claims to stop
// work it never touches. See docs/chat-lifecycle.md.
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
const observedId = (key: string) => `parent-1::sub::${key}`;

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

test("a foreground run carries no backgrounded flag", () => {
  const { manager, ingest } = createHarness();

  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer" });

  expect(manager.getObservedSubagentPayload(observedId("task-1"))).not.toHaveProperty(
    "backgrounded",
  );
});

test("the backgrounded flag latches and survives a status-only refresh", () => {
  const { manager, ingest } = createHarness();

  // The provider only learns a run is backgrounded once its tool_result turns
  // out to be a launch ack, so the first frame can arrive without the flag.
  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer" });
  ingest({ key: "task-1", status: "running", backgrounded: true });
  expect(manager.getObservedSubagentPayload(observedId("task-1"))?.backgrounded).toBe(true);

  // A later progress frame that omits it must not walk the row back to
  // foreground — nothing re-attaches a backgrounded run to the turn.
  ingest({ key: "task-1", status: "running", toolUseCount: 3 });
  expect(manager.getObservedSubagentPayload(observedId("task-1"))?.backgrounded).toBe(true);
});

test("a row nested under a backgrounded run inherits the flag", () => {
  const { manager, ingest } = createHarness();

  ingest({
    key: "workflow-1",
    status: "running",
    subAgentType: "Workflow: spec",
    backgrounded: true,
  });
  // The workflow's own internal agent reports itself with no flag; it survives
  // whatever its parent survives, so the daemon flows the flag down the tree.
  ingest({ key: "wf-child-1", status: "running", parentKey: "workflow-1" });

  expect(manager.getObservedSubagentPayload(observedId("wf-child-1"))?.backgrounded).toBe(true);
});

test("a row nested under a foreground run stays foreground", () => {
  const { manager, ingest } = createHarness();

  ingest({ key: "task-1", status: "running", subAgentType: "code-explorer" });
  ingest({ key: "task-2", status: "running", parentKey: "task-1" });

  expect(manager.getObservedSubagentPayload(observedId("task-2"))).not.toHaveProperty(
    "backgrounded",
  );
});
