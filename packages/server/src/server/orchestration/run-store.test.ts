import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Run } from "@otto-code/protocol/orchestration";

import { RunStore } from "./run-store.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_a",
    title: "A run",
    status: "running",
    phases: [{ id: "p1", type: "research", title: "R", task: "survey", status: "pending" }],
    createdAt: "2023-11-14T00:00:00.000Z",
    updatedAt: "2023-11-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("RunStore", () => {
  let dir: string;
  let store: RunStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "otto-runs-"));
    store = new RunStore(join(dir, "runs"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("save then get round-trips a run", async () => {
    await store.save(makeRun());
    const loaded = await store.get("run_a");
    expect(loaded?.title).toBe("A run");
    expect(loaded?.phases[0]?.id).toBe("p1");
  });

  test("get returns null for a missing run", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  test("save overwrites in place (latest projection wins)", async () => {
    await store.save(makeRun({ status: "running" }));
    await store.save(makeRun({ status: "done" }));
    expect((await store.get("run_a"))?.status).toBe("done");
    expect(await store.list()).toHaveLength(1);
  });

  test("list returns runs sorted by createdAt", async () => {
    await store.save(makeRun({ id: "run_late", createdAt: "2023-11-14T02:00:00.000Z" }));
    await store.save(makeRun({ id: "run_early", createdAt: "2023-11-14T01:00:00.000Z" }));
    expect((await store.list()).map((r) => r.id)).toEqual(["run_early", "run_late"]);
  });

  test("delete removes a run", async () => {
    await store.save(makeRun());
    await store.delete("run_a");
    expect(await store.get("run_a")).toBeNull();
  });

  test("concurrent saves of the same run serialize without corruption", async () => {
    await Promise.all([
      store.save(makeRun({ status: "pending" })),
      store.save(makeRun({ status: "running" })),
      store.save(makeRun({ status: "done" })),
    ]);
    const loaded = await store.get("run_a");
    expect(["pending", "running", "done"]).toContain(loaded?.status);
  });
});
