import { describe, expect, test } from "vitest";
import type { Run, RunPlan } from "@otto-code/protocol/workflow";

import {
  DEFAULT_RUN_CAPS,
  type RunEnginePort,
  type RunEngineSpawnInput,
  buildRunFromPlan,
  buildRunSummaryPrompt,
  executeRun,
  summarizeRunOutput,
} from "./workflow-engine.js";

// A deterministic in-memory port. `respond` decides each spawned agent's final
// message from its spawn input; `gate` decides gate outcomes. Records spawns.
interface FakeOptions {
  roles?: Record<string, string | null>; // role -> personalityId, or null = gap
  respond: (
    input: RunEngineSpawnInput,
    spawnIndex: number,
  ) => string | { message: string; failed: boolean };
  gate?: (phaseId: string) => { approved: boolean; note?: string };
  /** Agents that hang until the run aborts - the cancel-cascade shape. */
  hangAgentIds?: Set<string>;
  /**
   * Decides a continued agent's next final message from the continuation it
   * received; `round` counts continuations across the run (1-based).
   */
  respondContinued?: (input: {
    agentId: string;
    task: string;
    round: number;
  }) => string | { message: string; failed: boolean };
  /** A host that cannot continue chats - the port omits continueAgent. */
  withoutContinue?: boolean;
}

interface FakeRun {
  port: RunEnginePort;
  spawns: RunEngineSpawnInput[];
  emits: Run[];
  canceled: string[];
  continued: Array<{ agentId: string; task: string }>;
}

