import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForTabBar } from "../support/helpers/launcher";
import { moneyShot } from "../support/helpers/evidence";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { buildAssistantMarkdownScenarioPrompt } from "../support/helpers/mock-scenarios";

test("an Offline project preserves its workspace and reconnects through its base folder", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workspace = await seedWorkspace({ repoPrefix: "offline-project-", git: false });
  const moved = `${workspace.repoPath}-moved`;
  try {
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Preserved conversation",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    await workspace.client.sendAgentMessage(
      agent.id,
      buildAssistantMarkdownScenarioPrompt("This conversation survives moving the project."),
    );
    await workspace.client.waitForFinish(agent.id);
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await awaitAssistantMessage(page, "This conversation survives moving the project.");
    // Windows may briefly hold a directory handle during initial discovery.
    await expect(async () => rename(workspace.repoPath, moved)).toPass({ timeout: 10_000 });
    const panel = page.getByTestId("project-offline-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("workspace-tabs-rail").filter({ visible: true })).toHaveCount(0);
    await page.reload();
    await expect(panel).toBeVisible();
    await panel.getByTestId("project-base-folder").fill(`${moved}-missing`);
    await panel.getByTestId("project-reconnect").click();
    await expect(panel.getByText(/selected base folder is unavailable/)).toBeVisible();
    await expect(panel.getByText(/requestType=/)).toHaveCount(0);
    expect(existsSync(workspace.repoPath)).toBe(false);
    expect(existsSync(`${moved}-missing`)).toBe(false);
    await moneyShot(
      page,
      "Offline project retains its identity and shows a recoverable base-folder error",
    );
    await panel.getByTestId("project-base-folder").fill(moved);
    await panel.getByTestId("project-reconnect").click();
    await expect(panel).toHaveCount(0);
    await waitForTabBar(page);
    const chat = (await workspace.client.fetchAgents()).entries.find(
      (entry) => entry.agent.id === agent.id,
    )?.agent;
    expect(chat).toMatchObject({ id: agent.id, workspaceId: workspace.workspaceId, cwd: moved });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    await awaitAssistantMessage(page, "This conversation survives moving the project.");
    const after = await workspace.client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    expect(
      after.entries.map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        cwd: entry.workspaceDirectory,
      })),
    ).toEqual([{ id: workspace.workspaceId, projectId: workspace.projectId, cwd: moved }]);
    await page.reload();
    await waitForTabBar(page);
    await expect(panel).toHaveCount(0);
    await awaitAssistantMessage(page, "This conversation survives moving the project.");
    expect(existsSync(workspace.repoPath)).toBe(false);
    await moneyShot(
      page,
      "The same workspace loads again after reconnecting its moved project root",
    );
  } catch (error) {
    await moneyShot(page, "Reconnection failure before fixture cleanup");
    throw error;
  } finally {
    await workspace.cleanup();
    // This path is derived only from this spec's freshly allocated fixture.
    await rm(moved, { recursive: true, force: true });
  }
});
