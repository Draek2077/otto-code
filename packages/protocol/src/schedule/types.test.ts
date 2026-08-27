import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleRunSchema, ScheduleTargetSchema } from "./types.js";

describe("ScheduleCadenceSchema", () => {
  test("accepts existing UTC cron cadence without a time zone", () => {
    expect(ScheduleCadenceSchema.parse({ type: "cron", expression: "0 9 * * *" })).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  test("accepts timezone-aware cron cadence", () => {
    expect(
      ScheduleCadenceSchema.parse({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "America/New_York",
    });
  });
});

describe("ScheduleTargetSchema", () => {
  // COMPAT(flatProviderConfigFields): Zod strips unknown keys, so if these flat
  // fields ever leave the schema again, a schedule persisted before v0.4.0
  // silently loses its approval, sandbox, and network settings on rewrite.
  test("keeps the flat provider fields a pre-v0.4.0 schedule persisted", () => {
    const stored = {
      type: "new-agent",
      config: {
        provider: "codex",
        cwd: "/repo",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        networkAccess: false,
        webSearch: true,
        extra: { codex: { profile: "ci" } },
      },
    };

    expect(ScheduleTargetSchema.parse(stored)).toEqual(stored);
  });
});

describe("ScheduleRunSchema", () => {
  test("accepts historical runs without a requested-target snapshot", () => {
    expect(
      ScheduleRunSchema.parse({
        id: "run-1",
        scheduledFor: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        status: "running",
        agentId: null,
        output: null,
        error: null,
      }),
    ).not.toHaveProperty("target");
  });

  test("preserves the requested target snapshot for durable run audit", () => {
    expect(
      ScheduleRunSchema.parse({
        id: "run-1",
        scheduledFor: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        status: "running",
        target: { type: "new-agent", config: { provider: "codex", cwd: "/repo" } },
        agentId: null,
        output: null,
        error: null,
      }),
    ).toMatchObject({
      target: { type: "new-agent", config: { provider: "codex", cwd: "/repo" } },
    });
  });
});
