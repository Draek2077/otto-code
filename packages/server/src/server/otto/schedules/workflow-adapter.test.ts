import { expect, test, vi } from "vitest";
import { workflowHostFixture, deferred } from "../workflows/test-utils/host-fixture.js";
import { WorkflowScheduleAdapter } from "../workflows/schedule-adapter.js";
import { SavedWorkflowScheduleAdapter } from "./workflow-adapter.js";
import type { ScheduleTarget, ScheduleAudit } from "./types.js";

test.each(["seats", "limits"] as const)(
  "saved AI %s changes require fresh approval even with explicit Schedule overrides",
  async (field) => {
    const f = await workflowHostFixture();
    try {
      if (f.ai.kind !== "ai") throw new Error("Expected AI");
      const definition = f.ai.definition;
      const source = await f.library.write(f.scope, { kind: "ai", value: definition }, null);
      const adapter = new SavedWorkflowScheduleAdapter(new WorkflowScheduleAdapter(f.host));
      const target: Extract<ScheduleTarget, { type: "workflow" }> = {
        type: "workflow",
        source: { ...source.ref, kind: "ai" },
        workspaceId: "workspace-1",
        seats: definition.seats,
        limits: definition.limits,
        inputs: {},
        approval: {
          policyFingerprint: "a".repeat(64),
          allowTemplateCode: false,
          allowQueryEffects: false,
        },
      };
      const approved = await adapter.review(target, f.scope);
      await f.library.write(
        f.scope,
        {
          kind: "ai",
          value: {
            ...definition,
            ...(field === "seats"
              ? { seats: { ...definition.seats, worker: { provider: "changed", model: "other" } } }
              : { limits: { ...definition.limits, maxAgents: definition.limits.maxAgents + 1 } }),
          },
        },
        source.revision,
        source.ref,
      );
      await expect(
        adapter.prepare(approved, f.scope, { scheduleId: "schedule", runId: "next-fire" }),
      ).rejects.toThrow("authority changed");
      expect(f.agents.size).toBe(0);
    } finally {
      await f.cleanup();
    }
  },
);

