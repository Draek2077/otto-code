import { test, expect } from "../support/helpers/otto-provider-settings"; // OTTO(refine)
import { z } from "zod";
import { openFileExplorer, openFileFromExplorer } from "../support/helpers/file-explorer";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

function editorDialog(page: Page, testId: string, compact: boolean) {
  // AdaptiveModalSheet's testID labels only the header on compact screens;
  // the accessible sheet owns its body and footer as siblings of that header.
  return compact
    ? page.getByRole("slider", { name: "Bottom Sheet", exact: true }).filter({
        visible: true,
        has: page.getByTestId(testId),
      })
    : page.getByTestId(testId);
}

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

const RefineCompletion = z.object({
  messages: z.array(z.object({ role: z.literal("user"), content: z.string() })).length(1),
});
const RefineRequest = z.object({
  rewritableDocuments: z.array(z.object({ id: z.string(), content: z.string() })).length(1),
  readOnlyReferences: z.array(z.object({ content: z.string() })),
});

test("Document tools opens Refine and applies the reviewed changes only", async ({
  page,
  withWorkspace,
  ottoProvider,
}) => {
  test.setTimeout(120_000);
  const workspace = await withWorkspace({ prefix: "otto-editor-refine-" });
  const file = path.join(workspace.repoPath, "guide.md");
  const original =
    "# Review this prose\n\nPreserve one.\nPreserve two.\nPreserve three.\n\nThe last rule is too long.\n[Details](details.md)\n";
  const accepted = original.replace("Review this prose", "Concise prose");
  const proposal = accepted.replace("The last rule is too long.", "The last rule is short.");
  const reference = path.join(workspace.repoPath, "details.md");
  await writeFile(file, original);
  await writeFile(reference, "Reference bytes.");
  ottoProvider.replyWith((body) => {
    const prompt = RefineCompletion.parse(body).messages[0]!.content;
    const start = prompt.indexOf('\n\n{"instruction":');
    const end = prompt.indexOf("\n\nYou must respond with JSON only", start);
    const input = RefineRequest.parse(JSON.parse(prompt.slice(start + 2, end)));
    expect(body).not.toHaveProperty("tools");
    expect(input.rewritableDocuments[0]!.content).toBe(original);
    expect(input.readOnlyReferences.map(({ content }) => content)).toContain("Reference bytes.");
    return JSON.stringify({ files: [{ id: input.rewritableDocuments[0]!.id, content: proposal }] });
  });
  await ottoProvider.refreshCatalog();
  await workspace.navigateTo();
  await openFileExplorer(page);
  await openFileFromExplorer(page, "guide.md");
  await page
    .getByTestId(/^(editor-document-tools|editor-code-menu)$/)
    .filter({ visible: true })
    .click();
  await page.getByTestId("editor-refine").click();
  const refine = editorDialog(page, "editor-refine-dialog", false);
  await expect(refine.getByText("guide.md", { exact: true }).first()).toBeVisible();
  await expect(refine.getByText("Read-only references (1)", { exact: true })).toBeVisible();
  const apply = refine.getByRole("button", { name: "Apply kept changes", exact: true });
  await expect(apply).toBeDisabled();
  await refine.getByTestId("combined-model-selector").click();
  await page
    .getByTestId("model-search-all-input")
    .or(page.getByTestId("model-search-input"))
    .filter({ visible: true })
    .fill("fixture");
  await page.getByTestId("model-row-openai-compatible-fixture").click();
  await refine
    .getByTestId("context-compaction-instruction")
    .fill("Tighten the opening and final rule.");
  await refine.getByRole("button", { name: "Generate proposal", exact: true }).click();
  await expect(
    refine.getByRole("button", { name: "Drop guide.md change h0", exact: true }),
  ).toBeVisible();
  await refine.getByRole("button", { name: "Drop guide.md change h1", exact: true }).click();
  expect(await readFile(file, "utf8")).toBe(original);
  page.once("dialog", (dialog) => void dialog.accept());
  await apply.click();
  await expect.poll(() => readFile(file, "utf8")).toBe(accepted);
  expect(await readFile(reference, "utf8")).toBe("Reference bytes.");
  expect(ottoProvider.requests).toHaveLength(1);
});
test("File History follows a revision and switches its real diff to Structural", async ({
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "otto-file-history-" });
  const file = path.join(workspace.repoPath, "history.ts");
  await writeFile(file, "export const total = 1;\n");
  commitFixture(workspace.repoPath, "Seed history");
  await writeFile(file, "export const total = 2;\n");
  commitFixture(workspace.repoPath, "Change the total");
  await workspace.navigateTo();
  await openFileExplorer(page);
  await openFileFromExplorer(page, "history.ts");
  await page.getByTestId("editor-code-menu").click();
  await page.getByTestId("editor-file-history").click();
  const history = page.getByTestId("otto-file-history");
  await expect(history.getByText("Change the total", { exact: true })).toBeVisible();
  await expect(history.getByTestId("git-diff-canvas")).toBeVisible();
  await history.getByTestId("otto-diff-presentation").click();
  await page.getByText("Structural", { exact: true }).last().click();
  await expect(history.getByTestId("otto-diff-presentation")).toContainText("Structural");
  await history.getByRole("button", { name: "Blame lines", exact: true }).click();
  await expect(history.getByTestId("otto-file-blame-line-1")).toContainText("Change the total");
});

