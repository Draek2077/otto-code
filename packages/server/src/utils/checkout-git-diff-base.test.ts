import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  __resetCheckoutShortstatCacheForTests,
  getCheckoutDiff,
  getCheckoutShortstat,
  getCheckoutStatus,
  setCheckoutBaseRef,
} from "./checkout-git.js";
import { createWorktree } from "./worktree.js";
import { readOttoWorktreeMetadata, writeOttoWorktreeRuntimeMetadata } from "./worktree-metadata.js";

const tempDirs: string[] = [];

afterEach(() => {
  __resetCheckoutShortstatCacheForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function commitFile(cwd: string, path: string, content: string, message: string): void {
  writeFileSync(join(cwd, path), content);
  git(cwd, ["add", path]);
  git(cwd, ["commit", "-m", message]);
}

interface StackFixture {
  tempDir: string;
  remoteDir: string;
  userRepo: string;
  teamRepo: string;
}

/**
 * Builds an "origin + two clones" fixture that mirrors the field report:
 * a shared bare remote on `main`, another team's clone that pushes merged work,
 * and the user's clone where local `main` can drift from `origin/main`.
 */
function createStackFixture(): StackFixture {
  const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "diff-base-test-")));
  tempDirs.push(tempDir);
  const remoteDir = join(tempDir, "remote.git");
  const seedDir = join(tempDir, "seed");
  const userRepo = join(tempDir, "user");
  const teamRepo = join(tempDir, "team");

  execFileSync("git", ["init", "--bare", "-b", "main", remoteDir]);
  mkdirSync(seedDir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: seedDir });
  git(seedDir, ["config", "user.email", "test@test.com"]);
  git(seedDir, ["config", "user.name", "Test"]);
  commitFile(seedDir, "README.md", "seed\n", "initial");
  git(seedDir, ["remote", "add", "origin", remoteDir]);
  git(seedDir, ["push", "-u", "origin", "main"]);

  for (const clone of [userRepo, teamRepo]) {
    execFileSync("git", ["clone", remoteDir, clone]);
    git(clone, ["config", "user.email", "test@test.com"]);
    git(clone, ["config", "user.name", "Test"]);
  }

  return { tempDir, remoteDir, userRepo, teamRepo };
}

function changedPaths(diff: { structured?: { path: string }[] }): string[] {
  return (diff.structured ?? []).map((file) => file.path).sort();
}

describe("Changes-view diff base freshness", () => {
  it("ignores other teams' merged work when local main is behind origin/main", async () => {
    const { userRepo, teamRepo } = createStackFixture();

    // Another team merges work into main and pushes it.
    commitFile(teamRepo, "other-team.txt", "merged elsewhere\n", "other team work");
    git(teamRepo, ["push", "origin", "main"]);

    // The user fetches (so origin/main is fresh) but never fast-forwards local main,
    // then branches their feature off the fresh remote-tracking ref.
    git(userRepo, ["fetch", "origin"]);
    git(userRepo, ["checkout", "-b", "feature", "origin/main"]);
    commitFile(userRepo, "mine.txt", "my work\n", "my work");

    const diff = await getCheckoutDiff(userRepo, { mode: "base", includeStructured: true });
    expect(changedPaths(diff)).toEqual(["mine.txt"]);
  });

  it("ignores merged-in base commits when local main is behind origin/main", async () => {
    const { userRepo, teamRepo } = createStackFixture();

    // The field report's shape: the feature branch has merged the fresh base in, so the other
    // team's commits really are reachable from HEAD. Only a base ref that has caught up excludes
    // them; a stale local `main` surfaces every merged file as the user's own change.
    git(userRepo, ["checkout", "-b", "feature"]);
    commitFile(userRepo, "mine.txt", "my work\n", "my work");
    commitFile(teamRepo, "other-team.txt", "merged elsewhere\n", "other team work");
    git(teamRepo, ["push", "origin", "main"]);
    git(userRepo, ["fetch", "origin"]);
    git(userRepo, ["merge", "--no-edit", "origin/main"]);

    const diff = await getCheckoutDiff(userRepo, { mode: "base", includeStructured: true });
    expect(changedPaths(diff)).toEqual(["mine.txt"]);
  });

  it("ignores unpushed local base commits when origin/main is stale", async () => {
    const { userRepo } = createStackFixture();

    // Local main moves ahead of origin/main and is never pushed.
    commitFile(userRepo, "local-base.txt", "local base work\n", "local base work");
    git(userRepo, ["checkout", "-b", "feature"]);
    commitFile(userRepo, "mine.txt", "my work\n", "my work");

    const diff = await getCheckoutDiff(userRepo, { mode: "base", includeStructured: true });
    expect(changedPaths(diff)).toEqual(["mine.txt"]);
  });

  it("reports ahead/behind against the freshest base when origin/main is stale", async () => {
    const { userRepo } = createStackFixture();

    commitFile(userRepo, "local-base.txt", "local base work\n", "local base work");
    git(userRepo, ["checkout", "-b", "feature"]);
    commitFile(userRepo, "mine.txt", "my work\n", "my work");

    const status = await getCheckoutStatus(userRepo);
    expect(status.isGit).toBe(true);
    if (!status.isGit) return;
    expect(status.aheadBehind).toEqual({ ahead: 1, behind: 0 });
  });

  it("counts shortstat against the freshest base when origin/main is stale", async () => {
    const { userRepo } = createStackFixture();

    commitFile(userRepo, "local-base.txt", "local base work\nsecond line\n", "local base work");
    git(userRepo, ["checkout", "-b", "feature"]);
    commitFile(userRepo, "mine.txt", "my work\n", "my work");

    const shortstat = await getCheckoutShortstat(userRepo);
    expect(shortstat).toEqual({ additions: 1, deletions: 0 });
  });
});

