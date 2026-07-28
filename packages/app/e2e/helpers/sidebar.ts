import { expect, type Page } from "@playwright/test";
import { getServerId } from "./server-id";

export async function selectWorkspaceInSidebar(page: Page, workspaceId: string): Promise<void> {
  const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

async function openWorkspaceSidebarKebab(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  return serverId;
}

export async function expectWorkspaceListed(page: Page, name: string): Promise<void> {
  await expect(
    page.locator('[data-testid^="sidebar-workspace-row-"]').filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

// The workspace row kebab and its menu items carry no web ARIA role, so the sidebar
// suite addresses them by the stable test ids the app assigns per workspace — the same
// convention the rename flow uses. The kebab only reveals on hover.
export async function clickArchiveWorkspaceMenuItem(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const serverId = await openWorkspaceSidebarKebab(page, workspaceId);
  const archiveItem = page.getByTestId(`sidebar-workspace-menu-archive-${serverId}:${workspaceId}`);
  await expect(archiveItem).toBeVisible({ timeout: 10_000 });
  await archiveItem.click();
}

export async function archiveWorkspaceFromSidebar(page: Page, workspaceId: string): Promise<void> {
  // A clean workspace archives with no prompt. A worktree-backed one raises the
  // branch-aware archive sheet ("Archive <name>?" plus an "Also delete branch"
  // checkbox), which is the in-app ConfirmDialogHost — NOT a native
  // window.confirm. Accepting only the native dialog left the confirmation
  // unanswered, so the daemon saw the archive preflight and never the archive
  // itself, and the row stayed in the sidebar looking like a broken archive.
  // The native handler stays for any surface that still uses one.
  page.once("dialog", (dialog) => void dialog.accept());
  await clickArchiveWorkspaceMenuItem(page, workspaceId);

  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  await confirmButton.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }
}

export async function expectWorkspaceAbsentFromSidebar(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await expect(
    page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`),
  ).toHaveCount(0, { timeout: 30_000 });
}

export async function openMobileAgentSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu" }).click();
}

export async function closeMobileAgentSidebar(page: Page): Promise<void> {
  const closeButton = page.getByTestId("sidebar-close");
  await expect(closeButton).toBeInViewport({ timeout: 5_000 });
  await closeButton.click({ force: true });
}

// The mobile sidebar panel animates via translateX; toBeInViewport reflects the rendered position.
export async function expectMobileAgentSidebarVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-sessions")).toBeInViewport({ timeout: 5_000 });
}

export async function expectMobileAgentSidebarHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-sessions")).not.toBeInViewport({ timeout: 5_000 });
}
