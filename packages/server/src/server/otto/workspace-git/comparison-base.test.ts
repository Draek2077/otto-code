import { afterEach, beforeEach, expect, test, vi } from "vitest";
import pino from "pino";
import { WorkspaceGitServiceImpl } from "../../workspace-git-service.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { runGitCommand } from "../../../utils/run-git-command.js";
import {
  getCheckoutDiff,
  getCheckoutSnapshotFacts,
  listCheckoutCommits,
} from "../../../utils/checkout-git.js";
import {
  getPaseoWorktreeMetadataPath,
  writePaseoWorktreeMetadata,
} from "../../../utils/worktree-metadata.js";
import { setComparisonBase, setComparisonBaseAndRefresh } from "./comparison-base.js";
import { readComparisonBase } from "./comparison-base-store.js";

const scratch = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
let cwd: string;
const git = async (...args: string[]) => (await runGitCommand(args, { cwd })).stdout.trim();
beforeEach(async () => {
  await mkdir(scratch, { recursive: true });
  cwd = await mkdtemp(join(scratch, "comparison-base-"));
  await git("init", "-qb", "main");
  await git("config", "user.name", "Draekz");
  await git("config", "user.email", "draekz@gmail.com");
  await git("config", "commit.gpgsign", "false");
  await git("commit", "--allow-empty", "-qm", "initial");
  await git("checkout", "-qb", "parent");
  await writeFile(join(cwd, "parent.txt"), "parent\n");
  await git("add", ".");
  await git("commit", "-qm", "parent work");
  await git("checkout", "-qb", "child");
  await writeFile(join(cwd, "child.txt"), "child\n");
  await git("add", ".");
  await git("commit", "-qm", "child work");
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

test("a stacked branch uses its selected parent for snapshots, diffs and commits without checking out", async () => {
  const before = await getCheckoutDiff(cwd, { mode: "base", includeStructured: true });
  expect(before.structured?.map((file) => file.path).sort()).toEqual(["child.txt", "parent.txt"]);
  const head = await git("rev-parse", "HEAD");
  await setComparisonBase(cwd, { branchName: "child", baseRef: "refs/heads/parent" });
  expect(await getCheckoutSnapshotFacts(cwd)).toMatchObject({
    storedBaseRef: "refs/heads/parent",
    comparisonBaseRef: "refs/heads/parent",
  });
  const after = await getCheckoutDiff(cwd, { mode: "base", includeStructured: true });
  expect(after.structured?.map((file) => file.path)).toEqual(["child.txt"]);
  expect(
    (await listCheckoutCommits({ cwd })).commits
      .filter((commit) => !commit.isOnBase)
      .map((commit) => commit.subject),
  ).toEqual(["child work"]);
  expect(await git("rev-parse", "HEAD")).toBe(head);
  expect(await git("status", "--porcelain")).toBe("");
});
test("choices survive reads and are scoped to the current branch", async () => {
  await setComparisonBase(cwd, { branchName: "child", baseRef: "refs/heads/parent" });
  expect(readComparisonBase(cwd, "child")).toBe("refs/heads/parent");
  await git("checkout", "-qb", "sibling", "main");
  expect(await getCheckoutSnapshotFacts(cwd)).toMatchObject({
    storedBaseRef: null,
    resolvedBaseRef: "main",
  });
  await git("checkout", "child");
  expect(await getCheckoutSnapshotFacts(cwd)).toMatchObject({
    resolvedBaseRef: "refs/heads/parent",
  });
  await setComparisonBase(cwd, { branchName: "child", baseRef: null });
  expect(readComparisonBase(cwd, "child")).toBe("refs/heads/main");
});
test("a remote choice stays distinct from a more advanced local parent", async () => {
  await git("update-ref", "refs/remotes/origin/parent", "main");
  await setComparisonBase(cwd, { branchName: "child", baseRef: "refs/remotes/origin/parent" });
  expect(
    (await getCheckoutDiff(cwd, { mode: "base", includeStructured: true })).structured
      ?.map((file) => file.path)
      .sort(),
  ).toEqual(["child.txt", "parent.txt"]);
  await setComparisonBase(cwd, { branchName: "child", baseRef: "refs/heads/parent" });
  expect(
    (await getCheckoutDiff(cwd, { mode: "base", includeStructured: true })).structured?.map(
      (file) => file.path,
    ),
  ).toEqual(["child.txt"]);
});
test("a linked worktree can override its creation base without changing metadata or the main checkout", async () => {
  const linked = join(cwd, "linked");
  await git("worktree", "add", "-b", "linked-child", linked, "child");
  writePaseoWorktreeMetadata(linked, { baseRefName: "main" });
  const metadata = await readFile(getPaseoWorktreeMetadataPath(linked), "utf8");
  await setComparisonBase(linked, { branchName: "linked-child", baseRef: "refs/heads/parent" });
  expect(
    (await getCheckoutDiff(linked, { mode: "base", includeStructured: true })).structured?.map(
      (file) => file.path,
    ),
  ).toEqual(["child.txt"]);
  expect(await readFile(getPaseoWorktreeMetadataPath(linked), "utf8")).toBe(metadata);
  expect(readComparisonBase(cwd, "child")).toBeNull();
});
test.each(["refs/heads/child", "refs/heads/missing", "HEAD~1", "refs/heads/parent..main"])(
  "refuses %s without saving a choice",
  async (baseRef) => {
    await expect(setComparisonBase(cwd, { branchName: "child", baseRef })).rejects.toThrow();
    expect(readComparisonBase(cwd, "child")).toBeNull();
  },
);
test("a stale picker cannot save against a different working branch", async () => {
  await git("checkout", "parent");
  await expect(
    setComparisonBase(cwd, { branchName: "child", baseRef: "refs/heads/main" }),
  ).rejects.toThrow("working branch changed");
  expect(readComparisonBase(cwd, "child")).toBeNull();
});
test("rapid parent/default changes publish fresh canonical snapshots without waiting for the refresh throttle", async () => {
  const service = new WorkspaceGitServiceImpl({
    logger: pino({ level: "silent" }),
    paseoHome: join(cwd, "home"),
    ottoFetchPolicy: { enabled: false, intervalSeconds: 180 },
  });
  try {
    await service.getSnapshot(cwd, { force: true, reason: "fixture", includeForge: false });
    await setComparisonBaseAndRefresh(
      cwd,
      { branchName: "child", baseRef: "refs/heads/parent" },
      service,
    );
    expect(service.peekSnapshot(cwd)?.git).toMatchObject({ baseRef: "refs/heads/parent" });
    await setComparisonBaseAndRefresh(cwd, { branchName: "child", baseRef: null }, service);
    expect(service.peekSnapshot(cwd)?.git).toMatchObject({ baseRef: "refs/heads/main" });
  } finally {
    await service.dispose();
  }
});
test("a parent change waits for a new snapshot when a forced read is already in flight", async () => {
  let started!: () => void, release!: () => void;
  const captured = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = false;
  const service = new WorkspaceGitServiceImpl({
    logger: pino({ level: "silent" }),
    paseoHome: join(cwd, "home"),
    ottoFetchPolicy: { enabled: false, intervalSeconds: 180 },
    deps: {
      getCheckoutSnapshotFacts: async (...args) => {
        const facts = await getCheckoutSnapshotFacts(...args);
        if (hold) {
          started();
          await gate;
        }
        return facts;
      },
    },
  });
  try {
    await service.getSnapshot(cwd, { force: true, reason: "fixture", includeForge: false });
    hold = true;
    const reading = service.getSnapshot(cwd, {
      force: true,
      reason: "older-read",
      includeForge: false,
    });
    await captured;
    const saving = setComparisonBaseAndRefresh(
      cwd,
      { branchName: "child", baseRef: "refs/heads/parent" },
      service,
    );
    await vi.waitFor(() => expect(readComparisonBase(cwd, "child")).toBe("refs/heads/parent"));
    release();
    await Promise.all([reading, saving]);
    expect(service.peekSnapshot(cwd)?.git).toMatchObject({ baseRef: "refs/heads/parent" });
  } finally {
    release();
    await service.dispose();
  }
});
