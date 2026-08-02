import { resolve } from "node:path";

import type { Logger } from "pino";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ForgeService } from "../services/github-service.js";
import {
  deleteOttoWorktree,
  isOttoOwnedWorktreeCwd,
  resolveOttoWorktreeRootForCwd,
  WorktreeTeardownError,
} from "../utils/worktree.js";
import { deleteLocalBranch as deleteLocalBranchImpl } from "./workspace-archive-branch.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";

export interface ActiveWorkspaceRef {
  workspaceId: string;
  cwd: string;
  kind?: "local_checkout" | "worktree" | "directory";
  // Paseo widened this ref so archive callers can decide worktree teardown
  // without a second registry read. Optional here because Otto's older
  // producers (and the test harnesses) only fill the first three.
  worktreeRoot?: string | null;
  isOttoOwnedWorktree?: boolean;
  mainRepoRoot?: string | null;
}

export interface ArchiveDependencies {
  ottoHome?: string;
  // Base directory that may hold worktrees across repositories. Used as a fallback
  // when the request does not supply a per-repo root.
  ottoWorktreesBaseRoot?: string;
  github: ForgeService;
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
  agentManager: Pick<AgentManager, "listAgents" | "archiveAgent" | "archiveSnapshot">;
  agentStorage: Pick<AgentStorage, "list">;
  // Resolves the worktree at a path to its workspaceId for archive-by-path. The
  // path uniquely identifies a worktree workspace; this is a directory lookup for
  // the archive target, not status/ownership.
  findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
  // Active (non-archived) workspaces, used to decide whether the workspace being
  // archived is the last reference to its backing worktree directory, and to
  // break a same-cwd tie in favor of the worktree-kind record when archiving by
  // path (no explicit workspaceId).
  listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  killTerminalsForWorkspace: (workspaceId: string) => Promise<void>;
  // Stops the language servers rooted at a directory no active workspace points at
  // any more. Optional so the test harnesses and the CLI paths need not wire an
  // LspService; when absent, servers are left to the daemon's idle reaper.
  stopLanguageServers?: (rootPath: string) => Promise<void>;
  // Deletes a local branch from the shared repo. Injectable for tests; defaults
  // to the real git-backed implementation.
  deleteLocalBranch?: (input: {
    repoRoot: string;
    branchName: string;
  }) => Promise<{ deleted: boolean }>;
  sessionLogger?: Logger;
}

export interface KillTerminalsForWorkspaceDependencies {
  detachTerminalStream?: (terminalId: string, options: { emitExit: boolean }) => void;
  sessionLogger: Logger;
  terminalManager: TerminalManager | null;
}

export type ArchiveScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "worktree"; targetPath: string };

export interface ArchiveResult {
  archivedAgentIds: string[];
  archivedWorkspaceIds: string[];
  removedDirectory: boolean;
  // The local branch deleted as part of this archive, or null when none was
  // requested / eligible / actually removed.
  deletedBranch: string | null;
}

export interface ArchiveByScopeRequest {
  scope: ArchiveScope;
  // Optional: Paseo's callers let the service resolve the repo root itself.
  repoRoot?: string | null;
  // Per-repository worktree root, used to remove the actual directory.
  repoWorktreesRoot?: string;
  // Base directory that may hold worktrees across repositories; falls back to the
  // dependency's base root for ownership checks and path resolution.
  ottoWorktreesBaseRoot?: string;
  // When set, delete this local branch from `repoRoot` after the worktree
  // directory is removed (i.e. only when this archive was the last reference to
  // the directory and the branch is no longer checked out). Requires repoRoot.
  branchCleanup?: { branchName: string } | null;
  requestId: string;
}

export async function requireActiveWorkspaceForArchive(
  dependencies: Pick<ArchiveDependencies, "listActiveWorkspaces">,
  workspaceId: string,
): Promise<ActiveWorkspaceRef> {
  const workspace = (await dependencies.listActiveWorkspaces()).find(
    (candidate) => candidate.workspaceId === workspaceId,
  );
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace;
}

