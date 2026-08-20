import type { ExplorerDirectory } from "@/stores/session-store";
import { explorerParentPath } from "@/utils/explorer-paths";
import { isHiddenExplorerPath } from "./visibility";

export interface ExpandedPathSyncPlan {
  /** Directories to list now, shallowest first. */
  request: string[];
  /** Persisted expansions that no longer exist on disk and must be forgotten. */
  prune: string[];
}

interface PlanExpandedPathSyncInput {
  directories: ReadonlyMap<string, ExplorerDirectory>;
  expandedPaths: Iterable<string>;
  showHiddenFiles: boolean;
  /** Listings already in flight, so a cascade pass does not re-request them. */
  inFlightPaths: ReadonlySet<string>;
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

/**
 * Decide, from the listings already in hand, which expanded directories to list
 * next and which to forget.
 *
 * Persisted expansion used to be replayed blind: every remembered path was
 * requested the moment the root listing landed. A folder that had since been
 * deleted (`archdocs`, say) came back as an ENOENT the pane rendered as a
 * full-pane error, and because the path stayed persisted it did so on every
 * visit, forever. So a path is only requested once its parent listing is in
 * hand and still names it as a directory; a path its loaded parent no longer
 * names is pruned instead, along with everything under it.
 *
 * A path whose parent has not loaded yet is neither requested nor pruned - it
 * is simply undecided, and the next pass (each arriving listing re-runs this)
 * decides it. That is what makes the restore cascade level by level.
 */
export function planExpandedPathSync({
  directories,
  expandedPaths,
  showHiddenFiles,
  inFlightPaths,
}: PlanExpandedPathSyncInput): ExpandedPathSyncPlan {
  const ordered = Array.from(expandedPaths)
    .filter((path) => path !== "." && path.length > 0)
    .sort((a, b) => pathDepth(a) - pathDepth(b));

  const request: string[] = [];
  const prune: string[] = [];
  const prunedPaths = new Set<string>();

  for (const path of ordered) {
    const parentPath = explorerParentPath(path);
    if (prunedPaths.has(parentPath)) {
      prune.push(path);
      prunedPaths.add(path);
      continue;
    }

    const parentDirectory = directories.get(parentPath);
    if (!parentDirectory) {
      continue;
    }

    const entry = parentDirectory.entries.find((candidate) => candidate.path === path);
    if (!entry || entry.kind !== "directory") {
      prune.push(path);
      prunedPaths.add(path);
      continue;
    }

    // Hidden directories stay persisted while hidden files are off - they exist,
    // they are just not on screen - but nothing lists them until they are shown.
    if (!showHiddenFiles && isHiddenExplorerPath(path)) {
      continue;
    }
    if (directories.has(path) || inFlightPaths.has(path)) {
      continue;
    }
    request.push(path);
  }

  return { request, prune };
}
