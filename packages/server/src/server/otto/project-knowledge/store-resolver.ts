import path from "node:path";
import { lstat } from "node:fs/promises";

export type KnowledgeLocation = "repository" | "host";

/** Supplied by the owning daemon, never inferred from the client's filesystem. */
export interface KnowledgeProject {
  projectId: string;
  rootPath: string;
  knowledgeLocation?: KnowledgeLocation | null;
  knowledgeDirectoryName?: string | null;
}

export interface KnowledgeStore {
  projectId: string;
  projectRoot: string;
  location: KnowledgeLocation;
  /** Trusted project root or host home; descendants must not be symlinks. */
  boundary: string;
  base: string;
}

export interface KnowledgeResolverPorts {
  ottoHome: string;
  resolveProject: (projectId: string) => Promise<KnowledgeProject>;
  defaultLocation: () => KnowledgeLocation;
}

export class KnowledgeStoreResolver {
  constructor(private readonly ports: KnowledgeResolverPorts) {}

  async resolve(projectId: string): Promise<KnowledgeStore> {
    const project = await this.ports.resolveProject(projectId);
    if (project.projectId !== projectId || !path.isAbsolute(project.rootPath)) {
      throw new Error("Knowledge requires a canonical project identity and absolute root");
    }
    const root = path.resolve(project.rootPath);
    const repositoryBase = path.join(root, ".otto");
    const location =
      project.knowledgeLocation ??
      ((await repositoryStoreExists(repositoryBase)) ? "repository" : this.ports.defaultLocation());
    if (location === "repository") {
      return { projectId, projectRoot: root, location, boundary: root, base: repositoryBase };
    }
    if (location !== "host") throw new Error("Unknown Knowledge store location");
    // Directory allocation/persistence belongs to the daemon project-settings adapter.
    // Refuse to derive a new identity that could strand an existing 0.9 store.
    const directory = project.knowledgeDirectoryName;
    if (!directory) throw new Error("Host Knowledge requires a persisted directory name");
    assertSafeSegment(directory);
    if (!path.isAbsolute(this.ports.ottoHome))
      throw new Error("Knowledge requires an absolute host home");
    const boundary = path.resolve(this.ports.ottoHome);
    return {
      projectId,
      projectRoot: root,
      location,
      boundary,
      base: path.join(boundary, "project-knowledge", directory),
    };
  }
}

async function repositoryStoreExists(base: string): Promise<boolean> {
  // Even an incomplete or corrupt checked-in tree is an existing store. Never
  // redirect it to a new, apparently empty host store because index.md is absent.
  for (const target of [path.join(base, "knowledge"), path.join(base, "KNOWLEDGE.md")]) {
    try {
      await lstat(target);
      return true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return false;
}

export function assertSafeSegment(value: string): void {
  if (
    !/^[a-z0-9][a-z0-9-]{0,119}$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  ) {
    throw new Error("Invalid Knowledge path segment");
  }
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
