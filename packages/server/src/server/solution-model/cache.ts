import { stat } from "node:fs/promises";
import { documentKey } from "../lsp/uri.js";
import type { SolutionProjectContents, SolutionStructure } from "./provider.js";

/**
 * What the daemon remembers between requests, and how it knows the memory is still true.
 *
 * The libraries evaluate a point in time; keeping the tree honest as files change is ours. The
 * mechanism is a **freshness stamp checked on read** — mtime and size of the file the answer was
 * derived from — rather than a watcher subscription.
 *
 * That is a deliberate departure from the original plan of reusing `file-explorer/file-watcher.ts`.
 * That watcher is subscription-scoped: it watches the files a client has open in a tab. A
 * `.csproj` almost never has one, and the writer is at least as likely to be an agent, a `git
 * checkout`, or a `dotnet add package` in a terminal as it is to be the user typing. A cache keyed
 * on "did a tab tell us" would be stale in exactly the cases that matter and correct in the case
 * nobody hits. One `stat` before a request that would otherwise cost an MSBuild evaluation is not
 * a cost worth optimising away, and unlike a watcher it cannot miss a writer.
 *
 * Ordinary `.cs` edits still invalidate nothing, which is the property that makes this cheap:
 * membership is by glob, so editing a file cannot change which files are in the project. Creating
 * or deleting one can, which is why `invalidateProject` stays on the push side.
 */

/** Identity of a file's content for cache purposes. Null when it could not be read. */
type FreshnessStamp = string | null;

interface CachedStructure {
  structure: SolutionStructure;
  stamp: FreshnessStamp;
}

interface CachedProject {
  contents: SolutionProjectContents;
  stamp: FreshnessStamp;
}

interface SolutionCacheEntry {
  structure: CachedStructure;
  projects: Map<string, CachedProject>;
}

export async function freshnessStamp(path: string): Promise<FreshnessStamp> {
  try {
    const stats = await stat(path);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    // A file that cannot be stat'ed has no stamp, and a null stamp never matches a stored one, so
    // an unreadable file always re-reads rather than silently serving a stale answer.
    return null;
  }
}

export class SolutionModelCache {
  private readonly entries = new Map<string, SolutionCacheEntry>();

  /** The cached structure, if the solution file has not changed since it was read. */
  getStructure(solutionPath: string, stamp: FreshnessStamp): SolutionStructure | null {
    const entry = this.entries.get(documentKey(solutionPath));
    if (entry === undefined || stamp === null || entry.structure.stamp !== stamp) {
      return null;
    }
    return entry.structure.structure;
  }

  setStructure(structure: SolutionStructure, stamp: FreshnessStamp): void {
    // A re-read of the solution replaces its structure and drops every evaluation under it: a
    // project may have been removed, and keeping its contents cached would leave a node the tree
    // no longer contains answering as if it did.
    this.entries.set(documentKey(structure.solutionPath), {
      structure: { structure, stamp },
      projects: new Map(),
    });
  }

  getProject(
    solutionPath: string,
    projectPath: string,
    stamp: FreshnessStamp,
  ): SolutionProjectContents | null {
    const cached = this.entries
      .get(documentKey(solutionPath))
      ?.projects.get(documentKey(projectPath));
    if (cached === undefined || stamp === null || cached.stamp !== stamp) {
      return null;
    }
    return cached.contents;
  }

  setProject(solutionPath: string, contents: SolutionProjectContents, stamp: FreshnessStamp): void {
    const entry = this.entries.get(documentKey(solutionPath));
    if (entry === undefined) {
      // No structure means nothing asked for this project through the tree, so there is nothing
      // for the cached contents to hang off.
      return;
    }
    entry.projects.set(documentKey(contents.projectPath), { contents, stamp });
  }

  invalidateSolution(solutionPath: string): void {
    this.entries.delete(documentKey(solutionPath));
  }

  invalidateProject(projectPath: string): void {
    const key = documentKey(projectPath);
    for (const entry of this.entries.values()) {
      entry.projects.delete(key);
    }
  }

  /** Every solution whose cached state mentions this project. */
  solutionsContaining(projectPath: string): string[] {
    const key = documentKey(projectPath);
    const owners: string[] = [];
    for (const entry of this.entries.values()) {
      const named = entry.structure.structure.projects.some(
        (project) => documentKey(project.path) === key,
      );
      if (named || entry.projects.has(key)) {
        owners.push(entry.structure.structure.solutionPath);
      }
    }
    return owners;
  }

  /** Every solution currently cached, so a caller can decide which ones a change affects. */
  solutionPaths(): string[] {
    return [...this.entries.values()].map((entry) => entry.structure.structure.solutionPath);
  }

  invalidateWhere(predicate: (solutionPath: string) => boolean): void {
    for (const [key, entry] of Array.from(this.entries)) {
      if (predicate(entry.structure.structure.solutionPath)) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