interface StackedWorktreeFixture {
  userRepo: string;
  ottoHome: string;
  childWorktree: string;
}

/**
 * Repo with a stacked pair: `parent` carries one commit off main, and an Otto worktree
 * `child` is cut from `parent` but records main as its base (the default a user gets when
 * they leave the base branch alone).
 */
async function createStackedWorktreeFixture(): Promise<StackedWorktreeFixture> {
  const { userRepo, tempDir } = createStackFixture();
  const ottoHome = join(tempDir, "otto-home");

  git(userRepo, ["checkout", "-b", "parent"]);
  commitFile(userRepo, "parent.txt", "parent work\n", "parent work");
  git(userRepo, ["checkout", "main"]);

  const worktree = await createWorktree({
    cwd: userRepo,
    worktreeSlug: "child",
    source: { kind: "branch-off", baseBranch: "parent", branchName: "child" },
    runSetup: false,
    ottoHome,
  });

  // Leave the recorded base at the repo default, which is what makes the parent's
  // commits leak into the child's view until the base is repointed.
  await setCheckoutBaseRef(worktree.worktreePath, "main", { ottoHome });
  commitFile(worktree.worktreePath, "child.txt", "child work\n", "child work");

  return { userRepo, ottoHome, childWorktree: worktree.worktreePath };
}

describe("per-worktree diff base", () => {
  it("hides the parent branch's commits once the base points at the parent", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    const beforeDiff = await getCheckoutDiff(
      childWorktree,
      { mode: "base", includeStructured: true },
      { ottoHome },
    );
    expect(changedPaths(beforeDiff)).toEqual(["child.txt", "parent.txt"]);

    const result = await setCheckoutBaseRef(childWorktree, "parent", { ottoHome });
    expect(result).toEqual({ baseRef: "parent", isDefault: false });

    const afterDiff = await getCheckoutDiff(
      childWorktree,
      { mode: "base", includeStructured: true },
      { ottoHome },
    );
    expect(changedPaths(afterDiff)).toEqual(["child.txt"]);
  });

  it("reports the new base through checkout status", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    await setCheckoutBaseRef(childWorktree, "parent", { ottoHome });

    const status = await getCheckoutStatus(childWorktree, { ottoHome });
    expect(status).toMatchObject({ isGit: true, baseRef: "parent" });
  });

  it("resets to the repository default branch when given null", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    await setCheckoutBaseRef(childWorktree, "parent", { ottoHome });
    const result = await setCheckoutBaseRef(childWorktree, null, { ottoHome });

    expect(result).toEqual({ baseRef: "main", isDefault: true });
    const status = await getCheckoutStatus(childWorktree, { ottoHome });
    expect(status).toMatchObject({ isGit: true, baseRef: "main" });
  });

  it("accepts an origin/-prefixed base and stores the local name", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    const result = await setCheckoutBaseRef(childWorktree, "origin/main", { ottoHome });
    expect(result.baseRef).toBe("main");
  });

  it("rejects a branch that exists neither locally nor on origin", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    await expect(setCheckoutBaseRef(childWorktree, "nope", { ottoHome })).rejects.toThrow(
      /not found locally or on origin/,
    );
  });

  it("rejects the branch the worktree is on", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();

    await expect(setCheckoutBaseRef(childWorktree, "child", { ottoHome })).rejects.toThrow(
      /cannot be the branch you are on/,
    );
  });

  it("refuses to set a base on a checkout that is not an Otto worktree", async () => {
    const { userRepo, ottoHome } = await createStackedWorktreeFixture();

    await expect(setCheckoutBaseRef(userRepo, "parent", { ottoHome })).rejects.toThrow(
      /Only Otto worktrees/,
    );
  });

  it("keeps other worktree metadata when the base is repointed", async () => {
    const { ottoHome, childWorktree } = await createStackedWorktreeFixture();
    writeOttoWorktreeRuntimeMetadata(childWorktree, { worktreePort: 4321 });

    await setCheckoutBaseRef(childWorktree, "parent", { ottoHome });

    const metadata = readOttoWorktreeMetadata(childWorktree);
    expect(metadata).toMatchObject({
      version: 2,
      baseRefName: "parent",
      runtime: { worktreePort: 4321 },
    });
  });
});
