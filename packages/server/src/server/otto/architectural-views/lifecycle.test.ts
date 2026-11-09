import { expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ViewWrites } from "./writes.js";
import { knowledgeObservationPlan } from "../project-knowledge/observation.js";
import type { ViewStore } from "./records.js";
const fixtures = fileURLToPath(
  new URL("../../../../../../.tmp/archify-restoration/lifecycle-fixtures/", import.meta.url),
);
async function fixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, "owner-"));
  const store: ViewStore = {
    projectId: "project",
    projectRoot: root,
    boundary: root,
    base: path.join(root, ".otto"),
    location: "repository",
    origin: { location: "repository", storeKey: "a".repeat(64) },
  };
  return {
    root,
    store,
    close: async () => {
      const relative = path.relative(fixtures, root);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Fixture escaped");
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("shutdown drains admitted filesystem work and rejects queued/late writes", async () => {
  const f = await fixture(),
    writes = new ViewWrites();
  let finish!: () => void;
  let admitted!: () => void;
  let calls = 0;
  const entered = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const first = writes.run(f.store, async () => {
      calls++;
      admitted();
      await held;
      return "saved";
    });
    await entered;
    const queued = writes.run(f.store, async () => {
      calls++;
    });
    const rejected = expect(queued).rejects.toThrow("shutting down");
    const closing = writes.close();
    expect(() => writes.run(f.store, async () => {})).toThrow("shutting down");
    finish();
    expect(await first).toBe("saved");
    await rejected;
    await closing;
    expect(calls).toBe(1);
  } finally {
    finish?.();
    await writes.close();
    await f.close();
  }
});
test("View observation retains only Knowledge and View subtrees under the canonical boundary", async () => {
  const f = await fixture();
  try {
    await mkdir(f.store.base, { recursive: true });
    await mkdir(path.join(f.store.base, "unrelated"));
    await mkdir(path.join(f.store.base, "architectural-views"));
    const plan = await knowledgeObservationPlan(f.store, [
      "knowledge",
      "KNOWLEDGE.md",
      "architectural-views",
    ]);
    expect(plan.root).toBe(f.store.base);
    expect(plan.ignore).toEqual([path.join(f.store.base, "unrelated")]);
  } finally {
    await f.close();
  }
});
