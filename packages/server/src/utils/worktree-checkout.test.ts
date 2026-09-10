import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../test-utils/remove-temp-dir.js";
import { createWorktree } from "./worktree.js";

describe("worktree branch checkout", () => {
  let tempRoot: string;
  let repoDir: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: "pipe" }).trim();
  }

  async function checkout(refName: string) {
    return createWorktree({
      cwd: repoDir,
      worktreeSlug: "random-directory",
      source: { kind: "checkout-branch", branchName: refName },
      ottoHome: join(tempRoot, "otto-home"),
      runSetup: false,
    });
  }

  beforeEach(() => {
    const scratchRoot = resolve(import.meta.dirname, "../../../../.tmp");
    mkdirSync(scratchRoot, { recursive: true });
    tempRoot = realpathSync(mkdtempSync(join(scratchRoot, "worktree-checkout-")));
    repoDir = join(tempRoot, "repo");
    mkdirSync(repoDir);
    git("init", "-b", "main");
    git("config", "user.name", "Otto Test");
    git("config", "user.email", "test@otto-code.local");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial");
    git("branch", "feature/chosen");
  });

  afterEach(() => removeTempDir(tempRoot));

  it("checks out the full local picker ref independently of the directory name", async () => {
    const worktree = await checkout("refs/heads/feature/chosen");

    expect(worktree.branchName).toBe("feature/chosen");
    expect(basename(worktree.worktreePath)).toBe("random-directory");
    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen");
    expect(git("for-each-ref", "--format=%(refname)", "refs/heads/random-directory")).toBe("");
  });

  it("creates a named tracking branch for an exact remote-only picker ref", async () => {
    git("remote", "add", "upstream", join(tempRoot, "unused-remote"));
    git("update-ref", "refs/remotes/upstream/feature/remote", "HEAD");
    const worktree = await checkout("refs/remotes/upstream/feature/remote");

    expect(worktree.branchName).toBe("feature/remote");
    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/remote");
    expect(
      git("-C", worktree.worktreePath, "rev-parse", "--symbolic-full-name", "@{upstream}"),
    ).toBe("refs/remotes/upstream/feature/remote");
  });

  it("reuses an available local branch that matches the selected remote", async () => {
    git("update-ref", "refs/remotes/origin/feature/chosen", "HEAD");
    const worktree = await checkout("refs/remotes/origin/feature/chosen");

    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen");
    expect(git("for-each-ref", "--format=%(refname)", "refs/heads/feature/chosen-1")).toBe("");
  });

  it("preserves a differing local branch and starts from the exact selected remote", async () => {
    const localCommit = git("rev-parse", "feature/chosen");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "remote change");
    const remoteCommit = git("rev-parse", "HEAD");
    git("remote", "add", "origin", join(tempRoot, "unused-remote"));
    git("update-ref", "refs/remotes/origin/feature/chosen", remoteCommit);
    const worktree = await checkout("refs/remotes/origin/feature/chosen");

    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen-1");
    expect(git("-C", worktree.worktreePath, "rev-parse", "HEAD")).toBe(remoteCommit);
    expect(git("rev-parse", "feature/chosen")).toBe(localCommit);
  });

  it("keeps the selected branch name as the suffix base when already checked out", async () => {
    git("checkout", "feature/chosen");
    const worktree = await checkout("refs/heads/feature/chosen");

    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen-1");
    expect(git("branch", "--show-current")).toBe("feature/chosen");
  });

  it("checks out a selected branch when the source directory is itself a worktree", async () => {
    const sourcePath = join(tempRoot, "source-worktree");
    git("worktree", "add", "-b", "source", sourcePath);
    repoDir = sourcePath;
    const worktree = await checkout("refs/heads/feature/chosen");

    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen");
    expect(git("branch", "--show-current")).toBe("source");
  });

  it("preserves plain branch-name checkout requests", async () => {
    const worktree = await checkout("feature/chosen");
    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("feature/chosen");
  });

  it("does not confuse a local origin-prefixed branch with a remote ref", async () => {
    git("branch", "origin/chosen");
    const worktree = await checkout("refs/heads/origin/chosen");
    expect(git("-C", worktree.worktreePath, "branch", "--show-current")).toBe("origin/chosen");
  });

  it("rejects a missing exact remote ref without substituting the local branch", async () => {
    await expect(checkout("refs/remotes/origin/feature/chosen")).rejects.toThrow("Unknown branch");
    expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});
