/**
 * Resolves which Knowledge store a project uses.
 *
 * Three inputs, in a fixed order of precedence:
 *
 *   1. The project's own `knowledgeLocation` override.
 *   2. A repository store that already exists on disk.
 *   3. The host-wide default from daemon config.
 *
 * Rule 2 is the one that matters in practice. It means a repository whose
 * `.otto/knowledge` is checked in keeps working even under a host-local
 * default, so flipping that default never appears to erase a teammate's
 * knowledge, and only projects that have no store yet land host-local.
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "../../atomic-file.js";
import { moveProjectKnowledgeStore } from "./project-knowledge-store-migration.js";
import {
  HOST_STORE_MARKER_FILE,
  deriveKnowledgeDirectoryName,
  hostKnowledgeStore,
  isSameKnowledgeStore,
  repositoryKnowledgeStore,
  type ProjectKnowledgeStore,
  type ProjectKnowledgeStoreLocation,
  type ProjectKnowledgeStoreMarker,
} from "./project-knowledge-store.js";

/**
 * The slice of a project record the resolver reads. Deliberately structural:
 * the registry's own type would drag the whole workspace registry into this
 * subsystem, and every field here is one the resolver genuinely needs.
 */
export interface ProjectKnowledgeProjectRecord {
  projectId: string;
  rootPath: string;
  displayName: string;
  customName: string | null;
  projectKey: string | null;
  knowledgeLocation: ProjectKnowledgeStoreLocation | null;
  knowledgeDirectoryName: string | null;
}

export interface ProjectKnowledgeStoreResolverDeps {
  ottoHome: string;
  /** Repo root for a cwd. Otto worktrees already collapse to the main root. */
  resolveProjectRoot: (cwd: string) => Promise<string>;
  /** The registered project owning a root, when there is one. */
  findProjectByRoot: (rootPath: string) => Promise<ProjectKnowledgeProjectRecord | null>;
  /** Persists a derived directory name so it is never derived twice. */
  persistDirectoryName: (input: { projectId: string; directoryName: string }) => Promise<void>;
  /** Host-wide default for projects with no override and no existing store. */
  defaultLocation: () => ProjectKnowledgeStoreLocation;
  logger: Logger;
}

export class ProjectKnowledgeStoreResolver {
  /** Serializes directory-name allocation so two concurrent resolves for one
   * project cannot each derive and persist a different name. */
  private readonly allocations = new Map<string, Promise<string>>();

  constructor(private readonly deps: ProjectKnowledgeStoreResolverDeps) {}

  async resolveForCwd(cwd: string): Promise<ProjectKnowledgeStore> {
    return this.resolveForRoot(await this.projectRoot(cwd));
  }

  async projectRoot(cwd: string): Promise<string> {
    try {
      return await this.deps.resolveProjectRoot(cwd);
    } catch {
      // Non-git workspaces are ordinary, not an error.
      return path.resolve(cwd);
    }
  }

  async resolveForRoot(projectRoot: string): Promise<ProjectKnowledgeStore> {
    const root = path.resolve(projectRoot);
    const project = await this.findProject(root);
    const override = project?.knowledgeLocation ?? null;
    if (override === "repository") return repositoryKnowledgeStore(root);
    if (override === "host") return this.hostStoreFor(root, project);
    if (await repositoryStoreExists(root)) return repositoryKnowledgeStore(root);
    if (this.defaultLocation() === "host") return this.hostStoreFor(root, project);
    return repositoryKnowledgeStore(root);
  }

  /** The store a project would use at an explicit location, ignoring precedence.
   * The migration path needs both sides of a switch before it moves anything. */
  async storeAtLocation(
    projectRoot: string,
    location: ProjectKnowledgeStoreLocation,
  ): Promise<ProjectKnowledgeStore> {
    const root = path.resolve(projectRoot);
    if (location === "repository") return repositoryKnowledgeStore(root);
    return this.hostStoreFor(root, await this.findProject(root));
  }

  /**
   * Creates the host store directory and its reconcile marker. Called before a
   * migration writes into a store, and by the service on first bootstrap.
   */
  async ensureHostStoreMarker(store: ProjectKnowledgeStore): Promise<void> {
    if (store.location !== "host") return;
    const project = await this.findProject(store.projectRoot);
    const marker: ProjectKnowledgeStoreMarker = {
      projectId: project?.projectId ?? null,
      projectKey: project?.projectKey ?? null,
      rootPath: store.projectRoot,
      updatedAt: new Date().toISOString(),
    };
    try {
      await mkdir(store.base, { recursive: true });
      await writeJsonFileAtomic(path.join(store.base, HOST_STORE_MARKER_FILE), marker);
    } catch (error) {
      // A missing marker costs reconcilability, not correctness: the store is
      // still addressed by the persisted directory name. Never fail a write for it.
      this.deps.logger.warn(
        { err: error, base: store.base },
        "Failed to write project knowledge store marker",
      );
    }
  }

