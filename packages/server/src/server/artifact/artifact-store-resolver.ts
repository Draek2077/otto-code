/** Resolves where a project's artifacts live. */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  deriveKnowledgeDirectoryName,
  type ProjectKnowledgeStoreLocation,
} from "../agent/project-knowledge/project-knowledge-store.js";

export const HOST_ARTIFACT_STORE_ROOT_DIRECTORY = "project-artifacts";

export interface ArtifactStoreLocation {
  location: ProjectKnowledgeStoreLocation;
  projectRoot: string;
  artifactsDirectory: string;
}

/** Minimal project record needed to resolve the independent Artifacts choice. */
export interface ArtifactStoreProjectRecord {
  projectId: string;
  rootPath: string;
  displayName: string;
  customName: string | null;
  projectKey: string | null;
  artifactLocation: ProjectKnowledgeStoreLocation | null;
  artifactDirectoryName: string | null;
  // Pre-0.9 host-local artifacts were filed under the Knowledge store's
  // directory name. It is consulted only to adopt such a directory when one
  // already exists; new allocations derive their own name.
  knowledgeDirectoryName?: string | null;
}

export interface ArtifactStoreResolverDeps {
  ottoHome: string;
  findProjectByRoot: (projectRoot: string) => Promise<ArtifactStoreProjectRecord | null>;
  persistDirectoryName: (input: { projectId: string; directoryName: string }) => Promise<void>;
  defaultLocation: () => ProjectKnowledgeStoreLocation;
  logger: Logger;
}

export interface StoreAtLocationOptions {
  /**
   * Whether resolving a host store may allocate and persist the project's
   * host directory name. Read-only callers (listing both locations, locating
   * an artifact by id) pass false so that merely looking at a project never
   * writes to the project registry.
   */
  persist?: boolean;
}

/**
 * Shares Knowledge's precedence safeguards, but never its selected location:
 * project Artifact override, existing repository Artifact store, then the
 * host-wide Artifact default.
 */
export class ArtifactStoreResolver {
  private readonly allocations = new Map<string, Promise<string>>();

  constructor(private readonly deps: ArtifactStoreResolverDeps) {}

  async resolveForProjectRoot(projectRoot: string): Promise<ArtifactStoreLocation> {
    const root = path.resolve(projectRoot);
    const project = await this.findProject(root);
    if (project?.artifactLocation === "repository") return this.repositoryStore(root);
    if (project?.artifactLocation === "host") return this.hostStore(root, project, true);
    if (await repositoryArtifactStoreExists(root)) return this.repositoryStore(root);
    return this.defaultLocation() === "host"
      ? this.hostStore(root, project, true)
      : this.repositoryStore(root);
  }

  /** Resolves an explicit location without changing the project's selection. */
  async storeAtLocation(
    projectRoot: string,
    location: ProjectKnowledgeStoreLocation,
    options?: StoreAtLocationOptions,
  ): Promise<ArtifactStoreLocation> {
    const root = path.resolve(projectRoot);
    if (location === "repository") return this.repositoryStore(root);
    return this.hostStore(root, await this.findProject(root), options?.persist ?? true);
  }

  private repositoryStore(projectRoot: string): ArtifactStoreLocation {
    return {
      location: "repository",
      projectRoot,
      artifactsDirectory: path.join(projectRoot, ".otto", "artifacts"),
    };
  }

  private async hostStore(
    projectRoot: string,
    project: ArtifactStoreProjectRecord | null,
    persist: boolean,
  ): Promise<ArtifactStoreLocation> {
    return {
      location: "host",
      projectRoot,
      artifactsDirectory: this.hostDirectory(
        await this.directoryNameFor(projectRoot, project, persist),
      ),
    };
  }

  private hostDirectory(directoryName: string): string {
    return path.join(this.deps.ottoHome, HOST_ARTIFACT_STORE_ROOT_DIRECTORY, directoryName);
  }

  private async directoryNameFor(
    root: string,
    project: ArtifactStoreProjectRecord | null,
    persist: boolean,
  ): Promise<string> {
    if (project?.artifactDirectoryName) return project.artifactDirectoryName;
    if (!persist) return this.deriveDirectoryName(root, project);
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
    project: ArtifactStoreProjectRecord | null,
  ): Promise<string> {
    const current = await this.findProject(root);
    if (current?.artifactDirectoryName) return current.artifactDirectoryName;
    const currentProject = current ?? project;
    const directoryName = await this.deriveDirectoryName(root, currentProject);
    if (currentProject) {
      try {
        await this.deps.persistDirectoryName({
          projectId: currentProject.projectId,
          directoryName,
        });
      } catch (error) {
        this.deps.logger.warn(
          { err: error, projectId: currentProject.projectId, directoryName },
          "Failed to persist artifact store directory name",
        );
      }
    }
    return directoryName;
  }

  /**
   * The name a project's host store would use if nothing has been persisted
   * yet. A directory left by a pre-0.9 daemon (which filed host artifacts
   * under the Knowledge directory name, collision suffix included) wins, so
   * upgrading never strands artifacts under a name nobody looks in anymore.
   */
  private async deriveDirectoryName(
    root: string,
    project: ArtifactStoreProjectRecord | null,
  ): Promise<string> {
    const inherited = project?.knowledgeDirectoryName;
    if (inherited && (await directoryExists(this.hostDirectory(inherited)))) return inherited;
    return deriveKnowledgeDirectoryName({
      displayName: project?.customName ?? project?.displayName ?? path.basename(root),
      projectKey: project?.projectKey ?? null,
      rootPath: root,
    });
  }

  private async findProject(rootPath: string): Promise<ArtifactStoreProjectRecord | null> {
    try {
      return await this.deps.findProjectByRoot(rootPath);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, rootPath },
        "Failed to resolve project for artifact store",
      );
      return null;
    }
  }

  private defaultLocation(): ProjectKnowledgeStoreLocation {
    try {
      return this.deps.defaultLocation();
    } catch {
      return "repository";
    }
  }
}

/**
 * A repository store only outranks the host default when it holds at least
 * one artifact record. Every pre-0.9 daemon created an empty
 * `.otto/artifacts` in each project it ever listed, and an empty directory
 * must not silently pin a project to the repository after the user picks
 * "host" as the default.
 */
async function repositoryArtifactStoreExists(projectRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(path.join(projectRoot, ".otto", "artifacts"));
    return entries.some((entry) => entry.endsWith(".json"));
  } catch {
    return false;
  }
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}
