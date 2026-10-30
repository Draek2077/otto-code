import { expect, test } from "vitest";
import { artifactCallerSource } from "./sources.js";
import type { StoredSchedule } from "@getpaseo/protocol/schedule/types";
import { ScheduleNotFoundError } from "../../schedule/service.js";

const schedule: StoredSchedule = {
  id: "schedule",
  name: "Refresh",
  prompt: "Refresh report",
  cadence: { type: "every", everyMs: 60000 },
  target: { type: "new-agent", config: { provider: "fixture", cwd: "/project" } },
  status: "active",
  createdAt: "now",
  updatedAt: "now",
  nextRunAt: null,
  lastRunAt: "now",
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
  runs: [
    {
      id: "run",
      status: "running",
      agentId: "agent",
      workspaceId: "workspace",
      scheduledFor: "now",
      startedAt: "now",
      endedAt: null,
      output: null,
      error: null,
    },
  ],
};
const caller = {
  workspaceId: "workspace",
  agentId: "agent",
  labels: { "paseo.schedule-id": "schedule", "paseo.schedule-run": "run" },
};
test("Schedule attribution requires the exact durable active run, chat and workspace", async () => {
  expect(await artifactCallerSource(caller, { inspect: async () => schedule })).toEqual({
    kind: "schedule",
    scheduleId: "schedule",
    runId: "run",
  });
});
test.each([
  { run: { status: "succeeded" as const } },
  { run: { status: "failed" as const } },
  { run: { agentId: "peer" } },
  { run: { workspaceId: "peer" } },
  { run: { id: "peer" } },
])("stale or mismatched run ownership stays chat-attributed: %j", async ({ run }) => {
  expect(
    await artifactCallerSource(caller, {
      inspect: async () => ({ ...schedule, runs: [{ ...schedule.runs[0], ...run }] }),
    }),
  ).toEqual({ kind: "chat", agentId: "agent" });
});
test("existing-chat schedules cannot infer per-turn ownership from durable labels", async () => {
  expect(
    await artifactCallerSource(caller, {
      inspect: async () => ({ ...schedule, target: { type: "agent", agentId: "agent" } }),
    }),
  ).toEqual({ kind: "chat", agentId: "agent" });
});
test("incomplete labels and outside-chat calls never fetch or invent a source", async () => {
  const unexpected = {
    inspect: async (): Promise<StoredSchedule> => {
      throw new Error("must not read");
    },
  };
  expect(await artifactCallerSource({ workspaceId: "workspace" }, unexpected)).toBeUndefined();
  expect(await artifactCallerSource({ ...caller, labels: {} }, unexpected)).toEqual({
    kind: "chat",
    agentId: "agent",
  });
});
test("an unreadable claimed Schedule refuses a write instead of inventing provenance", async () => {
  await expect(
    artifactCallerSource(caller, {
      inspect: async () => {
        throw new Error("store unavailable");
      },
    }),
  ).rejects.toThrow("store unavailable");
});
test("a deleted Schedule cannot retag later manual work in its old chat", async () => {
  expect(
    await artifactCallerSource(caller, {
      inspect: async () => {
        throw new ScheduleNotFoundError("schedule");
      },
    }),
  ).toEqual({ kind: "chat", agentId: "agent" });
});
test.each(["../config", "C:\\private\\config", "/private/config"])(
  "source lookup refuses a path-shaped Schedule identity: %s",
  async (id) => {
    expect(
      await artifactCallerSource(
        { ...caller, labels: { ...caller.labels, "paseo.schedule-id": id } },
        {
          inspect: async (): Promise<StoredSchedule> => {
            throw new Error("must not read");
          },
        },
      ),
    ).toEqual({ kind: "chat", agentId: "agent" });
  },
);
