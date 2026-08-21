import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  asScheduleSeedClient,
  createSchedule,
  deleteScheduleById,
  latestRun,
} from "../support/helpers/schedules";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  waitForSidebarHydration,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

// Schedule runs execute in a workspace created hidden (withheld from clients),
// so a healthy run never flashes into the sidebar. `disposeScheduleRunWorkspace`
// (packages/server/src/server/schedule/service.ts) decides what happens next,
// and the branch is three-way, not "archive on success / reveal on error":
//   - success + archiveOnFinish  → archive, never revealed
//   - failure WITHOUT content    → archive too (an empty shell is not worth a
//                                  sidebar row; the error surfaces on the card)
//   - success + keep, or failure WITH content → REVEAL (live workspace_update)
// A missing-personality failure is the canonical content-less failure, so it
// proves the archive branch, not the reveal branch. The reveal path is proven
// with a kept success (archiveOnFinish: false) - same reveal call, same live
// sidebar row, and deterministic under the mock provider.
//
// The runs get their OWN directory, separate from the visible seeded workspace:
// revealScheduleRunWorkspace reattaches to whatever visible workspace already
// backs the run's cwd instead of revealing a duplicate row, so running them in
// the seeded workspace's directory would make the reveal unobservable.
test.describe("Schedule hidden runs and reveal", () => {
  test.describe.configure({ retries: 0, timeout: 120_000 });

  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  // Each mock run streams ~10s, so the two paths are separate tests: three runs
  // in one test overran the 60s project budget, and raising the timeout does not
  // cover the afterEach hook (see iron-out.md "Run mechanics").
  async function setUpRunEnvironment(page: Page) {
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "schedule-hidden-runs-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const runRepo = await createTempGitRepo("schedule-run-cwd-");
    cleanupTasks.push(async () => {
      // A revealed run workspace is deliberately left live, so the daemon still
      // holds the directory (git watcher) - drop the project first, and never
      // let a Windows EBUSY on the temp dir fail an otherwise-green test.
      await workspace.client.removeProject(runRepo.path).catch(() => undefined);
      await runRepo.cleanup().catch(() => undefined);
    });
    const schedules = asScheduleSeedClient(workspace.client);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
    return { serverId, workspace, runRepo, schedules };
  }

  test("keeps a healthy run's workspace hidden and archives a content-less failure", async ({
    page,
  }) => {
    const { serverId, workspace, runRepo, schedules } = await setUpRunEnvironment(page);

    // ── Healthy path: the run's workspace stays hidden start to finish ──────
    const healthyId = await createSchedule(schedules, {
      prompt: "Say hello from the healthy scheduled run.",
      name: `Hidden healthy ${Date.now()}`,
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: {
        type: "new-agent",
        config: {
          provider: "mock",
          cwd: runRepo.path,
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
    // being revealed - still no sidebar row.
    await page.waitForTimeout(1_000);
    await expect(healthyRunRow).toHaveCount(0);
    // The user's own workspace row is untouched throughout.
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${workspace.workspaceId}`),
    ).toBeVisible();

    // ── Error path (no content): the workspace is archived, never revealed ──
    const failingId = await createSchedule(schedules, {
      prompt: "This scheduled run is expected to fail.",
      name: `Hidden failing ${Date.now()}`,
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: {
        type: "new-agent",
        config: {
          provider: "mock",
          cwd: runRepo.path,
          model: "ten-second-stream",
          modeId: "load-test",
          // Personality resolution runs after the hidden workspace is created
          // and hard-fails the run when the name is unknown - a failure that
          // never produced content, so the workspace is archived, not revealed.
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

    // The run died before producing anything, so its hidden workspace is
    // archived rather than promoted - no sidebar row ever appears.
    await page.waitForTimeout(2_000);
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${failingRunWorkspaceId}`),
    ).toHaveCount(0);
  });

  test("reveals a kept run's workspace live in the sidebar", async ({ page }) => {
    const { serverId, runRepo, schedules } = await setUpRunEnvironment(page);

    const keptId = await createSchedule(schedules, {
      prompt: "Say hello from the kept scheduled run.",
      name: `Hidden kept ${Date.now()}`,
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: {
        type: "new-agent",
        config: {
          provider: "mock",
          cwd: runRepo.path,
          model: "ten-second-stream",
          modeId: "load-test",
          // Keep the result: the run's workspace is revealed at finish so the
          // user can inspect what it produced.
          archiveOnFinish: false,
          isolation: "local",
          title: "Hidden kept run",
        },
      },
      runOnCreate: false,
    });
    cleanupTasks.push(() => deleteScheduleById(schedules, keptId));

    const keptResult = await schedules.scheduleRunOnce({ id: keptId });
    if (!keptResult.schedule) {
      throw new Error(keptResult.error ?? "schedule/run-once returned no schedule");
    }
    const keptRun = latestRun(keptResult.schedule);
    expect(keptRun.status).toBe("succeeded");
    const keptRunWorkspaceId = keptRun.workspaceId ?? "";
    expect(keptRunWorkspaceId.length).toBeGreaterThan(0);

    // The reveal emits a workspace_update, so the row surfaces live in the
    // sidebar without a reload.
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${keptRunWorkspaceId}`),
    ).toBeVisible({ timeout: 30_000 });
  });
});
