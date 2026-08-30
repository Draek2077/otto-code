import { describe, expect, it } from "vitest";
import { ScheduleCreateRequestSchema, ScheduleUpdateRequestSchema } from "./rpc-schemas.js";

describe("schedule RPC schemas", () => {
  it("round-trips new-agent run options on create requests", () => {
    expect(
      ScheduleCreateRequestSchema.parse({
        type: "schedule/create",
        requestId: "request-1",
        prompt: "Run the task",
        cadence: { type: "every", everyMs: 60_000 },
        target: {
          type: "new-agent",
          config: {
            provider: "claude",
            cwd: "/tmp/project",
            thinkingOptionId: "think-hard",
            archiveOnFinish: false,
            isolation: "worktree",
          },
        },
      }),
    ).toEqual({
      type: "schedule/create",
      requestId: "request-1",
      prompt: "Run the task",
      cadence: { type: "every", everyMs: 60_000 },
      target: {
        type: "new-agent",
        config: {
          provider: "claude",
          cwd: "/tmp/project",
          thinkingOptionId: "think-hard",
          archiveOnFinish: false,
          isolation: "worktree",
        },
      },
    });
  });

  it("accepts a project-scoped saved Workflow target", () => {
    expect(
      ScheduleCreateRequestSchema.parse({
        type: "schedule/create",
        requestId: "request-1",
        prompt: "Start saved Workflow",
        cadence: { type: "every", everyMs: 60_000 },
        target: { type: "workflow", definitionId: "graph-1", projectRoot: "/repo" },
      }).target,
    ).toEqual({ type: "workflow", definitionId: "graph-1", projectRoot: "/repo" });
  });

  it("round-trips new-agent run options on update requests", () => {
    expect(
      ScheduleUpdateRequestSchema.parse({
        type: "schedule/update",
        requestId: "request-1",
        scheduleId: "schedule-1",
        newAgentConfig: {
          thinkingOptionId: "think-hard",
          archiveOnFinish: false,
          isolation: "worktree",
        },
      }),
    ).toEqual({
      type: "schedule/update",
      requestId: "request-1",
      scheduleId: "schedule-1",
      newAgentConfig: {
        thinkingOptionId: "think-hard",
        archiveOnFinish: false,
        isolation: "worktree",
      },
    });
  });
});
