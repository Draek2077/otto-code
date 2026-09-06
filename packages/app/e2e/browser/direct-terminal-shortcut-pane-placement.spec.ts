import { expect, test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { gotoWorkspace, pressDirectNewTabShortcut } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

test.describe("Direct terminal shortcut pane placement", () => {
  test("opens a terminal in the focused pane", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "direct-terminal-shortcut-pane-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const originalPane = page
        .locator('[data-testid^="workspace-pane-"]')
        .filter({ visible: true })
        .first();
      const originalPaneId = await originalPane.getAttribute("data-testid");
      expect(originalPaneId).not.toBeNull();

      await runWorkspaceActionFromCommandCenter(page, "Split pane right");
      // Splitting now seeds a draft. Identify the newly created pane by its
      // identity, independently of whichever initial surface it contains.
      const focusedPane = page
        .locator('[data-testid^="workspace-pane-"]')
        .filter({ visible: true })
        .and(page.locator(`[data-testid]:not([data-testid="${originalPaneId}"])`));
      await expect(focusedPane).toHaveCount(1);

      await pressDirectNewTabShortcut(page, "t");

      await expect(focusedPane.locator('[data-testid^="workspace-tab-terminal_"]')).toHaveCount(1, {
        timeout: 30_000,
      });
      await expect(
        page.getByTestId(originalPaneId!).locator('[data-testid^="workspace-tab-terminal_"]'),
      ).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });
});
