import type { OpenInSidePanePreferences, PullRequestOpenLocation } from "@/hooks/use-settings";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import {
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  usesCompactExplorerSidebar,
  type ExplorerSidebarView,
} from "@/workspace-tabs/explorer-sidebar";
import {
  openPreferredWorkspaceTarget,
  openWorkspaceTargetBeside,
} from "@/workspace-tabs/open-beside";
import { DEFAULT_PANE_ID, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

interface WorkspaceViewInput {
  isCompact: boolean;
  workspaceKey: string | null;
  checkout: ExplorerCheckoutContext | null;
  supportsPaneSplits?: boolean;
}

interface OpenWorkspaceChangesInput extends WorkspaceViewInput {
  preferences: OpenInSidePanePreferences;
}

interface OpenWorkspacePullRequestInput extends WorkspaceViewInput {
  destination: PullRequestOpenLocation;
}

function openExplorerView(input: WorkspaceViewInput, view: ExplorerSidebarView): void {
  openExplorerSidebarView({ ...input, view });
}

/** Opens the workspace Changes view according to the current layout and diff preference. */
export function openWorkspaceChanges(input: OpenWorkspaceChangesInput): string | null {
  if (usesCompactExplorerSidebar(input)) {
    openExplorerView(input, "changes");
    return null;
  }
  return openPreferredWorkspaceTarget({
    isCompact: input.isCompact,
    workspaceKey: input.workspaceKey,
    target: { kind: "working_diff" },
    source: "chatFiles",
    preferences: input.preferences,
  });
}

/** Reveals Changes from the composer, then opens its diff on a subsequent desktop action. */
export function openComposerChanges(input: OpenWorkspaceChangesInput): string | null {
  if (usesCompactExplorerSidebar(input) || isExplorerSidebarOpen(input)) {
    return openWorkspaceChanges(input);
  }
  openExplorerView(input, "changes");
  return null;
}

/** Opens the workspace pull request at its semantic destination. */
export function openWorkspacePullRequest(input: OpenWorkspacePullRequestInput): string | null {
  if (usesCompactExplorerSidebar(input) || input.destination === "explorer") {
    openExplorerView(input, "pr");
    return null;
  }
  if (!input.workspaceKey) return null;
  if (input.destination === "side") {
    return openWorkspaceTargetBeside({
      workspaceKey: input.workspaceKey,
      target: { kind: "pull_request" },
    });
  }
  // Explorer seeds a PR tab even before the reader opens it. The explicit
  // destination setting must place that singleton, not merely reveal its seed.
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: input.workspaceKey,
    target: { kind: "pull_request" },
    intent: "reveal",
    placement: { mode: "pane", paneId: DEFAULT_PANE_ID },
  });
}
