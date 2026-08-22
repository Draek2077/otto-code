import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleTargetSchema } from "./types.js";

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
