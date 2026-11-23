import { test, expect } from "vitest";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { WorkflowScheduleAdapter } from "./schedule-adapter.js";
test("Schedule adapter uses the same exact-revision Graph owner and captures durable provenance", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.graph.kind !== "graph") throw new Error("Expected Graph");
    const source = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    const adapter = new WorkflowScheduleAdapter(f.host);
    const input = {
      source: source.ref,
      expectedRevision: source.revision,
      workspaceId: "workspace-1",
      seats: f.graph.seats,
      limits: f.graph.limits,
      inputs: {},
      scheduleSource: { scheduleId: "schedule-1", scheduleRunId: "invocation-1" },
    };
    const run = await adapter.start(input);
    await f.host.settled(run.ref);
    expect((await f.library.read(run.ref)).document.value).toMatchObject({
      status: "done",
      scheduleSource: input.scheduleSource,
    });
    const count = f.agents.size;
    expect((await adapter.start(input)).ref).toEqual(run.ref);
    expect(f.agents.size).toBe(count);
    await expect(adapter.start({ ...input, expectedRevision: "changed" })).rejects.toMatchObject({
      kind: "conflict",
    });
  } finally {
    await f.cleanup();
  }
});

test("AI Schedule preparation starts no sessions and preserves saved approval intent", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.ai.kind !== "ai") throw new Error("Expected AI definition");
    const source = await f.library.write(
      f.scope,
      { kind: "ai", value: { ...f.ai.definition, autopilot: false } },
      null,
    );
    const adapter = new WorkflowScheduleAdapter(f.host);
    const scheduleSource = { scheduleId: "schedule-ai", scheduleRunId: "invocation-ai" };
    const prepared = await adapter.prepare({
      source: source.ref,
      expectedRevision: source.revision,
      workspaceId: "workspace-1",
      seats: f.ai.definition.seats,
      limits: f.ai.definition.limits,
      inputs: {},
      scheduleSource,
    });
    expect(f.agents.size).toBe(0);
    const run = await prepared.start();
    expect(run.document.value).toMatchObject({
      status: "planning",
      scheduleSource,
      launch: { kind: "ai", definition: { autopilot: false } },
    });
    expect(f.agents.size).toBe(1);
    let settled = false;
    const waiting = f.host.waitForSettlement(run.ref).then((entry) => {
      settled = true;
      return entry;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const canceled = await adapter.cancel(run.ref);
    expect((await waiting).document.value).toMatchObject({ status: "canceled" });
    expect(canceled.document.value).toMatchObject({ status: "canceled", scheduleSource });
  } finally {
    await f.cleanup();
  }
});

test("abandoning Schedule preflight releases review capacity without creating agents", async () => {
  const f = await workflowHostFixture();
  try {
    if (f.graph.kind !== "graph") throw new Error("Expected Graph");
    const source = await f.library.write(f.scope, { kind: "graph", value: f.graph.graph }, null);
    const adapter = new WorkflowScheduleAdapter(f.host);
    for (let index = 0; index < 20; index++) {
      const prepared = await adapter.prepare({
        source: source.ref,
        expectedRevision: source.revision,
        workspaceId: "workspace-1",
        seats: f.graph.seats,
        limits: f.graph.limits,
        inputs: {},
        scheduleSource: { scheduleId: "schedule", scheduleRunId: `run-${index}` },
      });
      prepared.release();
    }
    expect(f.agents.size).toBe(0);
  } finally {
    await f.cleanup();
  }
});
