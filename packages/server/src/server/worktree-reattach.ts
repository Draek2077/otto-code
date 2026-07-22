import { resolve } from "node:path";

import type { WorktreeReattachCandidate } from "@otto-code/protocol/messages";

import { readOttoWorktreeMetadata } from "../utils/worktree-metadata.js";
import {
  resolveWorkspaceDisplayName,
  type PersistedWorkspaceRecord,
} from "./workspace-registry.js";

// The subset of an on-disk Otto worktree entry (from listWorktrees) the candidate
// builder needs. `path` is the worktree working directory.
export interface OnDiskWorktreeInfo {
  path: string;
  branchName?: string | null;
}

export interface BuildReattachCandidatesInput {
  // Every worktree-kind workspace record for the project — active AND archived.
  // Active records are excluded from the results; they are already live. Archived
  // records with a branch become the primary "reopen what I left" targets.
  worktreeWorkspaces: PersistedWorkspaceRecord[];
  // Otto-owned worktrees that currently exist on disk under the project repo.
  onDiskWorktrees: OnDiskWorktreeInfo[];
  // Reads the base ref recorded in a worktree's otto/worktree.json. Injected so the
  // builder stays pure and testable; defaults to the real metadata reader.
  readBaseBranch?: (worktreePath: string) => string | null;
}

function defaultReadBaseBranch(worktreePath: string): string | null {
  try {
    const baseRefName = readOttoWorktreeMetadata(worktreePath)?.baseRefName?.trim();
    return baseRefName ? baseRefName : null;
  } catch {
    return null;
  }
}

/**
 * Compute the set of re-attachable Otto worktrees for a project. Two kinds:
 *
 * 1. Archived worktree workspace records with a kept branch — revived in place,
 *    recreating the backing directory from the branch when it is gone.
 * 2. On-disk Otto worktrees that no workspace record references at all (orphans) —
 *    a fresh workspace is bound to the existing directory.
 *
 * A worktree backed by an ACTIVE (non-archived) workspace is never a candidate;
 * it is already live. The path→record map is keyed by resolved cwd so the on-disk
 * scan and the record set agree on identity.
 */
export function buildReattachCandidates(
  input: BuildReattachCandidatesInput,
): WorktreeReattachCandidate[] {
  const readBaseBranch = input.readBaseBranch ?? defaultReadBaseBranch;

  const recordByResolvedCwd = new Map<string, PersistedWorkspaceRecord>();
  const activeResolvedCwds = new Set<string>();
  for (const workspace of input.worktreeWorkspaces) {
    const key = resolve(workspace.cwd);
    recordByResolvedCwd.set(key, workspace);
    if (!workspace.archivedAt) {
      activeResolvedCwds.add(key);
    }
  }

  const onDiskByResolvedPath = new Map<string, OnDiskWorktreeInfo>();
  for (const entry of input.onDiskWorktrees) {
    onDiskByResolvedPath.set(resolve(entry.path), entry);
  }

  const candidates: WorktreeReattachCandidate[] = [];

  // (1) Archived worktree workspace records with a branch to restore.
  for (const workspace of input.worktreeWorkspaces) {
    if (!workspace.archivedAt || !workspace.branch) {
      continue;
    }
    const resolvedCwd = resolve(workspace.cwd);
    // A dir shared with a still-active workspace is not ours to re-attach.
    if (activeResolvedCwds.has(resolvedCwd)) {
      continue;
    }
    candidates.push({
      workspaceId: workspace.workspaceId,
      worktreePath: workspace.cwd,
      branchName: workspace.branch,
      baseBranch: workspace.baseBranch ?? null,
      directoryOnDisk: onDiskByResolvedPath.has(resolvedCwd),
      displayName: resolveWorkspaceDisplayName(workspace),
      archivedAt: workspace.archivedAt,
    });
  }

  // (2) Orphaned on-disk worktrees with no record at all.
  for (const entry of input.onDiskWorktrees) {
    const resolvedPath = resolve(entry.path);
    if (recordByResolvedCwd.has(resolvedPath)) {
      continue;
    }
    candidates.push({
      workspaceId: null,
      worktreePath: entry.path,
      branchName: entry.branchName ?? null,
      baseBranch: readBaseBranch(entry.path),
      directoryOnDisk: true,
      displayName: null,
      archivedAt: null,
    });
  }

  return candidates;
}
