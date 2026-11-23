import { expect, test } from "vitest";
import { OttoStoredSchedule, type OttoScheduleTarget } from "@getpaseo/plugin/otto/schedules";
import { StoredScheduleSchema } from "@getpaseo/protocol/schedule/types";
import {
  assertScheduleMutation,
  requirePaseoSchedule,
  scheduleRevision,
  legacyScheduleRuns,
} from "./legacy.js";

function record(
  target: OttoScheduleTarget = { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
) {
  return OttoStoredSchedule.parse({
    id: "schedule",
    name: "Review",
    prompt: "Review",
    target,
    cadence: { type: "every", everyMs: 60000 },
    status: "active",
    createdAt: "now",
    updatedAt: "now",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    maxRuns: null,
    expiresAt: null,
    runs: [],
  });
}
const ref = {
  scope: { hostId: "host", projectId: null },
  id: "schedule",
  location: "legacy" as const,
  storeKey: "schedules:legacy:host",
};
test("legacy projection retains the old schema and removes private target audit", () => {
  const schedule = record();
  const projected = requirePaseoSchedule({
    ...schedule,
    otto: { version: 1, scope: ref.scope, location: "legacy", storeKey: ref.storeKey },
  });
  expect(StoredScheduleSchema.parse(projected)).toEqual(schedule);
  expect(projected).not.toHaveProperty("otto");
});
test("a stale edit is refused and an unchanged originating revision is accepted", () => {
  const schedule = record();
  const mutation = { ref, expectedRevision: scheduleRevision(schedule) };
  expect(() => assertScheduleMutation(schedule, mutation)).not.toThrow();
  expect(() => assertScheduleMutation({ ...schedule, name: "Peer edit" }, mutation)).toThrow(
    "Schedule changed",
  );
});
test("legacy mutation authority cannot modify an extended target", () => {
  const schedule = record({
    type: "artifact-update",
    source: {
      scope: { hostId: "host", target: { kind: "project", id: "project" } },
      id: "artifact",
      location: "repository",
    },
    designFingerprint: "a".repeat(64),
    update: { type: "data", json: "{}" },
  });
  expect(() => assertScheduleMutation(schedule, { legacyOnly: true })).toThrow(
    "updated Otto client",
  );
  expect(() => requirePaseoSchedule(schedule)).toThrow("updated Otto client");
});

test("legacy native wire reads remain parseable but cannot bypass an explicit repair review", () => {
  const schedule = {
    ...record(),
    status: "paused" as const,
    otto: {
      version: 1 as const,
      scope: ref.scope,
      location: "legacy" as const,
      storeKey: ref.storeKey,
      repairReason: "Inspect interrupted work",
    },
  };
  expect(StoredScheduleSchema.safeParse(requirePaseoSchedule(schedule)).success).toBe(true);
  expect(() => assertScheduleMutation(schedule, { legacyOnly: true })).toThrow(
    "inspect and review",
  );
});
test("an exact content revision cannot authorize a different owning project/store", () => {
  const schedule = {
    ...record(),
    otto: {
      version: 1 as const,
      scope: { hostId: "host", projectId: "project" },
      location: "repository" as const,
      storeKey: "schedules:repository:project",
    },
  };
  expect(() =>
    assertScheduleMutation(schedule, { ref, expectedRevision: scheduleRevision(schedule) }),
  ).toThrow("storage origin changed");
});
test("legacy logs preserve caller ordering and remove only extension fields", () => {
  const base = {
    id: "run",
    scheduledFor: "now",
    startedAt: "now",
    endedAt: null,
    status: "running" as const,
    agentId: null,
    workspaceId: "workspace",
    output: null,
    error: null,
  };
  const runs = legacyScheduleRuns([
    { ...base, otto: { requestedTarget: record().target, disposition: "waiting" } },
    { ...base, id: "second" },
  ]);
  expect(runs).toEqual([base, { ...base, id: "second" }]);
});
test("a persistent transfer fence blocks old controls, modern repair acknowledgement and bare clock mutations", () => {
  const schedule = {
    ...record(),
    status: "paused" as const,
    otto: {
      version: 1 as const,
      scope: ref.scope,
      location: ref.location,
      storeKey: ref.storeKey,
      transfer: {
        operationId: "transfer-1",
        operation: "move" as const,
        role: "source" as const,
        phase: "pending" as const,
        peer: {
          ...ref,
          location: "repository" as const,
          scope: { hostId: "host", projectId: "project" },
          storeKey: "schedules:repository:project",
        },
      },
    },
  };
  expect(StoredScheduleSchema.safeParse(requirePaseoSchedule(schedule)).success).toBe(true);
  expect(() => assertScheduleMutation(schedule)).toThrow("unfinished storage transfer");
  expect(() => assertScheduleMutation(schedule, { legacyOnly: true })).toThrow(
    "unfinished storage transfer",
  );
  expect(() =>
    assertScheduleMutation(schedule, {
      ref,
      expectedRevision: scheduleRevision(schedule),
      repairReviewed: true,
    }),
  ).toThrow("unfinished storage transfer");
});
test("project-owned native controls require an exact origin while old host-global native controls keep working", () => {
  const schedule = record();
  expect(() => assertScheduleMutation(schedule, { legacyOnly: true })).not.toThrow();
  const source = {
    ...ref,
    scope: { hostId: "host", projectId: "project" },
    location: "repository" as const,
    storeKey: "schedules:repository:project",
  };
  const scoped = {
    ...schedule,
    otto: {
      version: 1 as const,
      scope: source.scope,
      location: source.location,
      storeKey: source.storeKey,
    },
  };
  expect(StoredScheduleSchema.safeParse(requirePaseoSchedule(scoped)).success).toBe(true);
  expect(() => assertScheduleMutation(scoped, { legacyOnly: true })).toThrow("exact origin");
  expect(() =>
    assertScheduleMutation(scoped, { ref: source, expectedRevision: scheduleRevision(scoped) }),
  ).not.toThrow();
});
