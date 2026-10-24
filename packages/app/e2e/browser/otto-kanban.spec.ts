import { test, expect, openKanban } from "../support/helpers/otto-kanban";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

for (const compact of [false, true]) {
  test(`Kanban menu, project settings, retained drafts and conflict recovery (${compact ? "compact" : "wide"})`, async ({
    page,
    kanban,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await gotoAppShell(page);
    if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
    await page
      .locator(
        `[data-testid="sidebar-workspace-row-${getServerId()}:${kanban.project.workspaceId}"]:visible`,
      )
      .first()
      .click();
    await openKanban(page, compact);
    const empty = `No board is configured for ${kanban.project.projectDisplayName}.`;
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Project Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/hosts\/[^/]+\/projects\//);
    const form = page.getByTestId("kanban-project-settings");
    await expect(form).toBeVisible();
    await form
      .getByRole("switch", { name: "Configure a board for this project", exact: true })
      .click();
    const boardInput = form.getByRole("textbox", { name: "Board number or URL", exact: true });
    const boardUrl = "https://github.com/orgs/otto-fixture/projects/42";
    await boardInput.fill(boardUrl);

    // Browser Back exercises the actual route departure; no reload or synthetic UI state.
    await page.goBack();
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Project Settings", exact: true }).click();
    await expect(boardInput).toHaveValue(boardUrl);
    await kanban.write({ adapter: "github", boardId: "70", boardOwner: "otto-fixture" });
    const save = form.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(
      form.getByText("Project Settings changed. Reload before saving.", { exact: true }),
    ).toBeVisible();
    await expect(boardInput).toHaveValue(boardUrl);
    await expect(save).toBeDisabled();

    const reload = form.getByRole("button", { name: "Reload saved settings", exact: true });
    await reload.click();
    await form.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(boardInput).toHaveValue(boardUrl);
    await reload.click();
    await form.getByRole("button", { name: "Discard and reload", exact: true }).click();
    await expect(boardInput).toHaveValue("70");
    await boardInput.fill(boardUrl);
    await save.click();
    await expect(form.getByText("Board settings saved", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await kanban.read()).target)
      .toEqual({
        adapter: "github",
        boardId: "42",
        boardOwner: "otto-fixture",
      });
    await page.screenshot({ path: testInfo.outputPath("kanban-project-settings.png") });

    // Clear before revisiting the board: this journey tests configuration, not vendor traffic.
    await form
      .getByRole("switch", { name: "Configure a board for this project", exact: true })
      .click();
    await save.click();
    await expect.poll(async () => (await kanban.read()).target).toBeNull();
    await page.goBack();
    await expect(page.getByText(empty, { exact: true })).toBeVisible();
  });
}
