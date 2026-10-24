import { test, expect, openKanban } from "../support/helpers/otto-kanban";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";

test.use({ e2eDaemonConfig: { pluginsEnabled: true }, kanbanWithBoard: true });

for (const compact of [false, true]) {
  test(`Configured Kanban board, pagination and scope recovery (${compact ? "compact" : "wide"})`, async ({
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
    await expect(page.getByText("Otto fixture board", { exact: true })).toBeVisible();
    const issue = page.getByTestId("kanban-card-issue-1");
    await expect(issue.getByText("Coordinate the release", { exact: true })).toBeVisible();
    await expect(issue.getByText("Assigned to fixture-user", { exact: true })).toBeVisible();
    const issueUrl = "https://github.com/paseo-e2e/local-fixture/issues/1";
    // Only the external destination is isolated; the app's actual opener still runs.
    await page
      .context()
      .route(issueUrl, (route) =>
        route.fulfill({ contentType: "text/html", body: "Fixture issue" }),
      );
    const destination = page.context().waitForEvent("page");
    await issue
      .getByRole("link", { name: "Open Coordinate the release in its provider", exact: true })
      .click();
    const external = await destination;
    await expect(external).toHaveURL(issueUrl);
    await external.close();
    if (compact) {
      await page.getByRole("button", { name: "Column: Todo", exact: true }).click();
      await page.getByRole("menuitem", { name: "Done", exact: true }).click();
    }
    await expect(
      page
        .getByTestId("kanban-card-draft-2")
        .getByText("Review the implementation", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => kanban.requests())
      .toEqual(
        expect.arrayContaining([
          { operation: "OttoKanbanFields", cursor: "fields-page-2" },
          { operation: "OttoKanbanItems", cursor: "items-page-2" },
        ]),
      );
    await page.screenshot({ path: testInfo.outputPath("kanban-configured-board.png") });

    await kanban.setProviderError("scope");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText(
        "The host's GitHub CLI needs read:project access; private contents also need repo access.",
        { exact: true },
      ),
    ).toBeVisible();
    await kanban.setProviderError(null);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Otto fixture board", { exact: true })).toBeVisible();
    await expect(page.getByTestId("kanban-card-issue-1")).toBeVisible();
  });
}
