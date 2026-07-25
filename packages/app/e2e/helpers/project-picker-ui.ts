import { expect, type Page } from "@playwright/test";

export async function expectOpenedProject(page: Page, projectName: string): Promise<string> {
  const projectRow = page
    .locator('[data-testid^="sidebar-project-row-"]')
    .filter({ hasText: projectName })
    .first();
  await expect(projectRow).toBeVisible({ timeout: 30_000 });

  const testId = await projectRow.getAttribute("data-testid");
  expect(testId).not.toBeNull();
  return testId!.replace("sidebar-project-row-", "");
}

// The New project page replaced the search-only picker modal. Every "New
// project" entry point routes here; with a single host the host chooser
// resolves itself, so the page is one click away.
export async function openNewProjectPage(page: Page, trigger: string): Promise<void> {
  await page.getByTestId(trigger).click();
  await expect(page.getByTestId("new-project-directory-input")).toBeVisible({ timeout: 30_000 });
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
