import { test, expect, openKanban } from "../support/helpers/otto-kanban";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import type { Page } from "../support/fixtures";

test.use({ e2eDaemonConfig: { pluginsEnabled: true }, kanbanWithBoard: true });
async function select(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp("^" + label + ":") }).click();
  await page.getByRole("menuitem", { name: option, exact: true }).click();
}
async function apply(page: Page) {
  await page.getByRole("button", { name: "Apply action", exact: true }).click();
  await expect(page.getByText("Board action applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
}
async function openWorkspace(page: Page, workspaceId: string, compact: boolean) {
  if (compact) await page.setViewportSize({ width: 390, height: 844 });
  await gotoAppShell(page);
  if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
  await page
    .locator(`[data-testid="sidebar-workspace-row-${getServerId()}:${workspaceId}"]:visible`)
    .first()
    .click();
  await openKanban(page, compact);
  await expect(page.getByText("Otto fixture board", { exact: true })).toBeVisible();
}
for (const compact of [false, true]) {
  test(`Kanban create, move, edit, link and detach (${compact ? "compact" : "wide"})`, async ({
    page,
    kanban,
  }, testInfo) => {
    test.setTimeout(180_000);
    await openWorkspace(page, kanban.project.workspaceId, compact);
    await page.getByRole("button", { name: "Create card", exact: true }).click();
    const content = await page.getByTestId("kanban-page-content").boundingBox();
    const form = await page.getByTestId("kanban-action-form").boundingBox();
    const action = await page.getByRole("button", { name: /^Action:/ }).boundingBox();
    expect(content).not.toBeNull();
    expect(form).not.toBeNull();
    expect(action).not.toBeNull();
    // Use the same content rails as the existing Paseo settings pages in both
    // layouts: inset from page chrome and a bounded, centered form on desktop.
    expect(action!.x - content!.x).toBeGreaterThanOrEqual(16);
    expect(content!.x + content!.width - action!.x - action!.width).toBeGreaterThanOrEqual(16);
    expect(form!.y - content!.y).toBeGreaterThanOrEqual(24);
    if (!compact) {
      expect(action!.x - content!.x).toBeGreaterThan(100);
    }
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("New from Otto");
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Created through the owning daemon");
    await select(page, "Column", "Done");
    await apply(page);
    if (compact) await select(page, "Column", "Done");
    const created = page.getByTestId("kanban-card-draft-3");
    await expect(created.getByText("New from Otto", { exact: true })).toBeVisible();
    await created.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Action", "Move card");
    await select(page, "Column", "Todo");
    await apply(page);
    if (compact) await select(page, "Column", "Todo");
    await expect(created).toBeVisible();
    await created.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Title");
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Renamed through Otto");
    await apply(page);
    await expect(created.getByText("Renamed through Otto", { exact: true })).toBeVisible();
    await created.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Description");
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Updated through Otto");
    await apply(page);
    await expect(created.getByText("Updated through Otto", { exact: true })).toBeVisible();
    await created.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Priority");
    await select(page, "Priority", "High");
    await apply(page);
    await created.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Priority");
    await expect(page.getByRole("button", { name: "Priority: High", exact: true })).toBeVisible();
    await select(page, "Action", "Remove from board");
    await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
    await apply(page);
    await expect(created).toHaveCount(0);

    await page.getByRole("button", { name: "Link issue or pull request", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Issue or pull request URL", exact: true })
      .fill("https://github.com/paseo-e2e/local-fixture/issues/2");
    await select(page, "Column", "Todo");
    await apply(page);
    const linked = page.getByTestId("kanban-card-linked-4");
    await expect(linked.getByText("Linked issue", { exact: true })).toBeVisible();
    await linked.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Assignees");
    await page.getByRole("switch", { name: "fixture-peer", exact: true }).click();
    await apply(page);
    await expect(linked.getByText("Assigned to fixture-peer", { exact: true })).toBeVisible();
    await linked.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Labels");
    await page.getByRole("switch", { name: "Enhancement", exact: true }).click();
    await apply(page);
    await linked.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Labels");
    await expect(page.getByRole("switch", { name: "Enhancement", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await select(page, "Field", "Due date");
    await page.getByRole("textbox", { name: "Due date", exact: true }).fill("2026-11-01");
    await apply(page);
    await linked.getByRole("button", { name: "View card", exact: true }).click();
    await select(page, "Field", "Due date");
    await expect(page.getByRole("textbox", { name: "Due date", exact: true })).toHaveValue(
      "2026-11-01",
    );
    await page.screenshot({ path: testInfo.outputPath("kanban-card-actions.png") });
    await page.getByRole("button", { name: "Clear field", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Due date", exact: true })).toHaveValue("");
    await apply(page);
  });
  test(`Kanban lost write response requires reconciliation (${compact ? "compact" : "wide"})`, async ({
    page,
    kanban,
  }) => {
    await openWorkspace(page, kanban.project.workspaceId, compact);
    await kanban.setProviderError("after-write");
    await page.getByRole("button", { name: "Create card", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Created despite lost response");
    await page.getByRole("button", { name: "Apply action", exact: true }).click();
    await expect(
      page.getByText(
        "GitHub may have applied this action. Refresh and reconcile the board before another action.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply action", exact: true })).toBeDisabled();
    await kanban.setProviderError(null);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Discard and close", exact: true }).click();
    if (compact) await select(page, "Column", "Unassigned");
    await expect(
      page
        .getByTestId("kanban-card-draft-3")
        .getByText("Created despite lost response", { exact: true }),
    ).toBeVisible();
    expect(
      (await kanban.requests()).filter((request) =>
        request.operation.startsWith("OttoKanbanWrite"),
      ),
    ).toHaveLength(1);
  });
}
