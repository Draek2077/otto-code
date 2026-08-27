/**
 * Resolves where a project's artifacts live.
 *
 * Artifact ownership deliberately follows the established Project Knowledge
 * ownership policy. That gives every project one answer to "does Otto write
 * durable project data into this checkout or keep it on this host?" while
 * preserving separate roots for knowledge and artifact files.
 */
import path from "node:path";
import type {
  ProjectKnowledgeStore,
  ProjectKnowledgeStoreLocation,
} from "../agent/project-knowledge/project-knowledge-store.js";

export const HOST_ARTIFACT_STORE_ROOT_DIRECTORY = "project-artifacts";

export interface ArtifactStoreLocation {
  location: ProjectKnowledgeStoreLocation;
  projectRoot: string;
  artifactsDirectory: string;
}

export interface ArtifactStoreResolverDeps {
  ottoHome: string;
  /** Resolves the ownership policy and stable host-project identity. */
  resolveKnowledgeStore: (projectRoot: string) => Promise<ProjectKnowledgeStore>;
}

export class ArtifactStoreResolver {
  constructor(private readonly deps: ArtifactStoreResolverDeps) {}

  async resolveForProjectRoot(projectRoot: string): Promise<ArtifactStoreLocation> {
    const root = path.resolve(projectRoot);
    const knowledgeStore = await this.deps.resolveKnowledgeStore(root);
    if (knowledgeStore.location === "repository") {
      return {
        location: "repository",
        projectRoot: root,
        artifactsDirectory: path.join(root, ".otto", "artifacts"),
      };
    }

    // The Project Knowledge resolver allocates and persists this directory
    // segment from the project identity. Reusing it prevents a project rename,
    // worktree, or second clone from appearing to lose host-local artifacts.
    const directoryName = path.basename(knowledgeStore.base);
    return {
      location: "host",
      projectRoot: root,
      artifactsDirectory: path.join(
        this.deps.ottoHome,
        HOST_ARTIFACT_STORE_ROOT_DIRECTORY,
        directoryName,
      ),
    };
  }
}
