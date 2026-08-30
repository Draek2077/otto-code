import path from "node:path";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { ArtifactStore } from "./artifact-store.js";
import type { ArtifactStoreLocation, ArtifactStoreResolver } from "./artifact-store-resolver.js";

export interface ResolvedArtifactStore {
  store: ArtifactStore;
  location: ArtifactStoreLocation;
}

export interface ArtifactStoreRegistryDeps {
  resolver: ArtifactStoreResolver;
  resolveProjectRoot: (cwd: string) => Promise<string>;
  listProjectRoots: () => Promise<string[]>;
  /** The pre-0.9 daemon-wide bucket. It remains read-compatible until migration is explicit. */
  legacyArtifactsDirectory: string;
}

export class ArtifactStoreRegistry {
  private readonly stores = new Map<string, ArtifactStore>();
  // artifactId -> the store it was last read from; see find().
  private readonly storeIndex = new Map<string, ResolvedArtifactStore>();

  constructor(private readonly deps: ArtifactStoreRegistryDeps) {}

  async resolveForProject(projectId: string): Promise<ResolvedArtifactStore> {
    const root = await this.deps.resolveProjectRoot(projectId);
    const location = await this.deps.resolver.resolveForProjectRoot(root);
    return { location, store: this.storeAt(location.artifactsDirectory) };
  }

  /** Resolve a specific destination without changing the project preference. */
  async resolveForProjectAtLocation(
    projectId: string,
    location: ArtifactStoreLocation["location"],
  ): Promise<ResolvedArtifactStore> {
    const root = await this.deps.resolveProjectRoot(projectId);
    const resolved = await this.deps.resolver.storeAtLocation(root, location);
    return { location: resolved, store: this.storeAt(resolved.artifactsDirectory) };
  }

  /**
   * Every artifact across the project stores plus the legacy bucket. Records
   * read from a project store are stamped with that store's location when the
   * record predates the field, so clients see one typed value; legacy-bucket
   * records stay unstamped on purpose - the library labels them as legacy and
   * offers both destinations.
   */
  async list(projectId?: string): Promise<ArtifactMetadata[]> {
    const expectedRoot = projectId
      ? path.resolve(await this.deps.resolveProjectRoot(projectId))
      : null;
    const stores = expectedRoot
      ? await this.storesForRoot(expectedRoot)
      : await this.allProjectStores();
    const belongsToProject = (artifact: ArtifactMetadata): boolean =>
      expectedRoot === null || path.resolve(artifact.projectId) === expectedRoot;
    const legacyResolved = this.legacyResolvedStore();
    const [projectResults, legacy] = await Promise.all([
      Promise.all(
        stores.map(async (resolved) =>
          (await resolved.store.list()).filter(belongsToProject).map((artifact) => {
            this.storeIndex.set(artifact.id, resolved);
            return artifact.storageLocation
              ? artifact
              : Object.assign(artifact, { storageLocation: resolved.location.location });
          }),
        ),
      ),
      legacyResolved.store.list(),
    ]);
    const legacyResults = legacy.filter(belongsToProject);
    for (const artifact of legacyResults) this.storeIndex.set(artifact.id, legacyResolved);
    return [...projectResults.flat(), ...legacyResults].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  /**
   * Locate the store holding an artifact. The last store an id was seen in is
   * tried first (one record read); only a miss pays for the full fan-out over
   * every project's stores plus the legacy bucket. The index is self-healing:
   * a move or delete makes the remembered store miss, which falls through to
   * the scan and re-indexes from wherever the record now lives.
   */
  async find(artifactId: string): Promise<ResolvedArtifactStore | null> {
    const remembered = this.storeIndex.get(artifactId);
    if (remembered && (await remembered.store.get(artifactId))) return remembered;
    this.storeIndex.delete(artifactId);

    const current = await this.allProjectStores();
    const candidates = [...current, this.legacyResolvedStore()];
    const matches = (
      await Promise.all(
        candidates.map(async (candidate) =>
          (await candidate.store.get(artifactId)) ? candidate : null,
        ),
      )
    ).filter((candidate): candidate is ResolvedArtifactStore => candidate !== null);
    if (matches.length > 1) {
      throw new Error(`Artifact "${artifactId}" exists in more than one store`);
    }
    const match = matches[0] ?? null;
    if (match) this.storeIndex.set(artifactId, match);
    return match;
  }

  private async allProjectStores(): Promise<ResolvedArtifactStore[]> {
    const roots = await this.deps.listProjectRoots();
    const uniqueRoots = Array.from(new Set(roots.map((root) => path.resolve(root))));
    const resolved = await Promise.all(uniqueRoots.map((root) => this.storesForRoot(root)));
    return this.uniqueStores(resolved.flat());
  }

  /**
   * Both locations stay visible while migration is explicit. The selected store
   * receives future writes, but switching a setting can never make a prior
   * deliverable disappear from the library. Looking at the unselected location
   * is read-only: it must never allocate a host directory name for a project
   * that has not chosen host storage.
   */
  private async storesForRoot(projectRoot: string): Promise<ResolvedArtifactStore[]> {
    const selected = await this.deps.resolver.resolveForProjectRoot(projectRoot);
    const otherLocation = selected.location === "repository" ? "host" : "repository";
    const other = await this.deps.resolver.storeAtLocation(projectRoot, otherLocation, {
      persist: false,
    });
    return this.uniqueStores(
      [selected, other].map((location) => ({
        location,
        store: this.storeAt(location.artifactsDirectory),
      })),
    );
  }

  private uniqueStores(stores: ResolvedArtifactStore[]): ResolvedArtifactStore[] {
    const seen = new Set<string>();
    return stores.filter((entry) => {
      const key = path.resolve(entry.location.artifactsDirectory);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private legacyStore(): ArtifactStore {
    return this.storeAt(this.deps.legacyArtifactsDirectory);
  }

  private legacyResolvedStore(): ResolvedArtifactStore {
    const directory = path.resolve(this.deps.legacyArtifactsDirectory);
    return {
      store: this.legacyStore(),
      location: {
        location: "host",
        projectRoot: "",
        artifactsDirectory: directory,
      },
    };
  }

  private storeAt(directory: string): ArtifactStore {
    const key = path.resolve(directory);
    let store = this.stores.get(key);
    if (!store) {
      store = new ArtifactStore(key);
      this.stores.set(key, store);
    }
    return store;
  }
}
