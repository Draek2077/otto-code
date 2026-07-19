import { expect, test } from "./fixtures";
import { restartTestDaemon } from "./helpers/daemon-restart";
import { openAgentRoute } from "./helpers/mock-agent";
import { connectSeedClient, seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { waitForWorkspaceInSidebar } from "./helpers/workspace-ui";

/**
 * Post-restart cleanup: the pre-restart seed client died with the daemon, so
 * reconnect fresh, archive the probe agent, and remove the project record.
 */
async function cleanupReconnectDaemonState(agentId: string, projectId: string): Promise<void> {
  const client = await connectSeedClient().catch(() => null);
  if (!client) {
    return;
  }
  await client.archiveAgent(agentId).catch(() => undefined);
  await client.removeProject(projectId).catch(() => undefined);
  await client.close().catch(() => undefined);
}

// Kill/restart the isolated E2E daemon mid-session and assert the app surfaces
// its disconnected state, then recovers once the daemon is back. The agent
// panel shows a sticky "Reconnecting..." toast (testID
// "agent-reconnecting-toast", see packages/app/src/panels/agent-panel.tsx)
// whenever the host connection leaves "online", and dismisses it on reconnect.
// helpers/daemon-restart.ts preserves the global-setup environment (same
// OTTO_HOME, same port, speech/local-model settings disabled), so the restart
// does not change the tested surface. The restart promise is always awaited —
// even when the outage assertion fails — so later specs get a live daemon.
test.describe("Daemon reconnect", () => {
  test.describe.configure({ retries: 0, timeout: 240_000 });

  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("shows the reconnecting state during a daemon outage and recovers after restart", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "daemon-reconnect-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const agentTitle = `Reconnect probe ${Date.now()}`;
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: agentTitle,
      modeId: "load-test",
      model: "ten-second-stream",
    });
    cleanupTasks.push(() => cleanupReconnectDaemonState(agent.id, workspace.projectId));

    // Baseline: agent open, composer live, workspace listed.
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
    const composer = page.getByRole("textbox", { name: "Message agent..." });
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });

    // The node-side seed connection must not hold the daemon's attention across
    // the bounce; the browser client is the one under test.
    await workspace.client.close().catch(() => undefined);

    // Bounce the daemon. restartTestDaemon() SIGTERMs the supervisor, waits for
    // the port to free, and respawns — the outage window is where the app must
    // show its disconnected state.
    const reconnectingToast = page.getByTestId("agent-reconnecting-toast");
    const restartPromise = restartTestDaemon();
    try {
      await expect(reconnectingToast).toBeVisible({ timeout: 30_000 });
    } finally {
      // Always restore the daemon, even if the outage assertion failed —
      // otherwise every later spec inherits a dead daemon.
      await restartPromise;
    }

    // Recovery: the client reconnects on its own; the sticky toast dismisses,
    // and the agent surface comes back (composer editable, workspace listed).
    await expect(reconnectingToast).toHaveCount(0, { timeout: 120_000 });
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(composer).toBeEditable({ timeout: 60_000 });
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
  });
});
