import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  asScheduleSeedClient,
  createSchedule,
  deleteScheduleById,
  latestRun,
} from "./helpers/schedules";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { waitForSidebarHydration, waitForWorkspaceInSidebar } from "./helpers/workspace-ui";

// Schedule runs execute in a workspace created hidden (withheld from clients),
// so a healthy run never flashes into the sidebar; the daemon reveals the
// workspace only on error (or finish-and-keep). See ScheduleService
// (packages/server/src/server/schedule/service.ts): createScheduleRunWorkspace
// passes hidden:true and disposeScheduleRunWorkspace archives on success +
// archiveOnFinish, reveals on error. The failing run is seeded fully
// deterministically with the mock provider by binding a personality name that
// does not exist — the workspace is created first, then personality resolution
// hard-fails the run, which reveals the hidden workspace.
test.describe("Schedule hidden runs promote on error", () => {
  test.describe.configure({ retries: 0, timeout: 120_000 });

  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("keeps a healthy schedule run's workspace out of the sidebar and reveals a failing run's workspace", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "schedule-hidden-runs-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const schedules = asScheduleSeedClient(workspace.client);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });

    // ── Healthy path: the run's workspace stays hidden start to finish ──────
    const healthyId = await createSchedule(schedules, {
      prompt: "Say hello from the healthy scheduled run.",
      name: `Hidden healthy ${Date.now()}`,
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: {
        type: "new-agent",
        config: {
          provider: "mock",
          cwd: workspace.repoPath,
          model: "ten-second-stream",
          modeId: "load-test",
          archiveOnFinish: true,
          isolation: "local",
          title: "Hidden healthy run",
        },
      },
      runOnCreate: false,
    });
    cleanupTasks.push(() => deleteScheduleById(schedules, healthyId));

    // Fire the run and, while the mock agent streams (~10s), grab the hidden
    // workspace id the daemon recorded for the in-flight run.
    const healthyRunPromise = schedules.scheduleRunOnce({ id: healthyId });
    let healthyRunWorkspaceId = "";
    await expect
      .poll(
        async () => {
          const inspected = await schedules.scheduleInspect({ id: healthyId });
          const run = inspected.schedule?.runs.at(-1);
          healthyRunWorkspaceId = run?.workspaceId ?? "";
          return healthyRunWorkspaceId.length > 0;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // Mid-run: the hidden workspace must not have a sidebar row.
    const healthyRunRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${healthyRunWorkspaceId}`,
    );
    await expect(healthyRunRow).toHaveCount(0);

    const healthyResult = await healthyRunPromise;
    if (!healthyResult.schedule) {
      throw new Error(healthyResult.error ?? "schedule/run-once returned no schedule");
    }
    expect(latestRun(healthyResult.schedule).status).toBe("succeeded");

    // After success + archiveOnFinish the workspace was archived without ever
    // being revealed — still no sidebar row.
    await page.waitForTimeout(1_000);
    await expect(healthyRunRow).toHaveCount(0);
    // The user's own workspace row is untouched throughout.
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${workspace.workspaceId}`),
    ).toBeVisible();

    // ── Error path: the failing run's workspace is revealed ─────────────────
    const failingId = await createSchedule(schedules, {
      prompt: "This scheduled run is expected to fail.",
      name: `Hidden failing ${Date.now()}`,
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: {
        type: "new-agent",
        config: {
          provider: "mock",
          cwd: workspace.repoPath,
          model: "ten-second-stream",
          modeId: "load-test",
          // Personality resolution runs after the hidden workspace is created
          // and hard-fails the run when the name is unknown — the deterministic
          // error trigger for the reveal path. archiveOnFinish stays true to
          // prove error overrides archive.
          personality: "E2E Missing Personality",
          archiveOnFinish: true,
          isolation: "local",
          title: "Hidden failing run",
        },
      },
      runOnCreate: false,
    });
    cleanupTasks.push(() => deleteScheduleById(schedules, failingId));

    const failingResult = await schedules.scheduleRunOnce({ id: failingId });
    if (!failingResult.schedule) {
      throw new Error(failingResult.error ?? "schedule/run-once returned no schedule");
    }
    const failingRun = latestRun(failingResult.schedule);
    expect(failingRun.status).toBe("failed");
    expect(failingRun.error ?? "").toContain("not found");
    const failingRunWorkspaceId = failingRun.workspaceId ?? "";
    expect(failingRunWorkspaceId.length).toBeGreaterThan(0);

    // The reveal emits a workspace_update, so the row surfaces live in the
    // sidebar without a reload.
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${failingRunWorkspaceId}`),
    ).toBeVisible({ timeout: 30_000 });
  });
});
