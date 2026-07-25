import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

interface PruneMountedWorkspaceSelectionsInput {
  currentSelections: ActiveWorkspaceSelection[];
  activeSelection: ActiveWorkspaceSelection | null;
  /**
   * How many workspace trees stay mounted — the user's `mountedWorkspaceLimit`.
   * Required, and this module deliberately holds no default of its own: the
   * limit is a user setting now, and a fallback constant here would be a second
   * cap that can silently disagree with the one in Settings. Keeping the module
   * free of the settings import also keeps it pure, which is what lets it be
   * unit-tested without the app's module graph.
   */
  maxMountedWorkspaces: number;
}

interface WorkspaceDeckEntryMountInput {
  isActive: boolean;
  hasHydratedWorkspaces: boolean;
  workspaceExists: boolean;
}

export function getWorkspaceSelectionKey(selection: ActiveWorkspaceSelection): string {
  return `${selection.serverId}:${selection.workspaceId}`;
}

export function areWorkspaceSelectionsEqual(
  left: ActiveWorkspaceSelection | null,
  right: ActiveWorkspaceSelection | null,
): boolean {
  return left?.serverId === right?.serverId && left?.workspaceId === right?.workspaceId;
}

export function areWorkspaceSelectionListsEqual(
  left: ActiveWorkspaceSelection[],
  right: ActiveWorkspaceSelection[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((selection, index) =>
    areWorkspaceSelectionsEqual(selection, right[index] ?? null),
  );
}

export function pruneMountedWorkspaceSelections({
  currentSelections,
  activeSelection,
  maxMountedWorkspaces,
}: PruneMountedWorkspaceSelectionsInput): ActiveWorkspaceSelection[] {
  if (!activeSelection) {
    return currentSelections;
  }

  const maxSelections = Math.max(1, maxMountedWorkspaces);
  const nextSelections: ActiveWorkspaceSelection[] = [];
  const seenSelectionKeys = new Set<string>();

  function appendSelection(selection: ActiveWorkspaceSelection): void {
    if (nextSelections.length >= maxSelections) {
      return;
    }
    const selectionKey = getWorkspaceSelectionKey(selection);
    if (seenSelectionKeys.has(selectionKey)) {
      return;
    }
    seenSelectionKeys.add(selectionKey);
    nextSelections.push(selection);
  }

  appendSelection(activeSelection);

  for (const selection of currentSelections) {
    if (areWorkspaceSelectionsEqual(selection, activeSelection)) {
      continue;
    }
    appendSelection(selection);
  }

  return nextSelections;
}

export function orderWorkspaceSelectionsForStableRender(
  selections: ActiveWorkspaceSelection[],
): ActiveWorkspaceSelection[] {
  return [...selections].sort((left, right) =>
    getWorkspaceSelectionKey(left).localeCompare(getWorkspaceSelectionKey(right)),
  );
}

export function shouldKeepWorkspaceDeckEntryMounted({
  isActive,
  hasHydratedWorkspaces,
  workspaceExists,
}: WorkspaceDeckEntryMountInput): boolean {
  if (isActive) {
    return true;
  }
  if (!hasHydratedWorkspaces) {
    return true;
  }
  return workspaceExists;
}
