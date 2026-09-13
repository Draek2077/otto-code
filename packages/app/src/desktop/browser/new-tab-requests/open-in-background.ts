import { createWorkspaceBrowser } from "../store";
import { ensureResidentBrowserWebview } from "../resident-webviews";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/** A page-created tab must not replace the editor the user still owns. */
export function openBrowserRequestInBackground(input: {
  serverId: string;
  workspaceId: string;
  url: string;
}): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (!workspaceKey) return;
  const { browserId, url } = createWorkspaceBrowser({ initialUrl: input.url });
  useWorkspaceLayoutStore
    .getState()
    .openTabInBackground(workspaceKey, { kind: "browser", browserId });
  // Register even though no pane presents the new tab yet, so browser tools can
  // immediately discover and interact with it without focusing it first.
  ensureResidentBrowserWebview({ ...input, browserId, url });
}
