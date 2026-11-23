import { expect, test } from "vitest";
import { ScheduleError } from "./files.js";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";

test.each(["agent", "new-agent"] as const)(
  "legacy %s controls retain the host-global origin and validate native policy",
  async (kind) => {
    const f = await scheduleApiFixture();
    const held = f.holdRun();
    try {
      const target =
        kind === "agent"
          ? f.draft.target
          : {
              type: "new-agent" as const,
              config: { provider: "codex", cwd: f.repo, archiveOnFinish: true },
            };
      const created = await f.scheduler.create({ ...f.draft, target });
      const first = await f.registry.entry(created.id);
      if (!first) throw new Error("Missing legacy Schedule");
      expect(first.ref).toMatchObject({ location: "legacy", scope: { projectId: null } });
      const paused = await f.actions.control({
        ref: first.ref,
        expectedRevision: first.revision,
        command: { type: "pause" },
      });
      if (!paused.entry) throw new Error("Missing paused Schedule");
      f.validateLegacyNative.mockRejectedValueOnce(
        new ScheduleError("invalid", "Review native provider"),
      );
      const input = {
        ref: paused.entry.ref,
        expectedRevision: paused.entry.revision,
        command: { type: "resume" as const },
      };
      await expect(f.actions.control(input)).rejects.toThrow("Review native provider");
      expect((await f.registry.entry(created.id))?.schedule.status).toBe("paused");
      const resumed = await f.actions.control(input);
      if (!resumed.entry) throw new Error("Missing resumed Schedule");
      expect(resumed.entry.ref).toEqual(first.ref);
      const admitted = await f.actions.control({
        ref: resumed.entry.ref,
        expectedRevision: resumed.entry.revision,
        command: { type: "run-once" },
      });
      expect(admitted.acceptedRunId).toBeTruthy();
      held.release();
      await held.finished;
      expect((await f.registry.entry(created.id))?.ref).toEqual(first.ref);
      expect(f.validateLegacyNative).toHaveBeenLastCalledWith(target);
      expect(f.validate).not.toHaveBeenCalled();
      expect(f.runner).toHaveBeenCalledTimes(1);
    } finally {
      held.release();
      await f.cleanup();
    }
  },
);

