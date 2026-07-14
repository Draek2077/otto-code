import { describe, expect, test } from "vitest";
import type { Run, RunPlan } from "@otto-code/protocol/orchestration";

import {
  DEFAULT_RUN_CAPS,
  type RunEnginePort,
  type RunEngineSpawnInput,
  buildRunFromPlan,
  buildRunSummaryPrompt,
  executeRun,
  summarizeRunOutput,
} from "./run-engine.js";

// A deterministic in-memory port. `respond` decides each spawned agent's final
// message from its spawn input; `gate` decides gate outcomes. Records spawns.
interface FakeOptions {
  roles?: Record<string, string | null>; // role -> personalityId, or null = gap
  respond: (
    input: RunEngineSpawnInput,
    spawnIndex: number,
  ) => string | { message: string; failed: boolean };
  gate?: (phaseId: string) => { approved: boolean; note?: string };
}

interface FakeRun {
  port: RunEnginePort;
  spawns: RunEngineSpawnInput[];
  emits: Run[];
}

function makeFake(options: FakeOptions): FakeRun {
  const spawns: RunEngineSpawnInput[] = [];
  const emits: Run[] = [];
  let tick = 0;
  let spawnCount = 0;
  const port: RunEnginePort = {
    async resolveRole(role) {
      const has = options.roles ? role in options.roles : true;
      const pid = options.roles?.[role] ?? (has ? `p_${role}` : null);
      return pid ? { personalityId: pid } : null;
    },
    async spawn(input) {
      spawns.push(input);
      const id = `agent_${spawnCount++}`;
      return { agentId: id, personalityId: `p_${input.role}` };
    },
    async awaitAgent({ agentId }) {
      const index = Number(agentId.split("_")[1]);
      const input = spawns[index]!;
      const r = options.respond(input, index);
      if (typeof r === "string") {
        return { finalMessage: r, failed: false };
      }
      return { finalMessage: r.message, failed: r.failed };
    },
    async awaitGate({ phaseId }) {
      return options.gate?.(phaseId) ?? { approved: true };
    },
    emit(snapshot) {
      emits.push(structuredClone(snapshot));
    },
    now() {
      return new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  return { port, spawns, emits };
}

function run(plan: RunPlan, fake: FakeRun): Promise<Run> {
  const built = buildRunFromPlan({ plan, id: "run_test", now: "2023-11-14T00:00:00.000Z" });
  return executeRun({
    run: built,
    plan,
    caps: DEFAULT_RUN_CAPS,
    signal: new AbortController().signal,
    port: fake.port,
  });
}

const verdict = (outcome: "pass" | "fail") => JSON.stringify({ verdict: outcome, score: 0.5 });

describe("buildRunFromPlan", () => {
  test("assigns default roles by phase type and initializes phases pending", () => {
    const built = buildRunFromPlan({
      plan: {
        title: "t",
        phases: [
          { id: "r", type: "research", title: "R", task: "survey" },
          { id: "g", type: "gate", title: "G", task: "approve" },
        ],
      },
      id: "run_1",
      now: "NOW",
    });
    expect(built.phases[0]?.assigneeRole).toBe("researcher");
    expect(built.phases[1]?.assigneeRole).toBeUndefined(); // gate has no role
    expect(built.phases.every((p) => p.status === "pending")).toBe(true);
    expect(built.status).toBe("pending");
  });

  test("records the team + cwd on the run for filtering", () => {
    const built = buildRunFromPlan({
      plan: { title: "t", phases: [{ id: "a", type: "implement", title: "A", task: "x" }] },
      id: "run_team",
      now: "NOW",
      teamId: "team_crew",
      teamName: "The Otto Crew",
      cwd: "/repos/proj",
    });
    expect(built.teamId).toBe("team_crew");
    expect(built.teamName).toBe("The Otto Crew");
    expect(built.cwd).toBe("/repos/proj");
  });

  test("rejects a forward or missing dependency reference", () => {
    expect(() =>
      buildRunFromPlan({
        plan: {
          title: "t",
          phases: [
            { id: "a", type: "implement", title: "A", task: "x", dependsOn: ["b"] },
            { id: "b", type: "implement", title: "B", task: "y" },
          ],
        },
        id: "run_2",
        now: "NOW",
      }),
    ).toThrow(/not an earlier phase/);
  });
});

describe("executeRun — linear + roles", () => {
  test("runs phases in order and completes", async () => {
    const fake = makeFake({ respond: () => "done" });
    const result = await run(
      {
        title: "Two-step",
        phases: [
          { id: "impl", type: "implement", title: "Build", task: "build it" },
          { id: "ship", type: "deliver", title: "Ship", task: "ship it", dependsOn: ["impl"] },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    expect(result.phases.map((p) => p.status)).toEqual(["done", "done"]);
    expect(fake.spawns.map((s) => s.role)).toEqual(["coder", "coder"]);
  });

  test("hard-fails and names the gap when a required role is missing", async () => {
    const fake = makeFake({ roles: { coder: "p_coder" }, respond: () => "x" });
    const result = await run(
      {
        title: "No researcher on the team",
        phases: [{ id: "r", type: "research", title: "Survey", task: "survey" }],
      },
      fake,
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("researcher");
    expect(result.phases[0]?.notes).toContain("This team has no researcher");
    expect(fake.spawns).toHaveLength(0); // never spawned
  });
});

describe("executeRun — gates", () => {
  test("pauses at a gate and resumes on approval", async () => {
    const fake = makeFake({ respond: () => "ok", gate: () => ({ approved: true, note: "LGTM" }) });
    const result = await run(
      {
        title: "Gated",
        phases: [
          { id: "plan", type: "plan", title: "Plan", task: "plan it" },
          { id: "gate", type: "gate", title: "Approve plan", task: "ok?", dependsOn: ["plan"] },
          { id: "impl", type: "implement", title: "Build", task: "build", dependsOn: ["gate"] },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    expect(result.phases[1]?.status).toBe("done");
    expect(result.phases[1]?.notes).toBe("LGTM");
    // The run passed through a paused state at the gate.
    expect(fake.emits.some((r) => r.status === "paused")).toBe(true);
  });

  test("rejecting a gate cancels the run and skips downstream", async () => {
    const fake = makeFake({ respond: () => "ok", gate: () => ({ approved: false, note: "no" }) });
    const result = await run(
      {
        title: "Rejected",
        phases: [
          { id: "gate", type: "gate", title: "Approve", task: "ok?" },
          { id: "impl", type: "implement", title: "Build", task: "build", dependsOn: ["gate"] },
        ],
      },
      fake,
    );
    expect(result.status).toBe("canceled");
    expect(result.phases[0]?.status).toBe("failed");
    expect(result.phases[1]?.status).toBe("pending"); // never reached
  });

  test("autopilot auto-approves gates without awaiting", async () => {
    let gateAsked = false;
    const fake = makeFake({
      respond: () => "ok",
      gate: () => {
        gateAsked = true;
        return { approved: true };
      },
    });
    const result = await run(
      {
        title: "Autopilot",
        autopilot: true,
        phases: [{ id: "gate", type: "gate", title: "Approve", task: "ok?" }],
      },
      fake,
    );
    expect(result.status).toBe("done");
    expect(gateAsked).toBe(false);
    expect(result.phases[0]?.notes).toContain("autopilot");
  });
});

describe("executeRun — fan-out + judged loop-until-N", () => {
  test("fans out N candidates and judges each (verify-attached)", async () => {
    // 4 makers; the judger passes candidates from even maker indices only.
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType === "verify") {
          // Judge task embeds the candidate output; pass if it contains "GOOD".
          return input.task.includes("GOOD") ? verdict("pass") : verdict("fail");
        }
        return input.index % 2 === 0 ? "GOOD work" : "weak work";
      },
    });
    const result = await run(
      {
        title: "Six angles",
        phases: [
          {
            id: "survey",
            type: "research",
            title: "Angles",
            task: "investigate an angle",
            fanOut: 4,
            judge: { criteria: ["grounded"] },
          },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    const candidates = result.phases[0]?.candidates ?? [];
    expect(candidates).toHaveLength(4);
    const passed = candidates.filter((c) => c.verdict?.verdict === "pass");
    expect(passed).toHaveLength(2);
    // Each maker got a judger → 4 makers + 4 judges = 8 spawns.
    expect(fake.spawns).toHaveLength(8);
  });

  test("loops to replace failers until keepBest passers are reached", async () => {
    // First round: 2 makers, both fail. Later rounds: makers pass.
    let round = 0;
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType === "verify") {
          return input.task.includes("PASSME") ? verdict("pass") : verdict("fail");
        }
        // attempt 0 fails, attempt >=1 passes
        return input.attempt === 0 ? "nope" : "PASSME";
      },
    });
    void round;
    const result = await run(
      {
        title: "Keep best 2",
        phases: [
          {
            id: "impl",
            type: "implement",
            title: "Attempts",
            task: "implement",
            fanOut: 2,
            keepBest: 2,
            judge: {},
          },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    const passers = (result.phases[0]?.candidates ?? []).filter(
      (c) => c.verdict?.verdict === "pass",
    );
    expect(passers.length).toBeGreaterThanOrEqual(2);
  });

  test("a verify phase parses the judger's own message as the verdict", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? verdict("pass") : "work"),
    });
    const result = await run(
      {
        title: "Explicit verify",
        phases: [
          { id: "impl", type: "implement", title: "Build", task: "build" },
          {
            id: "check",
            type: "verify",
            title: "Review",
            task: "review the build",
            dependsOn: ["impl"],
          },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    expect(result.phases[1]?.candidates?.[0]?.verdict?.verdict).toBe("pass");
  });

  test("a judged phase with zero passers fails the run", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? verdict("fail") : "bad"),
    });
    const result = await run(
      {
        title: "All fail",
        phases: [
          { id: "impl", type: "implement", title: "Build", task: "build", fanOut: 2, judge: {} },
        ],
      },
      fake,
    );
    expect(result.status).toBe("failed");
    expect(result.phases[0]?.status).toBe("failed");
  });
});

describe("executeRun — dependency output threading", () => {
  test("threads an upstream phase's output into a dependent phase's task", async () => {
    const fake = makeFake({
      respond: (input) =>
        input.phaseId === "haiku" ? "Cache warm, request cold" : "combined note",
    });
    await run(
      {
        title: "Haiku then note",
        phases: [
          { id: "haiku", type: "implement", title: "Haiku", task: "write a haiku about caching" },
          {
            id: "note",
            type: "deliver",
            title: "Note",
            task: "combine it into a short note",
            dependsOn: ["haiku"],
          },
        ],
      },
      fake,
    );
    const noteSpawn = fake.spawns.find((s) => s.phaseId === "note");
    expect(noteSpawn).toBeDefined();
    // The dependent phase's task carries the upstream haiku output, so the child
    // starts with context instead of asking "where is phase 1?".
    expect(noteSpawn!.task).toContain("Cache warm, request cold");
    expect(noteSpawn!.task).toContain("combine it into a short note");
    expect(noteSpawn!.task).toContain('From "Haiku"'); // upstream phase title labels the block
  });

  test("a phase with no dependencies still carries its declared task (plus worker framing)", async () => {
    const fake = makeFake({ respond: () => "ok" });
    await run(
      {
        title: "Solo",
        phases: [{ id: "solo", type: "implement", title: "Solo", task: "just do it" }],
      },
      fake,
    );
    expect(fake.spawns[0]?.task).toContain("just do it");
    // Worker framing is appended so the worker returns finished work, not a status update.
    expect(fake.spawns[0]?.task).toContain("Return your finished result");
  });

  test("a judged dependency threads only its passing candidate's output", async () => {
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType === "verify") {
          return input.task.includes("KEEP") ? verdict("pass") : verdict("fail");
        }
        if (input.phaseId === "make") {
          return input.index === 0 ? "KEEP this one" : "drop this one";
        }
        return "shipped";
      },
    });
    await run(
      {
        title: "Judged then ship",
        phases: [
          { id: "make", type: "implement", title: "Make", task: "make", fanOut: 2, judge: {} },
          { id: "ship", type: "deliver", title: "Ship", task: "ship it", dependsOn: ["make"] },
        ],
      },
      fake,
    );
    const shipSpawn = fake.spawns.find((s) => s.phaseId === "ship");
    expect(shipSpawn).toBeDefined();
    expect(shipSpawn!.task).toContain("KEEP this one");
    expect(shipSpawn!.task).not.toContain("drop this one");
  });
});

