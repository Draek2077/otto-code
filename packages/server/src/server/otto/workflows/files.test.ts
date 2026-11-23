import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  lstat,
  link,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assertWorkflowId,
  publishWorkflowFile,
  readWorkflowFile,
  retireWorkflowFile,
  workflowDigest,
  workflowDirectory,
  withWorkflowCleanup,
} from "./files.js";

describe("Workflow file ownership", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "otto-workflow-files-"));
  });
  afterEach(async () => {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("otto-workflow-files-")
    )
      throw new Error("Refusing unrelated fixture cleanup");
    await rm(root, { recursive: true, force: true });
  });
  test("read discovery creates no directory", async () => {
    const directory = path.join(root, ".otto", "workflows");
    expect(await workflowDirectory(root, directory)).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });
  test("creates only descendants of a trusted root", async () => {
    expect(await workflowDirectory(root, path.join(root, ".otto", "workflows"), true)).toBe(true);
    await expect(workflowDirectory(root, path.dirname(root), true)).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  test("refuses a linked storage directory", async () => {
    const target = path.join(root, "target");
    await mkdir(target);
    const alias = path.join(root, "alias");
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(workflowDirectory(root, alias)).rejects.toMatchObject({ kind: "invalid" });
  });
  test.each(["../escape", "a/b", "CON", "nul", "COM1", "CON.txt", ".", "..", ""])(
    "rejects unsafe record identity %s",
    (id) => {
      expect(() => assertWorkflowId(id)).toThrow();
    },
  );
  test("legacy dotted names remain file segments and round-trip without losing their identity", async () => {
    assertWorkflowId("review.v1");
    const file = path.join(root, "review.v1.json");
    await publishWorkflowFile(file, "original", null);
    expect(await readWorkflowFile(file)).toBe("original");
  });
  test("exclusive creation and revisioned replacement preserve complete UTF-8 bytes", async () => {
    const file = path.join(root, "run.json");
    const first = '{"title":"Café"}\r\n';
    const revision = await publishWorkflowFile(file, first, null);
    expect(await readWorkflowFile(file)).toBe(first);
    expect((await lstat(file)).nlink).toBe(1);
    const second = '{"title":"Updated","unknown":7}\n';
    expect(await publishWorkflowFile(file, second, revision)).toBe(workflowDigest(second));
    expect(await readFile(file, "utf8")).toBe(second);
    expect(await readdir(root)).toEqual(["run.json"]);
  });
  test("competing creates admit exactly one writer", async () => {
    const file = path.join(root, "same.json");
    const results = await Promise.allSettled([
      publishWorkflowFile(file, "first", null),
      publishWorkflowFile(file, "second", null),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["first", "second"]).toContain(await readWorkflowFile(file));
    expect(await readdir(root)).toEqual(["same.json"]);
  });
  test("stale writes preserve a peer's bytes and leave no stage/lock", async () => {
    const file = path.join(root, "record.json");
    const revision = await publishWorkflowFile(file, "before", null);
    await writeFile(file, "peer edit");
    await expect(publishWorkflowFile(file, "mine", revision)).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(await readFile(file, "utf8")).toBe("peer edit");
    expect(await readdir(root)).toEqual(["record.json"]);
  });
  test("never takes over a retained writer lock", async () => {
    const file = path.join(root, "busy.json");
    await mkdir(`${file}.otto-lock`);
    await expect(publishWorkflowFile(file, "new", null)).rejects.toMatchObject({ kind: "busy" });
    expect((await lstat(`${file}.otto-lock`)).isDirectory()).toBe(true);
    expect(await readWorkflowFile(file)).toBeNull();
  });
  test("bounded reads reject linked and oversized records", async () => {
    const file = path.join(root, "record.json");
    await writeFile(file, "a".repeat(100));
    await expect(readWorkflowFile(file, 16)).rejects.toMatchObject({ kind: "invalid" });
    await link(file, path.join(root, "other.json"));
    await expect(readWorkflowFile(file)).rejects.toMatchObject({ kind: "invalid" });
  });
  test("explicit retirement retains exact recovery bytes", async () => {
    const file = path.join(root, "record.json");
    const revision = await publishWorkflowFile(file, "original", null);
    const recovery = await retireWorkflowFile(file, revision);
    expect(path.dirname(recovery)).toBe(path.join(root, ".otto-recovery"));
    expect(await readWorkflowFile(file)).toBeNull();
    expect(await readFile(recovery, "utf8")).toBe("original");
  });
  test("failed retirement preserves changed source", async () => {
    const file = path.join(root, "record.json");
    await writeFile(file, "peer");
    await expect(retireWorkflowFile(file, workflowDigest("old"))).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(await readFile(file, "utf8")).toBe("peer");
  });
  test("cleanup preserves both failures and runs exactly once", async () => {
    const primary = new Error("operation");
    const secondary = new Error("cleanup");
    const release = vi.fn(async () => {
      throw secondary;
    });
    await expect(
      withWorkflowCleanup(async () => {
        throw primary;
      }, release),
    ).rejects.toMatchObject({ errors: [primary, secondary], cause: primary });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
