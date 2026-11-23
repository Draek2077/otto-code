import { beforeEach, afterEach, describe, test, expect } from "vitest";
import path from "node:path";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { workflowFixture } from "./test-utils/fixture.js";
import { workflowExclusive } from "./files.js";
import { inspectWorkflowLock, recoverWorkflowLock } from "./locks.js";
describe("explicit Workflow lock retirement", () => {
  let f: Awaited<ReturnType<typeof workflowFixture>>;
  beforeEach(async () => {
    f = await workflowFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("a current cooperating writer cannot be recovered even with an exact revision", async () => {
    const file = path.join(f.home, "record");
    await workflowExclusive(file, async () => {
      const lock = await inspectWorkflowLock(file);
      expect(lock?.canRecover).toBe(false);
      await expect(recoverWorkflowLock(file, lock!.revision)).rejects.toThrow("current writer");
    });
    expect(await inspectWorkflowLock(file)).toBeNull();
  });
  test("an explicitly verified empty retained lock is renamed, never recursively deleted", async () => {
    const file = path.join(f.home, "record");
    await mkdir(`${file}.otto-lock`);
    const lock = await inspectWorkflowLock(file);
    expect(lock?.canRecover).toBe(true);
    await expect(recoverWorkflowLock(file, "stale")).rejects.toThrow("changed");
    await recoverWorkflowLock(file, lock!.revision);
    expect(await inspectWorkflowLock(file)).toBeNull();
    expect((await readdir(f.home)).some((n) => n.startsWith(".recovery-workflow-lock-"))).toBe(
      true,
    );
  });
  test("non-empty or changed locks remain intact", async () => {
    const file = path.join(f.home, "record");
    await mkdir(`${file}.otto-lock`);
    const lock = await inspectWorkflowLock(file);
    await writeFile(path.join(`${file}.otto-lock`, "unknown"), "Keep");
    await expect(recoverWorkflowLock(file, lock!.revision)).rejects.toThrow("changed");
    expect(await readdir(`${file}.otto-lock`)).toEqual(["unknown"]);
  });
});
