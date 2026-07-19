import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  asScheduleSeedClient,
  deleteScheduleByName,
  selectScheduleModelByLabel,
  type ScheduleSeedClient,
} from "./helpers/schedules";
import { seedWorkspace } from "./helpers/seed-client";
import { expectSettled, expectStableHeight } from "./helpers/settled";
import { waitForSidebarHydration } from "./helpers/workspace-ui";
import { buildSchedulesRoute } from "../src/utils/host-routes";

async function scheduleExists(client: ScheduleSeedClient, scheduleId: string): Promise<boolean> {
  const list = await client.scheduleList();
  return list.schedules.some((candidate) => candidate.id === scheduleId);
}

// Full create -> list -> delete round trip through the schedule form UI, using
// the mock provider ("Ten second stream") so no real agent CLI is involved.
// Complements schedules-project-target.spec.ts, which covers project-picker
// mechanics: this spec asserts the created schedule's list card renders the
// entered fields and that the card's kebab delete removes it end to end.
test.describe("Schedule create flow", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("creates a schedule through the form, lists it with the entered fields, then deletes it", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-create-flow-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const schedules = asScheduleSeedClient(workspace.client);
    const scheduleName = `Create flow ${Date.now()}`;
    cleanupTasks.push(() => deleteScheduleByName(schedules, scheduleName));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());

    // Per-spec cleanup keeps the daemon schedule store empty, so the screen
    // starts on the empty state and its "Create a schedule" affordance.
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);

    // Project target.
    await page.getByRole("button", { name: /select project/i }).click();
    await page.getByTestId(`schedule-project-option-${workspace.projectId}`).click();
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(projectTrigger).toContainText(workspace.projectDisplayName);
    await expectSettled(projectTrigger);

    // Provider + model ride the combined model picker; "Ten second stream" is
    // the mock provider's fast model, under the "Mock Load Test" provider group.
    await selectScheduleModelByLabel(page, "Mock Load Test", "Ten second stream");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    await expect(modelTrigger).toContainText("Ten second stream");
    await expectSettled(modelTrigger);

    // Cadence: the Daily 9:00 preset writes a cron expression.
    await page.getByTestId("schedule-cadence-preset-trigger").click();
    await page.getByTestId("schedule-cadence-preset-daily-9").click();
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
    await expect(page.getByTestId("cadence-cron-expression")).toHaveValue("0 9 * * *");

    await page.getByLabel("Schedule name").fill(scheduleName);
    await page.getByLabel("Prompt").fill("Summarize the repository state.");
    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(formSheet).toHaveCount(0, { timeout: 30_000 });

    // The daemon recorded exactly what the form entered.
    const list = await schedules.scheduleList();
    const created = list.schedules.find((candidate) => candidate.name === scheduleName);
    expect(created).toEqual(
      expect.objectContaining({
        name: scheduleName,
        cadence: expect.objectContaining({ type: "cron", expression: "0 9 * * *" }),
        target: expect.objectContaining({
          type: "new-agent",
          config: expect.objectContaining({
            provider: "mock",
            model: "ten-second-stream",
            cwd: workspace.repoPath,
          }),
        }),
      }),
    );
    if (!created) {
      throw new Error(`Expected schedule named ${scheduleName} to exist`);
    }

    // The list card shows the entered fields: name, project, humanized cadence
    // ("Daily at 09:00 <tz>" via describeCron), and the Active state badge.
    const card = page.getByTestId(`schedule-card-${created.id}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(scheduleName);
    await expect(card).toContainText(workspace.projectDisplayName);
    await expect(card).toContainText(/Daily at 09:00/);
    await expect(card).toContainText("Active");
    await expect(card).toContainText("Never run");

    // Delete from the card's kebab menu, confirming the destructive dialog.
    await page.getByTestId(`schedule-kebab-${created.id}`).click();
    await page.getByTestId(`schedule-menu-delete-${created.id}`).click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();

    // Gone from the UI (back to the empty state) and from the daemon.
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("schedules-empty")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => scheduleExists(schedules, created.id), { timeout: 15_000 }).toBe(false);
  });
});
