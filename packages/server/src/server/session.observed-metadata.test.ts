import { expect, test, vi } from "vitest";
import { Session } from "./session.js";
import type { AgentSnapshotPayload } from "./messages.js";
import { toObservedSubagentPayload } from "./agent/agent-projections.js";
import { AgentManager } from "./agent/agent-manager.js";
import type { ObservedSubagentUpdate } from "./agent/agent-sdk-types.js";
import { createTestLogger } from "../test-utils/test-logger.js";

const enrich = (
  Session.prototype as unknown as {
    enrichAgentPayload(payload: AgentSnapshotPayload): Promise<AgentSnapshotPayload>;
  }
).enrichAgentPayload;

function snapshot() {
  return toObservedSubagentPayload({
    id: "parent::sub::child",
    parentAgentId: "parent",
    provider: "claude",
    cwd: "/project",
    createdAt: "2026-09-18T13:00:00Z",
    title: "Fix server session tests",
    update: { key: "child", status: "idle" },
  });
}

test("live enrichment preserves an observed title and archive tombstone without mutating the registry", async () => {
  const payload = Object.freeze({ ...snapshot(), archivedAt: "2026-09-18T14:00:00Z" });
  const result = await enrich.call({ agentStorage: { get: vi.fn(async () => null) } }, payload);
  expect(result).toEqual(payload);
  expect(result).not.toBe(payload);
  expect(result.title).toBe("Fix server session tests");
  expect(result.archivedAt).toBe("2026-09-18T14:00:00Z");
});

test("stored metadata still takes precedence on real chats without mutating the input", async () => {
  const payload = Object.freeze(snapshot());
  const result = await enrich.call(
    { agentStorage: { get: vi.fn(async () => ({ title: "Renamed chat", archivedAt: null })) } },
    payload,
  );
  expect(result.title).toBe("Renamed chat");
  expect(result.archivedAt).toBeNull();
  expect(payload.title).toBe("Fix server session tests");
});

test("cleared rows stay cleared when a new subagent completes and old usage arrives", async () => {
  const manager = new AgentManager({ logger: createTestLogger() });
  const internal = manager as unknown as {
    onObservedSubagentUpdated(
      parent: { id: string; cwd: string },
      event: {
        type: "observed_subagent_updated";
        provider: "claude";
        update: ObservedSubagentUpdate;
      },
    ): void;
  };
  const pending: Promise<unknown>[] = [];
  const received = new Map<string, AgentSnapshotPayload>();
  const context = { agentStorage: { get: vi.fn(async () => null) } };
  manager.subscribe((event) => {
    if (event.type === "observed_agent_state") {
      pending.push(
        enrich.call(context, event.payload).then((payload) => received.set(payload.id, payload)),
      );
    }
  });
  const complete = (key: string) =>
    internal.onObservedSubagentUpdated(
      { id: "parent", cwd: "/project" },
      {
        type: "observed_subagent_updated",
        provider: "claude",
        update: { key, status: "idle", description: `Task ${key}`, cumulativeTokens: 100 },
      },
    );
  complete("one");
  complete("two");
  await Promise.all(pending);
  await manager.archiveObservedSubagent("parent::sub::one");
  await manager.archiveObservedSubagent("parent::sub::two");
  await Promise.all(pending);
  complete("three");
  complete("one");
  await Promise.all(pending);
  expect([...received.values()].filter((row) => !row.archivedAt).map((row) => row.id)).toEqual([
    "parent::sub::three",
  ]);
  expect(
    manager
      .listObservedSubagentPayloads()
      .filter((row) => !row.archivedAt)
      .map((row) => row.id),
  ).toEqual(["parent::sub::three"]);
});
