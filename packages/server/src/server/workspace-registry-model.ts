import { randomBytes } from "node:crypto";

import type {
  ProjectCheckoutLitePayload,
  ProjectPlacementPayload,
} from "@otto-code/protocol/messages";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

export type PersistedProjectKind = "git" | "non_git";
export type PersistedWorkspaceKind = "local_checkout" | "worktree" | "directory";

export function generateWorkspaceId(): string {
  return `wks_${randomBytes(8).toString("hex")}`;
}

export function generateProjectId(): string {
  return `prj_${randomBytes(8).toString("hex")}`;
}

export function deriveProjectKind(checkout: ProjectCheckoutLitePayload): PersistedProjectKind {
  return checkout.isGit ? "git" : "non_git";
}

export function deriveWorkspaceKind(checkout: ProjectCheckoutLitePayload): PersistedWorkspaceKind {
  if (!checkout.isGit) {
    return "directory";
  }
  return checkout.mainRepoRoot ? "worktree" : "local_checkout";
}

export function deriveWorkspaceDisplayName(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): string {
  const branch = input.checkout.currentBranch?.trim() ?? null;
  if (branch && branch.toUpperCase() !== "HEAD") return branch;

  const segments = input.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? input.cwd;
}

export type PersistedWorkspacePlacement = Pick<
  PersistedWorkspaceRecord,
  | "cwd"
  | "kind"
  | "displayName"
  | "branch"
  | "worktreeRoot"
  | "baseBranch"
  | "isOttoOwnedWorktree"
  | "mainRepoRoot"
>;

export type MutableWorkspacePlacement = Pick<
  PersistedWorkspaceRecord,
  "kind" | "branch" | "worktreeRoot" | "isOttoOwnedWorktree" | "mainRepoRoot"
>;

export type InitialWorkspacePlacementInput =
  | {
      source: "checkout";
      cwd: string;
      checkout: ProjectCheckoutLitePayload;
    }
  | {
      source: "created_worktree";
      cwd: string;
      worktreeRoot: string;
      branch: string | null;
      baseBranch: string | null;
      mainRepoRoot: string;
    };

export interface WorkspacePlacementUpdate {
  workspace: PersistedWorkspaceRecord;
  fields: Partial<MutableWorkspacePlacement>;
}

/** Defines the complete persisted placement for every new workspace. */
export function initialWorkspacePlacement(
  input: InitialWorkspacePlacementInput,
): PersistedWorkspacePlacement {
  if (input.source === "created_worktree") {
    return {
      cwd: input.cwd,
      kind: "worktree",
      displayName: input.branch || input.cwd,
      branch: input.branch,
      worktreeRoot: input.worktreeRoot,
      baseBranch: input.baseBranch,
      isOttoOwnedWorktree: true,
      mainRepoRoot: input.mainRepoRoot,
    };
  }

  const branch = normalizeBranch(input.checkout.currentBranch);
  return {
    cwd: input.cwd,
    kind: deriveWorkspaceKind(input.checkout),
    displayName: deriveWorkspaceDisplayName(input),
    branch,
    worktreeRoot: input.checkout.isGit ? (input.checkout.worktreeRoot ?? input.cwd) : null,
    baseBranch: null,
    isOttoOwnedWorktree: input.checkout.isGit && input.checkout.isOttoOwnedWorktree,
    mainRepoRoot: input.checkout.isGit ? input.checkout.mainRepoRoot : null,
  };
}

/**
 * Applies live placement facts without rewriting the workspace's durable name
 * or its creation-time base branch.
 */
export function reconcileWorkspacePlacement(input: {
  workspace: PersistedWorkspaceRecord;
  checkout: ProjectCheckoutLitePayload;
  updatedAt: string;
}): WorkspacePlacementUpdate | null {
  const observed = initialWorkspacePlacement({
    source: "checkout",
    cwd: input.workspace.cwd,
    checkout: input.checkout,
  });
  const fields: Partial<MutableWorkspacePlacement> = {};
  if (input.workspace.kind !== observed.kind) fields.kind = observed.kind;
  if (input.workspace.branch !== observed.branch) fields.branch = observed.branch;
  if (input.workspace.worktreeRoot !== observed.worktreeRoot)
    fields.worktreeRoot = observed.worktreeRoot;
  if (input.workspace.isOttoOwnedWorktree !== observed.isOttoOwnedWorktree)
    fields.isOttoOwnedWorktree = observed.isOttoOwnedWorktree;
  if (input.workspace.mainRepoRoot !== observed.mainRepoRoot)
    fields.mainRepoRoot = observed.mainRepoRoot;

  if (Object.keys(fields).length === 0) return null;
  return {
    workspace: { ...input.workspace, ...fields, updatedAt: input.updatedAt },
    fields,
  };
}

/** Projects persisted placement onto the checkout shape sent over the wire. */
export function checkoutFromPersistedWorkspacePlacement(input: {
  workspace: PersistedWorkspaceRecord;
  fallbackBranch?: string | null;
  fallbackWorktreeRoot?: string | null;
}): ProjectPlacementPayload["checkout"] {
  const { workspace } = input;
  if (workspace.kind === "directory") {
    return {
      cwd: workspace.cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isOttoOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }

  const checkout = {
    cwd: workspace.cwd,
    currentBranch: workspace.branch ?? input.fallbackBranch ?? null,
    remoteUrl: null,
    worktreeRoot: workspace.worktreeRoot ?? input.fallbackWorktreeRoot ?? workspace.cwd,
  };
  if (workspace.isOttoOwnedWorktree && workspace.mainRepoRoot) {
    return {
      ...checkout,
      isGit: true,
      isOttoOwnedWorktree: true,
      mainRepoRoot: workspace.mainRepoRoot,
    };
  }
  return {
    ...checkout,
    isGit: true,
    isOttoOwnedWorktree: false,
    mainRepoRoot: workspace.mainRepoRoot ?? null,
  };
}

function normalizeBranch(branch: string | null | undefined): string | null {
  const normalized = branch?.trim() ?? null;
  return normalized && normalized.toUpperCase() !== "HEAD" ? normalized : null;
}

export function checkoutLiteFromGitSnapshot(
  cwd: string,
  git: {
    isGit: boolean;
    currentBranch: string | null;
    remoteUrl: string | null;
    repoRoot: string | null;
    isOttoOwnedWorktree: boolean;
    mainRepoRoot: string | null;
  },
): ProjectCheckoutLitePayload {
  if (!git.isGit) {
    return {
      cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isOttoOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }
  if (git.isOttoOwnedWorktree && git.mainRepoRoot) {
    return {
      cwd,
      isGit: true,
      currentBranch: git.currentBranch,
      remoteUrl: git.remoteUrl,
      worktreeRoot: git.repoRoot ?? cwd,
      isOttoOwnedWorktree: true,
      mainRepoRoot: git.mainRepoRoot,
    };
  }
  return {
    cwd,
    isGit: true,
    currentBranch: git.currentBranch,
    remoteUrl: git.remoteUrl,
    worktreeRoot: git.repoRoot ?? cwd,
    isOttoOwnedWorktree: false,
    mainRepoRoot: git.mainRepoRoot,
  };
}

export function deriveProjectGroupingName(projectKey: string): string {
  if (projectKey.startsWith("remote:")) {
    const remainder = projectKey.slice("remote:".length);
    const pathSegments = remainder.split("/").filter(Boolean).slice(1);
    if (pathSegments.length >= 2) {
      return pathSegments.slice(-2).join("/");
    }
    if (pathSegments.length === 1) {
      return pathSegments[0];
    }
    return projectKey;
  }

  const segments = projectKey.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectKey;
}
