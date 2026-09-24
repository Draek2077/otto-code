import { describe, expect, it, vi } from "vitest";
import { AgentManager } from "./agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  ControlledProviderSubagentStore,
  providerSubagentArchiveLabel,
} from "./provider-subagent-control.js";
import type { AgentProvider, AgentSession, ObservedSubagentUpdate } from "./agent-sdk-types.js";

function harness(
  stop = vi.fn<NonNullable<AgentSession["stopProviderSubagent"]>>().mockResolvedValue(undefined),
  provider: AgentProvider = "codex",
) {
  const manager = new AgentManager({ logger: createTestLogger() });
  const parent = {
    id: "11111111-1111-4111-8111-111111111111",
    provider,
    internal: false,
    labels: {} as Record<string, string>,
    session: { stopProviderSubagent: stop },
  };
  const internals = manager as unknown as {
    agents: Map<string, typeof parent>;
    providerSubagents: ControlledProviderSubagentStore;
  };
  internals.agents.set(parent.id, parent);
  const write = vi.spyOn(manager, "setLabels").mockImplementation(async (_id, labels) => {
    Object.assign(parent.labels, labels);
  });
  const close = vi.spyOn(manager, "closeAgent").mockResolvedValue(undefined);
  const updates: unknown[] = [];
  manager.subscribe((event) => {
    if (event.type === "provider_subagent") updates.push(event.event);
  });
  const ingest = (id: string, status: "running" | "completed" = "running") =>
    internals.providerSubagents.apply(parent.id, provider, { type: "upsert", id, status });
  ingest("noop");
  ingest("sibling");
  return {
    manager,
    parent,
    store: internals.providerSubagents,
    stop,
    write,
    close,
    updates,
    ingest,
  };
}

function announceClaudeObserved(manager: AgentManager, parentId: string, key: string): void {
  const observed = manager as unknown as {
    onObservedSubagentUpdated(
      parent: { id: string; cwd: string },
      event: {
        type: "observed_subagent_updated";
        provider: "claude";
        update: ObservedSubagentUpdate;
      },
    ): void;
  };
  observed.onObservedSubagentUpdated(
    { id: parentId, cwd: "/project" },
    {
      type: "observed_subagent_updated",
      provider: "claude",
      update: { key, status: "idle" },
    },
  );
}

