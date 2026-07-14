import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Run, RunPhase, RunPlan } from "@otto-code/protocol/orchestration";
import { PARENT_AGENT_ID_LABEL } from "@otto-code/protocol/agent-labels";

import { createTestOttoDaemon, type TestOttoDaemon } from "../test-utils/otto-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { RunStore } from "./run-store.js";
import { RunService, type RunSpawnPort } from "./run-service.js";
import { summarizeRunOutput } from "./run-engine.js";

// Loop A — the deterministic integration layer. Unlike run-engine/run-service
// unit tests (which fake the spawn seam entirely), this drives the engine
// through REAL child agents spawned on a live in-process daemon. The agents are
// FakeAgentClients (no model, no tokens), scripted via "respond with exactly: X"
// so the whole run is deterministic — but every hop the production start_run
// path takes is exercised: createAgent → session → agentManager → child turn →
// waitForAgentUpsert(idle) → getLastAssistantMessage → RunService persist/emit.
//
// The spawn port here mirrors the one otto-tools.ts assembles inside start_run;
// team-role resolution is stubbed (covered by resolve-team-role.test.ts) so the
// focus stays on the real spawn/await/gather wiring.

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

interface IntegrationHarness {
  daemon: TestOttoDaemon;
  client: DaemonClient;
  cwd: string;
}

let harness: IntegrationHarness;

beforeAll(async () => {
  const daemon = await createTestOttoDaemon({ logger: undefined });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.70",
  });
  await client.connect();
  // Required handshake before the session processes other requests.
  await client.fetchAgents({ subscribe: { subscriptionId: "orchestration-int" } });
  harness = { daemon, client, cwd: daemon.ottoHome };
}, 40_000);

afterAll(async () => {
  await harness?.client.close().catch(() => undefined);
  await harness?.daemon.close().catch(() => undefined);
});

interface SpawnPortHooks {
  /** Records the effective task each phase's child was actually spawned with. */
  composedTasks: Map<string, string>;
  /** Total children spawned (to assert a hard-fail spawns none). */
  spawnCount: { value: number };
  /** A role the "team" lacks — resolveRole returns null for it. */
  missingRole?: string;
}

function makeIntegrationSpawnPort(hooks: SpawnPortHooks): RunSpawnPort {
  return {
    async resolveRole(role) {
      if (role === hooks.missingRole) {
        return null;
      }
      return { personalityId: `p_${role}` };
    },
    async spawn(input) {
      hooks.composedTasks.set(`${input.phaseId}#${input.attempt}.${input.index}`, input.task);
      hooks.spawnCount.value += 1;
      const agent = await harness.client.createAgent({
        provider: "claude",
        cwd: harness.cwd,
        initialPrompt: input.task,
      });
      return { agentId: agent.id, personalityId: `p_${input.role}` };
    },
    async awaitAgent({ agentId, signal }) {
      // Mirror the production port (otto-tools): wait for the worker's whole
      // subtree to settle, not just its first idle. quietMs is shortened here so
      // the deterministic suite stays fast; the logic is identical to production.
      const result = await harness.daemon.daemon.agentManager.waitForAgentFullySettled(agentId, {
        signal,
        quietMs: 300,
      });
      const finalMessage =
        result.lastMessage ??
        (await harness.daemon.daemon.agentManager.getLastAssistantMessage(agentId));
      return { finalMessage: finalMessage ?? null, failed: result.status === "error" };
    },
  };
}

function allVerdictsPass(candidates: readonly { verdict?: { verdict: string } }[]): boolean {
  return candidates.every((c) => c.verdict?.verdict === "pass");
}

// Small extractors so assertions don't nest a callback 4 deep (lint cap).
function phaseById(run: Run, id: string): RunPhase | undefined {
  return run.phases.find((p) => p.id === id);
}
function phaseStatuses(run: Run): string[] {
  return run.phases.map((p) => p.status);
}

