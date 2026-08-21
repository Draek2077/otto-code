import { test, expect } from "../support/fixtures";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { gotoWorkspace } from "../support/helpers/launcher";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithCrossWorkspaceSubagent,
} from "../support/helpers/subagents";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// Upstream's Model B assumed two visible workspaces could back the SAME
// directory, and five of this file's tests minted a same-cwd sibling through
// `workspace.create` to prove per-workspace isolation. Otto retired that:
// `createLocalCheckoutWorkspace` now refuses a second visible workspace on an
// occupied directory (`workspace_directory_occupied`, see
// docs/workspace-lifecycle.md and workspace-same-cwd-isolation.e2e.test.ts), so
// those tests assert a capability the product no longer has and were removed
// rather than left guaranteed-red. Only schedule runs bypass the guard, and they
// have their own coverage.
//
// The cross-workspace subagent case survives: it never needed a shared
// directory, and nothing else covers a subagent that lands in a workspace other
// than its parent's.
type WorkspaceIndicator = "attention" | "done" | "failed" | "loading" | "needs_input" | "running";

async function expectWorkspaceRowHasOnlyIndicator(
  page: import("@playwright/test").Page,
  input: { rowTestId: string; indicator: WorkspaceIndicator },
) {
  const row = page.getByTestId(input.rowTestId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  for (const indicator of [
    "attention",
    "done",
    "failed",
    "loading",
    "needs_input",
    "running",
  ] satisfies WorkspaceIndicator[]) {
    const locator = row.locator(`[data-testid="workspace-status-indicator-${indicator}"]`);
    if (indicator === input.indicator) {
      await expect(locator).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(locator).toHaveCount(0);
    }
  }
}

test.describe("Workspace model regressions", () => {
  test.describe.configure({ timeout: 240_000 });

  test("cross-workspace subagent opens in its workspace and keeps its parent relationship", async ({
    page,
  }) => {
    const serverId = getServerId();
    const seeded = await seedWorkspace({ repoPrefix: "workspace-cross-subagent-" });

    try {
      const agents = await seedParentWithCrossWorkspaceSubagent(seeded, {
        parentTitle: "Parent agent",
        childTitle: "Cross-workspace subagent",
      });

      await gotoWorkspace(page, agents.child.workspaceId);
      await waitForSidebarHydration(page);
      await expectWorkspaceTabVisible(page, agents.child.id);

      const parentRowTestId = `sidebar-workspace-row-${serverId}:${agents.parent.workspaceId}`;
      const childRowTestId = `sidebar-workspace-row-${serverId}:${agents.child.workspaceId}`;
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: childRowTestId,
        indicator: "running",
      });
      await expectWorkspaceRowHasOnlyIndicator(page, {
        rowTestId: parentRowTestId,
        indicator: "done",
      });

      await gotoWorkspace(page, agents.parent.workspaceId);
      await openSubagentsTrack(page);
      await expectSubagentRowVisible(page, agents.child.id);
    } finally {
      await seeded.cleanup();
    }
  });
});
