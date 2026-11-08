import { expect, test } from "vitest";
import { DEFAULT_WORKFLOW_LIMITS } from "../workflows/runtime.js";
import {
  ScheduleDocument,
  ScheduleRunSummary,
  controlSchedule,
  createSchedule,
  listSchedules,
  readScheduleHistory,
  reviewScheduleTarget,
  scheduleOperations,
  transferSchedule,
  recoverScheduleTransferLock,
} from "./rpc.js";

const scope = { hostId: "host", projectId: "project" };
const ref = {
  scope,
  id: "schedule",
  location: "repository",
  storeKey: "schedules:repository:project",
};
const target = { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" };
const record = {
  id: ref.id,
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
  expiresAt: null,
  maxRuns: null,
};
const run = {
  id: "run",
  status: "succeeded",
  agentId: null,
  scheduledFor: "now",
  startedAt: "now",
  endedAt: "later",
  output: null,
  error: null,
  requestedTarget: target,
  outputTruncated: false,
  errorTruncated: false,
};
test("target review accepts a saved Workflow candidate without a client-generated fingerprint", () => {
  const seat = { provider: "fixture", model: "fixture" };
  expect(
    reviewScheduleTarget.input.parse({
      scope,
      target: {
        type: "workflow",
        source: { scope, id: "graph", kind: "graph", location: "repository" },
        workspaceId: "workspace",
        seats: { conductor: seat, worker: seat, judge: seat },
        limits: DEFAULT_WORKFLOW_LIMITS,
        inputs: {},
        approval: { allowTemplateCode: false, allowQueryEffects: false },
      },
    }).target.type,
  ).toBe("workflow");
});
test("project creation requires a project while host aggregate listing accepts unassigned legacy scope", () => {
  expect(listSchedules.input.safeParse({ scope: { ...scope, projectId: null } }).success).toBe(
    true,
  );
  expect(
    createSchedule.input.safeParse({
      scope: { ...scope, projectId: null },
      draft: {
        name: record.name,
        prompt: record.prompt,
        target,
        cadence: record.cadence,
        expiresAt: null,
        maxRuns: null,
        runOnCreate: false,
      },
    }).success,
  ).toBe(false);
});
test("cancel requires an exact run identity and unknown control tags are refused", () => {
  const input = { ref, expectedRevision: "a".repeat(64) };
  expect(controlSchedule.input.safeParse({ ...input, command: { type: "cancel" } }).success).toBe(
    false,
  );
  expect(controlSchedule.input.safeParse({ ...input, command: { type: "replace" } }).success).toBe(
    false,
  );
  expect(
    controlSchedule.input.safeParse({ ...input, command: { type: "cancel", runId: "run" } })
      .success,
  ).toBe(true);
});
test("create requires a stable client operation identity for lost-response recovery", () => {
  const input = {
    scope,
    draft: {
      name: record.name,
      prompt: record.prompt,
      target,
      cadence: record.cadence,
      expiresAt: null,
      maxRuns: null,
      runOnCreate: false,
    },
  };
  expect(createSchedule.input.safeParse(input).success).toBe(false);
  expect(createSchedule.input.safeParse({ ...input, operationId: "create-1" }).success).toBe(true);
  expect(createSchedule.input.safeParse({ ...input, operationId: "../outside" }).success).toBe(
    false,
  );
});

test("repair review is an explicit optional control intent and its receipt survives a document read", () => {
  const input = { ref, expectedRevision: "a".repeat(64) };
  expect(
    controlSchedule.input.safeParse({
      ...input,
      command: { type: "resume", userConfirmedInspection: true },
    }).success,
  ).toBe(true);
  expect(
    controlSchedule.input.safeParse({
      ...input,
      command: { type: "resume", userConfirmedInspection: "yes" },
    }).success,
  ).toBe(false);
  const lastRepairReview = {
    at: "review",
    runId: "previous-run",
    reason: "Inspect uncertain work",
  };
  expect(
    ScheduleDocument.parse({
      ref,
      revision: input.expectedRevision,
      schedule: {
        ...record,
        otto: {
          version: 1,
          scope,
          location: ref.location,
          storeKey: ref.storeKey,
          lastRepairReview,
        },
      },
    }).schedule.otto?.lastRepairReview,
  ).toEqual(lastRepairReview);
});
test("document responses exclude history and unknown disk-only fields without mutating stored data", () => {
  const stored = {
    ...record,
    futureSetting: { retained: true },
    runs: [run],
    otto: { version: 1, scope, location: ref.location, storeKey: ref.storeKey, futureOrigin: true },
  };
  const document = ScheduleDocument.parse({ ref, revision: "a".repeat(64), schedule: stored });
  expect(document.schedule).not.toHaveProperty("runs");
  expect(document.schedule).not.toHaveProperty("futureSetting");
  expect(document.schedule.otto).not.toHaveProperty("futureOrigin");
  expect(stored.futureSetting).toEqual({ retained: true });
  expect(stored.runs).toHaveLength(1);
});
test("history summaries bound output and carry explicit truncation rather than silently impersonating full logs", () => {
  expect(ScheduleRunSummary.safeParse({ ...run, output: "x".repeat(2001) }).success).toBe(false);
  expect(
    ScheduleRunSummary.parse({ ...run, output: "x".repeat(2000), outputTruncated: true })
      .outputTruncated,
  ).toBe(true);
});
test("history pages are bounded and every registered method uses a distinct dotted request name", () => {
  expect(
    readScheduleHistory.output.safeParse({
      ok: true,
      value: { runs: Array.from({ length: 51 }, () => run), total: 51, revision: "a".repeat(64) },
    }).success,
  ).toBe(false);
  expect(new Set(scheduleOperations.map((operation) => operation.name)).size).toBe(
    scheduleOperations.length,
  );
  for (const operation of scheduleOperations)
    expect(operation.name).toMatch(/^schedules\.(?:[a-z-]+\.)+request$/);
});

test("transfers require an explicit project, origin and digest while recovery requires stopped-writer acknowledgement", () => {
  const transfer = {
    scope,
    source: ref,
    expectedRevision: "a".repeat(64),
    operationId: "operation",
    operation: "copy",
    destination: "host",
  };
  expect(transferSchedule.input.parse(transfer)).toEqual(transfer);
  expect(transferSchedule.input.safeParse({ ...transfer, destination: "legacy" }).success).toBe(
    false,
  );
  expect(
    transferSchedule.input.safeParse({ ...transfer, scope: { ...scope, projectId: null } }).success,
  ).toBe(false);
  const recovery = {
    scope,
    operationId: "operation",
    expectedRevision: "a".repeat(64),
    kind: "source",
    expectedLockRevision: "b".repeat(64),
    writersStopped: true,
  };
  expect(recoverScheduleTransferLock.input.parse(recovery)).toEqual(recovery);
  expect(
    recoverScheduleTransferLock.input.safeParse({ ...recovery, writersStopped: false }).success,
  ).toBe(false);
  expect(
    recoverScheduleTransferLock.input.safeParse({ ...recovery, kind: "C:/arbitrary/path" }).success,
  ).toBe(false);
});
