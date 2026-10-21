import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { ScheduleStore } from "../schedule/store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(path.join(scratch, "schedule-continuity-"));
  roots.push(dir);
  const store = new ScheduleStore(dir, pino({ level: "silent" }));
  const schedule = await store.create({
    name: "existing Otto schedule",
    prompt: "Review",
    cadence: { type: "every", everyMs: 60000 },
    target: { type: "new-agent", config: { provider: "claude", cwd: dir } },
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nextRunAt: "2026-01-01T00:01:00Z",
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [],
  });
  return { store, schedule, file: path.join(dir, `${schedule.id}.json`) };
}
it("preserves Otto schedule and run metadata on a supported schedule rewrite", async () => {
  const { store, schedule, file } = await fixture();
  const historicalRun = {
    id: "run-1",
    scheduledFor: "2026-01-01",
    startedAt: "2026-01-01",
    endedAt: "2026-01-01",
    status: "succeeded",
    agentId: null,
    output: null,
    error: null,
    personalityName: "Reviewer",
    provider: "claude",
    model: "model-1",
    target: { type: "workflow", definitionId: "saved-graph", projectRoot: "project" },
  };
  await writeFile(
    file,
    JSON.stringify({
      ...schedule,
      lastRunPersonalityName: "Reviewer",
      lastRunModel: "model-1",
      runs: [historicalRun],
    }),
  );
  await store.update(schedule.id, (value) => ({ ...value, status: "paused" }));
  const saved = JSON.parse(await readFile(file, "utf8"));
  expect(saved.status).toBe("paused");
  expect(saved.lastRunPersonalityName).toBe("Reviewer");
  expect(saved.lastRunModel).toBe("model-1");
  expect(saved.runs).toEqual([historicalRun]);
  await store.update(schedule.id, (value) => ({ ...value, runs: [] }));
  expect(JSON.parse(await readFile(file, "utf8")).runs).toEqual([]);
});
it.each([
  ["agentProfile", "saved-profile"],
  ["personality", "saved-profile"],
  ["approvalPolicy", "never"],
  ["sandboxMode", "read-only"],
  ["networkAccess", false],
  ["webSearch", false],
  ["extra", { codex: { sandboxMode: "read-only" } }],
] as const)(
  "keeps a schedule using dormant %s settings intact and out of execution",
  async (field, setting) => {
    const { store, schedule, file } = await fixture();
    const config = {
      ...(schedule.target.type === "new-agent" ? schedule.target.config : {}),
      [field]: setting,
    };
    const raw = JSON.stringify({ ...schedule, target: { type: "new-agent", config } });
    await writeFile(file, raw);
    expect(await store.list()).toEqual([]);
    await expect(store.get(schedule.id)).rejects.toThrow("awaiting restoration");
    expect(await readFile(file, "utf8")).toBe(raw);
  },
);
it("leaves dormant workflow schedules byte-identical", async () => {
  const { store, schedule, file } = await fixture();
  const raw = JSON.stringify({
    ...schedule,
    target: { type: "workflow", definitionId: "saved-graph", projectRoot: "project" },
  });
  await writeFile(file, raw);
  expect(await store.list()).toEqual([]);
  await expect(store.get(schedule.id)).rejects.toThrow("awaiting restoration");
  expect(await readFile(file, "utf8")).toBe(raw);
});
