import { test, expect } from "../../app/e2e/support/fixtures";
import { gotoAppShell } from "../../app/e2e/support/helpers/app";
import {
  expectOpenedProject,
  openExistingProjectFolder,
  openNewProjectPage,
} from "../../app/e2e/support/helpers/project-picker-ui";
import { getServerId } from "../../app/e2e/support/helpers/server-id";
import { installDesktopRuntime, waitForDirectoryDialog } from "./support/runtime";

// Otto replaced the Add Project overlay with the New project page, so these
// drive that surface rather than upstream's modal. The behaviours pinned are the
// same three: Browse fills the field, a cancelled dialog keeps what was typed
// and adds nothing, and an existing folder opens.
test.skip(process.env.E2E_DESKTOP_RUNTIME !== "1", "requires Metro's Electron platform overlay");

test("Browse fills the directory field with the folder the desktop dialog returned", async ({
  page,
  projectPickerFixture,
}) => {
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    dialogOpenResult: projectPickerFixture.projectPath,
  });
  await gotoAppShell(page);

  await openNewProjectPage(page, "sidebar-add-project");
  const browse = page.getByRole("button", { name: "Browse…" });
  await expect(browse).toBeVisible({ timeout: 30_000 });
  await browse.click();

  // The New project page is a form, so Browse selects the folder and stops
  // there. Submitting is the explicit Open action - the old modal opened the
  // project the instant the dialog returned.
  const input = page.getByTestId("new-project-directory-input");
  await expect(input).toHaveValue(projectPickerFixture.projectPath, { timeout: 30_000 });

  await page.getByTestId("new-project-submit").click();

  const projectId = await expectOpenedProject(page, projectPickerFixture.projectName);
  projectPickerFixture.rememberProjectId(projectId);
});

test("cancelling the Browse dialog keeps the typed path and adds nothing", async ({
  page,
  projectPickerFixture,
}) => {
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    dialogOpenResult: null,
  });
  await gotoAppShell(page);

  await openNewProjectPage(page, "sidebar-add-project");
  const input = page.getByTestId("new-project-directory-input");
  await input.fill(projectPickerFixture.projectPath);

  const browse = page.getByRole("button", { name: "Browse…" });
  await expect(browse).toBeVisible({ timeout: 30_000 });
  await browse.click();

  const dialogOptions = await waitForDirectoryDialog(page);
  // createDirectory lets the user make the folder from inside the picker, so a
  // brand-new project does not have to be created out-of-band first.
  expect(dialogOptions).toEqual({
    directory: true,
    multiple: false,
    createDirectory: true,
  });
  // A cancelled dialog must not wipe what the user already typed, and must not
  // open anything by itself.
  await expect(input).toHaveValue(projectPickerFixture.projectPath);
  await expect(
    page
      .locator('[data-testid^="sidebar-project-row-"]')
      .filter({ hasText: projectPickerFixture.projectName }),
  ).toHaveCount(0);
});

test("the New project page opens an existing folder", async ({ page, projectPickerFixture }) => {
  await installDesktopRuntime(page, {
    serverId: getServerId(),
    manageBuiltInDaemon: false,
    dialogOpenResult: null,
  });
  await gotoAppShell(page);

  await openNewProjectPage(page, "sidebar-add-project");
  await openExistingProjectFolder(page, projectPickerFixture.projectPath);

  const projectId = await expectOpenedProject(page, projectPickerFixture.projectName);
  projectPickerFixture.rememberProjectId(projectId);
});