function commitFixture(cwd: string, subject: string) {
  execFileSync("git", ["add", "history.ts"], { cwd });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", subject], { cwd });
}

for (const compact of [false, true]) {
  test(`File Editor navigation, reviewed edits, Markdown and retained source (${compact ? "compact" : "wide"})`, async ({
    page,
    withWorkspace,
  }, info) => {
    test.setTimeout(150000);
    page.setDefaultTimeout(30000);
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
    const searchNote = editorDialog(page, "editor-document-note", compact);
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
      .getByLabel("Source editor for editor.ts", { exact: true })
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
    await page.getByTestId("editor-rename-symbol-input").fill("total");
    await page.getByTestId("editor-rename-symbol-submit").click();
    const review = editorDialog(page, "editor-rename-review", compact);
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
    const refactor = editorDialog(page, "editor-refactor", compact);
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
    const guide = page.getByTestId("workspace-file-pane").filter({
      has: page.getByLabel("Source editor for guide.md", { exact: true }),
      visible: true,
    });
    const markdownEditor = guide.getByTestId("file-source-editor").locator(".cm-content");
    await expect(markdownEditor).toContainText("Editor guide");
    await markdownEditor.press("ControlOrMeta+End");
    await markdownEditor.press("Enter");
    await markdownEditor.pressSequentially("Retained edit");
    await guide.getByTestId("file-mode-split").click();
    await expect(guide.getByTestId("file-split-editor")).toBeVisible();
    await expect(guide.getByTestId("file-split-preview")).toBeVisible();
    await expect(guide.getByTestId("file-split-preview")).toContainText("Retained edit");
    await page.screenshot({ path: info.outputPath("editor-split.png") });
    await guide.getByTestId("file-mode-preview").click();
    await guide.getByTestId("file-mode-source").click();
    await expect(markdownEditor).toContainText("Retained edit");
    await markdownEditor.focus();
    await markdownEditor.press("ControlOrMeta+z");
    await expect(markdownEditor).not.toContainText("Retained edit");
    await guide.getByTestId("file-mode-preview").click();
    await guide.getByRole("button", { name: "Comment on heading", exact: true }).click();
    const note = editorDialog(page, "editor-document-note", compact);
    await note
      .getByRole("textbox", { name: "Document review note", exact: true })
      .fill("Keep this heading source-backed");
    await note.getByRole("button", { name: "Save note", exact: true }).click();
    await guide.getByRole("button", { name: "Edit document note", exact: true }).click();
    await note.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      guide.getByRole("button", { name: "Comment on heading", exact: true }),
    ).toBeVisible();
    await guide.getByTestId("editor-document-tools").click();
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