export async function resolveWorkspaceIdAtPath(
  dependencies: Pick<ArchiveDependencies, "findWorkspaceIdForCwd" | "listActiveWorkspaces">,
  targetPath: string,
): Promise<string | null> {
  const targetDir = resolve(targetPath);
  const activeWorkspaces = await dependencies.listActiveWorkspaces();
  const exactMatches = activeWorkspaces.filter((workspace) => resolve(workspace.cwd) === targetDir);
  const worktreeMatch = exactMatches.find((workspace) => workspace.kind === "worktree");
  if (worktreeMatch) {
    return worktreeMatch.workspaceId;
  }
  return dependencies.findWorkspaceIdForCwd(targetPath);
}

// THE single archive entry. Resolves the in-scope record set, tears each down
// (agents + terminals + record), then removes the backing directory iff it is
// Otto-owned AND no active workspace still references it.
export async function archiveByScope(
  dependencies: ArchiveDependencies,
  request: ArchiveByScopeRequest,
): Promise<ArchiveResult> {
  const { targetDir, targetWorkspaceIds } = await resolveArchiveTargets(
    dependencies,
    request.scope,
    request.ottoWorktreesBaseRoot,
  );
  // Callers that know the repo root pass it; the rest get it derived here from
  // the workspaces being archived. Without a repo root, deleteOttoWorktree skips
  // `git worktree remove` and `git worktree prune` entirely, so the directory
  // disappeared while the parent repo went on listing it as a live worktree.
  const repoRoot =
    request.repoRoot ?? (await resolveArchiveRepoRoot(dependencies, targetWorkspaceIds));
  const resolvedRequest = repoRoot ? { ...request, repoRoot } : request;

  if (targetWorkspaceIds.length > 0) {
    dependencies.markWorkspaceArchiving(targetWorkspaceIds, new Date().toISOString());
  }

  let removedDirectory = false;
  let deletedBranch: string | null = null;

  try {
    if (targetWorkspaceIds.length > 0) {
      await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
    }

    const { archivedAgents, archivedWorkspaceIds } = await archiveTargetRecords(
      dependencies,
      targetWorkspaceIds,
      request.requestId,
    );

    if (targetDir !== null && archivedWorkspaceIds.length > 0) {
      await stopLanguageServersForArchivedDirectories(dependencies, {
        directories: [targetDir],
        archivedWorkspaceIds,
      });
    }

    if (resolvedRequest.repoRoot) {
      try {
        await dependencies.workspaceGitService.getSnapshot(resolvedRequest.repoRoot, {
          force: true,
          reason: "archive-worktree",
        });
      } catch (error) {
        dependencies.sessionLogger?.warn(
          { err: error, cwd: resolvedRequest.repoRoot, requestId: request.requestId },
          "Failed to force-refresh workspace git snapshot after archiving",
        );
      }
    }

    if (targetDir !== null) {
      const removal = await maybeRemoveDirectory(
        dependencies,
        resolvedRequest,
        targetDir,
        archivedWorkspaceIds,
      );
      removedDirectory = removal.removedDirectory;
      deletedBranch = removal.deletedBranch;
    }

    return {
      archivedAgentIds: Array.from(archivedAgents),
      archivedWorkspaceIds,
      removedDirectory,
      deletedBranch,
    };
  } finally {
    if (targetWorkspaceIds.length > 0) {
      dependencies.clearWorkspaceArchiving(targetWorkspaceIds);
      await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
    }
  }
}

// The repo a worktree workspace was cut from, as recorded on its placement.
// Only worktree records carry one; a plain checkout has nothing to prune.
async function resolveArchiveRepoRoot(
  dependencies: ArchiveDependencies,
  targetWorkspaceIds: string[],
): Promise<string | null> {
  if (targetWorkspaceIds.length === 0) {
    return null;
  }
  const targets = new Set(targetWorkspaceIds);
  const active = await dependencies.listActiveWorkspaces();
  for (const workspace of active) {
    if (targets.has(workspace.workspaceId) && workspace.mainRepoRoot) {
      return workspace.mainRepoRoot;
    }
  }
  return null;
}

