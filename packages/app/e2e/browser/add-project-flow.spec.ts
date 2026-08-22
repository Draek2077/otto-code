import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "../support/fixtures";
import { expectNewWorkspaceForAddedProject } from "../support/helpers/add-project-flow";
import { gotoAppShell } from "../support/helpers/app";
import { addConnectedHostAndReload, waitForConnectedHost } from "../support/helpers/hosts";
import {
  type IsolatedHostDaemon,
  startIsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { expectOpenedProject, openNewProjectPage } from "../support/helpers/project-picker-ui";
import { connectSeedClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// The New project page replaced the old command-center "Add Project" modal
// (see hooks/use-open-project-picker.ts): opening/creating/cloning a project
// all live on one page now instead of a stepped picker.

const SECONDARY_HOST_ID = "add-project-flow-secondary";
const SECONDARY_HOST_LABEL = "Secondary Host";

// Popup teardown can lag a step behind selection, so a badge picker opened
// right after another one closed can briefly leave two containers mounted.
async function selectBadgePickerOption(
  page: Page,
  testID: string,
  optionLabel: string,
): Promise<void> {
  await page.getByTestId(testID).click();
  await page.getByTestId("combobox-desktop-container").last().getByText(optionLabel).click();
}

async function expectProjectDirectory(pathname: string): Promise<void> {
  await expect.poll(async () => (await stat(pathname)).isDirectory()).toBe(true);
}

async function removeCreatedProject(
  pathname: string,
  knownProjectId: string | null,
): Promise<void> {
  const client = await connectSeedClient();
  try {
    let projectId = knownProjectId;
    if (!projectId) {
      const result = await client.addProject(pathname);
      projectId = result.project?.projectId ?? null;
    }
    if (projectId) await client.removeProject(projectId).catch(() => undefined);
  } finally {
    await client.close();
  }
}

async function expectProjectHasNoWorkspaces(projectId: string): Promise<void> {
  const client = await connectSeedClient();
  try {
    const result = await client.fetchWorkspaces({ filter: { projectId } });
    expect(result.entries).toEqual([]);
  } finally {
    await client.close();
  }
}

test.describe("New project page", () => {
  test.describe.configure({ timeout: 180_000 });

  test("opens on Open mode, hides the host picker for a single host, and offers Create and Clone", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await openNewProjectPage(page, "sidebar-add-project");

    await expect(page.getByTestId("new-project-mode")).toContainText("Open folder");
    await expect(page.getByTestId("new-project-host")).toHaveCount(0);
    await expect(page.getByTestId("new-project-folder-name-input")).toHaveCount(0);
    await expect(page.getByTestId("new-project-git-setup")).toHaveCount(0);

    await page.getByTestId("new-project-mode").click();
    const modePicker = page.getByTestId("combobox-desktop-container");
    await expect(modePicker).toBeVisible({ timeout: 30_000 });
    await expect(modePicker.getByText("Open folder", { exact: true })).toBeVisible();
    await expect(modePicker.getByText("Create folder", { exact: true })).toBeVisible();
    await expect(modePicker.getByText("Clone repository", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  // Fuzzy directory search + Open is already covered end-to-end by
  // empty-project-persists.spec.ts ("New project folder search").

  test("Clone mode accepts a pasted repository URL directly, with no repository search required", async ({
    page,
  }) => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "otto-e2e-clone-parent-"));
    try {
      await gotoAppShell(page);
      await openNewProjectPage(page, "sidebar-add-project");

      await selectBadgePickerOption(page, "new-project-mode", "Clone repository");

      await expect(page.getByTestId("new-project-blocker")).toContainText(/folder/i);
      await page.getByTestId("new-project-directory-input").fill(parentDirectory);

      const remote = "https://github.invalid/acme/manual.git";
      await page.getByTestId("new-project-clone-url-input").fill(remote);

      await expect(page.getByTestId("new-project-blocker")).toHaveCount(0);
      await expect(page.getByTestId("new-project-submit")).toBeEnabled();
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });

  test.describe("with a second connected host", () => {
    let secondaryHost: IsolatedHostDaemon;

    test.beforeAll(async () => {
      secondaryHost = await startIsolatedHostDaemon(SECONDARY_HOST_ID);
    });

    test.afterAll(async () => {
      await secondaryHost?.close();
    });

    test("Create mode with no repository setup creates a bare directory project on the selected host", async ({
      page,
    }) => {
      const parentDirectory = await mkdtemp(path.join(tmpdir(), "otto-e2e-remote-project-"));
      const directoryName = `remote-${randomUUID().slice(0, 8)}`;
      const directoryPath = path.join(parentDirectory, directoryName);

      try {
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, {
          serverId: secondaryHost.serverId,
          label: SECONDARY_HOST_LABEL,
          port: secondaryHost.port,
        });
        await waitForConnectedHost(page, {
          serverId: SECONDARY_HOST_ID,
          endpoint: `localhost:${secondaryHost.port}`,
        });

        // Two hosts means "Add project" opens the shared host chooser first,
        // before the New project page itself - only a single host skips it.
        await page.getByTestId("sidebar-add-project").click();
        await expect(page.getByTestId("host-chooser")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId(`host-chooser-row-${SECONDARY_HOST_ID}`).click();
        await expect(page.getByTestId("new-project-directory-input")).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByTestId("new-project-host")).toContainText(SECONDARY_HOST_LABEL);

        await selectBadgePickerOption(page, "new-project-mode", "Create folder");
        await selectBadgePickerOption(page, "new-project-git-setup", "No repository");

        await page.getByTestId("new-project-directory-input").fill(parentDirectory);
        await page.getByTestId("new-project-folder-name-input").fill(directoryName);
        await expect(page.getByTestId("new-project-blocker")).toHaveCount(0);

        await page.getByTestId("new-project-submit").click();

        const projectId = await expectOpenedProject(page, directoryName);
        await expectNewWorkspaceForAddedProject(page, {
          serverId: SECONDARY_HOST_ID,
          projectId,
          projectName: directoryName,
          projectPath: directoryPath,
        });
        await expect(page.getByTestId("host-picker-trigger")).toContainText(SECONDARY_HOST_LABEL);
        await expectProjectDirectory(directoryPath);
      } finally {
        await rm(parentDirectory, { recursive: true, force: true });
      }
    });
  });

  test("Create mode with the default git setup creates a Project and hands off to New workspace", async ({
    page,
  }) => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "otto-e2e-new-project-"));
    const directoryName = `created-${randomUUID().slice(0, 8)}`;
    const directoryPath = path.join(parentDirectory, directoryName);
    let projectId: string | null = null;

    try {
      await gotoAppShell(page);
      await openNewProjectPage(page, "sidebar-add-project");

      await selectBadgePickerOption(page, "new-project-mode", "Create folder");
      await expect(page.getByTestId("new-project-git-setup")).toContainText("New repository");

      await page.getByTestId("new-project-directory-input").fill(parentDirectory);
      await expect(page.getByTestId("new-project-blocker")).toContainText(/folder/i);
      await page.getByTestId("new-project-folder-name-input").fill(directoryName);
      await expect(page.getByTestId("new-project-blocker")).toHaveCount(0);

      await page.getByTestId("new-project-submit").click();

      projectId = await expectOpenedProject(page, directoryName);
      await expectNewWorkspaceForAddedProject(page, {
        serverId: getServerId(),
        projectId,
        projectName: directoryName,
        projectPath: directoryPath,
      });
      await expectProjectHasNoWorkspaces(projectId);
      await expectProjectDirectory(directoryPath);
    } finally {
      await removeCreatedProject(directoryPath, projectId).catch(() => undefined);
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });
});