test("a future fire resolves latest saved payload and stamps its exact revision before starting", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.graph.kind !== "graph") throw new Error("Expected Graph");
    const source = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    const adapter = new SavedWorkflowScheduleAdapter(new WorkflowScheduleAdapter(f.host));
    const target: Extract<ScheduleTarget, { type: "workflow" }> = {
      type: "workflow",
      source: { ...source.ref, kind: "graph" },
      workspaceId: "workspace-1",
      seats: f.graph.seats,
      limits: f.graph.limits,
      inputs: {},
      approval: {
        policyFingerprint: "a".repeat(64),
        allowTemplateCode: false,
        allowQueryEffects: false,
      },
    };
    const approved = await adapter.review(target, f.scope);
    const changed = await f.library.write(
      f.scope,
      {
        kind: "graph",
        value: {
          ...f.graph.graph,
          name: "Current title",
          nodes: f.graph.graph.nodes.map((node) => ({ ...node, prompt: "Updated task" })),
        },
      },
      source.revision,
      source.ref,
    );
    const prepared = await adapter.prepare(approved, f.scope, {
      scheduleId: "schedule",
      runId: "fire",
    });
    expect(f.agents.size).toBe(0);
    expect(prepared.audit.resolved).toMatchObject({
      title: "Current title",
      revision: changed.revision,
      workflowKind: "graph",
    });
    const stamp = vi.fn(async (_audit: Partial<ScheduleAudit>) => {});
    const result = await prepared.execute(new AbortController().signal, stamp);
    prepared.release?.();
    expect(result.audit?.disposition).toBe("succeeded");
    expect(stamp).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ kind: "workflow" }) }),
    );
    expect(f.turns.some((turn) => turn.text.includes("Updated task"))).toBe(true);
  } finally {
    await f.cleanup();
  }
});
test("changed saved authority blocks before any provider session and releases its review", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.graph.kind !== "graph") throw new Error("Expected Graph");
    const source = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    const adapter = new SavedWorkflowScheduleAdapter(new WorkflowScheduleAdapter(f.host));
    const target: Extract<ScheduleTarget, { type: "workflow" }> = {
      type: "workflow",
      source: { ...source.ref, kind: "graph" },
      workspaceId: "workspace-1",
      seats: f.graph.seats,
      limits: f.graph.limits,
      inputs: {},
      approval: {
        policyFingerprint: "a".repeat(64),
        allowTemplateCode: false,
        allowQueryEffects: false,
      },
    };
    const approved = await adapter.review(target, f.scope);
    await f.library.write(
      f.scope,
      {
        kind: "graph",
        value: {
          ...f.graph.graph,
          nodes: f.graph.graph.nodes.map((node) =>
            node.kind === "agent" ? { ...node, access: "read" } : node,
          ),
        },
      },
      source.revision,
      source.ref,
    );
    for (let index = 0; index < 18; index++)
      await expect(
        adapter.prepare(approved, f.scope, { scheduleId: "schedule", runId: `fire-${index}` }),
      ).rejects.toThrow("authority changed");
    expect(f.agents.size).toBe(0);
  } finally {
    await f.cleanup();
  }
});
test("scheduled AI remains pending through Planning and exact-owner cancellation settles it", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.ai.kind !== "ai") throw new Error("Expected AI");
    const source = await f.library.write(
      f.scope,
      { kind: "ai", value: { ...f.ai.definition, autopilot: false } },
      null,
    );
    const adapter = new SavedWorkflowScheduleAdapter(new WorkflowScheduleAdapter(f.host));
    const target: Extract<ScheduleTarget, { type: "workflow" }> = {
      type: "workflow",
      source: { ...source.ref, kind: "ai" },
      workspaceId: "workspace-1",
      seats: f.ai.definition.seats,
      limits: f.ai.definition.limits,
      inputs: {},
      approval: {
        policyFingerprint: "a".repeat(64),
        allowTemplateCode: false,
        allowQueryEffects: false,
      },
    };
    const approved = await adapter.review(target, f.scope);
    const prepared = await adapter.prepare(approved, f.scope, {
      scheduleId: "schedule",
      runId: "ai-fire",
    });
    const started = deferred<void>();
    let complete = false;
    const pending = prepared
      .execute(new AbortController().signal, async () => {
        started.resolve();
      })
      .catch((error) => {
        complete = true;
        return error;
      });
    await started.promise;
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(f.agents.size).toBe(1);
    expect(await prepared.cancel?.()).toBe("settled");
    expect(await pending).toMatchObject({
      disposition: "canceled",
      audit: { result: { kind: "workflow" } },
    });
    prepared.release?.();
    expect(f.subscriptions()).toBe(0);
  } finally {
    await f.cleanup();
  }
});
test.each([false, true])(
  "review exposes saved autopilot=%s and changes require explicit review before another fire",
  async (autopilot) => {
    const f = await workflowHostFixture();
    try {
      if (f.ai.kind !== "ai") throw new Error("Expected AI");
      const definition = { ...f.ai.definition, autopilot };
      const source = await f.library.write(f.scope, { kind: "ai", value: definition }, null);
      const adapter = new SavedWorkflowScheduleAdapter(new WorkflowScheduleAdapter(f.host));
      const target: Extract<ScheduleTarget, { type: "workflow" }> = {
        type: "workflow",
        source: { ...source.ref, kind: "ai" },
        workspaceId: "workspace-1",
        seats: f.ai.definition.seats,
        limits: f.ai.definition.limits,
        inputs: {},
        approval: {
          policyFingerprint: "a".repeat(64),
          allowTemplateCode: false,
          allowQueryEffects: false,
        },
      };
      const details = await adapter.reviewDetails(target, f.scope);
      const reviewed = details.target;
      expect(details.autopilot).toBe(autopilot);
      expect(details.title).toBe(definition.title);
      await f.library.write(
        f.scope,
        {
          kind: "ai",
          value: { ...definition, autopilot: !autopilot },
        },
        source.revision,
        source.ref,
      );
      await expect(
        adapter.prepare(reviewed, f.scope, {
          scheduleId: "schedule",
          runId: "next-fire",
        }),
      ).rejects.toThrow("authority changed");
      expect(f.agents.size).toBe(0);
      await expect(adapter.review(target, { ...f.scope, hostId: "foreign" })).rejects.toMatchObject(
        {
          kind: "invalid",
        },
      );
    } finally {
      await f.cleanup();
    }
  },
);
