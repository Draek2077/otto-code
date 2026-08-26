/**
 * Moving a Knowledge store between the repository and the host.
 *
 * Copy-then-remove, never rename: the two locations routinely sit on different
 * volumes, and a cross-device rename fails after the caller has already been
 * told the switch succeeded. The copy lands first and the source is only
 * cleared once every page is on disk at the destination, so an interrupted
 * move leaves the old store intact rather than a half-emptied one.
 *
 * Nothing here decides *whether* to move. A repository-to-host move stages a
 * deletion in the user's working tree, so the choice belongs to the user and
 * arrives as an explicit `movePages` flag on the RPC.
 */
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { ProjectKnowledgeStore } from "./project-knowledge-store.js";
import { HOST_STORE_MARKER_FILE, isSameKnowledgeStore } from "./project-knowledge-store.js";

export interface MoveProjectKnowledgeStoreResult {
  movedPageCount: number;
  /** True when the source held nothing to carry across. */
  sourceWasEmpty: boolean;
}

/**
 * Carries every page from one store to the other. Returns the number of
 * Markdown pages moved, which is what the UI reports back to the user.
 */
export async function moveProjectKnowledgeStore(input: {
  from: ProjectKnowledgeStore;
  to: ProjectKnowledgeStore;
  logger: Logger;
}): Promise<MoveProjectKnowledgeStoreResult> {
  const { from, to, logger } = input;
  if (isSameKnowledgeStore(from, to)) return { movedPageCount: 0, sourceWasEmpty: false };

  const entries = await collectStoreFiles(from.base);
  if (entries.length === 0) return { movedPageCount: 0, sourceWasEmpty: true };

  await mkdir(to.base, { recursive: true });
  for (const relative of entries) {
    const source = path.join(from.base, relative);
    const destination = path.join(to.base, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    // Read-then-write rather than copyFile: pages are small Markdown and this
    // keeps the operation identical on every platform, including across the
    // WSL boundary where copyFile's permission semantics differ.
    await writeFile(destination, await readFile(source), { flag: "w" });
  }

  // Only now is the destination complete. Clearing the source before this point
  // would turn an interrupted move into data loss.
  await removeSource(from, logger);

  return {
    movedPageCount: entries.filter((relative) => relative.toLowerCase().endsWith(".md")).length,
    sourceWasEmpty: false,
  };
}

/**
 * Whether a store holds anything worth moving. Drives the confirmation prompt,
 * so it must not count the host store's own marker file as content.
 */
export async function storeHasPages(store: ProjectKnowledgeStore): Promise<boolean> {
  const entries = await collectStoreFiles(store.base);
  return entries.some((relative) => relative.toLowerCase().endsWith(".md"));
}

/**
 * Every file under a store, store-relative, excluding the host marker. The
 * marker names the store, not its contents, and the destination writes its own.
 */
async function collectStoreFiles(base: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (relative === HOST_STORE_MARKER_FILE) continue;
      found.push(relative);
    }
  }
  await walk(base, "");
  return found;
}

/**
 * Clears the source store. A repository source loses its whole `.otto`
 * directory, which is the entire point of moving host-local: the working tree
 * ends up with no Otto files in it. A host source is removed outright.
 */
async function removeSource(from: ProjectKnowledgeStore, logger: Logger): Promise<void> {
  try {
    await rm(from.base, { recursive: true, force: true });
  } catch (error) {
    // The destination already holds every page, so the move succeeded from the
    // user's point of view. A leftover source directory is untidy, not wrong,
    // and failing here would report a successful move as an error.
    logger.warn(
      { err: error, base: from.base },
      "Moved project knowledge but failed to remove the old store",
    );
    return;
  }
  await removeEmptyParent(from);
}

/**
 * A removed host store leaves `$OTTO_HOME/project-knowledge` behind. Drop it
 * once it holds no other store, so a host that never uses the feature again is
 * left exactly as it started. Repository stores need none of this: removing
 * `.otto` already leaves the working tree clean.
 */
async function removeEmptyParent(from: ProjectKnowledgeStore): Promise<void> {
  if (from.location !== "host") return;
  const parent = path.dirname(from.base);
  try {
    const remaining = await readdir(parent);
    if (remaining.length === 0) await rm(parent, { recursive: false, force: true });
  } catch {
    // Best effort: an occupied or missing parent is not an error.
  }
}

/** Whether a store directory exists at all. */
export async function storeExists(store: ProjectKnowledgeStore): Promise<boolean> {
  try {
    await stat(store.base);
    return true;
  } catch {
    return false;
  }
}
