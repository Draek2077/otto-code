import { beforeEach, afterEach, describe, test, expect } from "vitest";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { reviewWorkflow, validatePlan } from "./preflight.js";
describe("Workflow authority preflight", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  beforeEach(async () => {
    f = await workflowHostFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("graph input defaults are explicit launch data; required blanks still reject", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.inputs = [
      { key: "topic", label: "Topic", defaultValue: "Original", required: true },
    ];
    const review = await reviewWorkflow(f.ports, f.scope, "workspace-1", graph, "defaults");
    expect(review.launch).toMatchObject({ inputs: { topic: "Original" } });
    graph.inputs.topic = " ";
    await expect(reviewWorkflow(f.ports, f.scope, "workspace-1", graph, "blank")).rejects.toThrow(
      "topic",
    );
    expect(f.agents.size).toBe(0);
  });
  test("unknown node kinds stay parseable but cannot execute on an older host", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].kind = "future-operation";
    await expect(f.host.review(f.scope, "workspace-1", graph, "future")).rejects.toThrow(
      "unsupported kind",
    );
    expect(f.agents.size).toBe(0);
  });
  test.each(["__proto__", "constructor", "prototype"])(
    "reserved descriptor %s is rejected before creating a native session",
    async (key) => {
      const graph = structuredClone(f.graph);
      if (graph.kind !== "graph") throw new Error("Fixture");
      graph.graph.nodes[1].output = { fields: [{ key, type: "string" }] };
      await expect(f.host.review(f.scope, "workspace-1", graph, "reserved")).rejects.toThrow(
        "reserved",
      );
      expect(f.agents.size).toBe(0);
    },
  );
  test("unknown capability declarations cannot silently run with missing semantics", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.requires = ["future-isolation"];
    await expect(f.host.review(f.scope, "workspace-1", graph, "future")).rejects.toThrow(
      "capability declarations",
    );
    expect(f.agents.size).toBe(0);
  });
  test("default AI seats retain write-mode provider coverage; fan-out verifies read access", async () => {
    f.hooks.validate = async (_seat, _workspace, access) =>
      access === "read" ? ["No read adapter"] : [];
    await f.host.review(f.scope, "workspace-1", f.ai, "ordinary");
    await expect(
      validatePlan(
        f.ports,
        {
          launch: f.ai,
          workspace: { workspaceId: "workspace-1", projectId: f.scope.projectId, cwd: f.repo },
        },
        {
          title: "Research",
          phases: [{ id: "a", title: "A", type: "research", task: "Read", fanOut: 2 }],
        },
      ),
    ).rejects.toThrow("No read adapter");
  });
  test("associated judges are separately validated before starting children", async () => {
    f.hooks.validate = async (_seat, _workspace, access) =>
      access === "read" ? ["Judge unavailable"] : [];
    await expect(
      validatePlan(
        f.ports,
        {
          launch: f.ai,
          workspace: { workspaceId: "workspace-1", projectId: f.scope.projectId, cwd: f.repo },
        },
        {
          title: "Implement",
          phases: [
            { id: "a", title: "A", type: "implement", task: "Work", judge: { role: "judger" } },
          ],
        },
      ),
    ).rejects.toThrow("Judge unavailable");
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].loop = { until: { max: 2, criteria: ["Accurate"] } };
    await expect(f.host.review(f.scope, "workspace-1", graph, "judge")).rejects.toThrow(
      "Judge unavailable",
    );
    expect(f.agents.size).toBe(0);
  });
  test("review fingerprints ignore JSON object insertion order", async () => {
    const first = await reviewWorkflow(f.ports, f.scope, "workspace-1", f.ai, "same");
    const second = await reviewWorkflow(
      f.ports,
      { projectId: f.scope.projectId, hostId: f.scope.hostId },
      "workspace-1",
      f.ai,
      "same",
    );
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
