import path from "node:path";
import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectWorkspaceHeader } from "../support/helpers/workspace-ui";
import { getServerId } from "../support/helpers/server-id";
import { escapeRegex } from "../support/helpers/regex";

const GITHUB_REMOTE_URL = "https://github.com/test-owner/test-repo.git";

function getWorkspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

// Tab alignment defaults to Vertical on a fresh install, so the workspace tab
// strip is the rail, not the horizontal row. Match either, the way
// helpers/workspace-tabs.ts does.
function workspaceTabsStrip(page: import("@playwright/test").Page) {
  return page.getByTestId("workspace-tabs-row").or(page.getByTestId("workspace-tabs-rail"));
}

async function openWorkspaceFromSidebar(
  page: import("@playwright/test").Page,
  workspaceId: string,
) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
  return row;
}

async function waitForSidebarProject(page: import("@playwright/test").Page, projectName: string) {
  const row = page
    .getByRole("button", {
      name: new RegExp(escapeRegex(projectName), "i"),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function waitForSidebarWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const row = page.getByTestId(getWorkspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openWorkspaceHoverCard(page: import("@playwright/test").Page, workspaceId: string) {
  const row = await waitForSidebarWorkspace(page, workspaceId);
  await row.hover();

  const hoverCard = page.getByRole("menu", { name: "Workspace scripts" });
  await expect(hoverCard).toBeVisible({ timeout: 30_000 });
  return hoverCard;
}

interface OttoOwnedWorktree {
  projectName: string;
  workspaceId: string;
  worktreeSlug: string;
}

async function withOttoOwnedWorktree(
  run: (workspace: OttoOwnedWorktree) => Promise<void>,
): Promise<void> {
  const project = await seedWorkspace({ repoPrefix: "sidebar-hover-owned-worktree-" });
  const worktreeSlug = "hover-card-owned-worktree";

  try {
    const created = await project.client.createWorkspace({
      source: {
        kind: "worktree",
        cwd: project.repoPath,
        projectId: project.projectId,
        worktreeSlug,
      },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? "Failed to create Otto-owned worktree");
    }
    expect(path.basename(created.workspace.workspaceDirectory)).toBe(worktreeSlug);

    await run({
      projectName: path.basename(project.repoPath),
      workspaceId: created.workspace.id,
      worktreeSlug,
    });
  } finally {
    await project.cleanup();
  }
}

test.describe("Sidebar workspace list", () => {
  test("project with GitHub remote shows its selected folder name in sidebar", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-remote-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);

      const projectRow = page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: projectName })
        .first();

      await expect(projectRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).not.toContainText("test-owner/test-repo");
    } finally {
      await workspace.cleanup();
    }
  });

  test("project shows workspace under it", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-workspace-under-project-" });

    try {
      await gotoAppShell(page);

      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await waitForSidebarWorkspace(page, workspace.workspaceId);
    } finally {
      await workspace.cleanup();
    }
  });

  test("non-git project shows directory name", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-directory-", git: false });

    try {
      await gotoAppShell(page);

      const directoryName = path.basename(workspace.repoPath);
      const projectRow = await waitForSidebarProject(page, directoryName);
      await expect(projectRow).toContainText(directoryName);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace header uses the selected folder name instead of its GitHub remote", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "sidebar-header-",
      repo: { withRemote: true, originUrl: GITHUB_REMOTE_URL },
    });

    try {
      const projectName = path.basename(workspace.repoPath);
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await waitForSidebarWorkspace(page, workspace.workspaceId);
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await expectWorkspaceHeader(page, {
        title: workspace.workspaceName,
        subtitle: projectName,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("git project shows branch name in workspace row", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-branch-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      expect(workspace.workspaceName).toBe("main");
      await expect(await waitForSidebarWorkspace(page, workspace.workspaceId)).toContainText(
        "main",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace hover card shows host as metadata", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-hover-host-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));

      const hoverCard = await openWorkspaceHoverCard(page, workspace.workspaceId);
      await expect(page.getByTestId("hover-card-workspace-host")).toHaveText("localhost");
      await expect(hoverCard).not.toContainText(/\b(Online|Connecting|Offline|Error|Idle)\b/);
    } finally {
      await workspace.cleanup();
    }
  });

  test("Otto-owned worktree hover card shows the worktree directory name", async ({ page }) => {
    await withOttoOwnedWorktree(async ({ projectName, workspaceId, worktreeSlug }) => {
      await gotoAppShell(page);
      await waitForSidebarProject(page, projectName);
      await openWorkspaceHoverCard(page, workspaceId);

      await expect(page.getByTestId("hover-card-workspace-cwd")).toHaveText(worktreeSlug);
    });
  });
});

