import { test, expect } from "./fixtures";
import { expandFolder, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import {
  editorTabCloseTestId,
  filePreviewSurface,
  fileTabEditorContent,
  fileTabPane,
} from "./helpers/file-tab";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

// The unified file tab's editor/split/preview mode bar
// (components/file-view-mode-bar.tsx) with per-file mode memory
// (stores/file-view-store.ts). Markdown defaults to preview
// (components/file-pane-render-mode.ts); an explicit choice is remembered per
// file and wins on reopen.

let workspace: SeededWorkspace;

const GUIDE_PATH = "docs/guide.md";
const GUIDE_CONTENT = "# Guide\n\nRendered hello from guide.\n\n- alpha\n- beta\n";

async function openGuideFile(page: Parameters<typeof gotoWorkspace>[0]): Promise<void> {
  await gotoWorkspace(page, workspace.workspaceId);
  await openFileExplorer(page);
  await expandFolder(page, "docs");
  await openFileFromExplorer(page, "guide.md");
  await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
}

async function closeGuideTab(page: Parameters<typeof gotoWorkspace>[0]): Promise<void> {
  const fileTab = page.getByTestId(`workspace-tab-file_${GUIDE_PATH}`).first();
  await fileTab.hover();
  await page.getByTestId(editorTabCloseTestId(GUIDE_PATH)).first().click();
  await expect(page.getByTestId(`workspace-tab-file_${GUIDE_PATH}`)).toBeHidden({
    timeout: 30_000,
  });
}

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "mode-bar-",
    repo: { files: [{ path: GUIDE_PATH, content: GUIDE_CONTENT }] },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("File tab mode bar", () => {
  test("markdown opens in preview and the mode bar switches all three surfaces", async ({
    page,
  }) => {
    await openGuideFile(page);

    // Fresh file, fresh storage: markdown defaults to the rendered preview.
    await expect(page.getByTestId("file-view-mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect(filePreviewSurface(page)).toBeVisible({ timeout: 30_000 });
    await expect(filePreviewSurface(page)).toContainText("Rendered hello from guide.", {
      timeout: 30_000,
    });
    await expect(fileTabEditorContent(page)).toHaveCount(0);

    // Editor: the CM6 buffer shows the raw markdown, the preview unmounts.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(fileTabEditorContent(page)).toContainText("Rendered hello from guide.", {
      timeout: 30_000,
    });
    await expect(filePreviewSurface(page)).toBeHidden();

    // Split: editor and preview render side by side.
    await page.getByTestId("file-view-mode-split").click();
    await expect(page.getByTestId("file-split-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-split-preview")).toBeVisible();
    await expect(fileTabEditorContent(page)).toContainText("Rendered hello from guide.");
    await expect(filePreviewSurface(page)).toBeVisible();

    // Back to preview: the editor surface goes away entirely.
    await page.getByTestId("file-view-mode-preview").click();
    await expect(filePreviewSurface(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-split-editor")).toBeHidden();
    await expect(fileTabEditorContent(page)).toHaveCount(0);
  });

  test("per-file mode memory survives closing and reopening the tab", async ({ page }) => {
    await openGuideFile(page);

    // Pick editor, close the clean tab, reopen: editor comes back directly.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(fileTabEditorContent(page)).toContainText("Rendered hello from guide.", {
      timeout: 30_000,
    });
    await closeGuideTab(page);
    await openFileFromExplorer(page, "guide.md");
    await expect(fileTabEditorContent(page)).toContainText("Rendered hello from guide.", {
      timeout: 30_000,
    });
    await expect(filePreviewSurface(page)).toBeHidden();

    // Pick split, close, reopen: split is remembered.
    await page.getByTestId("file-view-mode-split").click();
    await expect(page.getByTestId("file-split-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-split-preview")).toBeVisible();
    await closeGuideTab(page);
    await openFileFromExplorer(page, "guide.md");
    await expect(page.getByTestId("file-split-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-split-preview")).toBeVisible();

    // The memory is per file: a different markdown file still opens in its
    // path-derived default (preview), not guide.md's remembered split.
    await openFileFromExplorer(page, "README.md");
    await expect(page.getByTestId("workspace-tab-file_README.md").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(filePreviewSurface(page)).toBeVisible({ timeout: 30_000 });
    await expect(filePreviewSurface(page)).toContainText("Temp Repo", { timeout: 30_000 });
    await expect(page.getByTestId("file-split-editor")).toBeHidden();
    await expect(fileTabEditorContent(page)).toHaveCount(0);
  });
});
