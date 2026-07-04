import { join } from "node:path";

import { getOttoWorktreesRoot, isOttoOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateOttoWorktreeInput,
  CreateOttoWorktreeResult,
} from "../otto-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListOttoWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListOttoWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listOttoWorktreesCommand(
  dependencies: ListOttoWorktreesCommandDependencies,
  input: ListOttoWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateOttoWorktreeWorkflow<Result extends CreateOttoWorktreeResult> = (
  input: CreateOttoWorktreeInput,
) => Promise<Result>;

export interface CreateOttoWorktreeCommandDependencies<
  Result extends CreateOttoWorktreeResult = CreateOttoWorktreeResult,
> {
  ottoHome?: string;
  worktreesRoot?: string;
  createOttoWorktreeWorkflow?: CreateOttoWorktreeWorkflow<Result>;
}

export type CreateOttoWorktreeCommandInput = Omit<
  CreateOttoWorktreeInput,
  "ottoHome" | "runSetup"
> & {
  ottoHome?: string;
  worktreesRoot?: string;
};

export type CreateOttoWorktreeCommandResult<Result extends CreateOttoWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createOttoWorktreeCommand<Result extends CreateOttoWorktreeResult>(
  dependencies: CreateOttoWorktreeCommandDependencies<Result>,
  input: CreateOttoWorktreeCommandInput,
): Promise<CreateOttoWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createOttoWorktreeWorkflow) {
      throw new Error("Otto worktree service is not configured");
    }

    const createdWorktree = await dependencies.createOttoWorktreeWorkflow({
      ...input,
      runSetup: false,
      ottoHome: input.ottoHome ?? dependencies.ottoHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const resolvedTarget = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";

  if (scope === "worktree") {
    const ownership = await isOttoOwnedWorktreeCwd(resolvedTarget.targetPath, {
      ottoHome: dependencies.ottoHome,
      worktreesRoot: dependencies.ottoWorktreesBaseRoot,
    });

    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a Otto-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath: resolvedTarget.targetPath },
      repoRoot: ownership.repoRoot ?? resolvedTarget.repoRoot ?? null,
      repoWorktreesRoot: ownership.worktreeRoot,
      ottoWorktreesBaseRoot: dependencies.ottoWorktreesBaseRoot,
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, resolvedTarget.targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath: resolvedTarget.targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    repoRoot: resolvedTarget.repoRoot,
    ottoWorktreesBaseRoot: dependencies.ottoWorktreesBaseRoot,
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

interface ResolvedArchiveTarget {
  targetPath: string;
  repoRoot: string | null;
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ResolvedArchiveTarget> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return { targetPath: input.worktreePath, repoRoot };
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return {
      targetPath: await resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug),
      repoRoot,
    };
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Otto worktree not found for branch ${input.branchName}`);
    }
    return { targetPath: match.path, repoRoot };
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getOttoWorktreesRoot(
    repoRoot,
    dependencies.ottoHome,
    dependencies.ottoWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
