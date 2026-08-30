import path from "node:path";

import type { WorkflowStorageProvenance } from "@otto-code/protocol/orchestration";

import {
  CategoryStorageResolver,
  type ResolvedCategoryStorage,
} from "../category-storage/category-storage-resolver.js";

export const WORKFLOW_HOST_STORE_ROOT_DIRECTORY = "project-workflows";

export interface WorkflowStorageLocation extends ResolvedCategoryStorage {
  definitionsDirectory: string;
  templatesDirectory: string;
  runsDirectory: string;
}

export interface WorkflowLegacyLocations {
  runsDirectory: string;
  definitionsDirectory: string;
  templatesDirectory: string;
}

export interface WorkflowStoreRegistryDeps<TProject extends WorkflowStorageProjectRecord> {
  resolver: CategoryStorageResolver<TProject>;
  resolveProjectRoot: (cwd: string) => Promise<string>;
  /** All known project roots on this host. Used only for explicit discovery. */
  listProjectRoots?: () => Promise<string[]>;
  legacy: WorkflowLegacyLocations;
}

export interface WorkflowStorageProjectRecord {
  projectId: string;
  rootPath: string;
  displayName: string;
  customName: string | null;
  projectKey: string | null;
  workflowLocation: "repository" | "host" | null;
  workflowDirectoryName: string | null;
}

/**
 * Location and discovery boundary for future Workflow writers. It intentionally
 * does not move or replace the established daemon-global Run/Graph/template
 * stores: those remain the discoverable legacy host library until an explicit
 * transfer is built.
 */
export class WorkflowStoreRegistry<TProject extends WorkflowStorageProjectRecord> {
  constructor(private readonly deps: WorkflowStoreRegistryDeps<TProject>) {}

  async resolveForCwd(cwd: string): Promise<WorkflowStorageLocation> {
    return this.resolveForProjectRoot(await this.deps.resolveProjectRoot(cwd));
  }

  async resolveForProjectRoot(projectRoot: string): Promise<WorkflowStorageLocation> {
    return this.withLayout(await this.deps.resolver.resolveForProjectRoot(projectRoot));
  }

  async discoverForProjectRoot(projectRoot: string): Promise<{
    selected: WorkflowStorageLocation;
    alternate: WorkflowStorageLocation;
    legacy: WorkflowLegacyLocations;
  }> {
    const selected = await this.resolveForProjectRoot(projectRoot);
    const alternateLocation = selected.location === "repository" ? "host" : "repository";
    const alternate = this.withLayout(
      await this.deps.resolver.storeAtLocation(projectRoot, alternateLocation),
    );
    return { selected, alternate, legacy: this.deps.legacy };
  }

  /**
   * Both project locations remain discoverable while relocation is an explicit
   * transfer. This never consults another category's selection and never
   * allocates a host directory merely to inspect the alternate location.
   */
  async discoverAllProjectStores(): Promise<WorkflowStorageLocation[]> {
    const roots = await this.deps.listProjectRoots?.();
    if (!roots) return [];
    const discovered = await Promise.all(
      Array.from(new Set(roots.map((root) => path.resolve(root)))).map(async (root) => {
        const stores = await this.discoverForProjectRoot(root);
        return [stores.selected, stores.alternate];
      }),
    );
    const seen = new Set<string>();
    return discovered.flat().filter((store) => {
      const key = path.resolve(store.baseDirectory);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Resolve the exact durable store recorded on a Workflow, never today's default. */
  async resolveRecordedStore(input: {
    projectRoot: string;
    storeKey: string;
  }): Promise<WorkflowStorageLocation> {
    const stores = await this.discoverForProjectRoot(input.projectRoot);
    const match = [stores.selected, stores.alternate].find(
      (store) =>
        store.storeKey === input.storeKey || store.legacyStoreKeys.includes(input.storeKey),
    );
    if (!match) {
      throw new Error(
        "The Workflow's recorded storage location is unavailable. Reconnect its host or use an explicit verified transfer; Otto will not write it somewhere else.",
      );
    }
    return match;
  }

  provenanceFor(location: WorkflowStorageLocation): WorkflowStorageProvenance {
    return {
      schemaVersion: 1,
      projectRoot: location.projectRoot,
      ...(location.projectId ? { projectId: location.projectId } : {}),
      ...(location.projectKey ? { projectKey: location.projectKey } : {}),
      location: location.location,
      storeKey: location.storeKey,
      ...(location.hostId ? { hostId: location.hostId } : {}),
      ...(location.hostName ? { hostName: location.hostName } : {}),
      source: "project-store",
    };
  }

  legacyProvenanceFor(projectRoot?: string): WorkflowStorageProvenance {
    return {
      schemaVersion: 1,
      ...(projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}),
      location: "host",
      storeKey: "workflows:legacy-host-library",
      source: "legacy-host-library",
    };
  }

  private withLayout(location: ResolvedCategoryStorage): WorkflowStorageLocation {
    return {
      ...location,
      definitionsDirectory: path.join(location.baseDirectory, "definitions"),
      templatesDirectory: path.join(location.baseDirectory, "templates"),
      runsDirectory: path.join(location.baseDirectory, "runs"),
    };
  }
}
