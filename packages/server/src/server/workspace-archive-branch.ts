import { resolve } from "node:path";

import type { WorktreeArchiveBranchDetection } from "@otto-code/protocol/messages";

import { getCurrentBranch } from "../utils/checkout-git.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { isOttoOwnedWorktreeCwd } from "../utils/worktree.js";
import { readOttoWorktreeMetadata } from "../utils/worktree-metadata.js";

const READ_ONLY_GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export interface DetectWorktreeArchiveBranchInput {
  // Working directory of the worktree being archived.
  cwd: string;
  // The shared main-repo root (where branch refs live). Null when git could not
  // resolve it; detection then falls back to running ref queries from `cwd`,
  // which still sees the shared object store of a worktree.
  repoRoot: string | null;
  ottoHome?: string;
  worktreesRoot?: string;
  // Whether archiving will actually remove the backing directory. Branch cleanup
  // is only meaningful (and only offered) when the worktree is really going away.
  directoryWillBeRemoved: boolean;
}

const NON_WORKTREE_DETECTION: Omit<WorktreeArchiveBranchDetection, "directoryWillBeRemoved"> = {
  isOttoWorktree: false,
  branchName: null,
  baseBranch: null,
  mergeState: "unknown",
  unmergedCommitCount: null,
  hasRemoteBranch: false,
  branchCheckedOutElsewhere: false,
};

/**
 * Read-only inspection of a worktree's leftover branch ahead of archiving it.
 * Answers: is this an Otto-owned worktree, what branch is it on, is that branch
 * fully merged into its base, and can the branch actually be deleted once the
 * worktree directory is gone. Never throws — every git failure degrades to
 * "unknown" so the caller can still archive.
 */
export async function detectWorktreeArchiveBranch(
  input: DetectWorktreeArchiveBranchInput,
): Promise<WorktreeArchiveBranchDetection> {
  const directoryWillBeRemoved = input.directoryWillBeRemoved;

  const ownership = await isOttoOwnedWorktreeCwd(input.cwd, {
    ottoHome: input.ottoHome,
    worktreesRoot: input.worktreesRoot,
  }).catch(() => null);
  if (!ownership?.allowed) {
    return { ...NON_WORKTREE_DETECTION, directoryWillBeRemoved };
  }

  const branchName = await getCurrentBranch(input.cwd);
  if (!branchName || branchName === "HEAD") {
    // Detached HEAD: no local branch to clean up.
    return { ...NON_WORKTREE_DETECTION, isOttoWorktree: true, directoryWillBeRemoved };
  }

  const worktreeRoot = ownership.worktreePath ?? input.cwd;
  const baseBranch = readBaseBranch(worktreeRoot);
  // Branch refs live in the shared object store; querying from repoRoot avoids
  // depending on the worktree admin dir (which teardown may already be racing).
  const gitCwd = input.repoRoot ?? ownership.repoRoot ?? input.cwd;

  const [merge, hasRemoteBranch, branchCheckedOutElsewhere] = await Promise.all([
    computeMergeState(gitCwd, branchName, baseBranch),
    originBranchExists(gitCwd, branchName),
    isBranchCheckedOutElsewhere(gitCwd, branchName, input.cwd),
  ]);

  return {
    isOttoWorktree: true,
    branchName,
    baseBranch,
    mergeState: merge.mergeState,
    unmergedCommitCount: merge.unmergedCommitCount,
    hasRemoteBranch,
    branchCheckedOutElsewhere,
    directoryWillBeRemoved,
  };
}

function readBaseBranch(worktreeRoot: string): string | null {
  try {
    const metadata = readOttoWorktreeMetadata(worktreeRoot);
    const baseRefName = metadata?.baseRefName?.trim();
    return baseRefName ? baseRefName : null;
  } catch {
    return null;
  }
}

interface MergeStateResult {
  mergeState: WorktreeArchiveBranchDetection["mergeState"];
  unmergedCommitCount: number | null;
}

async function computeMergeState(
  cwd: string,
  branchName: string,
  baseBranch: string | null,
): Promise<MergeStateResult> {
  if (!baseBranch) {
    return { mergeState: "unknown", unmergedCommitCount: null };
  }
  const baseRef = await resolveBaseComparisonRef(cwd, baseBranch);
  if (!baseRef) {
    return { mergeState: "unknown", unmergedCommitCount: null };
  }
  const count = await revListCount(cwd, `${baseRef}..refs/heads/${branchName}`);
  if (count === null) {
    return { mergeState: "unknown", unmergedCommitCount: null };
  }
  return {
    mergeState: count === 0 ? "merged" : "unmerged",
    unmergedCommitCount: count,
  };
}

// Prefer the remote-tracking base (origin/<base>) when present — a branch is
// "merged" once its commits reach the base someone will actually integrate into
// — then fall back to the local base branch.
async function resolveBaseComparisonRef(cwd: string, baseBranch: string): Promise<string | null> {
  const originRef = `refs/remotes/origin/${baseBranch}`;
  if (await gitRefExists(cwd, originRef)) {
    return originRef;
  }
  const localRef = `refs/heads/${baseBranch}`;
  if (await gitRefExists(cwd, localRef)) {
    return localRef;
  }
  return null;
}

async function gitRefExists(cwd: string, fullRef: string): Promise<boolean> {
  try {
    const result = await runGitCommand(["show-ref", "--verify", "--quiet", fullRef], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      acceptExitCodes: [0, 1],
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function originBranchExists(cwd: string, branchName: string): Promise<boolean> {
  return gitRefExists(cwd, `refs/remotes/origin/${branchName}`);
}

async function revListCount(cwd: string, range: string): Promise<number | null> {
  try {
    const { stdout } = await runGitCommand(["rev-list", "--count", range], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

// A local branch may be checked out in at most one worktree. If git reports it
// checked out at a path other than the worktree we're archiving, deleting it
// will fail — so surface that up front. Best-effort: failures read as "not
// elsewhere" so a git hiccup never blocks the archive.
async function isBranchCheckedOutElsewhere(
  cwd: string,
  branchName: string,
  archivedWorktreePath: string,
): Promise<boolean> {
  try {
    const { stdout } = await runGitCommand(["worktree", "list", "--porcelain"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const archivedPath = resolve(archivedWorktreePath);
    const targetRef = `refs/heads/${branchName}`;
    let currentPath: string | null = null;
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("worktree ")) {
        currentPath = trimmed.slice("worktree ".length).trim();
        continue;
      }
      if (trimmed.startsWith("branch ") && currentPath) {
        const ref = trimmed.slice("branch ".length).trim();
        if (ref === targetRef && resolve(currentPath) !== archivedPath) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export interface DeleteLocalBranchResult {
  deleted: boolean;
}

/**
 * Delete a local branch from the shared repo. Runs after the worktree working
 * directory has been removed, so the branch is no longer checked out and git
 * will accept the deletion. Uses -D (force) because the caller has already
 * surfaced the branch's merge state to the user and taken their explicit choice;
 * git's own -d merged-check compares against the upstream, not the base branch
 * the user was shown, so it would spuriously refuse. Never throws — a failed
 * delete is logged by the caller and the archive still succeeds.
 */
export async function deleteLocalBranch(input: {
  repoRoot: string;
  branchName: string;
}): Promise<DeleteLocalBranchResult> {
  const result = await runGitCommand(["branch", "-D", input.branchName], {
    cwd: input.repoRoot,
    timeout: 30_000,
    acceptExitCodes: [0, 1, 128],
  });
  return { deleted: result.exitCode === 0 };
}
