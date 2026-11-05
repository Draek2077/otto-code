import { test, expect } from "../support/fixtures";
import { openFileExplorer, openFileFromExplorer } from "../support/helpers/file-explorer";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

async function openEditorExplorer(page: Page, compact: boolean) {
  if (!compact) return openFileExplorer(page);
  const files = page.getByTestId("explorer-tab-files").filter({ visible: true });
  if (!(await files.isVisible()))
    await page.getByTestId("workspace-explorer-toggle").first().click();
  await expect(files).toBeVisible();
  await files.click();
  await expect(
    page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }),
  ).toBeVisible();
}

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`File Editor navigation, reviewed edits, Markdown and retained source (${compact ? "compact" : "wide"})`, async ({
    page,
    withWorkspace,
  }, info) => {
    test.setTimeout(150000);
    const workspace = await withWorkspace({ prefix: "otto-editor-" });
    const source = "export const count = 1;\nconsole.log(count);\n";
    const file = path.join(workspace.repoPath, "editor.ts");
    await writeFile(file, source);
    await writeFile(path.join(workspace.repoPath, "guide.md"), "# Editor guide\n\nA paragraph.\n");
    await workspace.navigateTo();
    await openFileExplorer(page);
    await openFileFromExplorer(page, "editor.ts");
    // Seed the file route through the shared desktop setup helper, then use the
    // compact Explorer overlay and editor controls throughout the mobile journey.
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    await openEditorExplorer(page, compact);
    await page.getByTestId("files-search-contents").click();
    const initialSearch = page.getByTestId("editor-project-search");
    await initialSearch
      .getByRole("textbox", { name: "Find in workspace", exact: true })
      .fill("count");
    await initialSearch
      .getByRole("textbox", { name: "Files to include", exact: true })
      .fill("*.ts");
    await initialSearch.getByRole("button", { name: "Search", exact: true }).click();
    await expect(initialSearch).toContainText("2 matches");
    await initialSearch
      .getByRole("button", { name: "Comment on result", exact: true })
      .first()
      .click();
    const searchNote = page.getByTestId("editor-document-note");
    await searchNote
      .getByRole("textbox", { name: "Document review note", exact: true })
      .fill("Review this use of count");
    await searchNote.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(initialSearch).toContainText("Review this use of count");
    await initialSearch.getByRole("button", { name: "Edit search note", exact: true }).click();
    await searchNote.getByRole("button", { name: "Delete", exact: true }).click();
    await initialSearch.getByRole("button", { name: "Close", exact: true }).click();
    await openFileFromExplorer(page, "editor.ts");
    const editor = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-content");
    await expect(editor).toContainText("count");
    await expect(page.getByTestId("editor-status-bar")).toBeVisible();
    await page.getByTestId("editor-code-menu").click();
    await page.getByRole("menuitem", { name: "Outline", exact: false }).click();
    await expect(page.getByTestId("editor-code-results")).toContainText("count", {
      timeout: 30000,
    });
    await page
      .getByTestId("editor-code-results")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await editor.focus();
    await editor.press("ControlOrMeta+Home");
    await editor.press("ArrowRight", { delay: 10 });
    for (let index = 0; index < 13; index++) await editor.press("ArrowRight");
    await page.getByTestId("editor-code-menu").click();
    await page.getByRole("menuitem", { name: "Inspect symbol", exact: true }).click();
    const inspection = page.getByTestId("editor-code-results");
    await expect(inspection).toContainText("count");
    await inspection.getByRole("button", { name: "Close", exact: true }).click();
    await editor.focus();
    await editor.press("F2");
    const rename = page.getByTestId("editor-rename-symbol");
    await rename.getByRole("textbox").fill("total");
    await rename.getByRole("button", { name: "Preview rename", exact: true }).click();
    const review = page.getByTestId("editor-rename-review");
    await expect(review).toContainText("total");
    page.once("dialog", (dialog) => void dialog.accept());
    await review.getByRole("button", { name: "Apply reviewed edits", exact: true }).click();
    await expect.poll(() => readFile(file, "utf8")).toBe(source.replaceAll("count", "total"));
    page.once("dialog", (dialog) => void dialog.accept());
    await review.getByRole("button", { name: "Undo edits", exact: true }).click();
    await expect.poll(() => readFile(file, "utf8")).toBe(source);
    await review.getByTestId("editor-review-close").click();
    await page.getByTestId("editor-code-menu").click();
    await page.getByRole("menuitem", { name: "Refactor with AI", exact: true }).click();
    const refactor = page.getByTestId("editor-refactor");
    await refactor
      .getByRole("textbox", { name: "Refactor instruction", exact: true })
      .fill("Extract a small helper");
    await refactor.getByRole("button", { name: "Open request draft", exact: true }).click();
    await expect(
      page
        .getByRole("textbox", { name: "Message agent...", exact: true })
        .filter({ visible: true }),
    ).toHaveValue(/Instruction: Extract a small helper/);
    expect(await readFile(file, "utf8")).toBe(source);
    await openEditorExplorer(page, compact);
    await openFileFromExplorer(page, "editor.ts");
    await page.getByTestId("editor-code-menu").click();
    await page.getByRole("menuitem", { name: "Search and replace in files", exact: true }).click();
    const search = page.getByTestId("editor-project-search");
    await search.getByRole("textbox", { name: "Find in workspace", exact: true }).fill("count");
    await search.getByRole("textbox", { name: "Files to include", exact: true }).fill("*.ts");
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(search).toContainText("2 matches");
    await search.getByRole("textbox", { name: "Replace with", exact: true }).fill("amount");
    await search.getByRole("button", { name: "Review replacements", exact: true }).click();
    await expect(review).toContainText("amount");
    await review.getByTestId("editor-review-close").click();
    await search.getByRole("button", { name: "Close", exact: true }).click();
    expect(await readFile(file, "utf8")).toBe(source);
    await openEditorExplorer(page, compact);
    await openFileFromExplorer(page, "guide.md");
    await page.getByTestId("file-mode-source").filter({ visible: true }).click();
    await expect(editor).toContainText("Editor guide");
    await editor.press("ControlOrMeta+End");
    await editor.press("Enter");
    await editor.pressSequentially("Retained edit");
    await page.getByTestId("file-mode-split").click();
    await expect(page.getByTestId("editor-split-preview")).toBeVisible();
    await expect(page.getByTestId("file-split-preview")).toContainText("Retained edit");
    await page.getByTestId("file-mode-preview").click();
    await page.getByTestId("file-mode-source").filter({ visible: true }).click();
    await expect(editor).toContainText("Retained edit");
    await editor.focus();
    await editor.press("ControlOrMeta+z");
    await expect(editor).not.toContainText("Retained edit");
    await page.getByTestId("file-mode-preview").click();
    await page.getByRole("button", { name: "Comment on heading", exact: true }).click();
    const note = page.getByTestId("editor-document-note");
    await note
      .getByRole("textbox", { name: "Document review note", exact: true })
      .fill("Keep this heading source-backed");
    await note.getByRole("button", { name: "Save note", exact: true }).click();
    await page.getByRole("button", { name: "Edit document note", exact: true }).click();
    await note.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Comment on heading", exact: true }),
    ).toBeVisible();
    await page.getByTestId("editor-document-tools").click();
    await page.getByRole("menuitem", { name: "Export new HTML file", exact: true }).click();
    await expect
      .poll(
        async () => {
          try {
            return await readFile(path.join(workspace.repoPath, "guide.html"), "utf8");
          } catch (error) {
            if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return "";
            throw error;
          }
        },
        { timeout: 15000 },
      )
      .toContain("<h1>Editor guide</h1>");
    await page.screenshot({ path: info.outputPath("editor-workspace.png") });
  });
}

