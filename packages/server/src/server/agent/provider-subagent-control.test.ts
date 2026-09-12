import { describe, expect, it, vi } from "vitest";
import { AgentManager } from "./agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  ControlledProviderSubagentStore,
  providerSubagentArchiveLabel,
} from "./provider-subagent-control.js";
import type { AgentSession } from "./agent-sdk-types.js";

function harness(
  stop = vi.fn<NonNullable<AgentSession["stopProviderSubagent"]>>().mockResolvedValue(undefined),
) {
  const manager = new AgentManager({ logger: createTestLogger() });
  const parent = {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "codex",
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
    internals.providerSubagents.apply(parent.id, "codex", { type: "upsert", id, status });
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

describe("provider subagent lifecycle control", () => {
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
