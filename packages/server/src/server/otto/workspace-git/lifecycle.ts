import { stat } from "node:fs/promises";
import { basename } from "node:path";
import {
  listReopenWorktrees,
  listWorkspaceMoveTargets,
  moveWorkspaceChat,
  reopenWorktree,
  type WorkspaceRecoveryTarget,
} from "@getpaseo/plugin/otto/workspace-git";
import type { z } from "zod";
import { areEquivalentPaths } from "../../../utils/path.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import { mapWorkspaceCwdToWorktree } from "../../../utils/worktree.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import { createWorkspaceRecoveryService } from "../../session/workspace-recovery/workspace-recovery-service.js";
import type { WorkspaceProvisioningService } from "../../session/workspace-provisioning/workspace-provisioning-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import {
  resolveProjectDisplayName,
  resolveWorkspaceDisplayName,
  type WorkspaceRegistry,
  type ProjectRegistry,
  type PersistedWorkspaceRecord,
} from "../../workspace-registry.js";

type Target = z.infer<typeof WorkspaceRecoveryTarget>;
interface Candidate {
  target: Target;
  label: string;
  branch: string | null;
}

interface Dependencies {
  serverId(): string;
  paseoHome: string;
  worktreesRoot?: string;
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "get">;
  projectRegistry: Pick<ProjectRegistry, "list" | "get">;
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees" | "resolveRepoRoot">;
  workspaceProvisioning: Pick<
    WorkspaceProvisioningService,
    "createWorkspaceForWorktree" | "ensureWorkspaceRecordUnarchived"
  >;
  agentManager: Pick<AgentManager, "moveChatWorkspace">;
  publish(workspaceIds: string[]): Promise<void>;
  recovered?(workspace: PersistedWorkspaceRecord): Promise<void>;
  releaseAuthoring?(input: {
    agentId: string;
    workspaceId: string;
    labels: Record<string, string>;
  }): Promise<string | null>;
}

const isDirectory = async (path: string) =>
  (await stat(path).catch(() => null))?.isDirectory() ?? false;

function targetMatches(target: Target, candidate: Target) {
  return target.kind === "archived"
    ? candidate.kind === "archived" && target.workspaceId === candidate.workspaceId
    : candidate.kind === "worktree" && areEquivalentPaths(target.path, candidate.path);
}

