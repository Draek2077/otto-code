import { expect, type Page } from "@playwright/test";

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
