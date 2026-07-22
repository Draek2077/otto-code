import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Run, RunPlan } from "@otto-code/protocol/orchestration";

import { RunStore } from "./run-store.js";
import { RunService, type RunSpawnPort } from "./run-service.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// A fake spawn port: every spawned agent immediately "finishes" with a fixed
// message. Verify phases return a passing verdict so judged phases succeed.
function fakeSpawnPort(overrides: Partial<RunSpawnPort> = {}): RunSpawnPort {
  let counter = 0;
  return {
    async resolveRole(role) {
      return { personalityId: `p_${role}` };
    },
    async spawn(input) {
      return { agentId: `agent_${counter++}`, personalityId: `p_${input.role}` };
    },
    async awaitAgent() {
      return { finalMessage: JSON.stringify({ verdict: "pass", score: 1 }), failed: false };
    },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("RunService", () => {
  let dir: string;
  let store: RunStore;
  let service: RunService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "otto-runsvc-"));
    store = new RunStore(join(dir, "runs"));
    service = new RunService({ store, logger: silentLogger });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const simplePlan: RunPlan = {
    title: "Build and ship",
    phases: [
      { id: "impl", type: "implement", title: "Build", task: "build it" },
      { id: "ship", type: "deliver", title: "Ship", task: "ship it", dependsOn: ["impl"] },
    ],
  };

  test("startRun executes to done and persists the run", async () => {
    const { run, settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    expect(run.status).toBe("pending");
    const final = await settled;
    expect(final.status).toBe("done");
    // Persisted and visible via getRun + the store.
    expect(service.getRun(run.id)?.status).toBe("done");
    expect((await store.get(run.id))?.status).toBe("done");
  });

  test("onChange fires as the run progresses", async () => {
    const listener = vi.fn();
    service.onChange(listener);
    const { settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    await settled;
    const statuses = listener.mock.calls.map((c) => (c[0] as Run).status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("done");
  });

  test("pauses at a gate and resumes when the gate is answered", async () => {
    const gatedPlan: RunPlan = {
      title: "Gated",
      phases: [
        { id: "plan", type: "plan", title: "Plan", task: "plan it" },
        { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
        { id: "impl", type: "implement", title: "Build", task: "build", dependsOn: ["gate"] },
      ],
    };
    const { run, settled } = service.startRun({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    // Wait until the run parks at the gate.
    await waitFor(() => service.getRun(run.id)?.status === "paused");
    expect(service.respondToGate(run.id, { approved: true, note: "go" })).toBe(true);
    const final = await settled;
    expect(final.status).toBe("done");
    expect(final.phases.find((p) => p.id === "gate")?.notes).toBe("go");
  });

  test("cancelRun aborts a run parked at a gate", async () => {
    const gatedPlan: RunPlan = {
      title: "Cancelable",
      phases: [{ id: "gate", type: "gate", title: "Approve", task: "ok?" }],
    };
    const { run, settled } = service.startRun({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    await waitFor(() => service.getRun(run.id)?.status === "paused");
    expect(service.cancelRun(run.id)).toBe(true);
    const final = await settled;
    expect(final.status).toBe("canceled");
  });

  test("settleOrPause resolves with the terminal run", async () => {
    const { run, settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    const outcome = await service.settleOrPause({ runId: run.id, settled });
    expect(outcome.status).toBe("done");
  });

  test("settleOrPause returns at the gate pause without awaiting completion", async () => {
    const gatedPlan: RunPlan = {
      title: "Gated",
      phases: [
        { id: "plan", type: "plan", title: "Plan", task: "plan it" },
        { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
        { id: "impl", type: "implement", title: "Build", task: "build", dependsOn: ["gate"] },
      ],
    };
    const { run, settled } = service.startRun({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    const outcome = await service.settleOrPause({ runId: run.id, settled });
    expect(outcome.status).toBe("paused");
    // The run is still live — answering the gate drives it to completion.
    expect(service.respondToGate(run.id, { approved: true })).toBe(true);
    expect((await settled).status).toBe("done");
  });

  test("summarizes a terminal run via the injected summarizer", async () => {
    const summarized = new RunService({
      store,
      logger: silentLogger,
      summarize: async (run) => `Recap of ${run.title}`,
    });
    const { run, settled } = summarized.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    await settled;
    await waitFor(() => summarized.getRun(run.id)?.summaryStatus === "ready");
    expect(summarized.getRun(run.id)?.summary).toBe("Recap of Build and ship");
  });

  test("marks the summary failed when the summarizer throws", async () => {
    const summarized = new RunService({
      store,
      logger: silentLogger,
      summarize: async () => {
        throw new Error("no writer available");
      },
    });
    const { run, settled } = summarized.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    await settled;
    await waitFor(() => summarized.getRun(run.id)?.summaryStatus === "failed");
    expect(summarized.getRun(run.id)?.summary).toBeUndefined();
  });

  test("init marks a persisted in-flight run as failed (no live engine)", async () => {
    const orphan: Run = {
      id: "run_orphan",
      title: "Was running",
      status: "running",
      phases: [{ id: "a", type: "implement", title: "A", task: "x", status: "running" }],
      createdAt: "2023-11-14T00:00:00.000Z",
      updatedAt: "2023-11-14T00:00:00.000Z",
    };
    await store.save(orphan);
    const fresh = new RunService({ store, logger: silentLogger });
    await fresh.init();
    const recovered = fresh.getRun("run_orphan");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toContain("Daemon restarted");
  });

  test("deleteRun removes a finished run from memory, disk, and listeners", async () => {
    const removed: string[][] = [];
    service.onRemove((runIds) => removed.push(runIds));
    const { run, settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    await settled;

    const result = await service.deleteRun(run.id);
    expect(result).toEqual({ deleted: true });
    expect(service.getRun(run.id)).toBeNull();
    expect(await store.get(run.id)).toBeNull();
    expect(removed).toEqual([[run.id]]);
  });

  test("deleteRun refuses an in-flight run and an unknown id", async () => {
    // Delete before the run settles: the guard exists so a cleanup click can't
    // orphan the run's agents — the caller has to cancel first.
    const { run, settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    const refused = await service.deleteRun(run.id);
    expect(refused.deleted).toBe(false);
    expect(refused.error).toContain("Cancel");
    await settled;
    expect(service.getRun(run.id)).not.toBeNull();

    expect(await service.deleteRun("run_nope")).toEqual({
      deleted: false,
      error: "Run not found",
    });
  });

  test("re-saves a draft in place when given its runId (Edit Orchestration)", async () => {
    const graph = {
      id: "g1",
      name: "Sweep",
      inputs: [{ key: "goal", label: "Goal" }],
      nodes: [
        { id: "root", kind: "orchestrator", title: "Orchestrator" },
        { id: "a", kind: "agent", title: "A", role: "coder", prompt: "Do {{inputs.goal}}" },
      ],
      edges: [{ from: "root", to: "a" }],
    };
    const draft = await service.createDraftGraphRun({
      graph,
      title: "First name",
      description: "First description",
      graphInputs: { goal: "one" },
      cwd: "/repo",
    });
    expect(draft.status).toBe("draft");

    const edited = await service.createDraftGraphRun({
      graph,
      title: "Second name",
      description: "Second description",
      graphInputs: { goal: "two" },
      cwd: "/repo",
      runId: draft.id,
    });
    // Same record, new values — an edit must not leave a second draft behind.
    expect(edited.id).toBe(draft.id);
    expect(edited.status).toBe("draft");
    expect(service.getRun(draft.id)?.title).toBe("Second name");
    expect(service.getRun(draft.id)?.description).toBe("Second description");
    expect(service.getRun(draft.id)?.graphInputs).toEqual({ goal: "two" });
    expect(service.listRuns().filter((run) => run.status === "draft")).toHaveLength(1);
  });

  test("refuses to re-save a draft that isn't one", async () => {
    const graph = {
      id: "g1",
      name: "Sweep",
      nodes: [{ id: "root", kind: "orchestrator", title: "Orchestrator" }],
      edges: [],
    };
    await expect(
      service.createDraftGraphRun({ graph, title: "T", runId: "run_nope" }),
    ).rejects.toThrow("not found");

    const { run, settled } = service.startRun({ plan: simplePlan, spawnPort: fakeSpawnPort() });
    await settled;
    await expect(service.createDraftGraphRun({ graph, title: "T", runId: run.id })).rejects.toThrow(
      "not a draft",
    );
  });

  test("hard-fails and names the gap when the team lacks a role", async () => {
    const port = fakeSpawnPort({
      async resolveRole(role) {
        return role === "researcher" ? null : { personalityId: `p_${role}` };
      },
    });
    const { run, settled } = service.startRun({
      plan: {
        title: "needs researcher",
        phases: [{ id: "r", type: "research", title: "R", task: "survey" }],
      },
      spawnPort: port,
    });
    const final = await settled;
    expect(final.status).toBe("failed");
    expect(final.error).toContain("researcher");
    void run;
  });
});
