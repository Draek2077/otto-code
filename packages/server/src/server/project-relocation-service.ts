import path from "node:path";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { statSync } from "node:fs";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type {
  ProjectRegistry,
  WorkspaceRegistry,
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import { writeJsonFileAtomic } from "./atomic-file.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import {
  isProjectOffline,
  pathWithinRoot,
  relocateProjectPath,
  withProjectRelocationWrites,
} from "./project-availability.js";

interface RelocationJournal {
  project: PersistedProjectRecord;
  workspaces: PersistedWorkspaceRecord[];
  agents: StoredAgentRecord[];
}

const activeRelocations = new WeakMap<ProjectRegistry, Set<string>>();

/** One project transaction at a time, shared by all connected sessions. */
export class ProjectRelocationService {
  constructor(
    private readonly deps: {
      ottoHome: string;
      projectRegistry: ProjectRegistry;
      workspaceRegistry: WorkspaceRegistry;
      agentStorage: AgentStorage;
      prepareAgents?: (agentIds: string[]) => Promise<void>;
    },
  ) {}

  private get journalDirectory(): string {
    return path.join(this.deps.ottoHome, "projects", "relocations");
  }

  /** Roll back interrupted writes before any workspace bootstrap or runtime runs. */
  async recover(): Promise<void> {
    const files = await readdir(this.journalDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const journalPath = path.join(this.journalDirectory, file);
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as RelocationJournal;
      await withProjectRelocationWrites(journal.project.projectId, () => this.rollback(journal));
      await unlink(journalPath);
    }
  }

  async relocate(projectId: string, expectedRootPath: string, rootPath: string): Promise<void> {
    const locks = activeRelocations.get(this.deps.projectRegistry) ?? new Set<string>();
    activeRelocations.set(this.deps.projectRegistry, locks);
    if (locks.size > 0)
      throw new Error("A project is already reconnecting. Try again when it finishes.");
    locks.add(projectId);
    try {
      await withProjectRelocationWrites(projectId, () =>
        this.relocateLocked(projectId, expectedRootPath, rootPath),
      );
    } finally {
      locks.delete(projectId);
    }
  }

  private async relocateLocked(
    projectId: string,
    expectedRootPath: string,
    rootPath: string,
  ): Promise<void> {
    const { projectRegistry, workspaceRegistry, agentStorage } = this.deps;
    let project = await projectRegistry.get(projectId);
    if (!project || project.archivedAt) throw new Error("Project not found.");
    if (project.rootPath !== expectedRootPath)
      throw new Error("The base folder changed. Reopen Edit project and try again.");
    if (!isProjectOffline(project)) throw new Error("Only Offline projects can be reconnected.");
    if (!path.isAbsolute(rootPath)) throw new Error("Select an absolute base folder path.");
    const newRoot = path.resolve(rootPath);
    if (!isDirectory(newRoot)) throw new Error("The selected base folder is unavailable.");
    const projects = await projectRegistry.list();
    const matchesNewRoot = createRealpathAwarePathMatcher(newRoot);
    if (
      projects.some(
        (other) =>
          other.projectId !== projectId && !other.archivedAt && matchesNewRoot(other.rootPath),
      )
    ) {
      throw new Error("That base folder already belongs to another project.");
    }
    const allWorkspaces = await workspaceRegistry.list();
    const workspaces = allWorkspaces.filter((workspace) => workspace.projectId === projectId);
    const remap = (value: string) => relocateProjectPath(value, project!.rootPath, newRoot);
    const updatedWorkspaces = workspaces.map((workspace) => ({
      ...workspace,
      cwd: remap(workspace.cwd),
      worktreeRoot: workspace.worktreeRoot && remap(workspace.worktreeRoot),
      mainRepoRoot: workspace.mainRepoRoot && remap(workspace.mainRepoRoot),
    }));
    for (const workspace of updatedWorkspaces) {
      if (
        !workspace.archivedAt &&
        pathWithinRoot(newRoot, workspace.cwd) &&
        !isDirectory(workspace.cwd)
      ) {
        throw new Error(
          `The selected folder is missing workspace: ${path.relative(newRoot, workspace.cwd) || "."}`,
        );
      }
      const matchesWorkspace = createRealpathAwarePathMatcher(workspace.cwd);
      if (
        !workspace.archivedAt &&
        allWorkspaces.some(
          (other) =>
            other.projectId !== projectId && !other.archivedAt && matchesWorkspace(other.cwd),
        )
      ) {
        throw new Error(`A workspace already uses ${workspace.cwd}`);
      }
    }
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.workspaceId));
    const agents = (await agentStorage.list()).filter(
      (agent) => agent.workspaceId && workspaceIds.has(agent.workspaceId),
    );
    await this.deps.prepareAgents?.(agents.map((agent) => agent.id));
    await agentStorage.flush();
    // Capture again after idle provider sessions close and finish persisting.
    const settledAgents = (await agentStorage.list()).filter(
      (agent) => agent.workspaceId && workspaceIds.has(agent.workspaceId),
    );
    project = (await projectRegistry.update(projectId, (record) => ({
      ...record,
      offline: true,
    })))!;
    const journal: RelocationJournal = { project, workspaces, agents: settledAgents };
    await mkdir(this.journalDirectory, { recursive: true });
    const journalPath = path.join(
      this.journalDirectory,
      `${Buffer.from(projectId).toString("hex")}.json`,
    );
    await writeJsonFileAtomic(journalPath, journal);
    try {
      for (const workspace of updatedWorkspaces) await workspaceRegistry.upsert(workspace);
      for (const agent of settledAgents) {
        const cwd = remap(agent.cwd);
        if (cwd !== agent.cwd) await agentStorage.upsert({ ...agent, cwd });
      }
      await projectRegistry.update(projectId, (record) => ({
        ...record,
        rootPath: newRoot,
        offline: true,
      }));
      await projectRegistry.update(projectId, (record) => ({ ...record, offline: false }));
      // Until the journal is removed, startup restores the original Offline records.
      await unlink(journalPath);
    } catch (error) {
      await this.rollback(journal);
      await unlink(journalPath);
      throw error;
    }
  }

  private async rollback(journal: RelocationJournal): Promise<void> {
    await this.deps.projectRegistry.upsert({ ...journal.project, offline: true });
    for (const workspace of journal.workspaces) await this.deps.workspaceRegistry.upsert(workspace);
    for (const agent of journal.agents) await this.deps.agentStorage.upsert(agent);
  }
}

function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}
