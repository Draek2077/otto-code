import type { SplitNode, SplitPane } from "@/stores/workspace-layout-store";

export function resolveSplitContainerRoot(input: {
  root: SplitNode;
  focusedPaneId: string | null;
  focusModeEnabled: boolean | undefined;
}): { root: SplitNode; usesFallbackStrip: boolean } {
  const isolatedPaneId = input.focusModeEnabled ? input.focusedPaneId : null;
  if (!isolatedPaneId) return { root: input.root, usesFallbackStrip: false };
  const isolatedPane = findPane(input.root, isolatedPaneId);
  if (!isolatedPane || isolatedPane.hidden === true) {
    return { root: input.root, usesFallbackStrip: Boolean(input.focusModeEnabled) };
  }
  return { root: { kind: "pane", pane: isolatedPane }, usesFallbackStrip: false };
}

/** Whether a split subtree contains the pane currently projected full-size. */
export function splitNodeContainsPane(node: SplitNode, paneId: string): boolean {
  if (node.kind === "pane") return node.pane.id === paneId;
  return node.group.children.some((child) => splitNodeContainsPane(child, paneId));
}

/** Whether a workspace pane has another visible pane it can be maximized over. */
export function hasMultipleVisiblePanes(node: SplitNode): boolean {
  let visiblePaneCount = 0;
  const visit = (current: SplitNode): void => {
    if (current.kind === "pane") {
      if (current.pane.hidden !== true) visiblePaneCount += 1;
      return;
    }
    for (const child of current.group.children) {
      visit(child);
      if (visiblePaneCount > 1) return;
    }
  };
  visit(node);
  return visiblePaneCount > 1;
}

/**
 * Resolve a pane maximize button press together with the focus change needed
 * to make that projection stable. Pane chrome buttons are deliberately exempt
 * from ambient pane-focus handling, so maximizing an unfocused pane must claim
 * focus explicitly before the focus-mismatch restore rule runs.
 */
export function resolvePaneMaximizeToggle(input: {
  maximizedPaneId: string | null;
  workspaceKey: string;
  paneId: string;
}): {
  next: { workspaceKey: string; paneId: string } | null;
  focusPaneId: string | null;
} {
  if (input.maximizedPaneId === input.paneId) {
    return { next: null, focusPaneId: null };
  }
  return {
    next: { workspaceKey: input.workspaceKey, paneId: input.paneId },
    focusPaneId: input.paneId,
  };
}

export function shouldClearMaximizedPane(input: {
  maximizedPaneId: string | null;
  focusedPaneId: string | null;
  focusModeEnabled: boolean | undefined;
  workspaceHasMultiplePanes: boolean;
  root: SplitNode | null;
}): boolean {
  const paneId = input.maximizedPaneId;
  return Boolean(
    paneId &&
    (input.focusModeEnabled ||
      input.focusedPaneId !== paneId ||
      !input.workspaceHasMultiplePanes ||
      !input.root ||
      !splitNodeContainsPane(input.root, paneId)),
  );
}

function findPane(node: SplitNode, paneId: string): SplitPane | null {
  if (node.kind === "pane") return node.pane.id === paneId ? node.pane : null;
  for (const child of node.group.children) {
    const pane = findPane(child, paneId);
    if (pane) return pane;
  }
  return null;
}
