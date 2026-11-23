import { describe, expect, it } from "vitest";
import pino from "pino";
import { ScheduleSession } from "./schedule-session.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { ScheduleService } from "../../schedule/service.js";
import { OttoStoredSchedule } from "@getpaseo/plugin/otto/schedules";
import { SessionOutboundMessageSchema } from "@getpaseo/protocol/messages";

// OTTO(schedules): prove extended internal records never widen an old client's wire union.
function record() {
  return OttoStoredSchedule.parse({
    id: "schedule",
    name: "Review",
    prompt: "Review",
    cadence: { type: "every", everyMs: 60000 },
    target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [],
    otto: {
      version: 1,
      scope: { hostId: "host", projectId: "project" },
      location: "repository",
      storeKey: "store",
    },
  });
}

function makeSession(schedule: { [K in keyof ScheduleService]?: unknown }) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new ScheduleSession({
    host: { emit: (message) => emitted.push(message) },
    scheduleService: createStub<ScheduleService>(schedule),
    logger: pino({ level: "silent" }),
  });
  return { session, emitted };
}

describe("ScheduleSession", () => {
  it("legacy list and inspect keep the original parseable format without private audit", async () => {
    const native = record();
    const extended = {
      ...native,
      id: "extended",
      target: {
        type: "artifact-update" as const,
        source: {
          scope: { hostId: "host", target: { kind: "project" as const, id: "project" } },
          id: "artifact",
          location: "repository" as const,
        },
        designFingerprint: "a".repeat(64),
        update: { type: "data" as const, json: "{}" },
      },
    };
    const { session, emitted } = makeSession({
      list: async () => [native, extended],
      inspect: async (id: string) => (id === "extended" ? extended : native),
    });
    await session.handleScheduleListRequest({ type: "schedule/list", requestId: "list" });
    const listed = findByType(emitted, "schedule/list/response");
    expect(listed?.payload.schedules.map((row) => row.id)).toEqual(["schedule"]);
    expect(listed?.payload.schedules[0]).not.toHaveProperty("otto");
    expect(SessionOutboundMessageSchema.safeParse(listed).success).toBe(true);
    await session.handleScheduleInspectRequest({
      type: "schedule/inspect",
      requestId: "inspect",
      scheduleId: "extended",
    });
    expect(findByType(emitted, "rpc_error")?.payload.error).toContain("updated Otto client");
    expect(emitted.some((row) => row.type === "schedule/inspect/response")).toBe(false);
  });

  it("legacy mutation requests carry a queued target guard", async () => {
    let received: Parameters<ScheduleService["pause"]>[1];
    const { session, emitted } = makeSession({
      pause: async (_id: string, mutation: Parameters<ScheduleService["pause"]>[1]) => {
        received = mutation;
        return record();
      },
    });
    await session.handleSchedulePauseRequest({
      type: "schedule/pause",
      requestId: "pause",
      scheduleId: "schedule",
    });
    expect(received).toEqual({ legacyOnly: true });
    expect(findByType(emitted, "schedule/pause/response")?.payload.error).toBeNull();
  });
  it("schedule/create returns a summary with the runs stripped", async () => {
    const stored = {
      id: "s1",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          status: "running" as const,
          agentId: null,
          output: null,
          error: null,
        },
      ],
    };
    const { session, emitted } = makeSession({ create: async () => stored });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc1",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "a" },
    });

    const response = findByType(emitted, "schedule/create/response");
    expect(response?.payload.schedule).toBeDefined();
    expect(response?.payload.schedule).not.toHaveProperty("runs");
    expect(response?.payload.schedule?.id).toBe("s1");
  });

  it("schedule/create remaps a self target to an agent target before creating", async () => {
    let received: Parameters<ScheduleService["create"]>[0] | undefined;
    const stored = {
      id: "s2",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { session, emitted } = makeSession({
      create: async (input: Parameters<ScheduleService["create"]>[0]) => {
        received = input;
        return stored;
      },
    });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc2",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "self", agentId: "agent-9" },
    });

    expect(received?.target).toEqual({ type: "agent", agentId: "agent-9" });
    expect(findByType(emitted, "schedule/create/response")?.payload.error).toBeNull();
  });
});