test.describe("Mobile sidebar panelState transition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("showMobileAgent open and close transition", async ({ page }) => {
    await gotoAppShell(page);
    await expectMobileAgentSidebarHidden(page);
    await openMobileAgentSidebar(page);
    await expectMobileAgentSidebarVisible(page);
    await closeMobileAgentSidebar(page);
    await expectMobileAgentSidebarHidden(page);
  });
});

test.describe("Half-screen desktop layout", () => {
  test.use({ viewport: { width: 751, height: 982 } });

  test("keeps the pinned sidebar at half of a 14-inch Mac display", async ({ page }) => {
    await gotoAppShell(page);
    await expect(page.getByTestId("sidebar-command-center-search")).toBeVisible();
    await expect(page.getByTestId("agent-list-backdrop")).not.toBeVisible();
  });

  test("keeps the left toggle center-owned without left window controls", async ({ page }) => {
    await gotoAppShell(page);

    const openToggle = page.getByTestId("menu-button");
    const openBounds = await openToggle.boundingBox();
    expect(openBounds).not.toBeNull();
    expect(openBounds?.x).toBeGreaterThan(12);

    await openToggle.click();
    await expect(page.getByTestId("sidebar-command-center-search")).not.toBeVisible();

    const closedToggle = page.getByTestId("menu-button");
    const closedBounds = await closedToggle.boundingBox();
    expect(closedBounds).not.toBeNull();
    expect(closedBounds?.x).toBeCloseTo(12, 0);
    expect(closedBounds?.y).toBe(openBounds?.y);
  });

  test("yields app navigation to the settings split", async ({ page }) => {
    await gotoAppShell(page);
    await page.locator('[data-testid="sidebar-settings"]:visible').first().click();

    await expect(page.getByTestId("settings-sidebar")).toBeVisible();
    await expect(page.getByTestId("settings-detail-pane")).toBeVisible();
    // Probe a control the app sidebar alone owns. `sidebar-settings` is not one:
    // the Settings screen renders the same shared SidebarFooterNavRow in its own
    // footer, so a visible `sidebar-settings` survives precisely because app
    // navigation yielded, which is the opposite of what this asserts.
    await expect(page.getByTestId("sidebar-command-center-search")).not.toBeVisible();
  });

  test("yields app navigation to the Explorer", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-half-screen-explorer-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarProject(page, path.basename(workspace.repoPath));
      await openWorkspaceFromSidebar(page, workspace.workspaceId);

      await page.getByTestId("workspace-explorer-toggle").first().click();
      await expect(
        page.getByTestId("explorer-tab-files").filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(page.getByTestId("workspace-explorer-toggle").first()).toBeVisible();
      await expect(page.getByTestId("explorer-close")).toBeVisible();
      await expect(page.getByTestId("sidebar-command-center-search")).not.toBeVisible();

      const centerBounds = await workspaceTabsStrip(page).first().boundingBox();
      const headerGlyphBounds = await page.getByTestId("menu-button").boundingBox();
      const tabGlyphBounds = await page
        .locator('[data-testid^="workspace-tab-"]')
        .first()
        .locator("svg")
        .first()
        .boundingBox();
      expect(centerBounds).not.toBeNull();
      expect(headerGlyphBounds).not.toBeNull();
      expect(tabGlyphBounds).not.toBeNull();
      expect((headerGlyphBounds?.x ?? 0) - (centerBounds?.x ?? 0)).toBeCloseTo(
        (tabGlyphBounds?.x ?? 0) - (centerBounds?.x ?? 0),
        0,
      );

      await expect
        .poll(async () => (await workspaceTabsStrip(page).first().boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(400);

      await page.getByTestId("explorer-close").click();
      await expect(page.getByTestId("explorer-tab-files")).not.toBeVisible();
      await expect(page.getByTestId("workspace-explorer-toggle").first()).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
