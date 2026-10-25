import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { inspectKnowledgeLock, recoverKnowledgeLock } from "./lock-recovery.js";
import { withKnowledgeWrite } from "./knowledge-files.js";
import type { KnowledgeStore } from "./store-resolver.js";

const scratch = fileURLToPath(
  new URL("../../../../../../.tmp/knowledge-lock-recovery/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(scratch, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, "case-"));
  roots.push(root);
  const store: KnowledgeStore = {
    projectId: "fixture",
    projectRoot: root,
    location: "repository",
    boundary: root,
    base: path.join(root, ".otto"),
  };
  const directory = path.join(store.base, "knowledge");
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, ".write-lock");
  return { root, store, directory, lock };
}
it("reads an unlocked store without creating a lock or recovery evidence", async () => {
  const f = await fixture();
  expect(await inspectKnowledgeLock(f.store)).toMatchObject({ state: "unlocked" });
  expect(await readdir(f.directory)).toEqual([]);
});
it("requires explicit verification and a reason, retains the empty lock evidence and permits a later separate write", async () => {
  const f = await fixture();
  await mkdir(f.lock);
  const record = path.join(f.directory, "background.md");
  await writeFile(record, "Retain all original bytes.\n");
  const plan = await inspectKnowledgeLock(f.store);
  expect(plan.state).toBe("unverified");
  const input = {
    store: f.store,
    expectedRevision: plan.revision,
    reason: "Human verified all other writers stopped",
    userVerifiedNoActiveWriter: false,
  };
  await expect(recoverKnowledgeLock(input)).rejects.toThrow("explicit verification");
  await expect(
    recoverKnowledgeLock({ ...input, userVerifiedNoActiveWriter: true, reason: " " }),
  ).rejects.toThrow("reason");
  expect(await readdir(f.lock)).toEqual([]);
  const recovered = await recoverKnowledgeLock({ ...input, userVerifiedNoActiveWriter: true });
  expect(recovered.recoveryName).toMatch(/^\.recovered-write-lock-[a-f0-9-]+$/);
  const evidence = JSON.parse(
    await readFile(path.join(f.directory, recovered.recoveryName, ".recovery-claim.json"), "utf8"),
  );
  expect(evidence).toMatchObject({
    humanVerifiedNoActiveWriter: true,
    inspectedRevision: plan.revision,
    reason: input.reason,
  });
  expect(await readFile(record, "utf8")).toBe("Retain all original bytes.\n");
  expect(await inspectKnowledgeLock(f.store)).toMatchObject({ state: "unlocked" });
  await withKnowledgeWrite(f.store, () => writeFile(record, "A separately requested write.\n"));
  expect(await readFile(record, "utf8")).toBe("A separately requested write.\n");
  await expect(
    recoverKnowledgeLock({ ...input, userVerifiedNoActiveWriter: true }),
  ).rejects.toThrow("changed");
});
it("refuses a replaced lock and retains every unknown entry and previous recovery claim", async () => {
  const f = await fixture();
  await mkdir(f.lock);
  const before = await inspectKnowledgeLock(f.store);
  await rename(f.lock, path.join(f.directory, ".prior-lock"));
  await mkdir(f.lock);
  const input = {
    store: f.store,
    expectedRevision: before.revision,
    reason: "Verified",
    userVerifiedNoActiveWriter: true,
  };
  await expect(recoverKnowledgeLock(input)).rejects.toThrow("changed");
  for (const name of ["unknown.txt", ".recovery-claim.json"]) {
    await writeFile(path.join(f.lock, name), "Retain unknown content");
    const next = await inspectKnowledgeLock(f.store);
    expect(next.state).toBe("unsupported");
    await expect(
      recoverKnowledgeLock({ ...input, expectedRevision: next.revision }),
    ).rejects.toThrow("cannot be recovered");
    expect(await readFile(path.join(f.lock, name), "utf8")).toBe("Retain unknown content");
  }
  expect(await readdir(f.directory)).toEqual([".prior-lock", ".write-lock"]);
});
it("refuses an admitted local writer even when a caller claims it has stopped", async () => {
  const f = await fixture();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const operation = withKnowledgeWrite(f.store, async () => {
    entered();
    await gate;
  });
  await ready;
  try {
    const plan = await inspectKnowledgeLock(f.store);
    expect(plan.state).toBe("busy");
    await expect(
      recoverKnowledgeLock({
        store: f.store,
        expectedRevision: plan.revision,
        reason: "Caller assertion cannot override a known writer",
        userVerifiedNoActiveWriter: true,
      }),
    ).rejects.toThrow("cannot be recovered");
    expect(await readdir(f.lock)).toEqual([]);
  } finally {
    release();
    await operation;
  }
  expect(await inspectKnowledgeLock(f.store)).toMatchObject({ state: "unlocked" });
});
it("refuses non-directory locks and store paths outside the canonical boundary", async () => {
  const f = await fixture();
  await writeFile(f.lock, "Not a lock directory");
  expect(await inspectKnowledgeLock(f.store)).toMatchObject({ state: "unsupported" });
  await expect(
    inspectKnowledgeLock({ ...f.store, boundary: path.join(f.root, "other") }),
  ).rejects.toThrow("escapes");
  expect(await readFile(f.lock, "utf8")).toBe("Not a lock directory");
});
