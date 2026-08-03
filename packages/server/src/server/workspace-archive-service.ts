import { resolve } from "node:path";

import type { Logger } from "pino";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ForgeService } from "../services/github-service.js";
import {
  deleteOttoWorktree,
  isOttoOwnedWorktreeCwd,
  runWorktreeTeardownCommands,
  WorktreeTeardownError,
} from "../utils/worktree.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import { deleteLocalBranch as deleteLocalBranchImpl } from "./workspace-archive-branch.js";
import { gitOperationLog } from "./git-operation-log.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";

export interface ActiveWorkspaceRef {
  workspaceId: string;
  cwd: string;
  kind?: "local_checkout" | "worktree" | "directory";
  // Paseo widened this ref so archive callers can decide worktree teardown
  // without a second registry read. Optional here because Otto's older
  // producers (and the test harnesses) only fill the first three; when they are
  // absent the backing directory is rediscovered from the filesystem.
  worktreeRoot?: string | null;
  isOttoOwnedWorktree?: boolean;
  mainRepoRoot?: string | null;
}

// The directory a workspace record actually sits on top of. A record's cwd is NOT
// that directory: Otto opens a workspace at the package it was launched on, so a
// single worktree routinely backs records at <worktreeRoot> and at
// <worktreeRoot>/packages/app. Ownership, last-reference and removal all have to
// reason about the backing directory, never the raw cwd.
interface BackingDirectory {
  path: string;
  isOttoOwnedWorktree: boolean;
  mainRepoRoot: string | null;
  ottoWorktreesRoot: string | null;
}

interface ArchiveTarget {
  backing: BackingDirectory | null;
  // The exact directories teardown must run from — one per archived record, since
  // teardown commands are read from the otto.json at that directory.
  teardownTargets: Array<{ workspaceId: string | null; cwd: string }>;
  workspaceIds: string[];
}

// Ownership resolution reads the same two knobs everywhere. The request may
// override the daemon-level base root, so it is folded in once and threaded
// through every backing-directory lookup for a single archive.
type BackingResolutionDependencies = Pick<
  ArchiveDependencies,
  "ottoHome" | "ottoWorktreesBaseRoot"
