import path from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { readScheduleRun } from "@getpaseo/plugin/otto/schedules";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";
import { ScheduleHistoryObjects } from "./history-objects.js";

test("a peer primary edit during archiving wins byte CAS and unreachable history never becomes a current result", async () => {
  const f = await scheduleApiFixture();
  const saved = await f.create();
  const origin = await f.registry.transferOrigin(saved.ref);
  const primary = path.join(origin.directory, `${saved.ref.id}.json`);
  const peer = JSON.stringify({
    ...saved.schedule,
    name: "Peer",
    future: { preserved: true },
    runs: [],
  });
  const publishLookup = ScheduleHistoryObjects.prototype.putLookup;
  const interruption = vi
    .spyOn(ScheduleHistoryObjects.prototype, "putLookup")
    .mockImplementationOnce(async function (this: ScheduleHistoryObjects, runId, bytes) {
      await publishLookup.call(this, runId, bytes);
      await writeFile(primary, peer);
    });
  try {
    await expect(
      f.registry.update(saved.ref.id, (row) => ({
        ...row,
        runs: Array.from({ length: 51 }, (_, number) => ({
          id: `run-${number}`,
          scheduledFor: "before",
          startedAt: "before",
          endedAt: "before",
          status: "succeeded",
          agentId: null,
          output: "Retained result",
          error: null,
        })),
      })),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(await readFile(primary, "utf8")).toBe(peer);
    const history = new ScheduleHistoryObjects(origin, saved.ref.id);
    expect((await readdir(path.join(history.directory, "objects"))).length).toBeGreaterThan(0);
    expect(await history.readLookup("run-0")).not.toBeNull();
    expect(
      await f.api.invoke(readScheduleRun.name, { ref: saved.ref, runId: "run-0" }),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await readFile(primary, "utf8")).toBe(peer);
  } finally {
    interruption.mockRestore();
    await f.cleanup();
  }
});
