import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test } from "./fixtures";
import { createIdleAgent, openWorkspaceWithAgents } from "./helpers/archive-tab";
import { waitForTabBar, expectAgentTabActive } from "./helpers/launcher";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";

// Settings has no keyboard shortcut of its own (Mod+, opens the file finder),
// so the round trip is the sidebar button in and the back button out — the same
// `navigateToLastWorkspace` path the old Mod+, toggle took.
async function openSettingsFromSidebar(page: import("@playwright/test").Page) {
  const settingsButton = page.locator('[data-testid="sidebar-settings"]:visible').first();
  await expect(settingsButton).toBeVisible({ timeout: 15_000 });
  await settingsButton.click();
}

async function backToWorkspaceFromSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-back-to-workspace").click();
}

async function expectSendBehavior(
  page: import("@playwright/test").Page,
  expected: "interrupt" | "queue",
) {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => localStorage.getItem("@otto:app-settings"));
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { sendBehavior?: string }).sendBehavior ?? null;
    })
    .toBe(expected);
}

async function openAgentRouteAndExpectFocused(input: {
  page: import("@playwright/test").Page;
  serverId: string;
  workspaceId: string;
  agentId: string;
}) {
  await input.page.goto(
    buildHostAgentDetailRoute(input.serverId, input.agentId, input.workspaceId),
  );
  await input.page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await waitForTabBar(input.page);
  await expectAgentTabActive(input.page, input.agentId);
}

test.describe("Settings toggle tab regression", () => {
  test.describe.configure({ timeout: 180_000 });

  test("toggling settings after changing a setting returns to the same workspace tab", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "settings-toggle-tab-" });

    try {
      const firstAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `settings-toggle-a-${Date.now()}`,
      });
      const secondAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `settings-toggle-b-${Date.now()}`,
      });

      await openWorkspaceWithAgents(page, [firstAgent, secondAgent]);
      await waitForTabBar(page);
      await expectAgentTabActive(page, secondAgent.id);

      await openSettingsFromSidebar(page);
      await expect(page).toHaveURL(/\/settings\/general$/);

      await page.getByRole("button", { name: "Queue", exact: true }).click();
      await expectSendBehavior(page, "queue");
      await page.getByRole("button", { name: "Interrupt", exact: true }).click();
      await expectSendBehavior(page, "interrupt");

      await backToWorkspaceFromSettings(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, workspace.workspaceId));
      await waitForTabBar(page);
      await expectAgentTabActive(page, secondAgent.id);

      await page.reload();
      await waitForTabBar(page);
      await expectAgentTabActive(page, secondAgent.id);
    } finally {
      await workspace.cleanup();
    }
  });

  test("refresh after navigating between agent routes keeps the latest agent focused", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "agent-route-refresh-" });

    try {
      const firstAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `agent-route-refresh-a-${Date.now()}`,
      });
      const secondAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `agent-route-refresh-b-${Date.now()}`,
      });

      await openAgentRouteAndExpectFocused({
        page,
        serverId,
        workspaceId: workspace.workspaceId,
        agentId: firstAgent.id,
      });
      await openAgentRouteAndExpectFocused({
        page,
        serverId,
        workspaceId: workspace.workspaceId,
        agentId: secondAgent.id,
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.reload();
        await waitForTabBar(page);
        await expectAgentTabActive(page, secondAgent.id);
      }
    } finally {
      await workspace.cleanup();
    }
  });
});