async function resolveArchiveTargets(
  dependencies: ArchiveDependencies,
  scope: ArchiveScope,
  ottoWorktreesBaseRoot?: string,
): Promise<{ targetDir: string | null; targetWorkspaceIds: string[] }> {
  const activeWorkspaces = await dependencies.listActiveWorkspaces();

  if (scope.kind === "workspace") {
    const workspaceId = scope.workspaceId;
    const record = activeWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
    if (!record) {
      dependencies.sessionLogger?.warn(
        { workspaceId },
        "Workspace not found for archive-by-scope; skipping",
      );
      return { targetDir: null, targetWorkspaceIds: [] };
    }
    return { targetDir: resolve(record.cwd), targetWorkspaceIds: [workspaceId] };
  }

  let targetPath = scope.targetPath;
  const resolvedWorktree = await resolveOttoWorktreeRootForCwd(targetPath, {
    ottoHome: dependencies.ottoHome,
    worktreesRoot: ottoWorktreesBaseRoot ?? dependencies.ottoWorktreesBaseRoot,
  });
  if (resolvedWorktree) {
    targetPath = resolvedWorktree.worktreePath;
  }
  const targetDir = resolve(targetPath);
  const targetWorkspaceIds = activeWorkspaces
    .filter((workspace) => resolve(workspace.cwd) === targetDir)
    .map((workspace) => workspace.workspaceId);
  return { targetDir, targetWorkspaceIds };
}

