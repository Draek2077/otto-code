/**
 * Where a project's Knowledge store lives on disk.
 *
 * Two locations, one layout. A repository store is the historical one, at
 * `<projectRoot>/.otto`. A host store is the same payload under
 * `$OTTO_HOME/project-knowledge/<directory>`, so a project can use Knowledge
 * without putting a single Otto file in its working tree.
 *
 * Every path the service builds hangs off `base`, so the two locations differ
 * by exactly one string. The one thing that is *not* uniform is `pathBase`:
 * `ProjectKnowledgeRecord.path` stays relative to the project root for a
 * repository store, because that is what the app opens as a workspace-relative
 * file and changing it would break every existing client. A host store has no
 * meaningful workspace-relative path, so its `path` is store-relative and the
 * wire carries `absolutePath` alongside it.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizePathForIdentity } from "../../../utils/path.js";

export type ProjectKnowledgeStoreLocation = "repository" | "host";

/** The `.otto`-equivalent directory name inside a repository store. */
export const REPOSITORY_STORE_DIRECTORY = ".otto";
/** The `$OTTO_HOME` subdirectory holding every host store. */
export const HOST_STORE_ROOT_DIRECTORY = "project-knowledge";
/** Marker written into a host store so a moved project can be reconciled. */
export const HOST_STORE_MARKER_FILE = "project.json";

export interface ProjectKnowledgeStore {
  location: ProjectKnowledgeStoreLocation;
  /** The project root this store belongs to. */
  projectRoot: string;
  /** Directory holding `KNOWLEDGE.md` and the `knowledge/` tree. */
  base: string;
  /** What `ProjectKnowledgeRecord.path` is relative to. */
  pathBase: string;
}

export interface ProjectKnowledgeStoreMarker {
  projectId: string | null;
  projectKey: string | null;
  rootPath: string;
  updatedAt: string;
}

export function repositoryKnowledgeStore(projectRoot: string): ProjectKnowledgeStore {
  const root = path.resolve(projectRoot);
  return {
    location: "repository",
    projectRoot: root,
    base: path.join(root, REPOSITORY_STORE_DIRECTORY),
    pathBase: root,
  };
}

export function hostKnowledgeStore(input: {
  projectRoot: string;
  ottoHome: string;
  directoryName: string;
}): ProjectKnowledgeStore {
  const root = path.resolve(input.projectRoot);
  const base = path.join(input.ottoHome, HOST_STORE_ROOT_DIRECTORY, input.directoryName);
  return { location: "host", projectRoot: root, base, pathBase: base };
}

/** Root of every host store. Exists so callers can enumerate or sweep them. */
export function hostKnowledgeStoreRoot(ottoHome: string): string {
  return path.join(ottoHome, HOST_STORE_ROOT_DIRECTORY);
}

/**
 * The write-queue and upgrade-cache key. `base` is unique per store and stable
 * across the two locations, which matters because the service serializes writes
 * per store and two workspaces of the same project must land in one queue.
 */
export function knowledgeStoreKey(store: ProjectKnowledgeStore): string {
  return store.base;
}

export function isSameKnowledgeStore(
  left: ProjectKnowledgeStore,
  right: ProjectKnowledgeStore,
): boolean {
  return knowledgeStoreKey(left) === knowledgeStoreKey(right);
}

/**
 * A legible, collision-resistant directory name: `otto-code-3f9a1c2b`.
 *
 * The hash is taken over the project key when there is one, so two clones of
 * the same remote on one host collapse to a single store, and over the
 * identity-normalized root path otherwise.
 *
 * **Derive once, then persist.** `deriveProjectKey` carries a standing warning
 * that re-deriving an identity duplicates the project it names, and the same
 * hazard applies here: a project whose display name changes would otherwise
 * resolve to a different directory and appear to lose its Knowledge. The
 * resolver stores the result on the project record and never recomputes it.
 */
export function deriveKnowledgeDirectoryName(input: {
  displayName: string;
  projectKey: string | null;
  rootPath: string;
  /** Disambiguates a hash collision with an unrelated existing store. */
  attempt?: number;
}): string {
  const identity = input.projectKey ?? normalizePathForIdentity(input.rootPath);
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 8);
  const slug = slugifyDirectorySegment(input.displayName) || "project";
  const suffix = input.attempt && input.attempt > 0 ? `-${input.attempt + 1}` : "";
  return `${slug}-${digest}${suffix}`;
}

/**
 * Directory-safe slug. Deliberately stricter than the page slugifier: this
 * lands on a filesystem, so reserved Windows device names and trailing dots are
 * excluded too.
 */
function slugifyDirectorySegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  if (!normalized) return "";
  return RESERVED_DIRECTORY_NAMES.has(normalized) ? `${normalized}-project` : normalized;
}

const RESERVED_DIRECTORY_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);
