import type { RefObject } from "react";
import type { ExplorerDirectory } from "@/stores/session-store";
import type { ExpandedPathsUpdate } from "@/stores/panel-store";
import { reconcileRestoredExpandedPaths, restoreExpandedDirectories } from "./tree";
import { isHiddenExplorerPath } from "./visibility";

export async function initializeExplorer({
  hasWorkspaceScope,
  hasInitializedRef,
  workspaceStateKey,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
  setExpandedPathsForWorkspace,
}: {
  hasWorkspaceScope: boolean;
  hasInitializedRef: RefObject<boolean>;
  workspaceStateKey: string | null;
  persistedExpandedPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  requestDirectoryListing: (
    path: string,
    opts?: { recordHistory?: boolean; setCurrentPath?: boolean },
  ) => Promise<ExplorerDirectory | null>;
  setExpandedPathsForWorkspace: (workspaceStateKey: string, paths: ExpandedPathsUpdate) => void;
}): Promise<void> {
  if (!hasWorkspaceScope || hasInitializedRef.current) {
    return;
  }
  hasInitializedRef.current = true;
  const rootDirectory = await requestDirectoryListing(".", {
    recordHistory: false,
    setCurrentPath: false,
  });
  if (!rootDirectory) {
    hasInitializedRef.current = false;
    return;
  }
  if (!workspaceStateKey) {
    return;
  }

  const restoredPaths = await restoreExpandedDirectories({
    rootDirectory,
    persistedExpandedPaths,
    showHiddenFiles,
    requestDirectoryListing: (path) =>
      requestDirectoryListing(path, {
        recordHistory: false,
        setCurrentPath: false,
      }),
  });
  const hiddenPersistedPaths = showHiddenFiles
    ? []
    : Array.from(persistedExpandedPaths).filter(isHiddenExplorerPath);
  const restoredPathsWithHidden = [...restoredPaths, ...hiddenPersistedPaths];
  setExpandedPathsForWorkspace(workspaceStateKey, (currentPaths) =>
    reconcileRestoredExpandedPaths({
      persistedExpandedPaths,
      currentExpandedPaths: new Set(currentPaths),
      restoredExpandedPaths: restoredPathsWithHidden,
    }),
  );
}