describe("summarizeRunOutput", () => {
  test("returns the last completed non-gate phase's output", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseId === "ship" ? "SHIPPED IT" : "built"),
    });
    const result = await run(
      {
        title: "Build then ship",
        phases: [
          { id: "build", type: "implement", title: "Build", task: "build" },
          { id: "ship", type: "deliver", title: "Ship", task: "ship", dependsOn: ["build"] },
        ],
      },
      fake,
    );
    expect(summarizeRunOutput(result)).toBe("SHIPPED IT");
  });

  test("skips a trailing gate and returns the prior phase's output", async () => {
    const fake = makeFake({ respond: () => "the plan", gate: () => ({ approved: true }) });
    const result = await run(
      {
        title: "Plan then approve",
        phases: [
          { id: "plan", type: "plan", title: "Plan", task: "plan" },
          { id: "gate", type: "gate", title: "Approve", task: "ok?", dependsOn: ["plan"] },
        ],
      },
      fake,
    );
    expect(summarizeRunOutput(result)).toBe("the plan");
  });

  test("returns null when no phase produced output", () => {
    const built = buildRunFromPlan({
      plan: { title: "empty", phases: [{ id: "g", type: "gate", title: "G", task: "ok?" }] },
      id: "run_empty",
      now: "NOW",
    });
    expect(summarizeRunOutput(built)).toBeNull();
  });
});

