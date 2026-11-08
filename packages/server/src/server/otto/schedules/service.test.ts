import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  createSchedule,
  listSchedules,
  readSchedule,
  readScheduleHistory,
  readScheduleRun,
  readScheduleDefaults,
  saveScheduleDefaults,
  readScheduleStorage,
  saveScheduleStorage,
  controlSchedule,
} from "@getpaseo/plugin/otto/schedules";
import type { PluginRpcContract } from "@getpaseo/plugin";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";
import { ScheduleError } from "./files.js";
import { scheduleRevision } from "./legacy.js";

test("one bounded API creates, reads, searches, pauses and deletes through the canonical store", async () => {
  const f = await scheduleApiFixture();
  try {
    const saved = createSchedule.output.parse(
      await f.api.invoke(createSchedule.name, {
        scope: f.scope,
        operationId: "api-create",
        draft: f.draft,
      }),
    );
    if (!saved.ok) throw new Error(saved.error.message);
    const { ref, revision } = saved.value;
    const found = listSchedules.output.parse(
      await f.api.invoke(listSchedules.name, { scope: f.scope, query: "saved work" }),
    );
    expect(found).toMatchObject({
      ok: true,
      value: { total: 1, items: [{ ref, target: f.draft.target }] },
    });
    const paused = controlSchedule.output.parse(
      await f.api.invoke(controlSchedule.name, {
        ref,
        expectedRevision: revision,
        command: { type: "pause" },
      }),
    );
    if (!paused.ok || !paused.value.entry) throw new Error("Missing paused response");
    expect(paused.value.entry.schedule.status).toBe("paused");
    expect(
      await f.api.invoke(controlSchedule.name, {
        ref,
        expectedRevision: revision,
        command: { type: "delete" },
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    const deleted = await f.api.invoke(controlSchedule.name, {
      ref,
      expectedRevision: paused.value.entry.revision,
      command: { type: "delete" },
    });
    expect(deleted).toEqual({ ok: true, value: { deleted: true } });
    expect((await f.registry.catalog()).length).toBe(0);
  } finally {
    await f.cleanup();
  }
});
test("list and history disclose bounded previews while exact detail keeps actual run attribution", async () => {
  const f = await scheduleApiFixture();
  try {
    const saved = await f.create();
    const priorTarget = { type: "agent" as const, agentId: "00000000-0000-4000-8000-000000000002" };
    const run = {
      id: "historical",
      status: "succeeded" as const,
      scheduledFor: "now",
      startedAt: "now",
      endedAt: "then",
      agentId: null,
      error: null,
      output: "x".repeat(4000),
      futureRun: "disk only",
      otto: { requestedTarget: priorTarget, futureAudit: "disk only" },
    };
    await f.registry.update(saved.ref.id, (row) => ({
      ...row,
      prompt: "p".repeat(1000),
      futureHead: "disk only",
      runs: [
        run,
        ...Array.from({ length: 50 }, (_, i) => ({ ...run, id: `other-${i}`, otto: undefined })),
      ],
    }));
    const head = readSchedule.output.parse(await f.api.invoke(readSchedule.name, saved.ref));
    expect(head).toMatchObject({ ok: true });
    if (!head.ok) throw new Error(head.error.message);
    expect(head.value.schedule).not.toHaveProperty("runs");
    expect(head.value.schedule).not.toHaveProperty("futureHead");
    const page = readScheduleHistory.output.parse(
      await f.api.invoke(readScheduleHistory.name, { ref: saved.ref }),
    );
    if (!page.ok) throw new Error(page.error.message);
    expect(page.value.total).toBe(51);
    expect(page.value.runs).toHaveLength(50);
    expect(page.value.runs[0]).toMatchObject({
      requestedTarget: priorTarget,
      outputTruncated: true,
    });
    expect(page.value.runs[0].output).toHaveLength(2000);
    expect(page.value.runs[1].requestedTarget).toBeNull();
    const exact = readScheduleRun.output.parse(
      await f.api.invoke(readScheduleRun.name, { ref: saved.ref, runId: "historical" }),
    );
    if (!exact.ok) throw new Error(exact.error.message);
    expect(exact.value.run.output).toHaveLength(4000);
    expect(exact.value.run.otto?.requestedTarget).toEqual(priorTarget);
    expect(exact.value.run).not.toHaveProperty("futureRun");
    expect(exact.value.run.otto).not.toHaveProperty("futureAudit");
    expect((await f.registry.entry(saved.ref.id))?.schedule.runs[0]).toHaveProperty(
      "futureRun",
      "disk only",
    );
  } finally {
    await f.cleanup();
  }
});
test("duplicate origins remain individually inspectable but no ambiguous mutation can run", async () => {
  const f = await scheduleApiFixture();
  try {
    const saved = await f.create();
    const original = await f.registry.entry(saved.ref.id);
    if (!original?.schedule.otto) throw new Error("Missing Schedule");
    const origin = (await f.stores.locations(f.scope)).find((item) => item.location === "host");
    if (!origin) throw new Error("Missing host origin");
    await mkdir(origin.directory, { recursive: true });
    const duplicate = {
      ...original.schedule,
      otto: {
        ...original.schedule.otto,
        scope: origin.scope,
        location: origin.location,
        storeKey: origin.storeKey,
      },
    };
    await writeFile(path.join(origin.directory, `${saved.ref.id}.json`), JSON.stringify(duplicate));
    const catalog = listSchedules.output.parse(
      await f.api.invoke(listSchedules.name, { scope: f.scope, refresh: true }),
    );
    if (!catalog.ok) throw new Error(catalog.error.message);
    expect(catalog.value.items).toHaveLength(2);
    expect(catalog.value.diagnosticTotal).toBe(1);
    expect(catalog.value.items.every((item) => item.repairReason?.includes("Duplicate"))).toBe(
      true,
    );
    const detail = await f.api.invoke(readSchedule.name, {
      ...saved.ref,
      location: origin.location,
      storeKey: origin.storeKey,
    });
    expect(detail).toMatchObject({ ok: true, value: { revision: scheduleRevision(duplicate) } });
    expect(
      await f.api.invoke(controlSchedule.name, {
        ref: saved.ref,
        expectedRevision: saved.revision,
        command: { type: "run-once" },
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("host defaults and project overrides remain separate CAS domains", async () => {
  const f = await scheduleApiFixture();
  try {
    const defaults = readScheduleDefaults.output.parse(
      await f.api.invoke(readScheduleDefaults.name, { hostId: f.scope.hostId }),
    );
    const project = readScheduleStorage.output.parse(
      await f.api.invoke(readScheduleStorage.name, f.scope),
    );
    if (!defaults.ok || !project.ok) throw new Error("Missing settings");
    expect(
      await f.api.invoke(saveScheduleDefaults.name, {
        hostId: f.scope.hostId,
        expectedRevision: defaults.value.revision,
        location: "host",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await f.api.invoke(saveScheduleStorage.name, {
        scope: f.scope,
        expectedRevision: project.value.revision,
        location: "repository",
      }),
    ).toMatchObject({ ok: true, value: { location: "repository", hostDefault: "host" } });
    expect(
      await f.api.invoke(saveScheduleStorage.name, {
        scope: f.scope,
        expectedRevision: project.value.revision,
        location: "host",
      }),
    ).toMatchObject({ ok: false });
    expect((await f.metadata.read(f.scope.projectId)).record.knowledgeLocation).toBe("host");
    expect((await f.metadata.read(f.scope.projectId)).record.future).toEqual({ keep: true });
  } finally {
    await f.cleanup();
  }
});
test("request errors, stopped owners and host mismatches are sanitized without leaking provider or disk data", async () => {
  const f = await scheduleApiFixture();
  try {
    expect(f.api.invoke("not.registered.request", {})).toBeUndefined();
    for (const [contract, input] of [
      [createSchedule, { scope: f.scope, operationId: "bad", draft: {} }],
      [listSchedules, { scope: { ...f.scope, hostId: "wrong" } }],
    ] satisfies [PluginRpcContract, unknown][]) {
      expect(await f.api.invoke(contract.name, input)).toMatchObject({
        ok: false,
        error: { code: "invalid" },
      });
    }
    f.validate.mockRejectedValueOnce(new Error("secret provider key and unrelated host path"));
    const failed = await f.api.invoke(createSchedule.name, {
      scope: f.scope,
      operationId: "bad",
      draft: f.draft,
    });
    expect(JSON.stringify(failed)).not.toContain("secret provider");
    expect(failed).toMatchObject({ ok: false, error: { code: "unavailable" } });
    f.validate.mockRejectedValueOnce(
      new ScheduleError("conflict", "Review the saved target again."),
    );
    expect(
      await f.api.invoke(createSchedule.name, {
        scope: f.scope,
        operationId: "bad",
        draft: f.draft,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    await f.api.close();
    expect(await f.api.invoke(listSchedules.name, { scope: f.scope })).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  } finally {
    await f.cleanup();
  }
});
