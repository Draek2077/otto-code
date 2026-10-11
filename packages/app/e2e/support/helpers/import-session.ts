import { expect, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { gotoAppShell } from "./app";
import { openCommandCenter } from "./command-center";
import { getServerId } from "./server-id";
import { expectMobileAgentSidebarVisible, openMobileAgentSidebar } from "./sidebar";

const rowTestId = (id: string) => `import-session-session-claude-${id}`;

// The sheet is a batch importer (components/import-session-sheet.tsx): rows are
// checkboxes, "Import selected" runs the import, and "Show chats from all
// projects" widens a workspace-scoped listing. The scope hint, a row's folder
// label and the per-provider errors carry no test ids, so they are read as text
// inside the sheet or the row.

export class ImportSessionFlow {
  constructor(private readonly page: Page) {}
  async openWorkspace(workspaceId: string, viewport: { width: number; height: number }) {
    await this.page.setViewportSize(viewport);
    await gotoAppShell(this.page);
    await this.page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
    await expect(this.page.getByRole("button", { name: "Workspace actions" })).toBeVisible({
      timeout: 30_000,
    });
  }
  async revealMobileEntryPoint() {
    await openMobileAgentSidebar(this.page);
    await expectMobileAgentSidebarVisible(this.page);
    const button = this.page.getByTestId("sidebar-import-session");
    await expect(button).toHaveAccessibleName("Import session");
    await button.hover();
    await expect(this.page.getByText("Import session", { exact: true })).toBeVisible();
  }
  async openGlobally() {
    await expect(this.page.getByTestId("sidebar-import-session")).toBeVisible();
    await this.page.getByTestId("sidebar-import-session").click();
    await this.expectSheetReady();
  }
  async openFromWorkspaceHeader() {
    await this.page.getByRole("button", { name: "Workspace actions" }).click();
    await this.page.getByTestId("workspace-header-import-agent").click();
    await this.expectScope("This workspace");
    await expect(this.page.getByTestId("import-session-all-projects")).toBeVisible();
    await expect(this.page.getByText("Workspace actions", { exact: true })).not.toBeVisible();
  }
  async expectScope(text: string, exact = true) {
    await expect(this.scopeHint(text, exact)).toBeVisible();
  }
  async expectRows(input: {
    first?: string[];
    before?: [string, string];
    folders?: Array<[string, string]>;
  }) {
    const ids = await this.rowIds();
    if (input.first) expect(ids.slice(0, input.first.length)).toEqual(input.first.map(rowTestId));
    if (input.before) {
      expect(ids.indexOf(rowTestId(input.before[0]))).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(rowTestId(input.before[0]))).toBeLessThan(
        ids.indexOf(rowTestId(input.before[1])),
      );
    }
    for (const [id, folder] of input.folders ?? []) {
      await expect(
        this.page.getByTestId(rowTestId(id)).getByText(folder, { exact: true }),
      ).toBeVisible();
    }
  }
  async expectProviderError(label: string) {
    await expect(
      this.page.getByText(`Could not load ${label} sessions`, { exact: true }),
    ).toBeVisible();
  }
  async expectProviderFilterFits(width: number) {
    await expect(this.scopeHint("Sessions on", false)).toBeInViewport();
    const filter = this.page.getByRole("button", { name: "Filter: All" });
    await expect(filter).toBeInViewport();
    const bounds = await filter.boundingBox();
    expect(bounds?.x ?? width).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? 1)).toBeLessThanOrEqual(width);
  }
  async revealSession(id: string) {
    await this.page.getByTestId(rowTestId(id)).scrollIntoViewIfNeeded();
  }
  async search(query: string) {
    await this.page.getByTestId("import-session-search").fill(query);
    await expect(this.page.getByText("Invoice migration plan", { exact: true })).toBeVisible();
    await expect(this.page.getByText("Root session 01", { exact: true })).toHaveCount(0);
    await expect(this.page.getByTestId("import-session-load-more")).toHaveCount(0);
  }
  async resetSearch() {
    await this.page.getByTestId("import-session-search").fill("");
    await expect(this.page.getByTestId("import-session-load-more")).toBeVisible();
  }
  async loadMore() {
    await this.page.getByTestId("import-session-load-more").click();
    await expect(this.page.getByText("Root session 20", { exact: true })).toBeVisible();
    await expect(this.page.getByTestId("import-session-load-more")).toHaveCount(0);
  }
  async retryProvider(provider: string, label: string) {
    await this.expectProviderError(label);
    await this.page.getByTestId(`import-session-retry-${provider}`).click();
    await expect(this.page.getByTestId(`import-session-retry-${provider}`)).toBeEnabled();
    await this.expectProviderError(label);
    await expect(this.page.getByRole("progressbar")).toHaveCount(0);
  }
  async importSession(id: string) {
    const row = this.page.getByTestId(rowTestId(id));
    await row.click();
    await expect(row).toBeChecked();
    await this.page.getByTestId("import-session-import-selected").click();
    await expect(this.page.getByTestId("import-session-sheet")).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  async expectTranscript(userText: string, assistantText: string) {
    await expect(this.page.getByTestId("user-message")).toContainText(userText);
    await expect(this.page.getByTestId("assistant-message")).toContainText(assistantText);
  }
  async showAll() {
    await this.page.getByTestId("import-session-all-projects").click();
    await this.expectScope("Sessions on", false);
  }
  async expectImportedIntoWorkspace(workspaceId: string, userText: string) {
    await expect(this.page).toHaveURL(buildHostWorkspaceRoute(getServerId(), workspaceId), {
      timeout: 30_000,
    });
    const workspace = this.page.getByTestId(`workspace-deck-entry-${getServerId()}:${workspaceId}`);
    await expect(workspace.getByTestId("user-message")).toContainText(userText);
  }
  async close() {
    await this.page.keyboard.press("Escape");
    await expect(this.page.getByTestId("import-session-sheet")).toHaveCount(0);
  }
  async expectCommandCenterMatch() {
    const panel = await openCommandCenter(this.page);
    await panel.getByTestId("command-center-input").fill("import");
    await expect(panel.getByText("Import session", { exact: true })).toBeVisible();
    await expect(panel.getByText("Home", { exact: true })).toHaveCount(0);
  }
  private scopeHint(text: string, exact: boolean) {
    return this.page.getByTestId("import-session-sheet").getByText(text, { exact }).first();
  }
  private async expectSheetReady() {
    const sheet = this.page.getByTestId("import-session-sheet");
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    // On compact layouts the sheet test id marks only the header, so the body's
    // loading status is matched page-wide.
    await expect(this.page.getByText("Loading recent sessions...", { exact: true })).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    await expect(this.page.locator('[data-testid^="import-session-session-"]').first()).toBeVisible(
      { timeout: 30_000 },
    );
  }
  private async rowIds() {
    return await this.page
      .locator('[data-testid^="import-session-session-claude-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  }
}
