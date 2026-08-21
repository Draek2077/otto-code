import { test, expect } from "../support/fixtures";
import {
  expandFolder,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";
import {
  editorTabCloseTestId,
  filePreviewSurface,
  fileTabEditorContent,
  fileTabPane,
} from "../support/helpers/file-tab";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

// The unified file tab's editor/split/preview mode bar
// (components/file-view-mode-bar.tsx) with per-file mode memory
// (stores/file-view-store.ts). Markdown defaults to preview
// (components/file-pane-render-mode.ts); an explicit choice is remembered per
// file and wins on reopen.
//
// Also the bar's one non-mode: Formatted (markdown live preview), which is an
// orthogonal axis rather than a fourth position. The split-with-formatted-editor
// case is the cell a fourth mode would have cost, so it is asserted explicitly.

let workspace: SeededWorkspace;

const GUIDE_PATH = "docs/guide.md";
// The heading and the bold run sit well below line 1 on purpose: live preview
// reveals the caret's own line, and a fresh editor puts the caret at offset 0,
// so markers on the first line are legitimately visible and prove nothing.
const GUIDE_CONTENT =
  "# Guide\n\nRendered hello from guide.\n\n- alpha\n- beta\n\n## Details\n\nSome **bold** text.\n";

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
    repo: {
      files: [
        { path: GUIDE_PATH, content: GUIDE_CONTENT },
        { path: "src/app.ts", content: "export const answer = 42;\n" },
      ],
    },
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

  test("Formatted is an axis of the mode bar, not a fourth mode", async ({ page }) => {
    await openGuideFile(page);
    const formatted = page.getByTestId("file-view-formatted");

    // Preview: the segment keeps its place and goes inert. Visible-but-disabled
    // rather than withheld, so the bar does not change width with the mode.
    await page.getByTestId("file-view-mode-preview").click();
    await expect(formatted).toBeVisible({ timeout: 30_000 });
    await expect(formatted).toHaveAttribute("aria-disabled", "true");

    // Editor: on by default, so markers hide on every line but the caret's.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(fileTabEditorContent(page)).toContainText("Details", { timeout: 30_000 });
    await expect(formatted).not.toHaveAttribute("aria-disabled", "true");
    await expect(fileTabEditorContent(page)).not.toContainText("## Details");
    await expect(fileTabEditorContent(page)).not.toContainText("**bold**");

    // Off: the raw source comes back, in the same mode. This is the pair that
    // cannot be a radio position alongside the modes.
    await formatted.click();
    await expect(fileTabEditorContent(page)).toContainText("## Details", { timeout: 30_000 });
    await expect(fileTabEditorContent(page)).toContainText("**bold**");

    // The cell a fourth mode would have cost: split, with a formatted editor
    // beside the rendered preview.
    await page.getByTestId("file-view-mode-split").click();
    await expect(page.getByTestId("file-split-preview")).toBeVisible({ timeout: 30_000 });
    await expect(formatted).not.toHaveAttribute("aria-disabled", "true");
    await formatted.click();
    await expect(fileTabEditorContent(page)).not.toContainText("## Details", { timeout: 30_000 });
    await expect(page.getByTestId("file-split-editor")).toBeVisible();
    await expect(page.getByTestId("file-split-preview")).toBeVisible();
  });

  test("the Formatted segment is withheld for a file that is not markdown", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await expandFolder(page, "src");
    await openFileFromExplorer(page, "app.ts");
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });

    // Code opens straight in the editor, and gets the three modes with no
    // fourth glyph: withheld, not disabled, because the axis does not exist
    // here at all.
    await expect(page.getByTestId("file-view-mode-editor")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-view-formatted")).toHaveCount(0);
  });
});