function makeFake(options: FakeOptions): FakeRun {
  const spawns: RunEngineSpawnInput[] = [];
  const emits: Run[] = [];
  const canceled: string[] = [];
  const continued: Array<{ agentId: string; task: string }> = [];
  // Continuations not yet consumed by an awaitAgent, per agent.
  const pendingContinuations = new Map<string, string[]>();
  let tick = 0;
  let spawnCount = 0;
  const port: RunEnginePort = {
    ...(options.withoutContinue
      ? {}
      : {
          async continueAgent(input: { agentId: string; task: string }) {
            continued.push(input);
            const queue = pendingContinuations.get(input.agentId) ?? [];
            queue.push(input.task);
            pendingContinuations.set(input.agentId, queue);
          },
        }),
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
    async awaitAgent({ agentId, signal }) {
      if (options.hangAgentIds?.has(agentId)) {
        // Hang until the run aborts - mirroring the real port, whose
        // waitForAgentFullySettled honors the signal.
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { finalMessage: null, failed: true };
      }
      const queue = pendingContinuations.get(agentId);
      const continuation = queue?.shift();
      if (continuation !== undefined) {
        const r =
          options.respondContinued?.({
            agentId,
            task: continuation,
            round: continued.length,
          }) ?? "continued";
        if (typeof r === "string") {
          return { finalMessage: r, failed: false };
        }
        return { finalMessage: r.message, failed: r.failed };
      }
      const index = Number(agentId.split("_")[1]);
      const input = spawns[index]!;
      const r = options.respond(input, index);
      if (typeof r === "string") {
        return { finalMessage: r, failed: false };
      }
      return { finalMessage: r.message, failed: r.failed };
    },
    async cancelAgent({ agentId }) {
      canceled.push(agentId);
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
  return { port, spawns, emits, canceled, continued };
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

describe("cancel cascade", () => {
  test("a canceled run really cancels its in-flight child", async () => {
    const fake = makeFake({
      respond: () => "done",
      hangAgentIds: new Set(["agent_0"]),
    });
    const plan: RunPlan = {
      title: "t",
      phases: [{ id: "i", type: "implement", title: "I", task: "build" }],
    };
    const built = buildRunFromPlan({ plan, id: "run_c", now: "2023-11-14T00:00:00.000Z" });
    const controller = new AbortController();
    const execution = executeRun({
      run: built,
      plan,
      caps: DEFAULT_RUN_CAPS,
      signal: controller.signal,
      port: fake.port,
    });
    // Let the engine spawn, then cancel the run mid-await.
    while (fake.spawns.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    controller.abort();
    const terminal = await execution;
    expect(terminal.status).toBe("canceled");
    // The child was really stopped - an abandoned agent keeps running and spending.
    expect(fake.canceled).toEqual(["agent_0"]);
  });
});

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

describe("executeRun - linear + roles", () => {
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

  test("fails an unjudged phase when its provider worker errors and records recovery guidance", async () => {
    const fake = makeFake({
      respond: () => ({ message: "", failed: true }),
    });
    const result = await run(
      {
        title: "Provider failure",
        phases: [{ id: "research", type: "research", title: "Research", task: "research" }],
      },
      fake,
    );
    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("start a new Workflow"),
      phases: [
        expect.objectContaining({
          status: "failed",
          candidates: [
            expect.objectContaining({
              error: "The assigned agent failed before producing output.",
            }),
          ],
        }),
      ],
    });
  });
});

describe("executeRun - gates", () => {
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
    expect(result.phases[0]?.status).toBe("canceled");
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

describe("executeRun - fan-out + judged loop-until-N", () => {
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

  test("a replacement round receives the failed attempt's report and the judge's unmet criteria", async () => {
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType === "verify") {
          return input.task.includes("PASSME")
            ? verdict("pass")
            : JSON.stringify({
                verdict: "fail",
                score: 0.3,
                summary: "Stopped with the inventory half done.",
                criteria: [
                  { name: "Complete inventory", met: false, evidence: "1,477 rows unjoined" },
                  { name: "Preserved denominator", met: true, evidence: "536 rows kept" },
                ],
              });
        }
        return input.attempt === 0 ? "indexed the bindings but did not join them" : "PASSME";
      },
    });
    const result = await run(
      {
        title: "Iterate, don't repeat",
        phases: [
          {
            id: "impl",
            type: "implement",
            title: "Attempts",
            task: "join the bindings",
            keepBest: 1,
            judge: { criteria: ["complete"] },
          },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");

    const makers = fake.spawns.filter((s) => s.phaseType !== "verify");
    expect(makers).toHaveLength(2);
    // Round 0 gets the bare task.
    expect(makers[0]?.task).not.toContain("previous attempt");
    // Round 1 gets the task plus what went wrong: the attempt's own report, the
    // judge's summary, and only the criteria it missed.
    const replacement = makers[1]?.task ?? "";
    expect(replacement).toContain("join the bindings");
    expect(replacement).toContain("The previous attempt reported:");
    expect(replacement).toContain("indexed the bindings but did not join them");
    expect(replacement).toContain("The judge failed it: Stopped with the inventory half done.");
    expect(replacement).toContain("- Complete inventory: 1,477 rows unjoined");
    expect(replacement).not.toContain("Preserved denominator");
    // The worker framing stays the last instruction, behind the feedback.
    expect(replacement.indexOf("The previous attempt reported:")).toBeLessThan(
      replacement.indexOf("Return your finished result"),
    );

    // The judge grades against the declared task, never the feedback block.
    const judges = fake.spawns.filter((s) => s.phaseType === "verify");
    expect(judges).toHaveLength(2);
    expect(judges[1]?.task).toContain("join the bindings");
    expect(judges[1]?.task).not.toContain("previous attempt");
  });

  test("a judged phase that fails names the verdicts, not the provider, as the place to look", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? verdict("fail") : "bad"),
    });
    const result = await run(
      {
        title: "All fail",
        phases: [{ id: "impl", type: "implement", title: "Build", task: "build", judge: {} }],
      },
      fake,
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("produced no passing candidate");
    expect(result.error).toContain("judge verdicts");
    expect(result.error).not.toContain("provider or configuration");
  });

  test("an errored attempt feeds its error, not a report, to the replacement", async () => {
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType === "verify") {
          return verdict("pass");
        }
        return input.attempt === 0 ? { message: "", failed: true } : "done";
      },
    });
    const result = await run(
      {
        title: "Error then recover",
        phases: [
          { id: "impl", type: "implement", title: "Build", task: "build", keepBest: 1, judge: {} },
        ],
      },
      fake,
    );
    expect(result.status).toBe("done");
    const makers = fake.spawns.filter((s) => s.phaseType !== "verify");
    expect(makers).toHaveLength(2);
    expect(makers[1]?.task).toContain("The previous attempt failed before producing a result:");
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

