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
  test("replaces caller-supplied Team seats, checks the selected conductor tools, and captures the result", async () => {
    const role = {
      role: "orchestrator",
      profileId: "p",
      name: "Coordinator",
      prompt: "Coordinate",
      seat: { provider: "mock", model: "team-model" },
    };
    const team = { id: "team", name: "Review team", roles: [role] };
    const checked: string[] = [];
    const review = await reviewWorkflow(
      {
        ...f.ports,
        captureTeam: async () => team,
        validateSeat: async () => [],
        validateTools: async (seat) => {
          checked.push(seat.model ?? "");
          return [];
        },
      },
      f.scope,
      "workspace-1",
      { ...f.ai, teamSnapshot: { id: "fake", name: "Fake", roles: [] } },
      "team-review",
    );
    expect(checked).toEqual(["team-model"]);
    role.seat.model = "edited";
    expect(review.launch.teamSnapshot?.roles[0]?.seat.model).toBe("team-model");
    await expect(
      validatePlan(f.ports, review, {
        title: "Research",
        phases: [{ id: "research", type: "research", title: "Survey", task: "Read the project" }],
      }),
    ).rejects.toThrow(/researcher/);
  });
  test("gate-only AI plans cannot bypass the phase budget without spawning workers", async () => {
    await expect(
      validatePlan(
        f.ports,
        {
          launch: f.ai,
          workspace: { workspaceId: "workspace-1", projectId: f.scope.projectId, cwd: f.repo },
        },
        {
          title: "Oversized",
          phases: Array.from({ length: 65 }, (_, index) => ({
            id: `gate-${index}`,
            type: "gate",
            title: "Gate",
            task: "Review",
          })),
        },
      ),
    ).rejects.toThrow("64 phases");
    expect(f.agents.size).toBe(0);
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