describe("provider subagent lifecycle control", () => {
  it("persists all three Claude Clear tombstones when archives arrive together", async () => {
    const h = harness(undefined, "claude");
    const keys = ["task-a", "task-b", "task-c"];
    for (const key of keys) {
      announceClaudeObserved(h.manager, h.parent.id, key);
      h.store.apply(h.parent.id, "claude", {
        type: "upsert",
        id: key,
        status: "completed",
        toolCallId: key,
      });
    }
    let writesInFlight = 0;
    let maxWritesInFlight = 0;
    let persistedLabels: Record<string, string> = {};
    h.write.mockImplementation(async (_id, labels) => {
      Object.assign(h.parent.labels, labels);
      const snapshot = { ...h.parent.labels };
      writesInFlight += 1;
      maxWritesInFlight = Math.max(maxWritesInFlight, writesInFlight);
      await new Promise((resolve) =>
        setTimeout(resolve, labels[providerSubagentArchiveLabel("task-a")] ? 10 : 1),
      );
      persistedLabels = snapshot;
      writesInFlight -= 1;
    });

    await Promise.all(
      keys.map((key) => h.manager.archiveObservedSubagent(`${h.parent.id}::sub::${key}`)),
    );

    expect(maxWritesInFlight).toBe(1);
    expect(Object.keys(persistedLabels).sort()).toEqual(
      keys.map(providerSubagentArchiveLabel).sort(),
    );
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("archives a provider twin with its observed row so one Clear survives directory refresh", async () => {
    const h = harness(undefined, "claude");
    announceClaudeObserved(h.manager, h.parent.id, "task-call");
    h.store.apply(h.parent.id, "claude", {
      type: "upsert",
      id: "provider-child",
      status: "completed",
      toolCallId: "task-call",
    });

    await h.manager.archiveObservedSubagent(`${h.parent.id}::sub::task-call`);

    expect(h.store.get(h.parent.id, "provider-child")?.archivedAt).toEqual(expect.any(String));
    expect(
      h.manager.listObservedSubagentPayloads().find((row) => row.id.endsWith("::task-call"))
        ?.archivedAt,
    ).toEqual(expect.any(String));
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("keeps an observed row retryable when archiving its provider twin fails", async () => {
    const h = harness(undefined, "claude");
    announceClaudeObserved(h.manager, h.parent.id, "task-call");
    h.store.apply(h.parent.id, "claude", {
      type: "upsert",
      id: "provider-child",
      status: "completed",
      toolCallId: "task-call",
    });
    h.write.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      h.manager.archiveObservedSubagent(`${h.parent.id}::sub::task-call`),
    ).rejects.toThrow("storage unavailable");
    expect(h.store.get(h.parent.id, "provider-child")?.archivedAt).toBeUndefined();
    expect(
      h.manager.listObservedSubagentPayloads().find((row) => row.id.endsWith("::task-call"))
        ?.archivedAt,
    ).toBeUndefined();
  });

  it("stops only the selected child and broadcasts its settled state", async () => {
    const h = harness();
    await h.manager.controlProviderSubagent(h.parent.id, "noop", "stop");
    expect(h.stop).toHaveBeenCalledWith("noop");
    expect(h.close).not.toHaveBeenCalled();
    expect(h.store.get(h.parent.id, "noop")?.status).toBe("canceled");
    expect(h.store.get(h.parent.id, "sibling")?.status).toBe("running");
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        type: "upsert",
        subagent: expect.objectContaining({ id: "noop", status: "canceled" }),
      }),
    );
  });

  it("does not archive or claim a stop when the provider rejects cancellation", async () => {
    const h = harness(vi.fn().mockRejectedValue(new Error("provider rejected")));
    await expect(h.manager.controlProviderSubagent(h.parent.id, "noop", "archive")).rejects.toThrow(
      "provider rejected",
    );
    expect(h.write).not.toHaveBeenCalled();
    expect(h.store.get(h.parent.id, "noop")?.status).toBe("running");
    expect(h.updates).toEqual([]);
  });

  it("requires explicit permission for the wider parent-session stop", async () => {
    const h = harness();
    delete (h.parent.session as Partial<typeof h.parent.session>).stopProviderSubagent;
    await expect(h.manager.controlProviderSubagent(h.parent.id, "noop", "stop")).rejects.toThrow(
      "Confirm the wider stop",
    );
    expect(h.close).not.toHaveBeenCalled();
    await h.manager.controlProviderSubagent(h.parent.id, "noop", "stop", true);
    expect(h.close).toHaveBeenCalledWith(h.parent.id);
  });

  it("keeps the row visible when persisting its archive fails", async () => {
    const h = harness();
    h.ingest("noop", "completed");
    h.write.mockImplementation(async (_id, labels) => {
      Object.assign(h.parent.labels, labels);
      throw new Error("storage unavailable");
    });
    await expect(h.manager.controlProviderSubagent(h.parent.id, "noop", "archive")).rejects.toThrow(
      "storage unavailable",
    );
    expect(h.store.get(h.parent.id, "noop")?.archivedAt).toBeUndefined();
    expect(h.updates).toEqual([]);
  });

  it("persists archive ownership on the parent and preserves history through late updates and replay", async () => {
    const h = harness();
    h.ingest("noop", "completed");
    h.store.apply(h.parent.id, "codex", {
      type: "timeline",
      id: "noop",
      item: { type: "assistant_message", text: "Kept history" },
    });
    await h.manager.controlProviderSubagent(h.parent.id, "noop", "archive");
    const archivedAt = h.parent.labels[providerSubagentArchiveLabel("noop")];
    expect(archivedAt).toEqual(expect.any(String));
    expect(h.stop).not.toHaveBeenCalled();
    h.ingest("noop");
    expect(h.store.get(h.parent.id, "noop")?.archivedAt).toBe(archivedAt);
    expect(h.store.fetchTimeline(h.parent.id, "noop").rows).toHaveLength(1);
    const reloaded = new ControlledProviderSubagentStore(() => ({
      labels: { ...h.parent.labels },
    }));
    reloaded.apply(h.parent.id, "codex", { type: "upsert", id: "noop", status: "running" });
    expect(reloaded.get(h.parent.id, "noop")?.archivedAt).toBe(archivedAt);
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        type: "upsert",
        subagent: expect.objectContaining({ id: "noop", archivedAt }),
      }),
    );
  });

  it("refuses an unknown child without operating on the parent", async () => {
    const h = harness();
    await expect(
      h.manager.controlProviderSubagent(h.parent.id, "foreign-child", "stop", true),
    ).rejects.toThrow("not found");
    expect(h.close).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });
});
