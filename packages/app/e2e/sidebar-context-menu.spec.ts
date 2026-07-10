import path from "node:path";
import { test, expect } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { escapeRegex } from "./helpers/regex";

test.describe("Sidebar right-click context menus", () => {
  test("workspace row right-click opens the workspace context menu", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "ctx-menu-workspace-" });

    try {
      await gotoAppShell(page);

      const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;
      const row = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
      await expect(row).toBeVisible({ timeout: 30_000 });

      await row.click({ button: "right" });

      const menu = page.getByTestId(`sidebar-workspace-context-menu-${workspaceKey}`);
      await expect(menu).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByTestId(`sidebar-workspace-menu-archive-${workspaceKey}`),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("project row right-click opens the project context menu", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "ctx-menu-project-" });

    try {
      await gotoAppShell(page);

      const projectName = path.basename(workspace.repoPath);
      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: new RegExp(escapeRegex(projectName), "i") })
        .first();
      await expect(projectRow).toBeVisible({ timeout: 30_000 });

      await projectRow.click({ button: "right" });

      const menu = page.locator('[data-testid^="sidebar-project-context-menu-"]').first();
      await expect(menu).toBeVisible({ timeout: 5_000 });
      await expect(
        page.locator('[data-testid^="sidebar-project-menu-remove-"]').first(),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
