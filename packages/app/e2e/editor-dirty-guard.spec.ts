import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { expandFolder, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { editorTabCloseTestId, fileTabEditorContent, fileTabPane } from "./helpers/file-tab";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

// The CM6 editor's unsaved-changes contract (components/file-tab-pane.tsx +
// panels/file-panel.tsx confirmClose): typing marks the tab dirty (●), the
// buffer survives switching tabs without any prompt, and closing a dirty tab
// requires an explicit discard through the in-app confirm dialog. There is no
// autosave — nothing reaches the disk unless the user saves.

let workspace: SeededWorkspace;

const DRAFT_PATH = "notes/draft.txt";
const DRAFT_CONTENT = "one\ntwo\nthree\n";
const OTHER_PATH = "notes/other.txt";
const OTHER_CONTENT = "other-file-body\n";

function readDraftFromDisk(): string {
  return readFileSync(join(workspace.repoPath, DRAFT_PATH), "utf-8");
}

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "dirty-guard-",
    repo: {
      files: [
        { path: DRAFT_PATH, content: DRAFT_CONTENT },
        { path: OTHER_PATH, content: OTHER_CONTENT },
      ],
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("Editor dirty guard", () => {
  test("dirty dot, tab-switch survival, and confirm-to-discard on close", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await expandFolder(page, "notes");
    await openFileFromExplorer(page, "draft.txt");

    // Plain text opens straight in the editor; the click is a no-op safeguard.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
    const draftTab = page.getByTestId(`workspace-tab-file_${DRAFT_PATH}`).first();
    await expect(fileTabEditorContent(page)).toContainText("one", { timeout: 30_000 });

    // Typing marks the tab dirty.
    await fileTabEditorContent(page).click();
    await page.keyboard.type("guarded ");
    await expect(draftTab).toContainText("●", { timeout: 10_000 });

    // No autosave: the draft never reached the disk on its own.
    expect(readDraftFromDisk()).not.toContain("guarded");

    // Navigating away to another tab never prompts and never discards: the
    // buffer (and the dirty marker) survive the round trip.
    await openFileFromExplorer(page, "other.txt");
    await expect(fileTabEditorContent(page)).toContainText("other-file-body", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await draftTab.click();
    await expect(fileTabEditorContent(page)).toContainText("guarded", { timeout: 30_000 });
    await expect(draftTab).toContainText("●");

    // Closing the dirty tab prompts; cancel keeps the tab and the edits.
    await draftTab.hover();
    const closeButton = page.getByTestId(editorTabCloseTestId(DRAFT_PATH)).first();
    await closeButton.click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-cancel").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden({ timeout: 10_000 });
    await expect(fileTabEditorContent(page)).toContainText("guarded");
    await expect(draftTab).toContainText("●");

    // Confirming the discard closes the tab; the edits never reach the disk.
    await draftTab.hover();
    await closeButton.click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId(`workspace-tab-file_${DRAFT_PATH}`)).toBeHidden({
      timeout: 30_000,
    });
    expect(readDraftFromDisk()).toBe(DRAFT_CONTENT);

    // Reopening shows the on-disk baseline, not the discarded draft.
    await openFileFromExplorer(page, "draft.txt");
    await expect(fileTabEditorContent(page)).toContainText("one", { timeout: 30_000 });
    await expect(fileTabEditorContent(page)).not.toContainText("guarded");
  });
});
