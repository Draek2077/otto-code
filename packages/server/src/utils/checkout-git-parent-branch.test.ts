import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { inferParentBranchRef } from "./checkout-git-parent-branch.js";

const tempDirs: string[] = [];

afterEach(() => {
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

/** A repo on `main` with one commit. */
function createRepo(): string {
  const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "parent-branch-test-")));
  tempDirs.push(tempDir);
  const repo = join(tempDir, "repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  git(repo, ["config", "user.email", "test@test.com"]);
  git(repo, ["config", "user.name", "Test"]);
  commitFile(repo, "README.md", "seed\n", "initial");
  return repo;
}

describe("inferParentBranchRef", () => {
  it("picks the immediate parent of a stacked branch, not the default branch", async () => {
    const repo = createRepo();
    // main -> parent -> child. The whole point: `main` is also an ancestor of `child`, but
    // `parent` forks later, so diffing against `main` would show parent's commits as child's.
    git(repo, ["checkout", "-b", "feature/parent"]);
    commitFile(repo, "parent.txt", "parent\n", "parent work");
    git(repo, ["checkout", "-b", "feature/child"]);
    commitFile(repo, "child.txt", "child\n", "child work");

    await expect(
      inferParentBranchRef(repo, { currentBranch: "feature/child", defaultBranch: "main" }),
    ).resolves.toBe("feature/parent");
  });

  it("ignores child branches that contain the current branch", async () => {
    const repo = createRepo();
    git(repo, ["checkout", "-b", "feature/parent"]);
    commitFile(repo, "parent.txt", "parent\n", "parent work");
    // `feature/child` descends from `feature/parent`. Standing on the parent, the child is not
    // a candidate — its merge-base with HEAD is HEAD itself.
    git(repo, ["checkout", "-b", "feature/child"]);
    commitFile(repo, "child.txt", "child\n", "child work");
    git(repo, ["checkout", "feature/parent"]);

    await expect(
      inferParentBranchRef(repo, { currentBranch: "feature/parent", defaultBranch: "main" }),
    ).resolves.toBe("main");
  });

  it("returns null on the default branch of a single-branch repo", async () => {
    const repo = createRepo();
    commitFile(repo, "more.txt", "more\n", "more work");

    await expect(
      inferParentBranchRef(repo, { currentBranch: "main", defaultBranch: "main" }),
    ).resolves.toBeNull();
  });

  it("never proposes a merged branch as the default branch's parent", async () => {
    const repo = createRepo();
    git(repo, ["checkout", "-b", "merged-feature"]);
    commitFile(repo, "feature.txt", "feature\n", "feature work");
    git(repo, ["checkout", "main"]);
    git(repo, ["merge", "--no-ff", "-m", "merge feature", "merged-feature"]);

    // A merged branch's tip is an ancestor of HEAD, which is graph-identical to a stacked
    // parent — and `main` is excluded from its own candidate list, so without an explicit guard
    // the merged branch wins. Observed for real on this repo before the guard existed.
    await expect(
      inferParentBranchRef(repo, { currentBranch: "main", defaultBranch: "main" }),
    ).resolves.toBeNull();
  });

  it("prefers the default branch when several branches fork at the same commit", async () => {
    const repo = createRepo();
    // `sibling` and `main` both fork from the same commit, so the graph cannot separate them.
    // The tie-break has to be deterministic rather than ref-enumeration order.
    git(repo, ["branch", "sibling"]);
    git(repo, ["checkout", "-b", "feature/work"]);
    commitFile(repo, "work.txt", "work\n", "work");

    await expect(
      inferParentBranchRef(repo, { currentBranch: "feature/work", defaultBranch: "main" }),
    ).resolves.toBe("main");
  });

  it("finds a parent that only exists as a remote-tracking ref", async () => {
    const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "parent-branch-remote-")));
    tempDirs.push(tempDir);
    const remote = join(tempDir, "remote.git");
    const seed = join(tempDir, "seed");
    const clone = join(tempDir, "clone");

    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    mkdirSync(seed, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: seed });
    git(seed, ["config", "user.email", "test@test.com"]);
    git(seed, ["config", "user.name", "Test"]);
    commitFile(seed, "README.md", "seed\n", "initial");
    git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-u", "origin", "main"]);
    git(seed, ["checkout", "-b", "feature/parent"]);
    commitFile(seed, "parent.txt", "parent\n", "parent work");
    git(seed, ["push", "-u", "origin", "feature/parent"]);

    execFileSync("git", ["clone", remote, clone]);
    git(clone, ["config", "user.email", "test@test.com"]);
    git(clone, ["config", "user.name", "Test"]);
    // Branch off the remote-tracking ref without ever creating a local `feature/parent`.
    git(clone, ["checkout", "-b", "feature/child", "origin/feature/parent"]);
    commitFile(clone, "child.txt", "child\n", "child work");

    await expect(
      inferParentBranchRef(clone, { currentBranch: "feature/child", defaultBranch: "main" }),
    ).resolves.toBe("origin/feature/parent");
  });

  it("never proposes the bare remote name from origin/HEAD", async () => {
    const tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "parent-branch-symref-")));
    tempDirs.push(tempDir);
    const remote = join(tempDir, "remote.git");
    const seed = join(tempDir, "seed");
    const clone = join(tempDir, "clone");

    execFileSync("git", ["init", "--bare", "-b", "main", remote]);
    mkdirSync(seed, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: seed });
    git(seed, ["config", "user.email", "test@test.com"]);
    git(seed, ["config", "user.name", "Test"]);
    commitFile(seed, "README.md", "seed\n", "initial");
    git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-u", "origin", "main"]);
    execFileSync("git", ["clone", remote, clone]);
    git(clone, ["config", "user.email", "test@test.com"]);
    git(clone, ["config", "user.name", "Test"]);
    git(clone, ["checkout", "-b", "feature/work"]);
    commitFile(clone, "work.txt", "work\n", "work");

    // `git for-each-ref --format=%(refname:short)` renders refs/remotes/origin/HEAD as the bare
    // string "origin", which reads as an ordinary branch and beats real candidates on merge-base.
    // It is a symbolic ref to the default branch, so it must never be offered as a parent.
    const parent = await inferParentBranchRef(clone, {
      currentBranch: "feature/work",
      defaultBranch: "main",
    });
    expect(parent).not.toBe("origin");
    expect(parent).toBe("main");
  });

  it("returns null for a branch with unrelated history", async () => {
    const repo = createRepo();
    git(repo, ["checkout", "--orphan", "orphan-branch"]);
    git(repo, ["rm", "-rf", "."]);
    commitFile(repo, "orphan.txt", "orphan\n", "orphan root");

    await expect(
      inferParentBranchRef(repo, { currentBranch: "orphan-branch", defaultBranch: "main" }),
    ).resolves.toBeNull();
  });
});
