import { describe, expect, test } from "vitest";

import {
  RunPlanSchema,
  RunSchema,
  defaultRoleForPhaseType,
  isRunPhaseType,
  isTerminalPhaseStatus,
  isTerminalRunStatus,
} from "./orchestration.js";

describe("phase type → role mapping", () => {
  test("each type maps to its filling role, gate to nobody", () => {
    expect(defaultRoleForPhaseType("research")).toBe("researcher");
    expect(defaultRoleForPhaseType("plan")).toBe("planner");
    expect(defaultRoleForPhaseType("implement")).toBe("coder");
    expect(defaultRoleForPhaseType("refactor")).toBe("coder");
    expect(defaultRoleForPhaseType("design")).toBe("designer");
    expect(defaultRoleForPhaseType("verify")).toBe("judger");
    expect(defaultRoleForPhaseType("gate")).toBeNull();
    expect(defaultRoleForPhaseType("deliver")).toBe("coder");
  });

  test("isRunPhaseType guards the known set", () => {
    expect(isRunPhaseType("verify")).toBe(true);
    expect(isRunPhaseType("ship")).toBe(false);
  });
});

describe("terminal status helpers", () => {
  test("run terminal states", () => {
    expect(isTerminalRunStatus("done")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("canceled")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("paused")).toBe(false);
  });

  test("phase terminal states", () => {
    expect(isTerminalPhaseStatus("done")).toBe(true);
    expect(isTerminalPhaseStatus("failed")).toBe(true);
    expect(isTerminalPhaseStatus("skipped")).toBe(true);
    expect(isTerminalPhaseStatus("running")).toBe(false);
    expect(isTerminalPhaseStatus("blocked")).toBe(false);
  });
});

describe("RunPlanSchema", () => {
  test("accepts a fan-out research plan with a judged loop target", () => {
    const plan = RunPlanSchema.parse({
      title: "Research the caching layer from six angles",
      requirements: ["Cover eviction, invalidation, and warmup"],
      phases: [
        {
          id: "survey",
          type: "research",
          title: "Six-angle survey",
          task: "Investigate one angle of the caching layer and report findings.",
          fanOut: 6,
          keepBest: 4,
          judge: { role: "judger", criteria: ["grounded in real files", "non-duplicative"] },
        },
        {
          id: "report",
          type: "deliver",
          title: "Synthesize the final report",
          task: "Combine the passing findings into one report.",
          role: "writer",
          dependsOn: ["survey"],
        },
      ],
    });
    expect(plan.phases).toHaveLength(2);
    expect(plan.autopilot).toBeUndefined(); // attended by default
    expect(plan.phases[0]?.fanOut).toBe(6);
  });

  test("rejects a plan with no phases", () => {
    expect(() => RunPlanSchema.parse({ title: "empty", phases: [] })).toThrow();
  });

  test("rejects a fanOut above the cap", () => {
    expect(() =>
      RunPlanSchema.parse({
        title: "too wide",
        phases: [{ id: "a", type: "research", title: "t", task: "do it", fanOut: 99 }],
      }),
    ).toThrow();
  });
});

describe("RunSchema", () => {
  test("phases default to an empty array and survive round-trip", () => {
    const run = RunSchema.parse({ id: "run_1", title: "A run", status: "pending" });
    expect(run.phases).toEqual([]);
  });

  test("carries candidates with verdicts", () => {
    const run = RunSchema.parse({
      id: "run_2",
      title: "Judged run",
      status: "running",
      phases: [
        {
          id: "p1",
          type: "verify",
          title: "Judge",
          task: "grade it",
          status: "done",
          candidates: [{ agentId: "agent_x", verdict: { verdict: "pass", score: 0.8 } }],
        },
      ],
    });
    expect(run.phases[0]?.candidates?.[0]?.verdict?.verdict).toBe("pass");
  });
});