async function archiveTargetRecords(
  dependencies: ArchiveDependencies,
  targetWorkspaceIds: string[],
  requestId: string,
): Promise<{ archivedAgents: Set<string>; archivedWorkspaceIds: string[] }> {
  const archivedAgents = new Set<string>();
  const archivedWorkspaceIds: string[] = [];

  const results = await Promise.allSettled(
    targetWorkspaceIds.map(async (workspaceId) => {
      const agents = await archiveWorkspaceContents(dependencies, workspaceId);
      await dependencies.archiveWorkspaceRecord(workspaceId);
      return { workspaceId, agents };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      archivedWorkspaceIds.push(result.value.workspaceId);
      for (const agentId of result.value.agents) {
        archivedAgents.add(agentId);
      }
    } else {
      dependencies.sessionLogger?.warn(
        { err: result.reason, requestId },
        "archiveByScope workspace teardown failed; continuing",
      );
    }
  }

  return { archivedAgents, archivedWorkspaceIds };
}

interface RemoveDirectoryResult {
  removedDirectory: boolean;
  deletedBranch: string | null;
}

async function maybeRemoveDirectory(
  dependencies: ArchiveDependencies,
  request: Omit<ArchiveByScopeRequest, "scope">,
  targetDir: string,
  archivedWorkspaceIds: string[],
): Promise<RemoveDirectoryResult> {
  const ownership = await isOttoOwnedWorktreeCwd(targetDir, {
    ottoHome: dependencies.ottoHome,
    worktreesRoot: request.ottoWorktreesBaseRoot ?? dependencies.ottoWorktreesBaseRoot,
  });
  if (!ownership.allowed) {
    return { removedDirectory: false, deletedBranch: null };
  }

  const remainingActive = await dependencies.listActiveWorkspaces();
  if (!isDirectoryUnreferenced(remainingActive, targetDir, new Set(archivedWorkspaceIds))) {
    return { removedDirectory: false, deletedBranch: null };
  }

  try {
    await deleteOttoWorktree({
      cwd: request.repoRoot ?? null,
      worktreePath: targetDir,
      worktreesRoot: request.repoWorktreesRoot ?? ownership.worktreeRoot,
      ottoHome: dependencies.ottoHome,
      worktreesBaseRoot: request.ottoWorktreesBaseRoot ?? dependencies.ottoWorktreesBaseRoot,
    });
    dependencies.github.invalidate({ cwd: targetDir });
    // The worktree working tree is gone, so the branch is no longer checked out
    // and git will accept its deletion. Only attempted here (last-reference path)
    // so a directory still backing another workspace never loses its branch.
    const deletedBranch = await maybeDeleteLeftoverBranch(dependencies, request);
    return { removedDirectory: true, deletedBranch };
  } catch (error) {
    if (error instanceof WorktreeTeardownError) {
      dependencies.sessionLogger?.warn(
        { err: error, targetPath: targetDir, requestId: request.requestId },
        "Worktree disk removal failed during archive; workspace already archived",
      );
      return { removedDirectory: false, deletedBranch: null };
    }
    throw error;
  }
}

async function maybeDeleteLeftoverBranch(
  dependencies: ArchiveDependencies,
  request: Omit<ArchiveByScopeRequest, "scope">,
): Promise<string | null> {
  const branchName = request.branchCleanup?.branchName;
  if (!branchName || !request.repoRoot) {
    return null;
  }
  const deleteBranch = dependencies.deleteLocalBranch ?? deleteLocalBranchImpl;
  try {
    const result = await deleteBranch({ repoRoot: request.repoRoot, branchName });
    if (!result.deleted) {
      dependencies.sessionLogger?.warn(
        { branchName, repoRoot: request.repoRoot, requestId: request.requestId },
        "Leftover worktree branch could not be deleted during archive; leaving it in place",
      );
      return null;
    }
    return branchName;
  } catch (error) {
    dependencies.sessionLogger?.warn(
      { err: error, branchName, requestId: request.requestId },
      "Leftover worktree branch deletion threw during archive; leaving it in place",
    );
    return null;
  }
}

export type ArchiveWorkspaceContentsDependencies = Pick<
  ArchiveDependencies,
  "agentManager" | "agentStorage" | "killTerminalsForWorkspace" | "sessionLogger"
>;

// Tears down everything OWNED by a single workspace record: its live agents,
// its persisted-but-not-running agent snapshots, and its terminals. Scoped by
// workspaceId so a sibling workspace sharing the same directory is untouched.
// Returns the set of archived agent ids.
export async function archiveWorkspaceContents(
  dependencies: ArchiveWorkspaceContentsDependencies,
  workspaceId: string,
): Promise<Set<string>> {
  const archivedAgents = new Set<string>();

  const liveAgents = dependencies.agentManager
    .listAgents()
    .filter((agent) => agent.workspaceId === workspaceId);
  for (const agent of liveAgents) {
    archivedAgents.add(agent.id);
  }

  let storedRecords: StoredAgentRecord[] = [];
  try {
    storedRecords = await dependencies.agentStorage.list();
  } catch (error) {
    dependencies.sessionLogger?.warn(
      { err: error, workspaceId },
      "Failed to list stored agents during workspace archive; continuing",
    );
  }
  const liveAgentIds = new Set(liveAgents.map((agent) => agent.id));
  const matchingStoredRecords = storedRecords.filter(
    (record) => record.workspaceId === workspaceId,
  );
  for (const record of matchingStoredRecords) {
    archivedAgents.add(record.id);
  }

  const archivedAt = new Date().toISOString();
  const archiveResults = await Promise.allSettled([
    ...liveAgents.map((agent) => dependencies.agentManager.archiveAgent(agent.id)),
    ...matchingStoredRecords
      .filter((record) => !liveAgentIds.has(record.id) && !record.archivedAt)
      .map((record) => dependencies.agentManager.archiveSnapshot(record.id, archivedAt)),
    dependencies.killTerminalsForWorkspace(workspaceId),
  ]);

  for (const result of archiveResults) {
    if (result.status === "rejected") {
      dependencies.sessionLogger?.warn(
        { err: result.reason, workspaceId },
        "Workspace archive teardown step failed; continuing",
      );
    }
  }

  return archivedAgents;
}

export type StopLanguageServersDependencies = Pick<
  ArchiveDependencies,
  "listActiveWorkspaces" | "stopLanguageServers" | "sessionLogger"
>;

// A language server is keyed by DIRECTORY, not by workspace record, so it may only be
// stopped once no active workspace still points at that directory — the same
// last-reference rule the directory removal uses. Exported because project removal
// archives its workspaces without going through archiveByScope and owes the same
// teardown.
//
// Never throws: a language server that refuses to die must not fail an archive that has
// already happened.
export async function stopLanguageServersForArchivedDirectories(
  dependencies: StopLanguageServersDependencies,
  input: { directories: Iterable<string>; archivedWorkspaceIds: Iterable<string> },
): Promise<void> {
  const stop = dependencies.stopLanguageServers;
  if (!stop) {
    return;
  }

  const archivedWorkspaceIds = new Set(input.archivedWorkspaceIds);
  const remainingActive = await dependencies.listActiveWorkspaces().catch(() => null);
  if (remainingActive === null) {
    return;
  }

  const unreferenced = [...new Set([...input.directories].map((dir) => resolve(dir)))].filter(
    (dir) => isDirectoryUnreferenced(remainingActive, dir, archivedWorkspaceIds),
  );

  await Promise.all(
    unreferenced.map(async (dir) => {
      try {
        await stop(dir);
      } catch (error) {
        dependencies.sessionLogger?.warn(
          { err: error, targetPath: dir },
          "Failed to stop language servers for archived workspace; leaving them to the idle reaper",
        );
      }
    }),
  );
}

// EXACTLY one last-reference predicate in the module. True when, after archiving
// the in-scope records, no active workspace still points at targetDir. Derived
// from records each call — no stored counter.
function isDirectoryUnreferenced(
  activeWorkspaces: ActiveWorkspaceRef[],
  targetDir: string,
  archivedWorkspaceIds: ReadonlySet<string>,
): boolean {
  const target = resolve(targetDir);
  return !activeWorkspaces.some(
    (workspace) =>
      !archivedWorkspaceIds.has(workspace.workspaceId) && resolve(workspace.cwd) === target,
  );
}

export async function killTerminalsForWorkspace(
  dependencies: KillTerminalsForWorkspaceDependencies,
  workspaceId: string,
): Promise<void> {
  const terminalManager = dependencies.terminalManager;
  if (!terminalManager) {
    return;
  }

  const terminalIds: string[] = [];
  const terminalLists = await Promise.all(
    terminalManager.listDirectories().map(async (terminalCwd) => {
      try {
        return await terminalManager.getTerminals(terminalCwd, { workspaceId });
      } catch (error) {
        dependencies.sessionLogger.warn(
          { err: error, cwd: terminalCwd },
          "Failed to enumerate workspace terminals during archive",
        );
        return [];
      }
    }),
  );
  for (const terminals of terminalLists) {
    for (const terminal of terminals) {
      if (terminal.workspaceId === workspaceId) {
        terminalIds.push(terminal.id);
      }
    }
  }

  if (terminalIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    terminalIds.map(async (terminalId) => {
      try {
        dependencies.detachTerminalStream?.(terminalId, { emitExit: true });
        await terminalManager.killTerminalAndWait(terminalId, {
          gracefulTimeoutMs: 2000,
          forceTimeoutMs: 1500,
        });
      } catch (error) {
        dependencies.sessionLogger.warn(
          { err: error, terminalId },
          "Terminal kill escalation failed during archive; proceeding anyway",
        );
      }
    }),
  );
}

// Archiving the last workspace of a project leaves the project record active.
// The user removes the project explicitly, so we never archive the parent here.
export async function archivePersistedWorkspaceRecord(input: {
  workspaceId: string;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "archive">;
  archivedAt?: string;
}): Promise<PersistedWorkspaceRecord | null> {
  const existingWorkspace = await input.workspaceRegistry.get(input.workspaceId);
  if (!existingWorkspace) {
    return null;
  }

  if (existingWorkspace.archivedAt) {
    return existingWorkspace;
  }

  const archivedAt = input.archivedAt ?? new Date().toISOString();
  await input.workspaceRegistry.archive(input.workspaceId, archivedAt);

  return existingWorkspace;
}
