import { expect, test } from "vitest";
import { StoredScheduleSchema } from "@getpaseo/protocol/schedule/types";
import { OttoStoredSchedule, isPaseoSchedule, ScheduledArtifactUpdate } from "./model.js";

const legacy = {
  id: "legacy",
  name: null,
  prompt: "Keep the existing behavior",
  cadence: { type: "every", everyMs: 60000 },
  target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
  status: "active",
  createdAt: "2026-11-08T00:00:00Z",
  updatedAt: "2026-11-08T00:00:00Z",
  nextRunAt: null,
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
  runs: [],
};
test("old agent records remain parseable and preserve unknown persisted fields", () => {
  const record = OttoStoredSchedule.parse({ ...legacy, futureSetting: { retained: true } });
  expect(isPaseoSchedule(record)).toBe(true);
  expect(StoredScheduleSchema.parse(record)).toEqual(legacy);
  expect(record.futureSetting).toEqual({ retained: true });
});
test("future origin and run-audit fields survive known record edits", () => {
  const record = OttoStoredSchedule.parse({
    ...legacy,
    otto: {
      version: 1,
      scope: { hostId: "host", projectId: "project" },
      location: "repository",
      storeKey: "store",
      futureReceipt: { keep: true },
    },
    runs: [
      {
        id: "run",
        scheduledFor: "now",
        startedAt: "now",
        endedAt: null,
        status: "running",
        agentId: null,
        output: null,
        error: null,
        otto: { requestedTarget: legacy.target, futureAudit: { keep: true } },
      },
    ],
  });
  const edited = OttoStoredSchedule.parse({ ...record, name: "Edited" });
  expect(edited.otto?.futureReceipt).toEqual({ keep: true });
  expect(edited.runs[0].otto?.futureAudit).toEqual({ keep: true });
});
test("extended targets remain outside the unchanged legacy transport", () => {
  const record = OttoStoredSchedule.parse({
    ...legacy,
    target: {
      type: "artifact-update",
      source: {
        scope: { hostId: "host", target: { kind: "project", id: "project" } },
        id: "artifact",
        location: "repository",
      },
      designFingerprint: "a".repeat(64),
      update: { type: "data", json: "{}" },
    },
  });
  expect(isPaseoSchedule(record)).toBe(false);
  expect(StoredScheduleSchema.safeParse(record).success).toBe(false);
});
test("instruction updates require an explicit provider/model, never a generation fallback", () => {
  expect(
    ScheduledArtifactUpdate.safeParse({
      type: "artifact-update",
      source: {
        scope: { hostId: "host", target: { kind: "project", id: "project" } },
        id: "artifact",
        location: "repository",
      },
      designFingerprint: "a".repeat(64),
      update: { type: "instruction", instruction: "Refresh data" },
    }).success,
  ).toBe(false);
});
test("legacy terminal statuses remain closed while optional disposition is additive", () => {
  const run = {
    id: "run",
    scheduledFor: "now",
    startedAt: "now",
    endedAt: "later",
    status: "failed",
    agentId: null,
    output: null,
    error: "Canceled",
    otto: { requestedTarget: legacy.target, disposition: "canceled" },
  };
  const record = OttoStoredSchedule.parse({ ...legacy, runs: [run] });
  expect(StoredScheduleSchema.parse(record).runs[0].status).toBe("failed");
  expect(record.runs[0].otto?.disposition).toBe("canceled");
  expect(
    OttoStoredSchedule.safeParse({ ...legacy, runs: [{ ...run, status: "canceled" }] }).success,
  ).toBe(false);
});
