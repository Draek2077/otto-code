import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_ARTIFACT_RUNS, StoredArtifactSchema } from "@otto-code/protocol/artifacts/types";
import type {
  ArtifactMetadata,
  ArtifactRun,
  StoredArtifact,
} from "@otto-code/protocol/artifacts/types";

export type { ArtifactMetadata };
import { writeJsonFileAtomic } from "../atomic-file.js";

// Drop the run history off a stored record to get the lean metadata that
// list/get callers (and every broadcast/notification) work with. Keeping runs
// out of that shape means they never ride the wire on routine updates — only
// inspect() surfaces them.
function toMetadata(stored: StoredArtifact): ArtifactMetadata {
  const { runs: _runs, ...metadata } = stored;
  return metadata;
}

export class ArtifactStore {
  constructor(private readonly projectCwd: string) {}

  private artifactsDir(): string {
    return join(this.projectCwd, ".otto", "artifacts");
  }

  private metadataPath(artifactId: string): string {
    return join(this.artifactsDir(), `${artifactId}.json`);
  }

  private htmlPath(artifactId: string): string {
    return join(this.artifactsDir(), `${artifactId}.html`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.artifactsDir(), { recursive: true });
  }

  // Read the full on-disk record, run history included. Everything else in the
  // store layers on top of this: get()/list() strip runs, inspect() keeps them.
  private async readStored(artifactId: string): Promise<StoredArtifact | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.metadataPath(artifactId), "utf-8");
      return StoredArtifactSchema.parse(JSON.parse(content));
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      throw error;
    }
  }

  async get(artifactId: string): Promise<ArtifactMetadata | null> {
    const stored = await this.readStored(artifactId);
    return stored ? toMetadata(stored) : null;
  }

  // Full record with run history, for inspect_artifact. Returns null when the
  // artifact doesn't exist so callers can raise their own not-found error.
  async inspect(artifactId: string): Promise<StoredArtifact | null> {
    return this.readStored(artifactId);
  }

  async list(options?: { projectId?: string }): Promise<ArtifactMetadata[]> {
    await this.ensureDir();
    const entries = await readdir(this.artifactsDir(), { withFileTypes: true });
    const results = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          try {
            const content = await readFile(join(this.artifactsDir(), entry.name), "utf-8");
            return toMetadata(StoredArtifactSchema.parse(JSON.parse(content)));
          } catch {
            return null;
          }
        }),
    );
    const valid: ArtifactMetadata[] = results.filter((m): m is ArtifactMetadata => m !== null);
    const sorted = valid.sort((a: ArtifactMetadata, b: ArtifactMetadata) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    if (options?.projectId) {
      return sorted.filter((m: ArtifactMetadata) => m.projectId === options.projectId);
    }
    return sorted;
  }

  async create(metadata: ArtifactMetadata): Promise<void> {
    await this.ensureDir();
    const stored: StoredArtifact = { ...metadata, runs: [] };
    await writeJsonFileAtomic(this.metadataPath(metadata.id), stored);
  }

  async update(artifactId: string, changes: Partial<ArtifactMetadata>): Promise<void> {
    await this.ensureDir();
    const existing = await this.readStored(artifactId);
    if (!existing) {
      throw new Error(`Artifact "${artifactId}" not found`);
    }
    const updated: StoredArtifact = {
      ...existing,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFileAtomic(this.metadataPath(artifactId), updated);
  }

  // Append a generation attempt to the run history, oldest entries pruned so the
  // on-disk log stays bounded. Does not touch updatedAt — the run's own
  // timestamps carry that, and the accompanying status update bumps it.
  async appendRun(artifactId: string, run: ArtifactRun): Promise<void> {
    await this.ensureDir();
    const existing = await this.readStored(artifactId);
    if (!existing) {
      throw new Error(`Artifact "${artifactId}" not found`);
    }
    const runs = [...existing.runs, run].slice(-MAX_ARTIFACT_RUNS);
    const updated: StoredArtifact = { ...existing, runs };
    await writeJsonFileAtomic(this.metadataPath(artifactId), updated);
  }

  // Patch the current (most recent still-"running") run — to stamp its agent id
  // once known, or to close it out as succeeded/failed. No-ops when there's no
  // running run, so completion handlers can fire unconditionally.
  async patchCurrentRun(artifactId: string, patch: Partial<ArtifactRun>): Promise<void> {
    await this.ensureDir();
    const existing = await this.readStored(artifactId);
    if (!existing) {
      return;
    }
    const index = findLastRunningIndex(existing.runs);
    if (index === -1) {
      return;
    }
    const runs = existing.runs.map((run, i) => (i === index ? { ...run, ...patch } : run));
    const updated: StoredArtifact = { ...existing, runs };
    await writeJsonFileAtomic(this.metadataPath(artifactId), updated);
  }

  async delete(artifactId: string): Promise<void> {
    await this.ensureDir();
    await rm(this.metadataPath(artifactId), { force: true });
    await rm(this.htmlPath(artifactId), { force: true });
  }

  async scanAll(projectRoots: string[]): Promise<ArtifactMetadata[]> {
    const stores = projectRoots.map((root) => new ArtifactStore(root));
    const results = await Promise.all(
      stores.map(async (store) => {
        try {
          return await store.list();
        } catch {
          return [];
        }
      }),
    );
    return results
      .flat()
      .sort((a: ArtifactMetadata, b: ArtifactMetadata) => a.createdAt.localeCompare(b.createdAt));
  }
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Index of the last run still in flight — the one a success/failure handler
// should close out. Returns -1 when nothing is running.
function findLastRunningIndex(runs: ArtifactRun[]): number {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]!.status === "running") {
      return i;
    }
  }
  return -1;
}
