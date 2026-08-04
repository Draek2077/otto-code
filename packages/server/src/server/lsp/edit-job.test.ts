import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EditJobStore, isInsideWorkspace, type PlannedFile } from "./edit-job.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-edit-job-"));
  tempRoots.push(dir);
  return dir;
}

const SOURCE = "const target = 1;\nconst other = target + 1;\nconst last = 3;\n";

/** Both `target` occurrences, as a rename to `renamed` would plan them. */
function planFor(filePath: string): PlannedFile[] {
  return [
    {
      path: filePath,
      edits: [
        { line: 1, column: 7, endLine: 1, endColumn: 13, oldText: "target", newText: "renamed" },
        { line: 2, column: 15, endLine: 2, endColumn: 21, oldText: "target", newText: "renamed" },
      ],
    },
  ];
}

describe("running an edit job", () => {
  it("applies the plan it was given, not one re-derived at run time", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();

    const plan = store.putPlan(planFor(filePath), "rename:renamed");
    const outcome = await store.run(plan);

    expect(outcome.complete).toBe(true);
    expect(outcome.appliedEdits).toBe(2);
    expect(await readFile(filePath, "utf8")).toBe(
      "const renamed = 1;\nconst other = renamed + 1;\nconst last = 3;\n",
    );
  });

  // Edits are applied end-first so an earlier replacement of a different length cannot shift
  // the offsets of one not yet applied.
  it("keeps later edits correct when an earlier one changes the text length", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();

    const plan = store.putPlan(planFor(filePath), "rename:aVeryMuchLongerName");
    plan.files[0].edits.forEach((edit) => {
      edit.newText = "aVeryMuchLongerName";
    });
    const outcome = await store.run(plan);

    expect(outcome.complete).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(
      "const aVeryMuchLongerName = 1;\nconst other = aVeryMuchLongerName + 1;\nconst last = 3;\n",
    );
  });

  // The case the old "recompute and refuse" design failed: an agent writes to the file while
  // the user is auditing. One edit's ground truth moved; the other is still exactly right.
  it("applies the edits that still fit and reports the ones that do not", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();
    const plan = store.putPlan(planFor(filePath), "rename:renamed");

    // Something else edits line 2 out from under the plan.
    await writeFile(filePath, "const target = 1;\nconst other = MOVED + 1;\nconst last = 3;\n");

    const outcome = await store.run(plan);

    expect(outcome.complete).toBe(false);
    expect(outcome.appliedEdits).toBe(1);
    expect(outcome.skippedEdits).toBe(1);
    expect(outcome.files[0].kind).toBe("partial");
    expect(outcome.files[0].reason).toContain("no longer matched");
    // The edit that still fit landed; the one that did not left the changed text alone.
    expect(await readFile(filePath, "utf8")).toBe(
      "const renamed = 1;\nconst other = MOVED + 1;\nconst last = 3;\n",
    );
  });

  it("reports a file whose every edit moved as failed, and leaves it untouched", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();
    const plan = store.putPlan(planFor(filePath), "rename:renamed");

    const rewritten = "something entirely different\n";
    await writeFile(filePath, rewritten, "utf8");
    const outcome = await store.run(plan);

    expect(outcome.files[0].kind).toBe("failed");
    expect(outcome.appliedEdits).toBe(0);
    expect(await readFile(filePath, "utf8")).toBe(rewritten);
  });

  it("costs a missing file only its own edits", async () => {
    const root = await createRoot();
    const present = path.join(root, "a.ts");
    const absent = path.join(root, "gone.ts");
    await writeFile(present, SOURCE, "utf8");
    const store = new EditJobStore();

    const plan = store.putPlan([...planFor(present), ...planFor(absent)], "rename:renamed");
    const outcome = await store.run(plan);

    expect(outcome.appliedEdits).toBe(2);
    expect(outcome.files.find((file) => file.path === absent)?.kind).toBe("failed");
    expect(outcome.files.find((file) => file.path === present)?.kind).toBe("applied");
  });
});

