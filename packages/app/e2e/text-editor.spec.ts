import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { expandFolder, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

let workspace: SeededWorkspace;

const FILE_PATH = "notes/todo.txt";
const INITIAL_CONTENT = "alpha\nbeta\ngamma\n";

// Mirrors getCloseButtonTestId → encodeFilePathForPathSegment (base64url, no pad).
function editorTabCloseTestId(path: string): string {
  return `workspace-file-close-${Buffer.from(path, "utf-8").toString("base64url")}`;
}

function readSeededFile(): string {
  return readFileSync(join(workspace.repoPath, FILE_PATH), "utf-8");
}

const WATCH_FILE_PATH = "notes/watch.txt";
const WATCH_INITIAL_CONTENT = "w-one\nw-two\n";

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "text-editor-",
    repo: {
      files: [
        { path: FILE_PATH, content: INITIAL_CONTENT },
        { path: WATCH_FILE_PATH, content: WATCH_INITIAL_CONTENT },
      ],
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("Text editor", () => {
  test("edits, saves to disk, reverts, and guards dirty close", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);

    await expandFolder(page, "notes");
    await openFileFromExplorer(page, "todo.txt");

    // Plain text defaults to the editor view; the click is a no-op safeguard
    // against a remembered preview mode from earlier runs.
    await page.getByTestId("file-view-mode-editor").click();
    const filePane = page.getByTestId("workspace-file-tab-pane");
    await expect(filePane).toBeVisible({ timeout: 30_000 });
    const fileTab = page.getByTestId(`workspace-tab-file_${FILE_PATH}`).first();
    await expect(fileTab).toBeVisible({ timeout: 30_000 });

    const editorContent = filePane.locator(".cm-content");
    await expect(editorContent).toContainText("alpha", { timeout: 30_000 });

    // Type → the tab title gains the dirty marker.
    await editorContent.click();
    await page.keyboard.type("delta ");
    await expect(fileTab).toContainText("●", { timeout: 10_000 });

    // Save → dirty clears and the daemon wrote the file to disk.
    await page.getByTestId("editor-save").click();
    await expect(fileTab).not.toContainText("●", { timeout: 30_000 });
    await expect.poll(readSeededFile, { timeout: 15_000 }).toContain("delta");

    // Edit again, then revert back to the saved baseline via the confirm dialog.
    await editorContent.click();
    await page.keyboard.type("zeta ");
    await expect(fileTab).toContainText("●", { timeout: 10_000 });
    await page.getByTestId("editor-revert").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(fileTab).not.toContainText("●", { timeout: 10_000 });
    await expect(editorContent).not.toContainText("zeta");

    // Dirty close prompts; cancel keeps the tab, confirm closes it.
    await editorContent.click();
    await page.keyboard.type("omega ");
    await expect(fileTab).toContainText("●", { timeout: 10_000 });
    await fileTab.hover();
    const closeButton = page.getByTestId(editorTabCloseTestId(FILE_PATH)).first();
    await closeButton.click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-cancel").click();
    await expect(filePane).toBeVisible();

    await fileTab.hover();
    await closeButton.click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId(`workspace-tab-file_${FILE_PATH}`)).toBeHidden({
      timeout: 30_000,
    });

    // Discarded edits never reached the disk.
    expect(readSeededFile()).not.toContain("omega");
  });

  test("mode bar switches editor, split, and preview without losing the buffer", async ({
    page,
  }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await expandFolder(page, "notes");
    await openFileFromExplorer(page, "todo.txt");

    // One tab per file; the mode bar flips it between the three views in
    // place. (The remembered per-file mode may or may not start on preview.)
    await page.getByTestId("file-view-mode-editor").click();
    const filePane = page.getByTestId("workspace-file-tab-pane");
    const editorContent = filePane.locator(".cm-content");
    await expect(editorContent).toContainText("alpha", { timeout: 30_000 });

    // Split shows the editor and the preview side by side.
    await page.getByTestId("file-view-mode-split").click();
    await expect(page.getByTestId("file-split-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-split-preview")).toBeVisible();

    // Back to the full editor, type — the buffer is dirty.
    await page.getByTestId("file-view-mode-editor").click();
    await editorContent.click();
    await page.keyboard.type("sigma ");
    const fileTab = page.getByTestId(`workspace-tab-file_${FILE_PATH}`).first();
    await expect(fileTab).toContainText("●", { timeout: 10_000 });

    // Switching to preview keeps the unsaved buffer (no discard prompt) and
    // renders the draft, not the disk contents.
    await page.getByTestId("file-view-mode-preview").click();
    await expect(page.getByTestId("workspace-file-pane")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(fileTab).toContainText("●");
    await expect(page.getByTestId("workspace-file-pane")).toContainText("sigma", {
      timeout: 30_000,
    });

    // Back in the editor the edits are still there; closing the tab guards.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(editorContent).toContainText("sigma", { timeout: 30_000 });
    await fileTab.hover();
    await page.getByTestId(editorTabCloseTestId(FILE_PATH)).first().click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId(`workspace-tab-file_${FILE_PATH}`)).toBeHidden({
      timeout: 30_000,
    });
    expect(readSeededFile()).not.toContain("sigma");
  });

  test("follows disk changes when clean and banners when dirty", async ({ page }) => {
    const watchFilePath = join(workspace.repoPath, WATCH_FILE_PATH);

    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await expandFolder(page, "notes");
    await openFileFromExplorer(page, "watch.txt");
    await page.getByTestId("file-view-mode-editor").click();

    const filePane = page.getByTestId("workspace-file-tab-pane");
    await expect(filePane).toBeVisible({ timeout: 30_000 });
    const fileTab = page.getByTestId(`workspace-tab-file_${WATCH_FILE_PATH}`).first();
    const editorContent = filePane.locator(".cm-content");
    await expect(editorContent).toContainText("w-one", { timeout: 30_000 });

    // Clean buffer: an external write flows into the editor silently.
    writeFileSync(watchFilePath, "external-one\nw-two\n");
    await expect(editorContent).toContainText("external-one", { timeout: 30_000 });
    await expect(fileTab).not.toContainText("●");

    // Dirty buffer: an external write raises the banner and never clobbers.
    await editorContent.click();
    await page.keyboard.type("mine ");
    await expect(fileTab).toContainText("●", { timeout: 10_000 });
    writeFileSync(watchFilePath, "external-two\nw-two\n");
    await expect(page.getByTestId("editor-disk-banner")).toBeVisible({ timeout: 30_000 });
    await expect(editorContent).toContainText("mine");

    // Keep my changes → banner clears, and the save wins without a conflict.
    await page.getByTestId("editor-disk-keep").click();
    await expect(page.getByTestId("editor-disk-banner")).toBeHidden({ timeout: 10_000 });
    await page.getByTestId("editor-save").click();
    await expect(fileTab).not.toContainText("●", { timeout: 30_000 });
    await expect(page.getByTestId("editor-conflict-banner")).toBeHidden();
    await expect
      .poll(() => readFileSync(watchFilePath, "utf-8"), { timeout: 15_000 })
      .toContain("mine");
  });

  test("AI Refactor composes a scoped prompt into a pre-filled draft", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await expandFolder(page, "notes");
    await openFileFromExplorer(page, "todo.txt");
    await page.getByTestId("file-view-mode-editor").click();

    const filePane = page.getByTestId("workspace-file-tab-pane");
    await expect(filePane).toBeVisible({ timeout: 30_000 });
    const editorContent = filePane.locator(".cm-content");
    await expect(editorContent).toContainText("alpha", { timeout: 30_000 });

    // Select the first line, then open the refactor dialog.
    await editorContent.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByTestId("editor-refactor-toggle").click();

    const dialog = page.getByTestId("refactor-dialog-panel");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("refactor-dialog-scope")).toContainText("todo.txt");
    await page.getByTestId("refactor-dialog-input").fill("Rename alpha to first");
    await page.getByTestId("refactor-dialog-confirm").click();

    // A draft tab opens; its composer is pre-filled with the guarded prompt.
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await expect(composer).toHaveValue(/Rename alpha to first/, { timeout: 30_000 });
    await expect(composer).toHaveValue(/Scope rules/);
  });
});
