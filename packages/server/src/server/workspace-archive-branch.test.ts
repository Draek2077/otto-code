import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createWorktree, type WorktreeConfig } from "../utils/worktree.js";
import { detectWorktreeArchiveBranch } from "./workspace-archive-branch.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    rmSync(target, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

function createGitRepo(): { tempDir: string; repoDir: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), "archive-branch-"));
  cleanupPaths.push(tempDir);
  const repoDir = path.join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ["init", "-b", "main"]);
  git(repoDir, ["config", "user.email", "test@otto-code.local"]);
  git(repoDir, ["config", "user.name", "Otto Test"]);
  git(repoDir, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
  return { tempDir, repoDir };
}

async function createOttoWorktree(
  repoDir: string,
  ottoHome: string,
  slug: string,
): Promise<WorktreeConfig> {
  return createWorktree({
    cwd: repoDir,
    worktreeSlug: slug,
    source: { kind: "branch-off", baseBranch: "main", branchName: slug },
    runSetup: false,
    ottoHome,
  });
}

describe("detectWorktreeArchiveBranch", () => {
  test("reports a merged Otto worktree branch", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoWorktree(repoDir, ottoHome, "merged-branch");

    const detection = await detectWorktreeArchiveBranch({
      cwd: worktree.worktreePath,
      repoRoot: repoDir,
      ottoHome,
      directoryWillBeRemoved: true,
    });

    expect(detection).toMatchObject({
      isOttoWorktree: true,
      branchName: "merged-branch",
      baseBranch: "main",
      mergeState: "merged",
      unmergedCommitCount: 0,
      hasRemoteBranch: false,
      branchCheckedOutElsewhere: false,
      directoryWillBeRemoved: true,
    });
  });

  test("reports an unmerged branch with its commit count", async () => {
    const { tempDir, repoDir } = createGitRepo();
    const ottoHome = path.join(tempDir, ".otto");
    const worktree = await createOttoWorktree(repoDir, ottoHome, "unmerged-branch");

    writeFileSync(path.join(worktree.worktreePath, "change.txt"), "work\n");
    git(worktree.worktreePath, ["add", "change.txt"]);
    git(worktree.worktreePath, ["-c", "commit.gpgsign=false", "commit", "-m", "wip"]);

    const detection = await detectWorktreeArchiveBranch({
      cwd: worktree.worktreePath,
      repoRoot: repoDir,
      ottoHome,
      directoryWillBeRemoved: true,
    });

    expect(detection.isOttoWorktree).toBe(true);
    expect(detection.mergeState).toBe("unmerged");
    expect(detection.unmergedCommitCount).toBe(1);
  });

  test("does not treat a plain checkout as an Otto worktree", async () => {
    const { repoDir } = createGitRepo();

    const detection = await detectWorktreeArchiveBranch({
      cwd: repoDir,
      repoRoot: repoDir,
      ottoHome: path.join(repoDir, ".otto"),
      directoryWillBeRemoved: false,
    });

    expect(detection.isOttoWorktree).toBe(false);
    expect(detection.branchName).toBeNull();
    expect(detection.mergeState).toBe("unknown");
    expect(detection.directoryWillBeRemoved).toBe(false);
  });
});
