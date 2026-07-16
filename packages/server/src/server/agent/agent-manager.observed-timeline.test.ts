import { expect, test } from "vitest";

import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { ObservedSubagentUpdate } from "./agent-sdk-types.js";

const logger = createTestLogger();

// Observed subagents have no ManagedAgent, so nothing runs the normal
// registration path that seeds the timeline store. These tests pin the
// regression where every observed timeline append/fetch threw
// "Unknown agent '<parent>::sub::<key>'" — killing the subagent's live
// stream, backfill, and pane transcript all at once.
interface ObservedInternals {
  onObservedSubagentUpdated(
    agent: { id: string; cwd: string; workspaceId?: string },
    event: {
      type: "observed_subagent_updated";
      provider: "claude";
      update: ObservedSubagentUpdate;
    },
  ): void;
  onObservedSubagentTimeline(
    agent: { id: string; cwd: string; workspaceId?: string },
    event: {
      type: "observed_subagent_timeline";
      provider: "claude";
      key: string;
      item: AgentTimelineItem;
      turnId?: string;
    },
  ): void;
}

const PARENT = { id: "parent-1", cwd: "/tmp/project" };
const OBSERVED_ID = "parent-1::sub::task-1";

function createHarness() {
  const manager = new AgentManager({ logger });
  const streamed: Array<{ agentId: string; itemType: string }> = [];
  manager.subscribe((event) => {
    if (event.type === "agent_stream" && event.event.type === "timeline") {
      streamed.push({ agentId: event.agentId, itemType: event.event.item.type });
    }
  });
  const internals = manager as unknown as ObservedInternals;
  return { manager, streamed, internals };
}

test("observed subagent timeline items are recorded and streamed, not dropped", () => {
  const { manager, streamed, internals } = createHarness();

  internals.onObservedSubagentTimeline(PARENT, {
    type: "observed_subagent_timeline",
    provider: "claude",
    key: "task-1",
    item: { type: "assistant_message", text: "scanning files" },
  });

  expect(streamed).toEqual([{ agentId: OBSERVED_ID, itemType: "assistant_message" }]);

  const timeline = manager.fetchTimeline(OBSERVED_ID, { direction: "tail", limit: 0 });
  expect(timeline.rows.map((row) => row.item.type)).toEqual(["assistant_message"]);
});

test("fetchTimeline on a known observed subagent with no items returns empty instead of throwing", () => {
  const { manager, internals } = createHarness();

  internals.onObservedSubagentUpdated(PARENT, {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { key: "task-1", taskId: "t-1", status: "running", subAgentType: "code-explorer" },
  });

  const timeline = manager.fetchTimeline(OBSERVED_ID, { direction: "tail", limit: 0 });
  expect(timeline.rows).toEqual([]);
});

test("a nested update parents the row to the spawning observed subagent", () => {
  const { manager, internals } = createHarness();

  internals.onObservedSubagentUpdated(PARENT, {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { key: "branch-1", status: "running", description: "Branch A" },
  });
  internals.onObservedSubagentUpdated(PARENT, {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { key: "leaf-1", parentKey: "branch-1", status: "running", description: "Leaf A1" },
  });

  const branch = manager.getObservedSubagentPayload("parent-1::sub::branch-1");
  const leaf = manager.getObservedSubagentPayload("parent-1::sub::leaf-1");
  expect(branch?.labels[PARENT_AGENT_ID_LABEL]).toBe("parent-1");
  expect(leaf?.labels[PARENT_AGENT_ID_LABEL]).toBe("parent-1::sub::branch-1");

  // A later update that omits parentKey (e.g. a task_notification) keeps the
  // remembered tree parent instead of snapping the row back to the root.
  internals.onObservedSubagentUpdated(PARENT, {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { key: "leaf-1", status: "idle" },
  });
  expect(
    manager.getObservedSubagentPayload("parent-1::sub::leaf-1")?.labels[PARENT_AGENT_ID_LABEL],
  ).toBe("parent-1::sub::branch-1");
});

test("listObservedSubagentPayloads surfaces in-flight rows for the agent-list fetch", async () => {
  const { manager, internals } = createHarness();

  internals.onObservedSubagentUpdated(PARENT, {
    type: "observed_subagent_updated",
    provider: "claude",
    update: { key: "task-1", taskId: "t-1", status: "running", subAgentType: "code-explorer" },
  });

  const listed = manager.listObservedSubagentPayloads();
  expect(listed.map((payload) => payload.id)).toEqual([OBSERVED_ID]);
  expect(listed[0]).toMatchObject({ status: "running", attend: "observed" });

  // Archived rows keep their archivedAt stamp so the shared archived filter
  // in the agent-list path drops them like any other agent.
  const { archivedAt } = await manager.archiveObservedSubagent(OBSERVED_ID);
  expect(manager.listObservedSubagentPayloads()[0]?.archivedAt).toBe(archivedAt);
});
