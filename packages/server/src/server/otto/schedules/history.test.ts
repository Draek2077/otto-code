import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  readScheduleHistory,
  readScheduleRun,
  readScheduleRunPart,
  listSchedules,
  type OttoScheduleRun,
  type OttoScheduleTarget,
} from "@getpaseo/plugin/otto/schedules";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";
import { ScheduleHistory } from "./history.js";

function terminal(number: number, target?: OttoScheduleTarget): OttoScheduleRun {
  return {
    id: `run-${number}`,
    scheduledFor: "before",
    startedAt: "before",
    endedAt: "before",
    status: "succeeded",
    agentId: null,
    output: `Full result ${number}`,
    error: null,
    ...(target ? { otto: { requestedTarget: target } } : {}),
  };
}
test("older runs remain paged and readable while archived attempts still consume the lifetime run limit", async () => {
  const f = await scheduleApiFixture();
  try {
    const created = await f.create();
    await f.registry.update(created.ref.id, (row) => ({
      ...row,
      maxRuns: 61,
      nextRunAt: "2026-11-08T00:00:00.000Z",
      runs: Array.from({ length: 60 }, (_, number) => terminal(number, row.target)),
    }));
    const entry = await f.registry.entry(created.ref.id);
    if (!entry) throw new Error("Missing history fixture");
    expect(entry.schedule.runs).toHaveLength(50);
    expect(entry.schedule.otto?.history?.count).toBe(10);
    const page = readScheduleHistory.output.parse(
      await f.api.invoke(readScheduleHistory.name, { ref: entry.ref }),
    );
    expect(page).toMatchObject({ ok: true, value: { total: 60 } });
    if (!page.ok) throw new Error(page.error.message);
    expect(page.value.runs.map((run) => run.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `run-${59 - index}`),
    );
    const older = readScheduleHistory.output.parse(
      await f.api.invoke(readScheduleHistory.name, { ref: entry.ref, offset: 50 }),
    );
    if (!older.ok) throw new Error(older.error.message);
    expect(older.value.runs.map((run) => run.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `run-${9 - index}`),
    );
    expect(
      await f.api.invoke(readScheduleRun.name, { ref: entry.ref, runId: "run-0" }),
    ).toMatchObject({
      ok: true,
      value: { kind: "inline", run: { id: "run-0", output: "Full result 0" } },
    });
    await f.scheduler.tick();
    expect(f.runner).toHaveBeenCalledTimes(1);
    const completed = await f.registry.entry(entry.ref.id);
    expect(completed?.schedule).toMatchObject({
      status: "completed",
      nextRunAt: null,
      otto: { history: { count: 11 } },
    });
    expect(completed?.schedule.runs).toHaveLength(50);
  } finally {
    await f.cleanup();
  }
});

