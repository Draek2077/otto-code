import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { restartTestDaemon } from "./helpers/daemon-restart";
import { asRunsSeedClient, removeSeededRunFile, writeSeededRunFile } from "./helpers/runs";
import { connectSeedClient, seedWorkspace, type SeedDaemonClient } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { switchWorkspaceViaSidebar, waitForSidebarHydration } from "./helpers/workspace-ui";
import { buildRunsRoute } from "../src/utils/host-routes";

/** Clear the seeded run and project through a post-restart client, then close it. */
async function cleanupSeededRunState(client: SeedDaemonClient, projectId: string): Promise<void> {
  await asRunsSeedClient(client)
    .clearFinishedRuns()
    .catch(() => undefined);
  await client.removeProject(projectId).catch(() => undefined);
  await client.close().catch(() => undefined);
}

// The Runs ("Orchestrations") screen lists orchestration runs and offers a
// "Visualize" action that opens a run-scoped Visualizer tab in the run's
// workspace. Runs have no client-side create RPC (only the conductor `start_run`
// tool makes them), so this spec seeds one deterministically by writing a
// terminal run file into $OTTO_HOME/runs and restarting the isolated daemon —
// RunService.init reloads persisted runs on startup. The restart is safe here:
// the app E2E project runs with workers=1 and helpers/daemon-restart.ts
// preserves the global-setup environment.
test.describe("Runs screen", () => {
  test.describe.configure({ retries: 0, timeout: 240_000 });

  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("lists a seeded run with status and timing, and Visualize opens a run-scoped Visualizer tab", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "runs-screen-", git: false });
    cleanupTasks.push(() => workspace.cleanup());

    const runId = `run_e2e_${Date.now().toString(36)}`;
    const runTitle = `E2E seeded orchestration ${runId}`;
    // Terminal timestamps: createdAt -> updatedAt spans exactly 3m30s so the
    // card's frozen elapsed reads "3m 30s" (formatRunElapsed/formatDuration).
    const createdAtMs = Date.now() - 60 * 60 * 1000;
    const createdAt = new Date(createdAtMs).toISOString();
    const updatedAt = new Date(createdAtMs + 210_000).toISOString();

    await writeSeededRunFile({
      id: runId,
      title: runTitle,
      status: "done",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      agentCount: 1,
      createdAt,
      updatedAt,
      phases: [
        {
          id: "phase-implement",
          type: "implement",
          title: "Implement the change",
          task: "Make the seeded change.",
          status: "done",
          candidates: [{ agentId: "agent-e2e-run-candidate" }],
          startedAt: createdAt,
          completedAt: updatedAt,
        },
        {
          id: "phase-verify",
          type: "verify",
          title: "Verify the change",
          task: "Check the seeded change.",
          status: "done",
          startedAt: createdAt,
          completedAt: updatedAt,
        },
      ],
    });
    cleanupTasks.push(() => removeSeededRunFile(runId));

    // Bounce the isolated daemon so RunService loads the seeded run, closing
    // the seed connection first (it reconnects fresh below for cleanup).
    await workspace.client.close().catch(() => undefined);
    await restartTestDaemon();
    const client = await connectSeedClient();
    cleanupTasks.push(() => cleanupSeededRunState(client, workspace.projectId));

    // Deterministic gate: the restarted daemon serves the seeded run.
    const snapshot = await asRunsSeedClient(client).getRunsSnapshot();
    expect(snapshot.map((run) => run.id)).toContain(runId);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildRunsRoute());

    // The run card renders status, complexity, phases, and frozen timing.
    await expect(page.getByText("Orchestrations", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    const runsList = page.getByTestId("runs-list");
    await expect(runsList).toBeVisible({ timeout: 30_000 });
    await expect(runsList).toContainText(runTitle);
    await expect(runsList).toContainText("Completed");
    await expect(runsList).toContainText("2 phases");
    await expect(runsList).toContainText("1 agent");
    await expect(runsList).toContainText("Implement the change");
    await expect(runsList).toContainText("Verify the change");
    await expect(runsList).toContainText("3m 30s");

    // Visualize: opens (or focuses) the run-scoped Visualizer tab in the run's
    // workspace layout, then the workspace tab row shows it. Navigation happens
    // client-side via the sidebar so the in-memory layout store is preserved.
    const visualizeButton = page.getByTestId("run-visualize-button");
    await expect(visualizeButton).toBeVisible({ timeout: 30_000 });
    await visualizeButton.click();

    await switchWorkspaceViaSidebar({
      page,
      serverId,
      workspaceId: workspace.workspaceId,
    });
    await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
      timeout: 30_000,
    });
  });
});
