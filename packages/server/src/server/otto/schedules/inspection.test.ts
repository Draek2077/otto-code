import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { previewScheduleCadence, readCreatedSchedule } from "@getpaseo/plugin/otto/schedules";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";

test("creation inspection is read-only, origin-bound and never admits an execution", async () => {
  const f = await scheduleApiFixture();
  try {
    const input = { scope: f.scope, operationId: "inspection" };
    expect(await f.api.invoke(readCreatedSchedule.name, input)).toEqual({ ok: true, value: null });
    const created = await f.create({ operationId: input.operationId });
    expect(await f.api.invoke(readCreatedSchedule.name, input)).toEqual({
      ok: true,
      value: created,
    });
    expect((await f.registry.catalog()).length).toBe(1);
    expect(f.runner).not.toHaveBeenCalled();
    expect(f.validate).toHaveBeenCalledTimes(1);
    expect(
      await f.api.invoke(readCreatedSchedule.name, {
        ...input,
        scope: { ...f.scope, hostId: "other" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
    const origin = await f.registry.transferOrigin(created.ref);
    await writeFile(
      path.join(origin.directory, `${created.ref.id}.json`),
      "corrupt retained source",
    );
    expect(await f.api.invoke(readCreatedSchedule.name, input)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

test("cadence preview uses the real clock rules, timezone and exact supplied instant without writes", async () => {
  const f = await scheduleApiFixture();
  try {
    const input = {
      scope: f.scope,
      cadence: { type: "cron", expression: "30 9 * * *", timezone: "America/New_York" },
      from: "2026-11-08T12:00:00.000Z",
    };
    expect(await f.api.invoke(previewScheduleCadence.name, input)).toEqual({
      ok: true,
      value: {
        from: input.from,
        next: ["2026-11-08T14:30:00.000Z", "2026-11-09T14:30:00.000Z", "2026-11-10T14:30:00.000Z"],
        timezone: "America/New_York",
      },
    });
    expect(
      await f.api.invoke(previewScheduleCadence.name, {
        ...input,
        cadence: { ...input.cadence, timezone: "not/a-zone" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(
      await f.api.invoke(previewScheduleCadence.name, {
        ...input,
        cadence: { type: "every", everyMs: 60000 },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        next: ["2026-11-08T12:01:00.000Z", "2026-11-08T12:02:00.000Z", "2026-11-08T12:03:00.000Z"],
      },
    });
    expect(await f.registry.catalog()).toEqual([]);
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
