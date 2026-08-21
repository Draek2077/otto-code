import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { composerLocator } from "../support/helpers/composer";
import { moneyShot, qaShot } from "../support/helpers/evidence";
import {
  expandFolder,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";

const RELATIVE_PATH = "src/target.ts";
const FILE_CONTENT = "export const alpha = 1;\nexport const beta = 2;\n";

/**
 * The File Editor's two "add to chat" entry points, proven against the chat that
 * receives them.
 *
 * Both write to the WORKSPACE attachment scope rather than a focused chat's own,
 * which is what makes them work from here: while the editor tab holds the focused
 * pane there is no focused chat to aim at. So the flow deliberately leaves the
 * chat, attaches from the editor, and comes back to find the pills waiting -
 * that round trip is the behaviour, not incidental navigation.
 */
test("attaches the open file and a selected range to the chat from the File Editor", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "add-file-to-chat-editor-",
    title: "Target chat",
  });

  try {
    await mkdir(path.join(workspace.cwd, "src"), { recursive: true });
    await writeFile(path.join(workspace.cwd, RELATIVE_PATH), FILE_CONTENT);
    await workspace.client.checkoutRefresh(workspace.cwd);

    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const agentComposer = composerLocator(page);
    await expect(agentComposer).toBeEditable({ timeout: 30_000 });
    // A draft already in flight: attaching from another tab must not disturb it.
    await agentComposer.fill("Preserve this thought");

    await openFileExplorer(page);
    await expandFolder(page, "src");
    await openFileFromExplorer(page, "target.ts");
    await page.getByTestId("file-view-mode-editor").click();

    const filePane = page.getByTestId("workspace-file-tab-pane");
    await expect(filePane).toBeVisible({ timeout: 30_000 });
    const editorContent = filePane.locator(".cm-content");
    await expect(editorContent).toContainText("alpha", { timeout: 30_000 });

    // 1. The toolbar button: the whole file.
    await page.getByTestId("file-add-to-chat").click();

    // 2. The right-click: the selected range.
    //
    // First with a bare caret, where the item is absent rather than greyed - the
    // menu offers nothing to click when there is no range to reference.
    const menuItem = page.getByTestId("editor-context-add-selection-to-chat");
    await editorContent.click();
    await editorContent.locator("text=export").first().click({ button: "right" });
    await expect(page.getByTestId("editor-context-menu")).toBeVisible({ timeout: 10_000 });
    await expect(menuItem).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Then with a selection. Select the first six characters, then right-click
    // INSIDE that range - the core collapses the caret to the click only when it
    // lands outside the selection, so a right-click on the selection is what
    // keeps it alive long enough to attach.
    await editorContent.click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Shift+ArrowRight");
    }
    await editorContent.locator("text=export").first().click({ button: "right" });
    await expect(menuItem).toBeVisible({ timeout: 10_000 });
    await qaShot(page, "add-selection-to-chat appears only once a selection exists");
    await menuItem.click();

    // Back to the chat: workspace-scoped attachments were waiting there.
    await page.getByTestId(`workspace-tab-agent_${workspace.agentId}`).first().click();
    await expect(agentComposer).toBeVisible({ timeout: 30_000 });

    const pills = page.getByTestId("composer-file-context-attachment-pill");
    await expect(pills).toHaveCount(2, { timeout: 15_000 });
    // The whole-file pill and the range pill are distinct attachments: one file
    // can be referenced both ways at once, and each removes independently.
    await expect(pills.filter({ hasText: "File context" })).toContainText("target.ts");
    const selectionPill = pills.filter({ hasText: "Selection context" });
    await expect(selectionPill).toContainText("target.ts:1:1-1:7");
    await expect(agentComposer).toHaveValue("Preserve this thought");

    await moneyShot(
      page,
      "the File Editor's toolbar and right-click put a whole-file pill and a row:column range pill in the chat, leaving the existing draft untouched",
    );
  } finally {
    await workspace.cleanup();
  }
});

/**
 * Picking an `@` mention attaches a pill instead of splicing a quoted path into
 * the sentence.
 *
 * The quoted form is not gone - `formatQuotedFileMentionPath` still runs at
 * serialize time on the fallback path - but it is no longer something the user
 * has to see, edit around, or delete by hand. The assertion that matters is the
 * negative one: the prose the user was writing survives with no path in it.
 */
test("picking an @ mention attaches a pill instead of inserting a quoted path", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "mention-pill-",
    title: "Mention chat",
  });

  try {
    await mkdir(path.join(workspace.cwd, "src"), { recursive: true });
    await writeFile(path.join(workspace.cwd, RELATIVE_PATH), FILE_CONTENT);
    await workspace.client.checkoutRefresh(workspace.cwd);

    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const agentComposer = composerLocator(page);
    await expect(agentComposer).toBeEditable({ timeout: 30_000 });

    await agentComposer.click();
    await page.keyboard.type("look at @src/target");
    const popover = page.getByTestId("composer-autocomplete-popover");
    await expect(popover).toBeVisible({ timeout: 30_000 });
    await expect(popover).toContainText(RELATIVE_PATH, { timeout: 30_000 });
    await page.keyboard.press("Enter");

    const pill = page.getByTestId("composer-file-context-attachment-pill");
    await expect(pill).toContainText("target.ts", { timeout: 15_000 });
    // The prose survives; the path is not in it, quoted or otherwise.
    await expect(agentComposer).toHaveValue("look at ");

    await moneyShot(
      page,
      "picking an @ mention leaves the sentence alone and attaches the file as a removable pill",
    );
  } finally {
    await workspace.cleanup();
  }
});