>;

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
  // Drops the in-memory git operation log buffers a directory owns. Injectable
  // for tests; defaults to the daemon-global service.
  deleteGitOperationLogs?: (cwd: string) => void;
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
  const matchesTarget = createRealpathAwarePathMatcher(targetPath);
  const activeWorkspaces = await dependencies.listActiveWorkspaces();
  const exactMatches = activeWorkspaces.filter((workspace) => matchesTarget(workspace.cwd));
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
  const backingDependencies: BackingResolutionDependencies = {
    ottoHome: dependencies.ottoHome,
    ottoWorktreesBaseRoot: request.ottoWorktreesBaseRoot ?? dependencies.ottoWorktreesBaseRoot,
  };
  const target = await resolveArchiveTarget(dependencies, backingDependencies, request.scope);
  const targetWorkspaceIds = target.workspaceIds;
  // Callers that know the repo root pass it; the rest get it derived here from
  // the workspaces being archived, then from the worktree's own ownership record.
  // Without a repo root, deleteOttoWorktree skips `git worktree remove` and
  // `git worktree prune` entirely, so the directory disappeared while the parent
  // repo went on listing it as a live worktree.
  const repoRoot =
    request.repoRoot ??
    (await resolveArchiveRepoRoot(dependencies, targetWorkspaceIds)) ??
    target.backing?.mainRepoRoot ??
    null;
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
    console.error(
      "DIAG archiveByScope",
      JSON.stringify(request.scope),
      "targets=",
      JSON.stringify(targetWorkspaceIds),
      "archived=",
      JSON.stringify(archivedWorkspaceIds),
    );

    await dropGitOperationLogsForArchivedRecords(dependencies, target, archivedWorkspaceIds);

    if (target.backing !== null && archivedWorkspaceIds.length > 0) {
      // A language server is rooted at the directory a session opened, so the
      // archived records' own cwds are the roots to stop — plus the backing
      // directory itself, which is about to go away.
      const archivedIds = new Set(archivedWorkspaceIds);
      await stopLanguageServersForArchivedDirectories(dependencies, {
        directories: uniqueFilesystemPaths([
          ...target.teardownTargets
            .filter((entry) => entry.workspaceId !== null && archivedIds.has(entry.workspaceId))
            .map((entry) => entry.cwd),
          target.backing.path,
        ]),
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

    if (target.backing !== null) {
      const removal = await maybeRemoveDirectory(
        dependencies,
        backingDependencies,
        resolvedRequest,
        target,
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

async function resolveArchiveTarget(
  dependencies: ArchiveDependencies,
  backingDependencies: BackingResolutionDependencies,
  scope: ArchiveScope,
): Promise<ArchiveTarget> {
  const activeWorkspaces = await dependencies.listActiveWorkspaces();

  if (scope.kind === "workspace") {
    const workspaceId = scope.workspaceId;
    const record = activeWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
    if (!record) {
      dependencies.sessionLogger?.warn(
        { workspaceId },
        "Workspace not found for archive-by-scope; skipping",
      );
      return { backing: null, teardownTargets: [], workspaceIds: [] };
    }
    return {
      backing: await resolveWorkspaceBackingDirectory(record, backingDependencies),
      teardownTargets: [{ workspaceId, cwd: record.cwd }],
      workspaceIds: [workspaceId],
    };
  }

  // Archiving by path takes every record the directory backs, not only the ones
  // whose cwd is spelled exactly like it — a record nested inside the worktree is
  // just as dead once the directory is gone.
  const backing = await resolveBackingDirectory(scope.targetPath, backingDependencies);
  const matchesBackingDirectory = createRealpathAwarePathMatcher(backing.path);
  const targetWorkspaces = (
    await Promise.all(
      activeWorkspaces.map(async (workspace) => {
        const backingDirectory = await resolveWorkspaceBackingDirectory(
          workspace,
          backingDependencies,
        );
        return matchesBackingDirectory(backingDirectory.path) ? workspace : null;
      }),
    )
  ).filter((workspace): workspace is ActiveWorkspaceRef => workspace !== null);
  const persistedMainRepoRoot = targetWorkspaces.find(
    (workspace) => workspace.mainRepoRoot,
  )?.mainRepoRoot;
  return {
    backing: {
      ...backing,
      mainRepoRoot: persistedMainRepoRoot ?? backing.mainRepoRoot,
    },
    teardownTargets:
      targetWorkspaces.length > 0
        ? targetWorkspaces.map((workspace) => ({
            workspaceId: workspace.workspaceId,
            cwd: workspace.cwd,
          }))
        : [{ workspaceId: null, cwd: scope.targetPath }],
    workspaceIds: targetWorkspaces.map((workspace) => workspace.workspaceId),
  };
}

async function resolveWorkspaceBackingDirectory(
  workspace: ActiveWorkspaceRef,
  dependencies: BackingResolutionDependencies,
): Promise<BackingDirectory> {
  if (workspace.isOttoOwnedWorktree && workspace.worktreeRoot && workspace.mainRepoRoot) {
    return {
      path: resolve(workspace.worktreeRoot),
      isOttoOwnedWorktree: true,
      mainRepoRoot: workspace.mainRepoRoot,
      ottoWorktreesRoot: null,
    };
  }
  // Otto's ref widens `kind` to optional, so an ABSENT kind is "unknown", not
  // "not a worktree". Falling through to filesystem discovery there is the safe
  // direction: under-resolving a backing directory is what deletes a worktree out
  // from under a live sibling.
  if (workspace.kind !== undefined && workspace.kind !== "worktree") {
    return {
      path: resolve(workspace.cwd),
      isOttoOwnedWorktree: false,
      mainRepoRoot: workspace.mainRepoRoot ?? null,
      ottoWorktreesRoot: null,
    };
  }

  // COMPAT(archiveMissingWorkspacePlacement): worktree records created before the
  // placement fields were stamped (Otto b2599f46a) lack durable backing ownership;
  // remove filesystem discovery after 2027-01-17.
  const backing = await resolveBackingDirectory(
    workspace.worktreeRoot ?? workspace.cwd,
    dependencies,
  );
  return { ...backing, mainRepoRoot: workspace.mainRepoRoot ?? backing.mainRepoRoot };
}

async function resolveBackingDirectory(
  cwd: string,
  dependencies: BackingResolutionDependencies,
): Promise<BackingDirectory> {
  const ownership = await isOttoOwnedWorktreeCwd(cwd, {
    ottoHome: dependencies.ottoHome,
    worktreesRoot: dependencies.ottoWorktreesBaseRoot,
  });
  return {
    path: resolve(ownership.allowed && ownership.worktreePath ? ownership.worktreePath : cwd),
    isOttoOwnedWorktree: ownership.allowed,
    mainRepoRoot: ownership.repoRoot ?? null,
    ottoWorktreesRoot: ownership.worktreeRoot ?? null,
  };
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
  backingDependencies: BackingResolutionDependencies,
  request: Omit<ArchiveByScopeRequest, "scope">,
  target: ArchiveTarget,
  archivedWorkspaceIds: string[],
): Promise<RemoveDirectoryResult> {
  const backing = target.backing;
  if (!backing?.isOttoOwnedWorktree) {
    return { removedDirectory: false, deletedBranch: null };
  }

  // Teardown belongs to the RECORD, not to the directory: a workspace that is
  // going away owes its teardown commands even when the directory survives for a
  // sibling. Deduped by path so two records on one directory run it once, and run
  // from each record's own cwd so a nested otto.json is actually seen.
  const archivedWorkspaceIdSet = new Set(archivedWorkspaceIds);
  const teardownCwds = uniqueFilesystemPaths(
    target.teardownTargets
      .filter(
        (teardownTarget) =>
          teardownTarget.workspaceId === null ||
          archivedWorkspaceIdSet.has(teardownTarget.workspaceId),
      )
      .map((teardownTarget) => teardownTarget.cwd),
  );

  try {
    for (const teardownCwd of teardownCwds) {
      await runWorktreeTeardownCommands({
        worktreePath: backing.path,
        teardownCwd,
        repoRootPath: request.repoRoot ?? backing.mainRepoRoot ?? undefined,
      });
    }
  } catch (error) {
    if (error instanceof WorktreeTeardownError) {
      dependencies.sessionLogger?.warn(
        { err: error, targetPath: backing.path, requestId: request.requestId },
        "Worktree teardown failed during archive; workspace already archived",
      );
      return { removedDirectory: false, deletedBranch: null };
    }
    throw error;
  }

  const remainingActive = await dependencies.listActiveWorkspaces();
  if (
    !(await isDirectoryUnreferenced(
      remainingActive,
      backing.path,
      new Set(archivedWorkspaceIds),
      backingDependencies,
    ))
  ) {
    return { removedDirectory: false, deletedBranch: null };
  }

  try {
    await deleteOttoWorktree({
      cwd: request.repoRoot ?? null,
      worktreePath: backing.path,
      // Already run above, per archived record, so deleteOttoWorktree must not
      // repeat it from the worktree root.
      teardownCwds: [],
      worktreesRoot: request.repoWorktreesRoot ?? backing.ottoWorktreesRoot ?? undefined,
      ottoHome: dependencies.ottoHome,
      worktreesBaseRoot: request.ottoWorktreesBaseRoot ?? dependencies.ottoWorktreesBaseRoot,
    });
    dependencies.github.invalidate({ cwd: backing.path });
    // The worktree working tree is gone, so the branch is no longer checked out
    // and git will accept its deletion. Only attempted here (last-reference path)
    // so a directory still backing another workspace never loses its branch.
    const deletedBranch = await maybeDeleteLeftoverBranch(dependencies, request);
    return { removedDirectory: true, deletedBranch };
  } catch (error) {
    if (error instanceof WorktreeTeardownError) {
      dependencies.sessionLogger?.warn(
        { err: error, targetPath: backing.path, requestId: request.requestId },
        "Worktree disk removal failed during archive; workspace already archived",
      );
      return { removedDirectory: false, deletedBranch: null };
    }
    throw error;
  }
}

// The git operation log is an unpersisted buffer per (cwd, operation), capped
// per key but never shedding keys, so an archived record's logs would sit in the
// daemon forever. Same last-reference shape as the language servers, but keyed
// on the record's own CWD rather than its backing directory, because that is
// what the buffer key is: two records at one cwd share buffers, and the survivor
// keeps them.
export function dropGitOperationLogs(
  dependencies: Pick<ArchiveDependencies, "deleteGitOperationLogs">,
  cwds: Iterable<string>,
): void {
  const drop =
    dependencies.deleteGitOperationLogs ?? ((cwd: string) => gitOperationLog.deleteForCwd(cwd));
  for (const cwd of cwds) {
    drop(cwd);
  }
}

// Never throws: losing an operational log buffer must not fail an archive that
// has already happened.
async function dropGitOperationLogsForArchivedRecords(
  dependencies: ArchiveDependencies,
  target: ArchiveTarget,
  archivedWorkspaceIds: string[],
): Promise<void> {
  const archived = new Set(archivedWorkspaceIds);
  const candidates = uniqueFilesystemPaths(
    target.teardownTargets
      .filter((entry) => entry.workspaceId === null || archived.has(entry.workspaceId))
      .map((entry) => entry.cwd),
  );
  if (candidates.length === 0) {
    return;
  }
  const remainingActive = await dependencies.listActiveWorkspaces().catch(() => null);
  if (remainingActive === null) {
    return;
  }
  const unreferenced = candidates.filter((cwd) => {
    const matchesCwd = createRealpathAwarePathMatcher(cwd);
    return !remainingActive.some(
      (workspace) => !archived.has(workspace.workspaceId) && matchesCwd(workspace.cwd),
    );
  });
  dropGitOperationLogs(dependencies, unreferenced);
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
  | "listActiveWorkspaces"
  | "stopLanguageServers"
  | "sessionLogger"
  | "ottoHome"
  | "ottoWorktreesBaseRoot"
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

  const candidates = [...new Set([...input.directories].map((dir) => resolve(dir)))];
  const unreferencedFlags = await Promise.all(
    candidates.map((dir) =>
      isDirectoryUnreferenced(remainingActive, dir, archivedWorkspaceIds, dependencies),
    ),
  );
  const unreferenced = candidates.filter((_dir, index) => unreferencedFlags[index]);

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
//
// A workspace points at BOTH its own cwd and the directory backing it, and those
// differ whenever a record sits in a subdirectory of a worktree. Checking only the
// cwd let an archive delete a worktree that a nested sibling was still live on;
// checking only the backing directory would leave that sibling's language servers
// resident. Matching is realpath-aware because two records can spell the same
// directory differently (a symlinked temp dir, /var vs /private/var).
async function isDirectoryUnreferenced(
  activeWorkspaces: ActiveWorkspaceRef[],
  targetDir: string,
  archivedWorkspaceIds: ReadonlySet<string>,
  dependencies: BackingResolutionDependencies,
): Promise<boolean> {
  const matchesTarget = createRealpathAwarePathMatcher(resolve(targetDir));
  for (const workspace of activeWorkspaces) {
    if (archivedWorkspaceIds.has(workspace.workspaceId)) continue;
    if (matchesTarget(workspace.cwd)) return false;
    const backingDirectory = await resolveWorkspaceBackingDirectory(workspace, dependencies);
    if (matchesTarget(backingDirectory.path)) return false;
  }
  return true;
}

// Realpath-aware dedupe: two records can spell one directory differently, and
// teardown must run once per DIRECTORY, not once per spelling.
function uniqueFilesystemPaths(paths: string[]): string[] {
  const unique: string[] = [];
  for (const candidate of paths) {
    if (!unique.some((existing) => createRealpathAwarePathMatcher(existing)(candidate))) {
      unique.push(candidate);
    }
  }
  return unique;
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