for (const mode of ["vim", "neovim", "custom"] as const) {
  test(`Real file-owned ${mode} PTY saves on the owning host and requires confirmation to stop`, async ({
    page,
    withWorkspace,
  }, info) => {
    test.setTimeout(120000);
    const workspace = await withWorkspace({ prefix: `otto-editor-${mode}-` });
    const filename = mode === "vim" ? "guide with spaces.md" : "file with spaces.txt";
    const file = path.join(workspace.repoPath, filename);
    await writeFile(file, "before\n");
    const script = path.join(workspace.repoPath, "editor-fixture.mjs");
    await writeFile(
      script,
      "import {createInterface} from 'node:readline'; import {writeFileSync} from 'node:fs'; console.log('EDITOR READY'); createInterface({input:process.stdin}).on('line', line => {if(line === 'save') writeFileSync(process.argv[2], 'saved by custom\\n');});",
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
    await page.addInitScript(
      ({ selected, custom }) =>
        localStorage.setItem(
          "@otto:app-settings",
          JSON.stringify({ fileEditorMode: selected, fileEditorCustomCommand: custom }),
        ),
      { selected: mode, custom: command },
    );
    await workspace.navigateTo();
    await page.reload();
    await openFileExplorer(page);
    await openFileFromExplorer(page, filename);
    if (mode === "vim")
      await page.getByTestId("file-mode-source").filter({ visible: true }).click();
    const pane = page.getByTestId("otto-terminal-file-editor");
    await expect(pane).toBeVisible();
    const input = pane.locator(".xterm-helper-textarea");
    await expect(input).toHaveCount(1, { timeout: 30000 });
    await input.focus();
    if (mode === "custom") await page.keyboard.type("save\n");
    else {
      await page.keyboard.press("Escape");
      await page.keyboard.type(":call setline(1, 'saved by editor')\n");
      await page.keyboard.type(":w\n");
    }
    await expect
      .poll(() => readFile(file, "utf8"))
      .toContain(mode === "custom" ? "saved by custom" : "saved by editor");
    page.once("dialog", (dialog) => void dialog.dismiss());
    await pane.getByRole("button", { name: "Use Otto editor", exact: true }).click();
    await expect(pane).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await pane.getByRole("button", { name: "Use Otto editor", exact: true }).click();
    await expect(page.getByTestId("file-source-editor").filter({ visible: true })).toContainText(
      "saved by",
    );
    await page.screenshot({ path: info.outputPath(`editor-${mode}.png`) });
  });
}
