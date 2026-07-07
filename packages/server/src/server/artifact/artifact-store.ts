import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactMetadataSchema } from "@otto-code/protocol/artifacts/types";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";

export type { ArtifactMetadata };
import { writeJsonFileAtomic } from "../atomic-file.js";

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

  async get(artifactId: string): Promise<ArtifactMetadata | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.metadataPath(artifactId), "utf-8");
      return ArtifactMetadataSchema.parse(JSON.parse(content));
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      throw error;
    }
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
            return ArtifactMetadataSchema.parse(JSON.parse(content));
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
    await writeJsonFileAtomic(this.metadataPath(metadata.id), metadata);
  }

  async update(artifactId: string, changes: Partial<ArtifactMetadata>): Promise<void> {
    await this.ensureDir();
    const existing = await this.get(artifactId);
    if (!existing) {
      throw new Error(`Artifact "${artifactId}" not found`);
    }
    const updated: ArtifactMetadata = {
      ...existing,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
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
