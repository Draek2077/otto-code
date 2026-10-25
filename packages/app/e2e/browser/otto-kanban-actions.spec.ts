import { test, expect, openKanban } from "../support/helpers/otto-kanban";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import type { Page } from "../support/fixtures";
import { z } from "zod";
import { callAgentMcp } from "../support/helpers/agent-mcp";

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
  test(`Kanban agent tools share the configured board and durable writes with the app (${compact ? "compact" : "wide"})`, async ({
    page,
    kanban,
  }) => {
    await openWorkspace(page, kanban.project.workspaceId, compact);
    const workspaceId = kanban.project.workspaceId;
    const pageSchema = z.object({
      status: z.literal("ready"),
      settingsRevision: z.string(),
      board: z.object({
        id: z.string(),
        revision: z.string(),
        columns: z.array(z.object({ id: z.string(), title: z.string() })),
      }),
      cards: z.array(z.object({ id: z.string(), title: z.string() })),
      editing: z
        .object({
          cardRevision: z.string(),
          fields: z.array(z.object({ id: z.string(), name: z.string() })),
        })
        .nullable(),
    });
    const read = async (cardId?: string) =>
      pageSchema.parse(
        await callAgentMcp("kanban_get_board", {
          workspaceId,
          ...(cardId ? { cardId, includeEditing: true } : {}),
        }),
      );
    const first = await read();
    const create = {
      workspaceId,
      operationId: "e2e-kanban-mcp-create",
      boardId: first.board.id,
      expectedSettingsRevision: first.settingsRevision,
      expectedBoardRevision: first.board.revision,
      title: "Created through agent tools",
      description: "Provider-neutral MCP body",
      columnId: null,
    };
    expect(await callAgentMcp("kanban_create_card", create)).toMatchObject({
      status: "applied",
      operationId: create.operationId,
    });
    expect(await callAgentMcp("kanban_create_card", create)).toMatchObject({
      status: "applied",
      operationId: create.operationId,
    });
    expect(
      (await kanban.requests()).filter((request) =>
        request.operation.startsWith("OttoKanbanWrite"),
      ),
    ).toHaveLength(1);
    const listed = await read();
    const created = listed.cards.find((card) => card.title === create.title);
    if (!created) throw new Error("MCP-created card was not read back");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (compact) await select(page, "Column", "Unassigned");
    await expect(page.getByText(create.title, { exact: true })).toBeVisible();
    const detail = await read(created.id);
    const title = detail.editing?.fields.find((field) => field.name === "Title");
    if (!detail.editing || !title) throw new Error("The actual host did not offer title editing");
    expect(
      await callAgentMcp("kanban_update_card", {
        workspaceId,
        operationId: "e2e-kanban-mcp-edit-title",
        boardId: detail.board.id,
        expectedSettingsRevision: detail.settingsRevision,
        expectedBoardRevision: detail.board.revision,
        cardId: created.id,
        expectedCardRevision: detail.editing.cardRevision,
        fieldId: title.id,
        value: { kind: "text", value: "Renamed through agent tools" },
      }),
    ).toMatchObject({ status: "applied" });
    const moved = await read(created.id);
    const done = moved.board.columns.find((column) => column.title === "Done");
    if (!moved.editing || !done) throw new Error("Missing host movement metadata");
    expect(
      await callAgentMcp("kanban_move_card", {
        workspaceId,
        operationId: "e2e-kanban-mcp-move-card",
        boardId: moved.board.id,
        expectedSettingsRevision: moved.settingsRevision,
        expectedBoardRevision: moved.board.revision,
        cardId: created.id,
        expectedCardRevision: moved.editing.cardRevision,
        columnId: done.id,
      }),
    ).toMatchObject({ status: "applied" });
    const removing = await read(created.id);
    if (!removing.editing) throw new Error("Missing current card revision");
    expect(
      await callAgentMcp("kanban_delete_card", {
        workspaceId,
        operationId: "e2e-kanban-mcp-detach-card",
        boardId: removing.board.id,
        expectedSettingsRevision: removing.settingsRevision,
        expectedBoardRevision: removing.board.revision,
        cardId: created.id,
        expectedCardRevision: removing.editing.cardRevision,
      }),
    ).toMatchObject({ status: "applied" });
    expect((await read()).cards.some((card) => card.id === created.id)).toBe(false);
    expect(
      (await kanban.requests()).filter((request) =>
        request.operation.startsWith("OttoKanbanWrite"),
      ),
    ).toHaveLength(4);
  });
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