export function createOttoWorkspaceLifecycle(deps: Dependencies) {
  const { workspaceRegistry, projectRegistry } = deps;
  const recovery = createWorkspaceRecoveryService({
    paseoHome: deps.paseoHome,
    worktreesRoot: deps.worktreesRoot,
    getWorkspace: (id) => workspaceRegistry.get(id),
    getProject: (id) => projectRegistry.get(id),
    isDirectory,
    unarchiveWorkspace: async (workspace) => {
      await deps.workspaceProvisioning.ensureWorkspaceRecordUnarchived(workspace);
    },
  });
  // Reopen discovery and mutation share a project lane. Double clicks on an
  // orphan cannot mint two workspace records for the same checkout.
  const reopenTails = new Map<string, Promise<unknown>>();
  const host = (id: string) => {
    if (id !== deps.serverId()) throw new Error("This request belongs to another host.");
  };

  async function allowedWorkspace(id: string) {
    const workspace = await workspaceRegistry.get(id);
    if (!workspace || workspace.archivedAt || workspace.background) {
      throw new Error("That workspace is no longer available.");
    }
    const project = await projectRegistry.get(workspace.projectId);
    if (!project || project.archivedAt) throw new Error("That project is no longer available.");
    return workspace;
  }

  async function moveChoices(workspaceId: string) {
    const [workspaces, projects] = await Promise.all([
      workspaceRegistry.list(),
      projectRegistry.list(),
    ]);
    const active = new Map(
      projects
        .filter((project) => !project.archivedAt)
        .map((project) => [project.projectId, resolveProjectDisplayName(project)]),
    );
    return workspaces
      .flatMap((workspace) => {
        const project = active.get(workspace.projectId);
        if (
          workspace.archivedAt ||
          workspace.background ||
          workspace.workspaceId === workspaceId ||
          !project
        )
          return [];
        return [
          {
            workspaceId: workspace.workspaceId,
            label: resolveWorkspaceDisplayName(workspace),
            project,
          },
        ];
      })
      .sort(
        (left, right) =>
          left.project.localeCompare(right.project) || left.label.localeCompare(right.label),
      );
  }

  async function scope(projectId: string) {
    const project = await projectRegistry.get(projectId);
    if (!project || project.archivedAt || project.kind !== "git") {
      throw new Error("This project has no worktrees to reopen.");
    }
    const repoRoot = await deps.workspaceGitService.resolveRepoRoot(project.rootPath);
    const worktrees = await deps.workspaceGitService.listWorktrees(repoRoot, {
      force: true,
      reason: "reattach-worktree",
    });
    const records = await workspaceRegistry.list();
    return { repoRoot, projectRoot: project.rootPath, worktrees, records };
  }

  async function hasKeptBranch(workspace: PersistedWorkspaceRecord, repoRoot: string) {
    if (!workspace.branch) return false;
    const cwd = workspace.mainRepoRoot ?? repoRoot;
    try {
      await runGitCommand(
        ["show-ref", "--verify", "--quiet", "--", `refs/heads/${workspace.branch}`],
        { cwd },
      );
      return true;
    } catch {
      return false;
    }
  }

  async function list(projectId: string): Promise<Candidate[]> {
    const { repoRoot, worktrees, records } = await scope(projectId);
    const registered = (path: string) =>
      records.some((record) => areEquivalentPaths(record.worktreeRoot ?? record.cwd, path));
    const candidates: Candidate[] = [];
    for (const record of records) {
      if (
        record.projectId !== projectId ||
        !record.archivedAt ||
        record.background ||
        record.kind !== "worktree"
      )
        continue;
      if (
        records.some(
          (other) =>
            !other.archivedAt &&
            areEquivalentPaths(other.worktreeRoot ?? other.cwd, record.worktreeRoot ?? record.cwd),
        )
      )
        continue;
      if (!(await isDirectory(record.cwd)) && !(await hasKeptBranch(record, repoRoot))) continue;
      candidates.push({
        target: { kind: "archived", workspaceId: record.workspaceId },
        label: resolveWorkspaceDisplayName(record),
        branch: record.branch,
      });
    }
    for (const entry of worktrees) {
      if (registered(entry.path) || !(await isDirectory(entry.path))) continue;
      candidates.push({
        target: { kind: "worktree", path: entry.path },
        label: basename(entry.path),
        branch: entry.branchName ?? null,
      });
    }
    return candidates.sort((left, right) => left.label.localeCompare(right.label));
  }

  async function open(projectId: string, target: Target): Promise<string> {
    if (target.kind === "archived") {
      const existing = await workspaceRegistry.get(target.workspaceId);
      if (existing?.projectId === projectId && !existing.archivedAt && !existing.background)
        return existing.workspaceId;
    }
    const candidate = (await list(projectId)).find((entry) => targetMatches(target, entry.target));
    if (!candidate) throw new Error("This worktree is no longer available to reopen.");
    if (candidate.target.kind === "archived") {
      const result = await recovery.restore(candidate.target.workspaceId);
      return result.workspaceId;
    }
    const { repoRoot, projectRoot } = await scope(projectId);
    const path = candidate.target.path;
    const cwd = mapWorkspaceCwdToWorktree({
      sourceWorktreePath: repoRoot,
      workspaceCwd: projectRoot,
      targetWorktreePath: path,
    });
    if (!(await isDirectory(cwd)))
      throw new Error("This project's directory is missing from the worktree.");
    const workspace = await deps.workspaceProvisioning.createWorkspaceForWorktree({
      sourceCwd: projectRoot,
      projectId,
      repoRoot,
      cwd,
      worktreeRoot: path,
      branch: candidate.branch,
      baseBranch: null,
      title: null,
    });
    return workspace.workspaceId;
  }

  function reopen(projectId: string, target: Target) {
    const previous = reopenTails.get(projectId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => open(projectId, target));
    reopenTails.set(projectId, task);
    const clear = () => {
      if (reopenTails.get(projectId) === task) reopenTails.delete(projectId);
    };
    void task.then(clear, clear);
    return task;
  }

  async function move(input: {
    agentId: string;
    fromWorkspaceId: string | null;
    workspaceId: string;
  }) {
    const { agentId, fromWorkspaceId, workspaceId } = input;
    await deps.agentManager.moveChatWorkspace({
      ...input,
      validateDestination: async () => {
        await allowedWorkspace(workspaceId);
      },
      releaseAuthoring: (labels) =>
        fromWorkspaceId
          ? deps.releaseAuthoring?.({ agentId, workspaceId: fromWorkspaceId, labels })
          : undefined,
    });
    await deps.publish(fromWorkspaceId ? [fromWorkspaceId, workspaceId] : [workspaceId]);
    return { workspaceId };
  }

  return {
    move,
    invoke(method: string, value: unknown) {
      switch (method) {
        case listWorkspaceMoveTargets.name:
          return respond(async () => {
            const input = listWorkspaceMoveTargets.input.parse(value);
            host(input.hostId);
            await allowedWorkspace(input.workspaceId);
            return moveChoices(input.workspaceId);
          });
        case moveWorkspaceChat.name:
          return respond(async () => {
            const input = moveWorkspaceChat.input.parse(value);
            host(input.hostId);
            return move(input);
          });
        case listReopenWorktrees.name:
          return respond(() => {
            const input = listReopenWorktrees.input.parse(value);
            host(input.hostId);
            return list(input.projectId);
          });
        case reopenWorktree.name:
          return respond(async () => {
            const input = reopenWorktree.input.parse(value);
            host(input.hostId);
            const workspaceId = await reopen(input.projectId, input.target);
            const record = await workspaceRegistry.get(workspaceId);
            if (record && deps.recovered) await deps.recovered(record);
            else await deps.publish([workspaceId]);
            return { workspaceId };
          });
        default:
          return undefined;
      }
    },
  };
}

async function respond<T>(operation: () => Promise<T>) {
  try {
    return { ok: true as const, value: await operation() };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        kind: "failed" as const,
        message: (error instanceof Error ? error.message : "The workspace operation failed.").slice(
          0,
          1000,
        ),
      },
    };
  }
}
