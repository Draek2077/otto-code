import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import type { ScheduleHistoryState } from "@getpaseo/plugin/otto/schedules";
import { ScheduleHistoryObjects } from "./history-objects.js";
import { ScheduleHistoryIndex } from "./history-index.js";
import { scheduleRunSummary } from "./projection.js";
import { scheduleDigest } from "./files.js";
const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected history fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "schedule-history-index-"));
  roots.push(root);
  const objects = new ScheduleHistoryObjects(
    {
      scope: { hostId: "host", projectId: "project" },
      location: "host",
      storeKey: "fixture",
      boundary: root,
      directory: path.join(root, "schedules"),
      project: null,
    },
    "schedule",
  );
  return { objects, index: new ScheduleHistoryIndex(objects) };
}
function entry(number: number) {
  const runId = `run-${number}`;
  return {
    runId,
    content: scheduleDigest(runId),
    original: scheduleDigest(`original-${runId}`),
    summary: scheduleRunSummary({
      id: runId,
      scheduledFor: "before",
      startedAt: "before",
      endedAt: "before",
      status: "succeeded",
      agentId: null,
      output: `Result ${number}`,
      error: null,
    }),
  };
}
test("appending across a leaf boundary preserves prior immutable roots and supports indexed history reads", async () => {
  const f = await fixture();
  let state: ScheduleHistoryState | null = null;
  for (let number = 0; number < 32; number++) state = await f.index.append(state, entry(number));
  if (!state) throw new Error("Missing history root");
  const bytes = await f.objects.read(state.root);
  const grown = await f.index.append(state, entry(32));
  expect(grown).toMatchObject({ count: 33, height: 1 });
  expect(await f.index.at(grown, 0)).toEqual(entry(0));
  expect(await f.index.at(grown, 31)).toEqual(entry(31));
  expect(await f.index.at(grown, 32)).toEqual(entry(32));
  expect(await f.objects.read(state.root)).toBe(bytes);
  expect(await f.index.at(state, 31)).toEqual(entry(31));
  await expect(f.index.at(state, 32)).rejects.toMatchObject({ kind: "invalid" });
});