describe("executeRun - dependency output threading", () => {
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

describe("executeRun - dependency skip", () => {
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

describe("executeRun - iterative phases continue the same chat", () => {
  const iterativePlan = (): RunPlan => ({
    title: "Inventory the platform",
    phases: [
      {
        id: "inventory",
        type: "plan",
        title: "Inventory",
        task: "inventory every operation",
        mode: "iterative",
        judge: { criteria: ["every operation is classified"] },
      },
    ],
  });

  const failVerdict = JSON.stringify({
    verdict: "fail",
    score: 0.3,
    summary: "The inventory stops at the settings pages.",
    criteria: [
      { name: "Every operation is classified", met: false, evidence: "CRM handlers unjoined" },
      { name: "Denominator preserved", met: true, evidence: "536 rows kept" },
    ],
  });

  test("a failed candidate is continued, not replaced, and passes on its second round", async () => {
    const fake = makeFake({
      respond: (input) => {
        if (input.phaseType !== "verify") {
          return "settings pages indexed";
        }
        return input.task.includes("ALL JOINED") ? verdict("pass") : failVerdict;
      },
      respondContinued: () => "ALL JOINED: CRM handlers mapped",
    });
    const result = await run(iterativePlan(), fake);
    expect(result.status).toBe("done");
    expect(result.phases[0]?.status).toBe("done");
    expect(result.phases[0]?.notes).toBe("1/1 candidate(s) passed after 2 iteration(s).");

    // One maker chat for the whole phase; it was continued once.
    const makers = fake.spawns.filter((s) => s.phaseType !== "verify");
    expect(makers).toHaveLength(1);
    expect(fake.continued).toHaveLength(1);
    expect(fake.continued[0]?.agentId).toBe("agent_0");

    // The continuation carries only the verdict: the chat already holds its own output.
    const continuation = fake.continued[0]?.task ?? "";
    expect(continuation).toContain("Continue in this same session");
    expect(continuation).toContain("The judge said: The inventory stops at the settings pages.");
    expect(continuation).toContain("- Every operation is classified: CRM handlers unjoined");
    expect(continuation).not.toContain("Denominator preserved");
    expect(continuation).not.toContain("settings pages indexed");
    expect(continuation).toContain("Return your finished result");

    // One card per chat: the candidate's summary and verdict are the latest round's.
    const candidates = result.phases[0]?.candidates ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.attempts).toBe(2);
    expect(candidates[0]?.summary).toBe("ALL JOINED: CRM handlers mapped");
    expect(candidates[0]?.verdict?.verdict).toBe("pass");

    // Two judges (one per round) plus one maker.
    expect(fake.spawns.filter((s) => s.phaseType === "verify")).toHaveLength(2);
    expect(result.agentCount).toBe(3);
    // Downstream phases receive the continued chat's final report.
    expect(summarizeRunOutput(result)).toBe("ALL JOINED: CRM handlers mapped");
  });

  test("the loop cap bounds judged rounds, the first one included", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? failVerdict : "round one"),
      respondContinued: ({ round }) => `round ${round + 1}`,
    });
    const result = await run(iterativePlan(), fake);
    expect(result.status).toBe("failed");
    expect(result.phases[0]?.status).toBe("failed");
    expect(result.phases[0]?.notes).toBe("0/1 candidate(s) passed after 3 iteration(s).");
    // DEFAULT_RUN_CAPS.maxLoopAttempts = 3 rounds: one spawn + two continuations.
    expect(fake.spawns.filter((s) => s.phaseType !== "verify")).toHaveLength(1);
    expect(fake.continued).toHaveLength(2);
    expect(result.phases[0]?.candidates?.[0]?.attempts).toBe(3);
    expect(result.error).toContain("produced no passing candidate");
  });

  test("a provider failure mid-loop is not continued", async () => {
    const fake = makeFake({
      respond: (input) => (input.phaseType === "verify" ? failVerdict : "round one"),
      respondContinued: () => ({ message: "", failed: true }),
    });
    const result = await run(iterativePlan(), fake);
    expect(result.status).toBe("failed");
    // Continued once; the continuation errored, so no further round was attempted.
    expect(fake.continued).toHaveLength(1);
    const candidate = result.phases[0]?.candidates?.[0];
    expect(candidate?.error).toBe("The assigned agent failed before producing output.");
    expect(candidate?.attempts).toBe(2);
  });

  test("a host that cannot continue chats fails the phase and names the gap", async () => {
    const fake = makeFake({
      respond: () => "never reached",
      withoutContinue: true,
    });
    const result = await run(iterativePlan(), fake);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("cannot continue child chats");
    expect(result.phases[0]?.notes).toContain("Update the host");
    expect(fake.spawns).toHaveLength(0);
  });

  test("buildRunFromPlan rejects an iterative phase without a judge", () => {
    expect(() =>
      buildRunFromPlan({
        plan: {
          title: "No judge",
          phases: [{ id: "p", type: "plan", title: "P", task: "plan", mode: "iterative" }],
        },
        id: "run_test",
        now: "2023-11-14T00:00:00.000Z",
      }),
    ).toThrow(/declares no judge/);
  });

  test("buildRunFromPlan rejects an iterative verify phase", () => {
    expect(() =>
      buildRunFromPlan({
        plan: {
          title: "Verify cannot iterate",
          phases: [
            { id: "v", type: "verify", title: "V", task: "check", mode: "iterative", judge: {} },
          ],
        },
        id: "run_test",
        now: "2023-11-14T00:00:00.000Z",
      }),
    ).toThrow(/cannot iterate/);
  });

  test("the mode is projected onto the phase so clients can show it", () => {
    const built = buildRunFromPlan({
      plan: iterativePlan(),
      id: "run_test",
      now: "2023-11-14T00:00:00.000Z",
    });
    expect(built.phases[0]?.mode).toBe("iterative");
  });
});
