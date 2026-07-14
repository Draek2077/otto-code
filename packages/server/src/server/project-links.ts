import { promises as fs } from "node:fs";

import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "./atomic-file.js";

/**
 * A persisted, undirected link between two projects. Links are the permission
 * that lets a user open/edit a file that lives in another project (the
 * gated-multi-root feature): same project is always allowed, a linked project
 * is allowed, and an unlinked project's files are refused. Stored in canonical
 * order (`projectAId` < `projectBId`) so a pair is deduped regardless of the
 * order it was authored in, and so linking is idempotent.
 */
const PersistedProjectLinkSchema = z.object({
  projectAId: z.string(),
  projectBId: z.string(),
  createdAt: z.string(),
});

export type PersistedProjectLink = z.infer<typeof PersistedProjectLinkSchema>;

export interface ProjectLinkStore {
  initialize(): Promise<void>;
  /** Every stored link, canonical order. Callers filter by liveness. */
  list(): Promise<PersistedProjectLink[]>;
  /** The ids of every project linked to `projectId`. */
  listLinkedProjectIds(projectId: string): Promise<string[]>;
  areLinked(projectId: string, otherProjectId: string): Promise<boolean>;
  /** Idempotent. Linking a project to itself is a no-op. */
  link(projectId: string, otherProjectId: string, createdAt: string): Promise<void>;
  unlink(projectId: string, otherProjectId: string): Promise<void>;
  /** Cascade: drop every link that references a removed/archived project. */
  removeAllForProject(projectId: string): Promise<void>;
}

/** An inert store for contexts without project persistence (tests, noop hosts). */
export function createNoopProjectLinkStore(): ProjectLinkStore {
  return {
    initialize: async () => {},
    list: async () => [],
    listLinkedProjectIds: async () => [],
    areLinked: async () => false,
    link: async () => {},
    unlink: async () => {},
    removeAllForProject: async () => {},
  };
}

/** Canonical, order-independent key for a pair of project ids. */
function orderPair(a: string, b: string): { projectAId: string; projectBId: string } {
  return a <= b ? { projectAId: a, projectBId: b } : { projectAId: b, projectBId: a };
}

function pairKey(a: string, b: string): string {
  const ordered = orderPair(a, b);
  // Collision-free encoding of the ordered pair. Project ids for local
  // projects are raw filesystem paths, which routinely contain spaces, so a
  // plain space-join would let different pairs collide (e.g. ["Alice","Bob C"]
  // vs ["Alice B","C"]). JSON.stringify unambiguously delimits the two ids.
  // In-memory only — never persisted or sent over the wire.
  return JSON.stringify([ordered.projectAId, ordered.projectBId]);
}

export class FileBackedProjectLinkStore implements ProjectLinkStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private loaded = false;
  private readonly cache = new Map<string, PersistedProjectLink>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger.child({ module: "project-links" });
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async list(): Promise<PersistedProjectLink[]> {
    await this.load();
    return Array.from(this.cache.values());
  }

  async listLinkedProjectIds(projectId: string): Promise<string[]> {
    await this.load();
    const linked: string[] = [];
    for (const link of this.cache.values()) {
      if (link.projectAId === projectId) {
        linked.push(link.projectBId);
      } else if (link.projectBId === projectId) {
        linked.push(link.projectAId);
      }
    }
    return linked;
  }

  async areLinked(projectId: string, otherProjectId: string): Promise<boolean> {
    if (projectId === otherProjectId) {
      return false;
    }
    await this.load();
    return this.cache.has(pairKey(projectId, otherProjectId));
  }

  async link(projectId: string, otherProjectId: string, createdAt: string): Promise<void> {
    if (projectId === otherProjectId) {
      return;
    }
    await this.load();
    const key = pairKey(projectId, otherProjectId);
    if (this.cache.has(key)) {
      return;
    }
    this.cache.set(key, { ...orderPair(projectId, otherProjectId), createdAt });
    await this.enqueuePersist();
  }

  async unlink(projectId: string, otherProjectId: string): Promise<void> {
    await this.load();
    if (this.cache.delete(pairKey(projectId, otherProjectId))) {
      await this.enqueuePersist();
    }
  }

  async removeAllForProject(projectId: string): Promise<void> {
    await this.load();
    let changed = false;
    for (const [key, link] of this.cache) {
      if (link.projectAId === projectId || link.projectBId === projectId) {
        this.cache.delete(key);
        changed = true;
      }
    }
    if (changed) {
      await this.enqueuePersist();
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.cache.clear();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = z.array(PersistedProjectLinkSchema).parse(JSON.parse(raw));
      for (const record of parsed) {
        // Re-canonicalize on load in case a hand-edited file stored reversed pairs.
        const ordered = orderPair(record.projectAId, record.projectBId);
        if (ordered.projectAId === ordered.projectBId) {
          continue;
        }
        this.cache.set(pairKey(ordered.projectAId, ordered.projectBId), {
          ...ordered,
          createdAt: record.createdAt,
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.error(
          { err: error, filePath: this.filePath },
          "Failed to load project-links file",
        );
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.filePath, Array.from(this.cache.values()));
  }

  private async enqueuePersist(): Promise<void> {
    const nextPersist = this.persistQueue.then(() => this.persist());
    this.persistQueue = nextPersist.catch(() => {});
    await nextPersist;
  }
}
