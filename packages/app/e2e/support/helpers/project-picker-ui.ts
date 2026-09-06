import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { connectSeedClient } from "./seed-client";

export async function expectExistingProjectOpened(
  page: Page,
  project: { projectPath: string; projectName: string },
): Promise<string> {
  // Opening an existing folder registers it and returns to the previous page.
  // Only scaffolding a new folder hands off to New workspace.
  await expect(page).toHaveURL(/\/open-project$/u, { timeout: 30_000 });
  const row = page
    .locator('[data-testid^="sidebar-project-row-"]:visible')
    .filter({ hasText: project.projectName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  const client = await connectSeedClient();
  try {
    const registered = (await client.listProjects()).projects.find(
      (entry) => path.resolve(entry.projectRootPath) === path.resolve(project.projectPath),
    );
    expect(registered, "the selected folder is registered on the host").toBeDefined();
    return registered!.projectId;
  } finally {
    await client.close();
  }
}

export async function expectOpenedProject(page: Page, _projectName?: string): Promise<string> {
  await expect(page).toHaveURL(/\/new\?.*projectId=/u, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("projectId");
  expect(projectId).not.toBeNull();
  return projectId!;
}

// Types a path into the directory field and submits it via the page's Open
// action. Unlike the old modal there is no Enter-to-submit: the page has more
// than one field, so submitting is an explicit button press.
export async function openExistingProjectFolder(page: Page, projectPath: string): Promise<void> {
  const input = page.getByTestId("new-project-directory-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(projectPath);

  const submit = page.getByTestId("new-project-submit");
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
}

// The New project page replaced the search-only picker modal. Every "New
// project" entry point routes here; with a single host the host chooser
// resolves itself, so the page is one click away.
export async function openNewProjectPage(page: Page, trigger: string): Promise<void> {
  await page.getByTestId(trigger).click();
  await expect(page.getByTestId("new-project-directory-input")).toBeVisible({ timeout: 30_000 });
}