  /** The host default in force right now, for UI that labels an inherited choice. */
  hostDefaultLocation(): ProjectKnowledgeStoreLocation {
    return this.defaultLocation();
  }

  /**
   * Carries a store's pages to another location. Lives here rather than on the
   * caller so the file work keeps the resolver's logger and the marker stays in
   * step with the move.
   */
  async movePages(input: {
    from: ProjectKnowledgeStore;
    to: ProjectKnowledgeStore;
  }): Promise<number> {
    if (isSameKnowledgeStore(input.from, input.to)) return 0;
    await this.ensureHostStoreMarker(input.to);
    const result = await moveProjectKnowledgeStore({ ...input, logger: this.deps.logger });
    return result.movedPageCount;
  }

  private defaultLocation(): ProjectKnowledgeStoreLocation {
    try {
      return this.deps.defaultLocation();
    } catch {
      return "repository";
    }
  }

  private async findProject(rootPath: string): Promise<ProjectKnowledgeProjectRecord | null> {
    try {
      return await this.deps.findProjectByRoot(rootPath);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, rootPath },
        "Failed to resolve project for knowledge store",
      );
      return null;
    }
  }

  private async hostStoreFor(
    root: string,
    project: ProjectKnowledgeProjectRecord | null,
  ): Promise<ProjectKnowledgeStore> {
    const directoryName = await this.directoryNameFor(root, project);
    return hostKnowledgeStore({ projectRoot: root, ottoHome: this.deps.ottoHome, directoryName });
  }

  private async directoryNameFor(
    root: string,
    project: ProjectKnowledgeProjectRecord | null,
  ): Promise<string> {
    if (project?.knowledgeDirectoryName) return project.knowledgeDirectoryName;
    const pending = this.allocations.get(root);
    if (pending) return pending;
    const allocation = this.allocateDirectoryName(root, project).finally(() => {
      this.allocations.delete(root);
    });
    this.allocations.set(root, allocation);
    return allocation;
  }

  private async allocateDirectoryName(
    root: string,
    project: ProjectKnowledgeProjectRecord | null,
  ): Promise<string> {
    // Re-read: an allocation that queued behind another one for the same
    // project must see the name that one persisted rather than derive a second.
    const current = await this.findProject(root);
    if (current?.knowledgeDirectoryName) return current.knowledgeDirectoryName;

    const displayName = current?.customName ?? current?.displayName ?? path.basename(root);
    const projectKey = current?.projectKey ?? project?.projectKey ?? null;
    let directoryName = deriveKnowledgeDirectoryName({ displayName, projectKey, rootPath: root });
    for (let attempt = 1; attempt <= MAX_DIRECTORY_NAME_ATTEMPTS; attempt += 1) {
      if (await directoryIsFreeOrOurs(this.deps.ottoHome, directoryName, root)) break;
      directoryName = deriveKnowledgeDirectoryName({
        displayName,
        projectKey,
        rootPath: root,
        attempt,
      });
    }

    const projectId = current?.projectId ?? project?.projectId ?? null;
    if (projectId) {
      try {
        await this.deps.persistDirectoryName({ projectId, directoryName });
      } catch (error) {
        // An unpersisted name still resolves this run because the derivation is
        // deterministic. It only costs stability across a project rename.
        this.deps.logger.warn(
          { err: error, projectId, directoryName },
          "Failed to persist project knowledge store directory name",
        );
      }
    }
    return directoryName;
  }
}

const MAX_DIRECTORY_NAME_ATTEMPTS = 16;

/**
 * Whether a repository store is already present. Mirrors the service's own
 * initialization check: either the generated index or a `KNOWLEDGE.md` entry
 * point counts, because a hand-authored policy file with no pages yet is still
 * a deliberate choice to keep Knowledge in the repository.
 */
export async function repositoryStoreExists(projectRoot: string): Promise<boolean> {
  const base = repositoryKnowledgeStore(projectRoot).base;
  for (const candidate of [
    path.join(base, "knowledge", "index.md"),
    path.join(base, "KNOWLEDGE.md"),
  ])
    if (await fileExists(candidate)) return true;
  return false;
}

async function directoryIsFreeOrOurs(
  ottoHome: string,
  directoryName: string,
  projectRoot: string,
): Promise<boolean> {
  const base = hostKnowledgeStore({ projectRoot, ottoHome, directoryName }).base;
  try {
    await stat(base);
  } catch {
    return true;
  }
  try {
    const raw = await readFile(path.join(base, HOST_STORE_MARKER_FILE), "utf8");
    const marker = JSON.parse(raw) as Partial<ProjectKnowledgeStoreMarker>;
    return typeof marker.rootPath === "string"
      ? path.resolve(marker.rootPath) === path.resolve(projectRoot)
      : true;
  } catch {
    // An existing directory with no readable marker predates the marker or was
    // hand-made. Treat it as ours rather than stranding a store the user can see.
    return true;
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