async function withRunService(
  fn: (service: RunService, store: RunStore) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "otto-run-int-"));
  const store = new RunStore(join(dir, "runs"));
  const service = new RunService({ store, logger: silentLogger });
  try {
    await fn(service, store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("orchestration integration (real fake-backed child agents)", () => {
  test("threads a real upstream child's output into the dependent phase and comes full circle", async () => {
    await withRunService(async (service, store) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks,
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Haiku then note",
        phases: [
          {
            id: "haiku",
            type: "implement",
            title: "Write haiku",
            task: "Write a haiku about caching. respond with exactly: HAIKU_ALPHA",
          },
          {
            id: "note",
            type: "deliver",
            title: "Combine into note",
            task: "Combine the haiku into a note. respond with exactly: NOTE_BETA",
            dependsOn: ["haiku"],
          },
        ],
      };

      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });

      // The real child produced its scripted output, gathered back into the run.
      expect(outcome.status).toBe("done");
      expect(outcome.phases[0]?.candidates?.[0]?.summary).toBe("HAIKU_ALPHA");

      // The dependent phase's child was spawned with the upstream output folded in.
      const noteTask = composedTasks.get("note#0.0");
      expect(noteTask).toContain("HAIKU_ALPHA");
      expect(noteTask).toContain("Combine the haiku into a note");

      // Full circle: the run's headline deliverable is the final phase's output.
      expect(summarizeRunOutput(outcome)).toBe("NOTE_BETA");

      // Persisted to disk as done.
      expect((await store.get(run.id))?.status).toBe("done");
    });
  }, 60_000);

  test("pauses at a gate between two real phases and resumes on approval", async () => {
    await withRunService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Plan, approve, build",
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Outline it. respond with exactly: THE_PLAN",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
            dependsOn: ["gate"],
          },
        ],
      };

      const { run, settled } = service.startRun({ plan, spawnPort });
      const paused = await service.settleOrPause({ runId: run.id, settled });
      expect(paused.status).toBe("paused");
      expect(paused.phases[0]?.candidates?.[0]?.summary).toBe("THE_PLAN");

      expect(service.respondToGate(run.id, { approved: true, note: "go" })).toBe(true);
      const final = await settled;
      expect(final.status).toBe("done");
      expect(final.phases[2]?.candidates?.[0]?.summary).toBe("BUILT");
    });
  }, 60_000);

  test("fans out multiple real children and grades each with a real judger", async () => {
    await withRunService(async (service) => {
      const spawnCount = { value: 0 };
      const spawnPort = makeIntegrationSpawnPort({ composedTasks: new Map(), spawnCount });
      const plan: RunPlan = {
        title: "Fan out and judge",
        phases: [
          {
            id: "explore",
            type: "research",
            title: "Explore angles",
            // "PASS" marker makes the real judger children return a pass verdict.
            task: "Investigate an angle. respond with exactly: PASS_ANGLE",
            fanOut: 3,
            judge: { criteria: ["grounded"] },
          },
        ],
      };

      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });

      expect(outcome.status).toBe("done");
      const candidates = outcome.phases[0]?.candidates ?? [];
      expect(candidates).toHaveLength(3);
      expect(allVerdictsPass(candidates)).toBe(true);
      // 3 maker children + 3 judger children all really spawned and awaited.
      expect(spawnCount.value).toBe(6);
    });
  }, 90_000);

  test("hard-fails and names the gap when the team lacks a role — spawning no child for it", async () => {
    await withRunService(async (service) => {
      const spawnCount = { value: 0 };
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount,
        missingRole: "designer",
      });
      const plan: RunPlan = {
        title: "Needs a designer",
        phases: [{ id: "design", type: "design", title: "Style it", task: "make it pretty" }],
      };

      const { run, settled } = service.startRun({ plan, spawnPort });
      const final = await service.settleOrPause({ runId: run.id, settled });
      expect(final.status).toBe("failed");
      expect(final.error).toContain("designer");
      expect(spawnCount.value).toBe(0);
    });
  }, 30_000);

  test("runs a verify phase whose child IS the judger", async () => {
    await withRunService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Build then verify",
        phases: [
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
          },
          {
            id: "check",
            type: "verify",
            title: "Review",
            task: 'Review the build. respond with exactly: {"verdict":"pass","score":1}',
            dependsOn: ["build"],
          },
        ],
      };
      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(outcome.phases[1]?.candidates?.[0]?.verdict?.verdict).toBe("pass");
    });
  }, 60_000);

  test("autopilot runs straight through a gate without pausing", async () => {
    await withRunService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Autopilot pipeline",
        autopilot: true,
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Plan it. respond with exactly: PLANNED",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build it. respond with exactly: BUILT",
            dependsOn: ["gate"],
          },
        ],
      };
      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(phaseById(outcome, "gate")?.notes).toContain("autopilot");
      expect(outcome.phases[2]?.candidates?.[0]?.summary).toBe("BUILT");
    });
  }, 60_000);

  test("cancels a run parked at a gate; downstream never runs", async () => {
    await withRunService(async (service) => {
      const spawnPort = makeIntegrationSpawnPort({
        composedTasks: new Map(),
        spawnCount: { value: 0 },
      });
      const plan: RunPlan = {
        title: "Cancelable",
        phases: [
          {
            id: "plan",
            type: "plan",
            title: "Plan",
            task: "Plan it. respond with exactly: PLANNED",
          },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "build",
            dependsOn: ["gate"],
          },
        ],
      };
      const { run, settled } = service.startRun({ plan, spawnPort });
      const paused = await service.settleOrPause({ runId: run.id, settled });
      expect(paused.status).toBe("paused");
      expect(service.cancelRun(run.id)).toBe(true);
      const final = await settled;
      expect(final.status).toBe("canceled");
      expect(phaseById(final, "build")?.status).toBe("pending");
    });
  }, 60_000);

  test("threads multiple dependencies' outputs into a joining phase", async () => {
    await withRunService(async (service) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({ composedTasks, spawnCount: { value: 0 } });
      const plan: RunPlan = {
        title: "Two inputs, one join",
        phases: [
          {
            id: "a",
            type: "research",
            title: "Angle A",
            task: "Research A. respond with exactly: OUTPUT_A",
          },
          {
            id: "b",
            type: "research",
            title: "Angle B",
            task: "Research B. respond with exactly: OUTPUT_B",
          },
          {
            id: "join",
            type: "deliver",
            title: "Join",
            task: "Combine both. respond with exactly: JOINED",
            dependsOn: ["a", "b"],
          },
        ],
      };
      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      const joinTask = composedTasks.get("join#0.0");
      expect(joinTask).toContain("OUTPUT_A");
      expect(joinTask).toContain("OUTPUT_B");
    });
  }, 60_000);

  test("drives a full research → implement → deliver pipeline end to end", async () => {
    await withRunService(async (service, store) => {
      const composedTasks = new Map<string, string>();
      const spawnPort = makeIntegrationSpawnPort({ composedTasks, spawnCount: { value: 0 } });
      const plan: RunPlan = {
        title: "Full pipeline",
        phases: [
          {
            id: "research",
            type: "research",
            title: "Survey",
            task: "Survey the space. respond with exactly: PASS_FINDINGS",
            fanOut: 2,
            judge: {},
          },
          {
            id: "build",
            type: "implement",
            title: "Build",
            task: "Build on the findings. respond with exactly: IMPLEMENTED",
            dependsOn: ["research"],
          },
          {
            id: "ship",
            type: "deliver",
            title: "Ship",
            task: "Ship it. respond with exactly: SHIPPED",
            dependsOn: ["build"],
          },
        ],
      };
      const { run, settled } = service.startRun({ plan, spawnPort });
      const outcome = await service.settleOrPause({ runId: run.id, settled });
      expect(outcome.status).toBe("done");
      expect(phaseStatuses(outcome)).toEqual(["done", "done", "done"]);
      // Findings thread into build; build threads into ship.
      expect(composedTasks.get("build#0.0")).toContain("PASS_FINDINGS");
      expect(composedTasks.get("ship#0.0")).toContain("IMPLEMENTED");
      // 2 researchers + 2 judgers + 1 builder + 1 shipper.
      expect(outcome.agentCount).toBe(6);
      expect(summarizeRunOutput(outcome)).toBe("SHIPPED");
      expect((await store.get(run.id))?.status).toBe("done");
    });
  }, 90_000);

  test("waitForAgentFullySettled waits for a worker's busy child agent", async () => {
    const agentManager = harness.daemon.daemon.agentManager;
    const parent = await harness.client.createAgent({
      provider: "claude",
      cwd: harness.cwd,
      initialPrompt: "hello",
    });
    await harness.client.waitForAgentUpsert(parent.id, (s) => s.status === "idle", 15_000);

    // A child labeled under the now-idle parent, started with a long-running
    // prompt so it stays busy — nothing re-invokes the parent, so the ONLY reason
    // settle should wait is the busy descendant in the subtree.
    const child = await harness.client.createAgent({
      provider: "claude",
      cwd: harness.cwd,
      initialPrompt: "emit 2000 coalesced agent stream updates",
      labels: { [PARENT_AGENT_ID_LABEL]: parent.id },
    });
    await harness.client.waitForAgentUpsert(child.id, (s) => s.status === "running", 15_000);

    const settledAt = agentManager
      .waitForAgentFullySettled(parent.id, { quietMs: 300 })
      .then(() => Date.now());
    const childDoneAt = harness.client
      .waitForAgentUpsert(child.id, (s) => s.status !== "running", 30_000)
      .then(() => Date.now());

    const [settled, childDone] = await Promise.all([settledAt, childDoneAt]);
    expect(settled).toBeGreaterThanOrEqual(childDone);
  }, 60_000);
});
