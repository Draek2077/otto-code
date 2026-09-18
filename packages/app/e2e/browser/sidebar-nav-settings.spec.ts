import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectSidebarItemHidden,
  expectSidebarNavSettingsOrder,
  expectSidebarNavSettingsRow,
  expectSidebarOrder,
  expectStoredSidebarNav,
  leaveSettings,
  moveSidebarNavItemUp,
  openSidebarNavSettings,
  seedSidebarNavPreferences,
  setSidebarNavItemVisible,
} from "../support/helpers/sidebar-nav-settings";

// Otto places the builtins in two groups: destinations (Artifacts, Kanban, Schedules,
// Workflows, and the optional New workspace, which starts hidden) as two-column rows,
// and History plus Search as Workspaces header actions. Each group reorders within itself.
test.describe("Sidebar items in Appearance settings", () => {
  test("owner reorders and hides top-level sidebar items", async ({ page }) => {
    await gotoAppShell(page);

    await test.step("the sidebar starts in the default order", async () => {
      await expectSidebarOrder(page, ["artifacts", "kanban", "schedules", "runs"]);
      await expectSidebarOrder(page, ["history", "search"]);
      await expectSidebarItemHidden(page, "new-workspace");
    });

    await test.step("the Sidebar section lists every item in the same order", async () => {
      await openSidebarNavSettings(page);
      // The section explains itself through the header's info tooltip, not a paragraph.
      await expect(page.getByTestId("sidebar-nav-section-info")).toHaveAccessibleName(
        "About Sidebar",
      );
      await expectSidebarNavSettingsOrder(page, [
        "artifacts",
        "kanban",
        "schedules",
        "runs",
        "new-workspace",
        "history",
        "search",
      ]);
      await expectSidebarNavSettingsRow(page, {
        key: "history",
        label: "History",
        visible: true,
      });
      await expectSidebarNavSettingsRow(page, {
        key: "new-workspace",
        label: "New workspace",
        visible: false,
      });
      // Items with a keyboard shortcut badge it next to their name. Chords render
      // with Ctrl off macOS, which is what the browser project runs on.
      await expect(
        page.getByTestId("sidebar-nav-item-new-workspace").getByText("Ctrl+N", { exact: true }),
      ).toBeVisible();
    });

    await test.step("moving Schedules up twice lifts it to the first row", async () => {
      await moveSidebarNavItemUp(page, "schedules");
      await expectSidebarNavSettingsOrder(page, [
        "artifacts",
        "schedules",
        "kanban",
        "runs",
        "new-workspace",
      ]);
      await moveSidebarNavItemUp(page, "schedules");
      await expectSidebarNavSettingsOrder(page, [
        "schedules",
        "artifacts",
        "kanban",
        "runs",
        "new-workspace",
      ]);

      await leaveSettings(page);
      await expectSidebarOrder(page, ["schedules", "artifacts", "kanban", "runs"]);
    });

    await test.step("turning History off removes it from the sidebar", async () => {
      await openSidebarNavSettings(page);
      await setSidebarNavItemVisible(page, "history", false);
      await expectStoredSidebarNav(page, [
        { key: "schedules", visible: true },
        { key: "artifacts", visible: true },
        { key: "kanban", visible: true },
        { key: "runs", visible: true },
        { key: "new-workspace", visible: false },
        { key: "history", visible: false },
        { key: "search", visible: true },
      ]);

      await leaveSettings(page);
      await expectSidebarItemHidden(page, "history");
      await expectSidebarOrder(page, ["schedules", "artifacts", "kanban", "runs", "search"]);
    });

    await test.step("the sidebar keeps that shape across a reload", async () => {
      await page.reload();
      await expectSidebarItemHidden(page, "history");
      await expectSidebarOrder(page, ["schedules", "artifacts", "kanban", "runs", "search"]);
    });
  });

  test("renders no top-level items when every one is turned off", async ({ page }) => {
    await seedSidebarNavPreferences(page, [
      { key: "artifacts", visible: false },
      { key: "kanban", visible: false },
      { key: "schedules", visible: false },
      { key: "runs", visible: false },
      { key: "new-workspace", visible: false },
      { key: "history", visible: false },
      { key: "search", visible: false },
    ]);
    await gotoAppShell(page);

    // The sidebar itself still renders; only its top-level nav items are gone.
    await expect(page.locator('[data-testid="sidebar-settings"]:visible')).toBeVisible({
      timeout: 30_000,
    });
    await expectSidebarItemHidden(page, "artifacts");
    await expectSidebarItemHidden(page, "kanban");
    await expectSidebarItemHidden(page, "schedules");
    await expectSidebarItemHidden(page, "runs");
    await expectSidebarItemHidden(page, "new-workspace");
    await expectSidebarItemHidden(page, "history");
    await expectSidebarItemHidden(page, "search");
  });
});
