import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Run, RunPlan } from "@otto-code/protocol/workflow";

import { RunStore } from "./workflow-run-file-store.js";
import { WorkflowService, type RunSpawnPort } from "./workflow-service.js";

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

describe("WorkflowService", () => {
  let dir: string;
  let store: RunStore;
  let service: WorkflowService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "otto-runsvc-"));
    store = new RunStore(join(dir, "runs"));
    service = new WorkflowService({ store, logger: silentLogger });
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
    const { run, settled } = service.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
    expect(run.status).toBe("pending");
    const final = await settled;
    expect(final.status).toBe("done");
    // Persisted and visible via getRun + the store.
    expect(service.getRun(run.id)?.status).toBe("done");
    expect((await store.get(run.id))?.status).toBe("done");
  });

  test("rejects an unpersistable initial Workflow snapshot before any worker spawns", async () => {
    const failingStore = {
      save: vi.fn(async () => {
        throw new Error("disk full");
      }),
    } as unknown as RunStore;
    const failingService = new WorkflowService({ store: failingStore, logger: silentLogger });
    const changes = vi.fn();
    const spawn = vi.fn(fakeSpawnPort().spawn);
    failingService.onChange(changes);

    const { run, settled } = failingService.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort({ spawn }),
    });
    const outcome = await settled;

    expect(outcome).toMatchObject({ id: run.id, status: "failed" });
    expect(outcome.error).toContain("initial snapshot could not be persisted");
    expect(spawn).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
    expect(failingService.getRun(run.id)).toBeNull();
  });

  test("rejects an unpersistable AI planning record before a conductor can be launched", async () => {
    const failingStore = {
      save: vi.fn(async () => {
        throw new Error("disk full");
      }),
    } as unknown as RunStore;
    const failingService = new WorkflowService({ store: failingStore, logger: silentLogger });
    const changes = vi.fn();
    failingService.onChange(changes);

    await expect(failingService.createAiRun({ title: "Plan safely" })).rejects.toThrow("disk full");
    expect(changes).not.toHaveBeenCalled();
    expect(failingService.listRuns()).toEqual([]);
  });

  test("writes project provenance into the first AI Workflow snapshot", async () => {
    const provenance = {
      schemaVersion: 1,
      projectRoot: "/repo",
      projectId: "project_1",
      location: "repository" as const,
      storeKey: "workflows:repository:project_1",
      source: "project-store" as const,
    };
    const scoped = new WorkflowService({
      store,
      logger: silentLogger,
      storageResolver: { provenanceForCwd: async () => provenance },
    });

    const run = await scoped.createAiRun({ title: "Scoped", cwd: "/repo" });

    expect(run.workflowStorage).toEqual(provenance);
    expect(await store.get(run.id)).toMatchObject({ workflowStorage: provenance });
  });

  test("persists a pending Graph snapshot before its root chat may be spawned", async () => {
    const graph = {
      id: "g_prepared",
      name: "Prepared graph",
      nodes: [{ id: "root", kind: "orchestrator", title: "Orchestrator" }],
      edges: [],
    };
    const prepared = await service.prepareGraphRun({
      graph,
      title: "Prepared graph",
      cwd: "/repo",
    });

    expect(prepared.status).toBe("pending");
    expect(await store.get(prepared.id)).toMatchObject({
      id: prepared.id,
      status: "pending",
      kind: "graph",
      graphSnapshot: graph,
    });
  });

  test("activates a durable AI Workflow record in place", async () => {
    const aiRun = await service.createAiRun({
      title: "Fix the release blocker",
      description: "Investigate and deliver a safe fix.",
      cwd: "/repo",
      workspaceId: "workspace_1",
      teamId: "team_1",
      teamName: "Release team",
    });
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor: async () => {},
    });

    const { run, settled } = service.startWorkflow({
      runId: aiRun.id,
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
      conductorAgentId: "agent_planner",
    });
    expect(run).toMatchObject({
      id: aiRun.id,
      title: "Fix the release blocker",
      description: "Investigate and deliver a safe fix.",
      kind: "ai",
      conductorAgentId: "agent_planner",
      workspaceId: "workspace_1",
      teamId: "team_1",
      createdAt: aiRun.createdAt,
    });
    expect((await settled).status).toBe("done");
    expect((await store.get(aiRun.id))?.kind).toBe("ai");
  });

  test("keeps an AI Workflow in Planning until its model declares a plan", async () => {
    const aiRun = await service.createAiRun({ title: "Plan before spending" });
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor: async () => {},
    });

    expect(service.getRun(aiRun.id)).toMatchObject({
      status: "pending",
      kind: "ai",
      phases: [],
    });
    expect(service.getRun(aiRun.id)?.startConfirmation).toBeUndefined();
  });

  test("requires confirmation before a model-declared plan spawns children", async () => {
    const aiRun = await service.createAiRun({ title: "Confirm the plan" });
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor: async () => {},
    });
    const spawn = vi.fn(fakeSpawnPort().spawn);
    const execution = service.startWorkflow({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      plan: {
        title: "Two parallel reviews",
        phases: [{ id: "review", type: "research", title: "Review", task: "Review", fanOut: 2 }],
      },
      spawnPort: fakeSpawnPort({ spawn }),
      requireStartConfirmation: true,
    });

    expect(execution.run).toMatchObject({
      status: "paused",
      startConfirmation: {
        reason: "model-plan-declared",
        plannedAgentCount: 2,
        fanOutPhaseCount: 1,
        agentCap: 40,
      },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(service.respondToStartConfirmation({ runId: aiRun.id, approved: true })).toBe(true);
    expect((await execution.settled).status).toBe("done");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test("rejecting a model-declared plan cancels it without spawning a child", async () => {
    const aiRun = await service.createAiRun({ title: "Reject the plan" });
    const cancelConductor = vi.fn(async () => {});
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor,
    });
    const spawn = vi.fn(fakeSpawnPort().spawn);
    const execution = service.startWorkflow({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      plan: simplePlan,
      spawnPort: fakeSpawnPort({ spawn }),
      requireStartConfirmation: true,
    });

    expect(service.respondToStartConfirmation({ runId: aiRun.id, approved: false })).toBe(true);
    await expect(execution.settled).resolves.toMatchObject({ status: "canceled" });
    expect(spawn).not.toHaveBeenCalled();
    expect(cancelConductor).toHaveBeenCalledOnce();
  });

  test("rejection waits for paused and canceled persistence before settling", async () => {
    const aiRun = await service.createAiRun({ title: "Reject while saving" });
    const cancelConductor = vi.fn(async () => {});
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor,
    });
    let releasePaused!: () => void;
    let releaseCanceled!: () => void;
    const pausedGate = new Promise<void>((resolve) => {
      releasePaused = resolve;
    });
    const canceledGate = new Promise<void>((resolve) => {
      releaseCanceled = resolve;
    });
    const save = store.save.bind(store);
    const saves: string[] = [];
    vi.spyOn(store, "save").mockImplementation(async (run) => {
      saves.push(run.status);
      if (run.status === "paused") await pausedGate;
      if (run.status === "canceled") await canceledGate;
      await save(run);
    });
    const emissions: string[] = [];
    service.onChange((run) => emissions.push(run.status));
    const spawn = vi.fn(fakeSpawnPort().spawn);
    const execution = service.startWorkflow({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      plan: simplePlan,
      spawnPort: fakeSpawnPort({ spawn }),
      requireStartConfirmation: true,
    });
    let settled = false;
    void execution.settled.then(() => {
      settled = true;
      return undefined;
    });
    try {
      expect(service.respondToStartConfirmation({ runId: aiRun.id, approved: false })).toBe(true);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(saves).toEqual(["paused"]);
      expect(spawn).not.toHaveBeenCalled();
      expect(cancelConductor).toHaveBeenCalledOnce();

      releasePaused();
      await waitFor(() => saves.includes("canceled"));
      expect(settled).toBe(false);
      expect(emissions).toEqual(["paused"]);
      releaseCanceled();
      await expect(execution.settled).resolves.toMatchObject({ status: "canceled" });
      expect(emissions).toEqual(["paused", "canceled"]);
      expect(service.getRun(aiRun.id)?.status).toBe("canceled");
      expect((await store.get(aiRun.id))?.status).toBe("canceled");
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      releasePaused();
      releaseCanceled();
      await execution.settled;
    }
  });

  test.each([true, false])(
    "initial confirmation save failure remains final after response %s",
    async (approved) => {
      const aiRun = await service.createAiRun({ title: "Cannot save confirmation" });
      let rejectSave!: (error: Error) => void;
      const pendingSave = new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      });
      const save = vi.spyOn(store, "save").mockImplementation(() => pendingSave);
      const changes = vi.fn();
      service.onChange(changes);
      const spawn = vi.fn(fakeSpawnPort().spawn);
      const execution = service.startWorkflow({
        runId: aiRun.id,
        plan: simplePlan,
        spawnPort: fakeSpawnPort({ spawn }),
        requireStartConfirmation: true,
      });
      expect(service.respondToStartConfirmation({ runId: aiRun.id, approved })).toBe(true);
      rejectSave(new Error("disk full"));
      const final = await execution.settled;
      expect(final.status).toBe("failed");
      expect(final.error).toContain("initial snapshot could not be persisted");
      expect(save).toHaveBeenCalledOnce();
      expect(spawn).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
      expect(service.getRun(aiRun.id)?.status).toBe("pending");
      expect(service.respondToStartConfirmation({ runId: aiRun.id, approved: true })).toBe(false);
    },
  );

  test("refuses a declared initial shape that already exceeds the hard cap", () => {
    const capped = new WorkflowService({
      store,
      logger: silentLogger,
      caps: { maxAgents: 1, maxConcurrency: 1, maxLoopAttempts: 1 },
    });

    expect(() =>
      capped.startWorkflow({
        plan: {
          title: "Too wide",
          phases: [{ id: "wide", type: "research", title: "Wide", task: "Review", fanOut: 2 }],
        },
        spawnPort: fakeSpawnPort(),
      }),
    ).toThrow("exceeding this Workflow's 1-agent cap");
  });

  test("requires Graph start confirmation at the named agent threshold", () => {
    expect(
      service.reviewGraphStart({
        id: "g_confirm",
        name: "Three workers",
        nodes: [
          { id: "root", kind: "orchestrator", title: "Orchestrator" },
          { id: "a", kind: "agent", title: "A", prompt: "A" },
          { id: "b", kind: "agent", title: "B", prompt: "B" },
          { id: "c", kind: "agent", title: "C", prompt: "C" },
        ],
        edges: [],
      }),
    ).toMatchObject({
      reason: "agent-threshold",
      plannedAgentCount: 4,
      threshold: 4,
      agentCap: 40,
    });
  });

  test("keeps one AI Workflow record through attended gate approval and rejection", async () => {
    const approved = await service.createAiRun({ title: "Approve the AI plan" });
    await service.bindAiRunConductor({
      runId: approved.id,
      conductorAgentId: "agent_approved",
      cancelConductor: async () => {},
    });
    const approvedExecution = service.startWorkflow({
      runId: approved.id,
      conductorAgentId: "agent_approved",
      plan: {
        title: "Model title must not mint a second Workflow",
        phases: [{ id: "approval", type: "gate", title: "Review plan", task: "Approve it." }],
      },
      spawnPort: fakeSpawnPort(),
    });
    await waitFor(() => service.getRun(approved.id)?.status === "paused");
    expect(
      service.respondToGate({
        runId: approved.id,
        phaseId: "stale-gate",
        decision: { approved: true },
      }),
    ).toBe(false);
    expect(service.getRun(approved.id)?.status).toBe("paused");
    expect(
      service.respondToGate({
        runId: approved.id,
        phaseId: "approval",
        decision: { approved: true, note: "Approved by the owner." },
      }),
    ).toBe(true);
    const approvedFinal = await approvedExecution.settled;
    expect(approvedFinal).toMatchObject({ id: approved.id, kind: "ai", status: "done" });

    const rejected = await service.createAiRun({ title: "Reject the AI plan" });
    await service.bindAiRunConductor({
      runId: rejected.id,
      conductorAgentId: "agent_rejected",
      cancelConductor: async () => {},
    });
    const rejectedExecution = service.startWorkflow({
      runId: rejected.id,
      conductorAgentId: "agent_rejected",
      plan: {
        title: "Model title must not mint a second Workflow",
        phases: [{ id: "approval", type: "gate", title: "Review plan", task: "Reject it." }],
      },
      spawnPort: fakeSpawnPort(),
    });
    await waitFor(() => service.getRun(rejected.id)?.status === "paused");
    expect(
      service.respondToGate({
        runId: rejected.id,
        phaseId: "approval",
        decision: { approved: false, note: "Rejected by the owner." },
      }),
    ).toBe(true);
    const rejectedFinal = await rejectedExecution.settled;
    expect(rejectedFinal).toMatchObject({ id: rejected.id, kind: "ai", status: "canceled" });
    expect(service.listRuns().filter((run) => run.kind === "ai")).toHaveLength(2);
    expect((await store.get(approved.id))?.status).toBe("done");
    expect((await store.get(rejected.id))?.status).toBe("canceled");
  });

  test("cancels an AI Workflow while its orchestrator is planning", async () => {
    const aiRun = await service.createAiRun({ title: "Plan safely" });
    const cancelConductor = vi.fn(async () => {});
    await service.bindAiRunConductor({
      runId: aiRun.id,
      conductorAgentId: "agent_planner",
      cancelConductor,
    });

    const persisted = new Promise<void>((resolve) => {
      const unsubscribe = service.onChange((run) => {
        if (run.id === aiRun.id && run.status === "canceled") {
          unsubscribe();
          resolve();
        }
      });
    });
    expect(service.cancelRun(aiRun.id)).toBe(true);
    await persisted;
    expect(cancelConductor).toHaveBeenCalledOnce();
    expect((await store.get(aiRun.id))?.error).toContain("while the orchestrator was planning");
    expect(service.cancelRun(aiRun.id)).toBe(false);
  });

  test("fails a durable AI Workflow when planning ends without a declared plan", async () => {
    const aiRun = await service.createAiRun({ title: "Plan safely" });
    await service.failPendingAiRun(
      aiRun.id,
      "The orchestrator finished without declaring a workflow plan.",
    );
    expect(service.getRun(aiRun.id)).toMatchObject({
      status: "failed",
      error: "The orchestrator finished without declaring a workflow plan.",
    });
    expect((await store.get(aiRun.id))?.status).toBe("failed");
  });

  test("fails only the planning AI Workflow bound to an archived conductor", async () => {
    const planning = await service.createAiRun({ title: "Still planning" });
    await service.bindAiRunConductor({
      runId: planning.id,
      conductorAgentId: "conductor-archived",
      cancelConductor: async () => {},
    });
    const other = await service.createAiRun({ title: "Another plan" });
    await service.bindAiRunConductor({
      runId: other.id,
      conductorAgentId: "conductor-alive",
      cancelConductor: async () => {},
    });
    await service.failPendingAiRunForConductor("conductor-archived", "Chat archived.");
    expect(service.getRun(planning.id)).toMatchObject({
      status: "failed",
      error: "Chat archived.",
    });
    expect(service.getRun(other.id)?.status).toBe("pending");
  });

  test("onChange fires as the run progresses", async () => {
    const listener = vi.fn();
    service.onChange(listener);
    const { settled } = service.startWorkflow({ plan: simplePlan, spawnPort: fakeSpawnPort() });
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
    const { run, settled } = service.startWorkflow({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    // Wait until the run parks at the gate.
    await waitFor(() => service.getRun(run.id)?.status === "paused");
    expect(
      service.respondToGate({
        runId: run.id,
        phaseId: "gate",
        decision: { approved: true, note: "go" },
      }),
    ).toBe(true);
    const final = await settled;
    expect(final.status).toBe("done");
    expect(final.phases.find((p) => p.id === "gate")?.notes).toBe("go");
  });

  test("cancelRun aborts a run parked at a gate", async () => {
    const gatedPlan: RunPlan = {
      title: "Cancelable",
      phases: [{ id: "gate", type: "gate", title: "Approve", task: "ok?" }],
    };
    const { run, settled } = service.startWorkflow({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    await waitFor(() => service.getRun(run.id)?.status === "paused");
    expect(service.cancelRun(run.id)).toBe(true);
    const final = await settled;
    expect(final.status).toBe("canceled");
  });

  test("settleOrPause resolves with the terminal run", async () => {
    const { run, settled } = service.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
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
    const { run, settled } = service.startWorkflow({ plan: gatedPlan, spawnPort: fakeSpawnPort() });
    const outcome = await service.settleOrPause({ runId: run.id, settled });
    expect(outcome.status).toBe("paused");
    // The run is still live - answering the gate drives it to completion.
    expect(
      service.respondToGate({ runId: run.id, phaseId: "gate", decision: { approved: true } }),
    ).toBe(true);
    expect((await settled).status).toBe("done");
  });

  test("summarizes a terminal run via the injected summarizer", async () => {
    const summarized = new WorkflowService({
      store,
      logger: silentLogger,
      summarize: async (run) => `Recap of ${run.title}`,
    });
    const { run, settled } = summarized.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
    await settled;
    await waitFor(() => summarized.getRun(run.id)?.summaryStatus === "ready");
    expect(summarized.getRun(run.id)?.summary).toBe("Recap of Build and ship");
  });

  test("marks the summary failed when the summarizer throws", async () => {
    const summarized = new WorkflowService({
      store,
      logger: silentLogger,
      summarize: async () => {
        throw new Error("no writer available");
      },
    });
    const { run, settled } = summarized.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
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
    const fresh = new WorkflowService({ store, logger: silentLogger });
    await fresh.init();
    const recovered = fresh.getRun("run_orphan");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toContain("Daemon restarted");
  });

  test("init closes a paused AI approval gate instead of resuming it", async () => {
    const orphanedGate: Run = {
      id: "run_ai_gate_restart",
      title: "Awaiting AI approval",
      kind: "ai",
      status: "paused",
      conductorAgentId: "agent_conductor",
      phases: [
        {
          id: "approval",
          type: "gate",
          title: "Review the AI plan",
          task: "Wait for the user.",
          status: "blocked",
        },
      ],
      createdAt: "2023-11-14T00:00:00.000Z",
      updatedAt: "2023-11-14T00:00:00.000Z",
    };
    await store.save(orphanedGate);
    const fresh = new WorkflowService({ store, logger: silentLogger });
    await fresh.init();

    expect(fresh.getRun(orphanedGate.id)).toMatchObject({
      id: orphanedGate.id,
      kind: "ai",
      status: "failed",
      error: expect.stringContaining("Daemon restarted"),
    });
    expect((await store.get(orphanedGate.id))?.status).toBe("failed");
  });

  test("deleteRun removes a finished run from memory, disk, and listeners", async () => {
    const removed: string[][] = [];
    service.onRemove((runIds) => removed.push(runIds));
    const { run, settled } = service.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
    await settled;

    const result = await service.deleteRun(run.id);
    expect(result).toEqual({ deleted: true });
    expect(service.getRun(run.id)).toBeNull();
    expect(await store.get(run.id)).toBeNull();
    expect(removed).toEqual([[run.id]]);
  });

  test("deleteRun refuses an in-flight run and an unknown id", async () => {
    // Delete before the run settles: the guard exists so a cleanup click can't
    // orphan the run's agents - the caller has to cancel first.
    const { run, settled } = service.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
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
    // Same record, new values - an edit must not leave a second draft behind.
    expect(edited.id).toBe(draft.id);
    expect(edited.status).toBe("draft");
    expect(service.getRun(draft.id)?.title).toBe("Second name");
    expect(service.getRun(draft.id)?.description).toBe("Second description");
    expect(service.getRun(draft.id)?.graphInputs).toEqual({ goal: "two" });
    expect((await store.get(draft.id))?.graphSnapshot).toEqual(graph);
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

    const { run, settled } = service.startWorkflow({
      plan: simplePlan,
      spawnPort: fakeSpawnPort(),
    });
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
    const { run, settled } = service.startWorkflow({
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