test("create delegates cadence to Paseo and replay preserves history across default changes", async () => {
  const f = await scheduleApiFixture();
  try {
    const first = await f.create();
    expect(first.schedule.nextRunAt).toBe("2026-11-08T00:01:00.000Z");
    await f.registry.update(first.ref.id, (row) => ({ ...row, name: "Peer edit" }));
    const defaults = await f.stores.defaults();
    await f.stores.saveDefaults(defaults.revision, "host");
    const replay = await f.create();
    expect(replay.ref).toEqual(first.ref);
    expect(replay.schedule.name).toBe("Peer edit");
    expect(await f.registry.list()).toHaveLength(1);
    await expect(
      f.create({ draft: { ...f.draft, prompt: "Different operation payload" } }),
    ).rejects.toThrow("already saved different");
  } finally {
    await f.cleanup();
  }
});
test("concurrent duplicate creates publish exactly one record and a new operation creates another", async () => {
  const f = await scheduleApiFixture();
  try {
    const [first, replay] = await Promise.all([f.create(), f.create()]);
    expect(replay.ref).toEqual(first.ref);
    await f.create({ operationId: "create-2" });
    expect(await f.registry.list()).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});
test("stale edits and owning target rejection preserve original settings", async () => {
  const f = await scheduleApiFixture();
  try {
    const first = await f.create();
    await f.registry.update(first.ref.id, (row) => ({ ...row, prompt: "Peer" }));
    await expect(
      f.actions.update({ ref: first.ref, expectedRevision: first.revision, draft: f.draft }),
    ).rejects.toThrow("Schedule changed");
    const current = await f.registry.entry(first.ref.id);
    if (!current) throw new Error("Missing fixture Schedule");
    f.validate.mockRejectedValueOnce(new ScheduleError("conflict", "Authority changed"));
    await expect(
      f.actions.update({ ref: current.ref, expectedRevision: current.revision, draft: f.draft }),
    ).rejects.toThrow("Authority changed");
    expect((await f.registry.entry(first.ref.id))?.schedule.prompt).toBe("Peer");
  } finally {
    await f.cleanup();
  }
});
test("run-once acknowledges durable admission before execution settles and blocks active edits", async () => {
  const f = await scheduleApiFixture();
  const held = f.holdRun();
  try {
    const first = await f.create();
    const response = await f.actions.control({
      ref: first.ref,
      expectedRevision: first.revision,
      command: { type: "run-once" },
    });
    expect(response.acceptedRunId).toBeTruthy();
    const running = await f.registry.entry(first.ref.id);
    if (!running) throw new Error("Missing running Schedule");
    expect(running.schedule.runs[0]).toMatchObject({
      id: response.acceptedRunId,
      status: "running",
    });
    await expect(
      f.actions.update({ ref: running.ref, expectedRevision: running.revision, draft: f.draft }),
    ).rejects.toThrow("active Schedule run");
    await expect(
      f.actions.control({
        ref: running.ref,
        expectedRevision: running.revision,
        command: { type: "delete" },
      }),
    ).rejects.toThrow("active Schedule run");
    await f.actions.control({
      ref: running.ref,
      expectedRevision: running.revision,
      command: { type: "pause" },
    });
    held.release();
    await held.finished;
    expect((await f.registry.entry(first.ref.id))?.schedule.status).toBe("paused");
    expect(f.runner).toHaveBeenCalledTimes(1);
    expect(f.settlementError).not.toHaveBeenCalled();
  } finally {
    held.release();
    await f.cleanup();
  }
});
test("repair resume requires inspection, validates the target and records the actual prior run", async () => {
  const f = await scheduleApiFixture();
  try {
    const first = await f.create();
    await f.registry.update(first.ref.id, (row) => ({
      ...row,
      status: "paused",
      nextRunAt: null,
      otto: { ...row.otto!, repairReason: "Uncertain previous write" },
    }));
    const entry = await f.registry.entry(first.ref.id);
    if (!entry) throw new Error("Missing repair Schedule");
    await expect(
      f.actions.control({
        ref: entry.ref,
        expectedRevision: entry.revision,
        command: { type: "resume" },
      }),
    ).rejects.toThrow("explicitly acknowledge");
    f.validate.mockRejectedValueOnce(new ScheduleError("conflict", "Review changed target"));
    await expect(
      f.actions.control({
        ref: entry.ref,
        expectedRevision: entry.revision,
        command: { type: "resume", userConfirmedInspection: true },
      }),
    ).rejects.toThrow("Review changed target");
    expect((await f.registry.entry(first.ref.id))?.schedule.otto?.repairReason).toBe(
      "Uncertain previous write",
    );
    const resumed = await f.actions.control({
      ref: entry.ref,
      expectedRevision: entry.revision,
      command: { type: "resume", userConfirmedInspection: true },
    });
    expect(resumed.entry?.schedule.status).toBe("active");
    expect(resumed.entry?.schedule.otto?.lastRepairReview).toMatchObject({
      runId: null,
      reason: "Uncertain previous write",
    });
  } finally {
    await f.cleanup();
  }
});
test("wrong host, archived project, stopped owner and inexact cancellation cannot start work", async () => {
  const f = await scheduleApiFixture();
  try {
    await expect(f.create({ scope: { ...f.scope, hostId: "other-host" } })).rejects.toThrow(
      "owning host",
    );
    const first = await f.create();
    await expect(
      f.actions.control({
        ref: first.ref,
        expectedRevision: first.revision,
        command: { type: "cancel", runId: "not-running" },
      }),
    ).rejects.toThrow("exact running");
    expect(f.cancel).not.toHaveBeenCalled();
    f.put(f.scope.projectId, f.repo, { archivedAt: "now" });
    await expect(f.create({ operationId: "archived" })).rejects.toThrow(
      "Restore the owning project",
    );
    await f.actions.close();
    await expect(f.create()).rejects.toThrow("stopping");
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