describe("undoing an edit job", () => {
  it("puts every file back the way it was", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();

    const outcome = await store.run(store.putPlan(planFor(filePath), "rename:renamed"));
    const undone = await store.undo(outcome.runId);

    expect(undone?.complete).toBe(true);
    expect(undone?.restoredFiles).toBe(1);
    expect(await readFile(filePath, "utf8")).toBe(SOURCE);
  });

  // The property that makes undo safe rather than merely available: a blind restore would
  // silently destroy whatever was saved after the run.
  it("refuses to restore a file that was edited after the run", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    await writeFile(filePath, SOURCE, "utf8");
    const store = new EditJobStore();
    const outcome = await store.run(store.putPlan(planFor(filePath), "rename:renamed"));

    const laterWork = "const renamed = 1;\nconst other = renamed + 1;\nconst added = 4;\n";
    await writeFile(filePath, laterWork, "utf8");

    const undone = await store.undo(outcome.runId);

    expect(undone?.complete).toBe(false);
    expect(undone?.files[0].kind).toBe("changedSince");
    expect(await readFile(filePath, "utf8")).toBe(laterWork);
  });

  it("undoes only the files the run actually wrote", async () => {
    const root = await createRoot();
    const present = path.join(root, "a.ts");
    const absent = path.join(root, "gone.ts");
    await writeFile(present, SOURCE, "utf8");
    const store = new EditJobStore();

    const outcome = await store.run(
      store.putPlan([...planFor(present), ...planFor(absent)], "rename:renamed"),
    );
    const undone = await store.undo(outcome.runId);

    // The file that never got written is not in the journal, so undo has nothing to say
    // about it - reporting it as a failed undo would invent a problem.
    expect(undone?.files).toHaveLength(1);
    expect(undone?.complete).toBe(true);
  });

  it("returns null for a run it does not know", async () => {
    expect(await new EditJobStore().undo("never-happened")).toBeNull();
  });
});

describe("the plan store", () => {
  it("gives identical plans the same id, so re-planning is idempotent", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    const store = new EditJobStore();

    expect(store.putPlan(planFor(filePath), "rename:renamed").planId).toBe(
      store.putPlan(planFor(filePath), "rename:renamed").planId,
    );
  });

  it("gives a different new name a different id", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "a.ts");
    const store = new EditJobStore();

    expect(store.putPlan(planFor(filePath), "rename:one").planId).not.toBe(
      store.putPlan(planFor(filePath), "rename:two").planId,
    );
  });

  // Plans hold whole file contents, so an unbounded map is a leak nobody notices.
  it("evicts the oldest plans rather than growing without limit", async () => {
    const root = await createRoot();
    const store = new EditJobStore({ maxEntries: 2 });

    const first = store.putPlan(planFor(path.join(root, "a.ts")), "rename:a");
    store.putPlan(planFor(path.join(root, "b.ts")), "rename:b");
    store.putPlan(planFor(path.join(root, "c.ts")), "rename:c");

    expect(store.getPlan(first.planId)).toBeNull();
  });
});

describe("workspace containment", () => {
  it("accepts a path inside the root and rejects one that escapes", () => {
    expect(isInsideWorkspace("/repo", "/repo/src/a.ts")).toBe(true);
    expect(isInsideWorkspace("/repo", "/repo/../secrets")).toBe(false);
    expect(isInsideWorkspace("/repo", "/elsewhere/a.ts")).toBe(false);
  });

  // A string-prefix test would call this inside the root. It is not.
  it("does not mistake a sibling with a shared prefix for a child", () => {
    expect(isInsideWorkspace("/repo", "/repo-evil/a.ts")).toBe(false);
  });

  it("rejects the root itself, which is a directory and not an edit target", () => {
    expect(isInsideWorkspace("/repo", "/repo")).toBe(false);
  });
});
