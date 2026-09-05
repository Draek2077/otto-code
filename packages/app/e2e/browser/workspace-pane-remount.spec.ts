import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { createIdleAgent } from "../support/helpers/archive-tab";
import { expectComposerVisible } from "../support/helpers/composer";
import { clickNewTerminal, terminalSurfaceLocator } from "../support/helpers/launcher";
import { renameModalInput } from "../support/helpers/rename";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { clickSettingsBackToWorkspace, openCompactSettings } from "../support/helpers/settings";
import { openSettings } from "../support/helpers/app";
import { moneyShot } from "../support/helpers/evidence";
import {
  clickFirstTerminalTab,
  splitPaneFromCatalogMenu,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

const WIDE_VIEWPORT = { width: 1280, height: 900 };
const COMPACT_VIEWPORT = { width: 390, height: 844 };

async function captureRenderedNode(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  const node = await locator.elementHandle();
  if (!node) {
    throw new Error("Expected rendered node");
  }
  return node;
}

async function expectSameRenderedNode(
  original: Awaited<ReturnType<typeof captureRenderedNode>>,
  locator: Locator,
) {
  const current = await captureRenderedNode(locator);
  await expect(original.evaluate((node, candidate) => node === candidate, current)).resolves.toBe(
    true,
  );
}

async function expectNodeConnected(node: Awaited<ReturnType<typeof captureRenderedNode>>) {
  expect(await node.evaluate((candidate) => candidate.isConnected)).toBe(true);
}

async function getSettingsShortcut(page: Page) {
  return page.evaluate(() =>
    navigator.platform.toLowerCase().includes("mac") ? "Meta+," : "Control+,",
  );
}

async function waitForWorkspaceRoute(page: Page, route: string) {
  await page.waitForURL((url) => url.pathname === route);
}

test.describe("Workspace pane mounting", () => {
  test("workspace navigation keeps the existing agent composer mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();

    const workspace = await seedWorkspace({ repoPrefix: "pane-remount-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `pane-remount-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await page.waitForURL(
        (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
        { timeout: 60_000 },
      );
      await waitForWorkspaceTabsVisible(page);
      await expectComposerVisible(page);

      const originalComposer = await page
        .getByTestId("message-input-root")
        .filter({ visible: true })
        .first()
        .elementHandle();
      expect(originalComposer).not.toBeNull();

      // Otto moved the split controls into the tab bar's catalog menu: the inline
      // "Split pane right" button only renders when its tool is pinned.
      await splitPaneFromCatalogMenu(page, "right");
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toHaveCount(
        2,
        { timeout: 30_000 },
      );

      const originalStillConnected = await originalComposer!.evaluate((node) => node.isConnected);
      expect(originalStillConnected).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  test("opening Settings hides workspace overlays and keeps the agent composer mounted", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "settings-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `settings-pane-retention-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      // The node as it is before Settings opens. The assertion at the end of
      // the step is that Settings did not remount it.
      const originalComposer = await captureRenderedNode(composer);
      await test.step("desktop Settings closes overlays and preserves the composer", async () => {
        const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
        await tab.click({ button: "right" });
        await page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`).click();
        const renameInput = renameModalInput(page, `workspace-tab-rename-modal-agent-${agent.id}`);
        await expect(renameInput).toBeVisible();

        const settingsShortcut = await getSettingsShortcut(page);
        await page.keyboard.press(settingsShortcut);
        await expect(page).toHaveURL(/\/settings\/general$/);
        await expect(renameInput).not.toBeVisible();
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalComposer, composer);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("opening Settings on a compact layout keeps the agent composer mounted", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 480, height: 900 });
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "compact-settings-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `compact-settings-pane-retention-${Date.now()}`,
      });
      const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId);

      await page.goto(agentRoute);
      await expectComposerVisible(page);
      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      const originalComposer = await captureRenderedNode(composer);

      const workspaceRoute = buildHostWorkspaceRoute(serverId, workspace.workspaceId);
      await openCompactSettings(page, workspaceRoute);
      await page.goBack();
      await waitForWorkspaceRoute(page, workspaceRoute);
      await expectSameRenderedNode(originalComposer, composer);
    } finally {
      await workspace.cleanup();
    }
  });

  test("compact workspace keeps its header after reload and restores saved panes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const workspace = await seedWorkspace({ repoPrefix: "compact-workspace-header-" });

    try {
      await page.setViewportSize(WIDE_VIEWPORT);
      await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      await splitPaneFromCatalogMenu(page, "right");
      const visiblePanes = page
        .locator('[data-testid^="workspace-pane-"]')
        .filter({ visible: true });
      await expect(visiblePanes).toHaveCount(2);

      await page.setViewportSize(COMPACT_VIEWPORT);
      await page.reload();
      await expect(
        page.getByTestId("workspace-header-title").filter({ visible: true }),
      ).toBeVisible();
      const menuButton = page.getByRole("button", { name: "Open menu", exact: true }).first();
      await expect(menuButton).toBeVisible();
      await menuButton.click();
      await expect(page.getByTestId("sidebar-command-center-search")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.setViewportSize(WIDE_VIEWPORT);
      await expect(visiblePanes).toHaveCount(2);
      await moneyShot(
        page,
        "compact reload preserves the workspace header and restores saved panes",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace navigation keeps the terminal emulator mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "terminal-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `terminal-pane-retention-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      await clickNewTerminal(page);
      await expectTerminalSurfaceVisible(page);
      const terminalSurface = terminalSurfaceLocator(page);
      const originalTerminal = await captureRenderedNode(terminalSurface);

      await test.step("switching tabs preserves the terminal", async () => {
        await page.getByTestId(`workspace-tab-agent_${agent.id}`).click();
        await expectComposerVisible(page);
        await expectNodeConnected(originalTerminal);

        await clickFirstTerminalTab(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });

      await test.step("opening Settings preserves the terminal", async () => {
        await openSettings(page);
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });
    } finally {
      await workspace.cleanup();
    }
  });
});
