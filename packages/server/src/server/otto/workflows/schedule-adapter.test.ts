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