describe("buildRunSummaryPrompt", () => {
  test("includes the run title, outcome, phase digest, and output excerpt", async () => {
    const fake = makeFake({ respond: () => "did the thing well" });
    const result = await run(
      {
        title: "My Important Run",
        phases: [{ id: "a", type: "implement", title: "Build the thing", task: "build" }],
      },
      fake,
    );
    const prompt = buildRunSummaryPrompt(result);
    expect(prompt).toContain("My Important Run");
    expect(prompt).toContain("Final status: done");
    expect(prompt).toContain("Build the thing");
    expect(prompt).toContain("did the thing well");
  });

  test("surfaces the failure reason for a failed run", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? verdict("fail") : "bad"),
    });
    const result = await run(
      {
        title: "Doomed",
        phases: [
          { id: "impl", type: "implement", title: "Try", task: "try", fanOut: 2, judge: {} },
        ],
      },
      fake,
    );
    const prompt = buildRunSummaryPrompt(result);
    expect(prompt).toContain("Final status: failed");
    expect(prompt).toMatch(/Error:|no passing candidate/);
  });
});

describe("executeRun — dependency skip", () => {
  test("skips a phase whose dependency failed", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? verdict("fail") : "bad"),
    });
    const result = await run(
      {
        title: "Cascade",
        phases: [
          { id: "impl", type: "implement", title: "Build", task: "build", judge: {} },
          { id: "ship", type: "deliver", title: "Ship", task: "ship", dependsOn: ["impl"] },
        ],
      },
      fake,
    );
    expect(result.phases[0]?.status).toBe("failed");
    // Run already failed at impl, so ship never runs (run returns at failure).
    expect(result.status).toBe("failed");
  });
});
