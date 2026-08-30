import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Logger } from "pino";

import { deriveKnowledgeDirectoryName } from "../agent/project-knowledge/project-knowledge-store.js";

/** The two durable locations every project-owned category may select. */
export type CategoryStorageLocation = "repository" | "host";

/** The common project identity slice needed by category-owned storage. */
export interface CategoryStorageProjectRecord {
  projectId: string;
  rootPath: string;
  displayName: string;
  customName: string | null;
  projectKey: string | null;
}

/**
 * A resolved store deliberately contains no daemon-private path on the wire.
 * `storeKey` is the stable, location-qualified identity that durable records
 * carry; `baseDirectory` remains server-local plumbing.
 */
export interface ResolvedCategoryStorage {
  category: string;
  location: CategoryStorageLocation;
  projectRoot: string;
  projectId: string | null;
  projectKey: string | null;
  storeKey: string;
  /** Read-only compatibility keys, never written into new provenance. */
  legacyStoreKeys: string[];
  baseDirectory: string;
  hostId: string | null;
  hostName: string | null;
}

export interface CategoryStorageResolverDeps<TProject extends CategoryStorageProjectRecord> {
  category: string;
  repositoryDirectory: string;
  hostRootDirectory: string;
  ottoHome: string;
  hostId: string;
  hostName: string;
  findProjectByRoot: (rootPath: string) => Promise<TProject | null>;
  projectLocation: (project: TProject) => CategoryStorageLocation | null;
  projectDirectoryName: (project: TProject) => string | null;
  persistDirectoryName: (input: { projectId: string; directoryName: string }) => Promise<void>;
  defaultLocation: () => CategoryStorageLocation;
  logger: Logger;
}

/**
 * The one resolver policy for project-owned categories. A category supplies
 * its own settings fields and directory names, but never its own precedence or
 * host-key allocation logic.
 */
export class CategoryStorageResolver<TProject extends CategoryStorageProjectRecord> {
  private readonly allocations = new Map<string, Promise<string>>();

  constructor(private readonly deps: CategoryStorageResolverDeps<TProject>) {}

  async resolveForProjectRoot(projectRoot: string): Promise<ResolvedCategoryStorage> {
    const root = path.resolve(projectRoot);
    const project = await this.findProject(root);
    const override = project ? this.deps.projectLocation(project) : null;
    if (override === "repository") return this.repositoryStore(root, project);
    if (override === "host") return this.hostStore(root, project);
    if (await this.repositoryStoreExists(root)) return this.repositoryStore(root, project);
    return this.defaultLocation() === "host"
      ? this.hostStore(root, project)
      : this.repositoryStore(root, project);
  }

  async storeAtLocation(
    projectRoot: string,
    location: CategoryStorageLocation,
  ): Promise<ResolvedCategoryStorage> {
    const root = path.resolve(projectRoot);
    const project = await this.findProject(root);
    return location === "repository"
      ? this.repositoryStore(root, project)
      : this.hostStore(root, project);
  }

  private repositoryStore(projectRoot: string, project: TProject | null): ResolvedCategoryStorage {
    const baseDirectory = path.join(projectRoot, ".otto", this.deps.repositoryDirectory);
    return this.makeResolved({ projectRoot, project, location: "repository", baseDirectory });
  }

  private async hostStore(
    projectRoot: string,
    project: TProject | null,
  ): Promise<ResolvedCategoryStorage> {
    const directoryName = await this.directoryNameFor(projectRoot, project);
    const baseDirectory = path.join(this.deps.ottoHome, this.deps.hostRootDirectory, directoryName);
    return this.makeResolved({ projectRoot, project, location: "host", baseDirectory });
  }

  private makeResolved(input: {
    projectRoot: string;
    project: TProject | null;
    location: CategoryStorageLocation;
    baseDirectory: string;
  }): ResolvedCategoryStorage {
    return {
      category: this.deps.category,
      location: input.location,
      projectRoot: input.projectRoot,
      projectId: input.project?.projectId ?? null,
      projectKey: input.project?.projectKey ?? null,
      // A durable record may be addressed across process restarts and hosts.
      // It must never carry this daemon's private absolute filesystem path.
      storeKey: `${this.deps.category}:${input.location}:${this.projectScopeKey(input.projectRoot, input.project)}`,
      // The first 0.9 foundation used an absolute path here. Keep accepting it
      // as a locator while old records age out, but never emit it again.
      legacyStoreKeys: [
        `${this.deps.category}:${input.location}:${path.resolve(input.baseDirectory)}`,
      ],
      baseDirectory: input.baseDirectory,
      hostId: input.location === "host" ? this.deps.hostId : null,
      hostName: input.location === "host" ? this.deps.hostName : null,
    };
  }

  private projectScopeKey(projectRoot: string, project: TProject | null): string {
    if (project?.projectKey) return `key:${project.projectKey}`;
    if (project?.projectId) return `id:${project.projectId}`;
    // Unregistered projects still need a stable opaque scope. A one-way digest
    // keeps the local root out of storage provenance and command addressing.
    return `root:${createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 24)}`;
  }

  private async directoryNameFor(root: string, project: TProject | null): Promise<string> {
    const current = await this.findProject(root);
    if (current && this.deps.projectDirectoryName(current)) {
      return this.deps.projectDirectoryName(current)!;
    }
    if (project && this.deps.projectDirectoryName(project)) {
      return this.deps.projectDirectoryName(project)!;
    }
    const pending = this.allocations.get(root);
    if (pending) return pending;
    const allocation = this.allocateDirectoryName(root, current ?? project).finally(() => {
      this.allocations.delete(root);
    });
    this.allocations.set(root, allocation);
    return allocation;
  }

  private async allocateDirectoryName(root: string, project: TProject | null): Promise<string> {
    const directoryName = deriveKnowledgeDirectoryName({
      displayName: project?.customName ?? project?.displayName ?? path.basename(root),
      projectKey: project?.projectKey ?? null,
      rootPath: root,
    });
    if (!project) return directoryName;
    try {
      await this.deps.persistDirectoryName({ projectId: project.projectId, directoryName });
    } catch (error) {
      // The derived name is deterministic. Preserve availability and log the
      // repairable metadata write instead of treating existing data as missing.
      this.deps.logger.warn(
        { err: error, category: this.deps.category, projectId: project.projectId, directoryName },
        "Failed to persist category storage directory name",
      );
    }
    return directoryName;
  }

  private async findProject(rootPath: string): Promise<TProject | null> {
    try {
      return await this.deps.findProjectByRoot(rootPath);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, category: this.deps.category, rootPath },
        "Failed to resolve category storage project",
      );
      return null;
    }
  }

  private defaultLocation(): CategoryStorageLocation {
    try {
      return this.deps.defaultLocation();
    } catch {
      return "repository";
    }
  }

  private async repositoryStoreExists(projectRoot: string): Promise<boolean> {
    try {
      await stat(path.join(projectRoot, ".otto", this.deps.repositoryDirectory));
      return true;
    } catch {
      return false;
    }
  }
}