test("large Unicode results stream losslessly in bounded public parts without exposing preserved private fields", async () => {
  const f = await scheduleApiFixture();
  try {
    const created = await f.create();
    const output = "🌊".repeat(220000);
    await f.registry.update(created.ref.id, (row) => ({
      ...row,
      runs: [
        {
          ...terminal(0, row.target),
          output,
          futureRun: "disk-only",
          otto: { requestedTarget: row.target, futureAudit: "disk-only" },
        },
      ],
    }));
    const entry = await f.registry.entry(created.ref.id);
    if (!entry) throw new Error("Missing content fixture");
    expect(entry.schedule.runs).toEqual([]);
    const detail = readScheduleRun.output.parse(
      await f.api.invoke(readScheduleRun.name, { ref: entry.ref, runId: "run-0" }),
    );
    if (!detail.ok || detail.value.kind !== "stored")
      throw new Error("Expected stored large result");
    expect(detail.value.summary).toMatchObject({ id: "run-0", outputTruncated: true });
    const parts: Buffer[] = [];
    for (let part = 0; part < detail.value.content.parts; part++) {
      const response = readScheduleRunPart.output.parse(
        await f.api.invoke(readScheduleRunPart.name, {
          ref: entry.ref,
          runId: "run-0",
          contentRevision: detail.value.content.revision,
          part,
        }),
      );
      if (!response.ok) throw new Error(response.error.message);
      expect(response.value.data.length).toBeLessThanOrEqual(360000);
      parts.push(Buffer.from(response.value.data, "base64"));
    }
    const result = JSON.parse(Buffer.concat(parts).toString("utf8"));
    expect(result.output).toBe(output);
    expect(result).not.toHaveProperty("futureRun");
    expect(result.otto).not.toHaveProperty("futureAudit");
    const history = new ScheduleHistory(await f.registry.transferOrigin(entry.ref), entry.ref.id);
    if (!entry.schedule.otto?.history) throw new Error("Missing retained history root");
    const archived = await history.index.at(entry.schedule.otto.history, 0);
    expect(
      await f.api.invoke(readScheduleRunPart.name, {
        ref: entry.ref,
        runId: "run-0",
        contentRevision: archived.original,
        part: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    const listed = listSchedules.output.parse(
      await f.api.invoke(listSchedules.name, { scope: f.scope }),
    );
    expect(listed).toMatchObject({
      ok: true,
      value: { items: [{ runCount: 1, lastRun: { id: "run-0", outputTruncated: true } }] },
    });
  } finally {
    await f.cleanup();
  }
});

test("copy settings leaves history with its source and a move carries verified archives to the destination", async () => {
  const f = await scheduleApiFixture();
  try {
    const created = await f.create();
    await f.registry.update(created.ref.id, (row) => ({
      ...row,
      runs: Array.from({ length: 55 }, (_, number) => terminal(number, row.target)),
    }));
    const source = await f.registry.entry(created.ref.id);
    if (!source) throw new Error("Missing transfer history fixture");
    const input = {
      scope: f.scope,
      source: source.ref,
      expectedRevision: source.revision,
      destination: "host" as const,
    };
    const copy = await f.api.transfers.transfer({
      ...input,
      operation: "copy",
      operationId: "copy-history-settings",
    });
    expect((await f.registry.entry(copy.destination.id))?.schedule.otto).not.toHaveProperty(
      "history",
    );
    const moved = await f.api.transfers.transfer({
      ...input,
      operation: "move",
      operationId: "move-history",
    });
    expect(moved).toMatchObject({ status: "committed", needsReconciliation: false });
    expect(await f.api.invoke(readScheduleHistory.name, { ref: moved.destination })).toMatchObject({
      ok: true,
      value: { total: 55 },
    });
    expect(
      await f.api.invoke(readScheduleRun.name, { ref: moved.destination, runId: "run-0" }),
    ).toMatchObject({ ok: true, value: { kind: "inline", run: { output: "Full result 0" } } });
  } finally {
    await f.cleanup();
  }
});

test("a corrupt archive root blocks execution discovery and leaves the primary record untouched", async () => {
  const f = await scheduleApiFixture();
  try {
    const created = await f.create();
    await f.registry.update(created.ref.id, (row) => ({
      ...row,
      runs: Array.from({ length: 51 }, (_, number) => terminal(number)),
    }));
    const entry = await f.registry.entry(created.ref.id);
    if (!entry?.schedule.otto?.history) throw new Error("Missing corrupt-history fixture");
    const origin = await f.registry.transferOrigin(entry.ref);
    const primary = path.join(origin.directory, `${entry.ref.id}.json`);
    const before = await readFile(primary, "utf8");
    const history = new ScheduleHistory(origin, entry.ref.id);
    await writeFile(
      path.join(history.objects.directory, "objects", `${entry.schedule.otto.history.root}.data`),
      "damaged archive",
    );
    await f.registry.refresh(true);
    expect(await f.registry.list()).toEqual([]);
    expect(await f.registry.problems()).toContainEqual(
      expect.objectContaining({ code: "record_unavailable" }),
    );
    expect(await readFile(primary, "utf8")).toBe(before);
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test("repeated large Artifact snapshots stay fully readable without filling the primary Schedule file", async () => {
  const f = await scheduleApiFixture();
  try {
    const created = await f.create();
    const target: OttoScheduleTarget = {
      type: "artifact-update",
      source: {
        scope: { hostId: f.scope.hostId, target: { kind: "project", id: f.scope.projectId } },
        id: "report",
        location: "repository",
      },
      designFingerprint: "a".repeat(64),
      update: { type: "data", json: JSON.stringify({ data: "x".repeat(90000) }) },
    };
    await f.registry.update(created.ref.id, (row) => ({
      ...row,
      target,
      runs: Array.from({ length: 20 }, (_, number) => terminal(number, target)),
    }));
    const entry = await f.registry.entry(created.ref.id);
    if (!entry) throw new Error("Missing Artifact history fixture");
    expect(entry.schedule.runs.length).toBeLessThan(20);
    expect(entry.schedule.otto?.history?.count).toBe(20 - entry.schedule.runs.length);
    const origin = await f.registry.transferOrigin(entry.ref);
    expect(
      (await readFile(path.join(origin.directory, `${entry.ref.id}.json`))).length,
    ).toBeLessThanOrEqual(768000);
    expect(await f.api.invoke(readScheduleHistory.name, { ref: entry.ref })).toMatchObject({
      ok: true,
      value: { total: 20 },
    });
    expect(
      await f.api.invoke(readScheduleRun.name, { ref: entry.ref, runId: "run-0" }),
    ).toMatchObject({
      ok: true,
      value: { kind: "inline", run: { otto: { requestedTarget: target } } },
    });
  } finally {
    await f.cleanup();
  }
});
