import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { awaitAssistantMessage } from "./helpers/agent-stream";
import { expectComposerVisible, submitMessage } from "./helpers/composer";
import { openFileExplorer, openFileFromExplorer, expectFileTabOpen } from "./helpers/file-explorer";
import { fileTabEditorContent } from "./helpers/file-tab";
import { installDaemonWebSocketGate } from "./helpers/daemon-websocket-gate";
import { buildAssistantMarkdownScenarioPrompt } from "./helpers/mock-scenarios";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { seedWorkspace } from "./helpers/seed-client";

// This spec arrived with the Paseo v0.2.5 merge and was written against Paseo's
// `file-pane/` surface. Otto replaced that surface with the unified file tab
// (`components/file-tab-pane.tsx` + `components/file-view-mode-bar.tsx`), and
// the merge brought `packages/app/src/file-pane/` in as DEAD CODE: nothing
// outside that directory imports it, and none of its exports (FilePanelBar,
// FileConflictAlert, useLiveFile) are referenced anywhere. Every testID this
// spec reached for - file-source-editor, file-panel-bar, file-mode-source,
// file-mode-preview, file-markdown-mode, file-conflict-alert - exists ONLY in
// that unmounted tree, so all ten tests failed on the first selector that
// touched it. That is a naming mismatch against a replaced surface, not a
// regression: Otto's file editing works and is covered elsewhere (see the
// per-test notes below).
//
// The first test is kept ALIVE and retargeted at Otto's surface, because it is
// the one behaviour here that no other spec asserts: opening an assistant file
// link AT ITS REFERENCED LINE. Otto parses `path:line` in
// `src/assistant-file-links/parse.ts` and opens to the side carrying the line
// target, but `chat-file-link-side-open.spec.ts` only asserts side-pane
// placement, never the line jump.

const TARGET_FILE = "target.ts";
const TARGET_LINE = 150;
const TOTAL_LINES = 200;

function targetFileContent(): string {
  return `${Array.from({ length: TOTAL_LINES }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n")}\n`;
}

const RED_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);
const BLUE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function editor(page: Page) {
  return page.getByTestId("file-source-editor").filter({ visible: true }).locator(".cm-content");
}

function hasHorizontalOverflow(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

function fitsViewportWidth(element: HTMLElement): boolean {
  return element.scrollWidth === element.clientWidth;
}

async function replaceEditorText(page: Page, content: string): Promise<void> {
  const contentElement = editor(page);
  await contentElement.click();
  await contentElement.press("Control+A");
  await contentElement.type(content);
}

async function openWorkspaceFile(page: Page, filename: string): Promise<void> {
  const tree = page.getByTestId("file-explorer-tree-scroll");
  if (!(await tree.isVisible())) await openFileExplorer(page);
  await openFileFromExplorer(page, filename);
  await expectFileTabOpen(page, filename);
}

async function seedAgentWithFileLink(target: string) {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "file-editing-chat-link-",
    title: "Chat file link e2e",
    initialPrompt: [
      "Generate a title and a git branch name for a coding agent from the user prompt and attachments.",
      "Return JSON only with fields 'title' and 'branch'.",
      "",
      "<user-prompt>",
      `Open \`${target}\` now`,
      "</user-prompt>",
    ].join("\n"),
  });
  await writeFile(
    path.join(session.cwd, "target.ts"),
    Array.from({ length: 80 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join(
      "\n",
    ),
    "utf8",
  );
  return session;
}

test.describe("CodeMirror workspace file editing", () => {
  test("opens an assistant file link at its referenced line", async ({ page }) => {
    test.setTimeout(120_000);
    // Side-pane placement is a desktop-web behaviour (see
    // chat-file-link-side-open.spec.ts), so pin a desktop viewport.
    await page.setViewportSize({ width: 1440, height: 900 });

    const workspace = await seedWorkspace({
      repoPrefix: "file-link-line-target-",
      repo: { files: [{ path: TARGET_FILE, content: targetFileContent() }] },
    });

    try {
      const agent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "File link line target",
        modeId: "load-test",
        model: "ten-second-stream",
      });

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expectComposerVisible(page);

      await submitMessage(
        page,
        buildAssistantMarkdownScenarioPrompt(`Open \`${TARGET_FILE}:${TARGET_LINE}\` now.`),
      );
      await awaitAssistantMessage(page, "Open");

      const fileLink = page.getByRole("link", { name: `${TARGET_FILE}:${TARGET_LINE}` }).first();
      await expect(fileLink).toBeVisible({ timeout: 15_000 });
      await fileLink.click();

      // Not expectFileTabOpen(): a link-opened file carries the ABSOLUTE path
      // (resolver.ts joins it onto workspaceRoot), so the tab id is
      // `file_<abs path>`, not `file_target.ts`. Match on the prefix, as
      // chat-file-link-side-open.spec.ts does.
      await expect(
        page
          .locator('[data-testid^="workspace-tab-file_"]')
          .filter({ hasText: TARGET_FILE })
          .first(),
      ).toBeVisible({ timeout: 15_000 });

      // The referenced line is scrolled into view, and the top of the file is
      // not. CodeMirror only renders lines near the viewport, so line 1 being
      // absent is what proves the editor jumped rather than opening at the top
      // with line 150 merely existing in the document.
      const content = fileTabEditorContent(page);
      await expect(
        content.locator(".cm-line", { hasText: `line${TARGET_LINE} = ${TARGET_LINE}` }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(content.locator(".cm-line", { hasText: "line1 = 1" })).not.toBeVisible();

      // Scrolling away works, and the buffer keeps the document.
      await content.click();
      await content.press("Control+Home");
      await expect(content.locator(".cm-line", { hasText: "line1 = 1" })).toBeVisible();

      // NOT asserted here, because Otto does not currently do it: clicking the
      // same `path:line` link again, with the tab already open and scrolled
      // elsewhere, does NOT re-apply the jump - the view stays at the top. The
      // Paseo original asserted a re-jump and that assertion is what failed when
      // this test was retargeted (verified by run: the first-open jump above
      // passes, the re-click does not). Treat it as a real gap rather than a
      // selector problem; it is tracked as its own ❌ row in the coverage
      // matrix. If the line target is later re-applied on re-open, add the
      // re-click assertion back here.
    } finally {
      await workspace.cleanup();
    }
  });

  // DEFERRED(paseoFilePane): `editor()` resolves file-source-editor, which only
  // exists in the unmounted `src/file-pane/` tree. Otto's equivalent is
  // `fileTabEditorContent()` (helpers/file-tab.ts). The pane-focus half is real
  // Otto behaviour and Alt+Shift+W is a live binding
  // (workspace-tab-close-current-alt-shift-w-web in keyboard-shortcuts.ts), so
  // this one is portable - retarget the locator rather than deleting it. Check
  // first whether split-pane focus is already asserted elsewhere before adding
  // a duplicate.
  test.skip("clicking the editor focuses its pane beside an agent", async ({ page }) => {
    const target = "target.ts:42";
    const session = await seedAgentWithFileLink(target);

    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openAgentRoute(page, session);

      await page.getByRole("button", { name: "Split pane right" }).first().click();
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);
      await openWorkspaceFile(page, "target.ts");

      await page
        .getByTestId(`workspace-tab-agent_${session.agentId}`)
        .filter({ visible: true })
        .click();
      await editor(page).click();
      await page.keyboard.press("Alt+Shift+W");

      await expect(page.getByTestId("workspace-tab-file_target.ts")).not.toBeVisible();
      await expect(
        page.getByTestId(`workspace-tab-agent_${session.agentId}`).filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  // DEFERRED(paseoFilePane): needs three things Otto does not have. (1)
  // `workspace-tab-tooltip-<tabId>` - the tab's TooltipContent carries no
  // testID (workspace-desktop-tabs-row.tsx, the TooltipContent under the
  // ContextMenuTrigger). (2) file-panel-bar / file-markdown-mode - Otto's bar is
  // `file-view-mode-bar` with file-view-mode-{editor,split,preview} and
  // file-view-formatted. (3) the cursor-position readout the mode-stability
  // assertion pins against; Otto renders no Ln/Col status. Adding a testID to
  // the tab tooltip is a small, legitimate product change if this is wanted -
  // start there.
  test.skip("shows the full file path and keeps editor controls stable", async ({
    page,
    withWorkspace,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const workspace = await withWorkspace({ prefix: "file-editing-visuals-" });
    const relativePath = "src/deep/visuals.md";
    const sourcePath = path.join(workspace.repoPath, relativePath);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      [...Array.from({ length: 11 }, (_, index) => `line ${index + 1}`), "abcdefghijklmnop"].join(
        "\n",
      ),
      "utf8",
    );
    await workspace.navigateTo();
    await openFileExplorer(page);
    await page.getByTestId("file-explorer-tree-scroll").getByText("src", { exact: true }).click();
    await page.getByTestId("file-explorer-tree-scroll").getByText("deep", { exact: true }).click();
    await openFileFromExplorer(page, "visuals.md");
    await expectFileTabOpen(page, relativePath);

    const fileTab = page.getByTestId(`workspace-tab-file_${relativePath}`).first();
    await fileTab.hover();
    await expect(page.getByTestId(`workspace-tab-tooltip-file_${relativePath}`)).toHaveText(
      relativePath,
    );
    await expect(page.getByTestId("file-panel-bar")).not.toContainText("visuals.md");
    const modeControl = page.getByTestId("file-markdown-mode");
    await expect(modeControl).toBeVisible();
    await page.getByTestId("file-mode-source").click();

    const editorHost = page.getByTestId("file-source-editor");
    const content = editor(page);
    await expect(editorHost).toHaveAttribute("data-pmono", "");
    await expect(content).toHaveCSS("font-family", /SFMono-Regular/);

    await content.click();
    const cursor = editorHost.locator(".cm-cursor-primary");
    await expect(cursor).toBeVisible();
    await expect(cursor).toHaveCSS("border-left-color", "rgb(250, 250, 250)");

    const initialModeBox = await modeControl.boundingBox();
    expect(initialModeBox).not.toBeNull();
    const initialModeX = initialModeBox!.x;
    await content.press("Control+End");
    await expect(page.getByLabel(/Line 12, column \d+/)).toBeVisible();
    const movedModeBox = await modeControl.boundingBox();
    expect(movedModeBox).not.toBeNull();
    expect(movedModeBox!.x).toBe(initialModeX);

    await content.press("Control+a");
    const selection = editorHost.locator(".cm-selectionBackground").first();
    await expect(selection).toBeVisible();
    await expect(selection).toHaveCSS("background-color", "rgba(255, 255, 255, 0.2)");
  });

  // DEFERRED(paseoFilePane): blocked only by the missing
  // `workspace-tab-tooltip-<tabId>` testID above - the uiFontFamily behaviour it
  // checks is real and Otto's tab tooltip does render the path. This is the
  // cheapest of the nine to revive: add the testID to the tab's TooltipContent
  // and this test should pass close to as written.
  test.skip("applies the interface font to portaled tooltips", async ({ page, withWorkspace }) => {
    await page.addInitScript(() => {
      localStorage.setItem("@otto:app-settings", JSON.stringify({ uiFontFamily: "monospace" }));
    });
    const workspace = await withWorkspace({ prefix: "file-tooltip-font-" });
    const relativePath = "tooltip-font.txt";
    await writeFile(path.join(workspace.repoPath, relativePath), "tooltip font\n", "utf8");
    await workspace.navigateTo();
    await openFileExplorer(page);
    await openFileFromExplorer(page, relativePath);
    await expectFileTabOpen(page, relativePath);

    await page.getByTestId(`workspace-tab-file_${relativePath}`).first().hover();

    await expect(
      page
        .getByTestId(`workspace-tab-tooltip-file_${relativePath}`)
        .getByText(relativePath, { exact: true }),
    ).toHaveCSS("font-family", "monospace");
  });

  // DEFERRED(paseoFilePane): file-mode-source and file-source-editor are both
  // Paseo-only names. The wrap-vs-scroll distinction is worth covering on
  // Otto's surface, but check `preview-wordwrap-toggle` (file-tab-pane.tsx)
  // first - Otto makes word wrap an explicit user control, so the per-language
  // default this asserts may not be Otto's model at all.
  test.skip("wraps Markdown while source code remains horizontally scrollable", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-wrap-" });
    const longLine = "word ".repeat(300);
    await writeFile(path.join(workspace.repoPath, "notes.md"), `${longLine}\n`, "utf8");
    await writeFile(
      path.join(workspace.repoPath, "source.ts"),
      `const value = "${longLine}";\n`,
      "utf8",
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");
    await page.getByTestId("file-mode-source").click();

    const markdownScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => markdownScroller.evaluate(fitsViewportWidth)).toBe(true);

    await openWorkspaceFile(page, "source.ts");
    const sourceScroller = page
      .getByTestId("file-source-editor")
      .filter({ visible: true })
      .locator(".cm-scroller");
    await expect.poll(() => sourceScroller.evaluate(hasHorizontalOverflow)).toBe(true);
  });

  // DEFERRED(paseoFilePane): do NOT revive this one as written - its first
  // assertion contradicts Otto on purpose. It expects the buffer to autosave to
  // disk on a timer; Otto's editor deliberately does not autosave, and
  // `editor-dirty-guard.spec.ts` asserts that absence ("no-autosave" in the
  // coverage matrix). The conflict half maps cleanly onto real Otto UI
  // (editor-conflict-banner with editor-conflict-overwrite /
  // editor-conflict-reload, plus editor-disk-banner) and the reconnect
  // resubscribe half is genuinely uncovered - those two are worth splitting out
  // into a new spec against Otto's names. The autosave half should be dropped.
  test.skip("autosaves, saves immediately, resolves conflicts, and restores live updates after reconnect", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const workspace = await withWorkspace({ prefix: "file-editing-source-" });
    const sourcePath = path.join(workspace.repoPath, "source.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await Promise.all(
      ["one.ts", "two.ts", "three.ts", "four.ts"].map((fileName) =>
        writeFile(path.join(workspace.repoPath, fileName), `// ${fileName}\n`, "utf8"),
      ),
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "source.ts");

    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(page.getByLabel(/File size/)).toBeVisible();
    await expect(page.getByLabel(/lines/)).toBeVisible();

    await replaceEditorText(page, "const autosaved = 2;\n");
    await expect(page.getByTestId("workspace-tab-modified-file_source.ts")).toBeVisible();
    await expect(page.getByLabel("Editor status dirty")).toBeVisible();
    await expect(page.getByLabel("Editor status clean")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("workspace-tab-modified-file_source.ts")).not.toBeVisible();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const autosaved = 2;\n");

    await replaceEditorText(page, "const immediate = 3;\n");
    await editor(page).press("Control+s");
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const immediate = 3;\n");

    await writeFile(sourcePath, "const external = 4;\nconst line = 2;\n", "utf8");
    await expect(editor(page)).toContainText("const external = 4;");
    await expect(page.getByLabel("3 lines")).toBeVisible();

    await replaceEditorText(page, "const localWins = 5;\n");
    await writeFile(sourcePath, "const diskLoses = 6;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    for (const fileName of ["one.ts", "two.ts", "three.ts", "four.ts"]) {
      await openWorkspaceFile(page, fileName);
    }
    await page.getByTestId("workspace-tab-file_source.ts").filter({ visible: true }).click();
    await expect(editor(page)).toContainText("const localWins = 5;");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(sourcePath, "utf8")).toBe("const localWins = 5;\n");

    await replaceEditorText(page, "const discarded = 7;\n");
    await writeFile(sourcePath, "const diskWins = 8;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(editor(page)).toContainText("const diskWins = 8;");

    const subscriptionCount = gate.getClientRequestCount("fs.file.subscribe.request");
    await gate.drop();
    gate.restore();
    await expect
      .poll(() => gate.getClientRequestCount("fs.file.subscribe.request"), { timeout: 30_000 })
      .toBeGreaterThan(subscriptionCount);
    await writeFile(sourcePath, "const afterReconnect = 9;\n", "utf8");
    await expect(editor(page)).toContainText("const afterReconnect = 9;");
  });

  // DEFERRED(paseoFilePane): this is a missing CAPABILITY, not a missing
  // selector. BOM and line-separator preservation live in
  // `src/file-pane/editor/model.ts` (FileLineSeparator, the dead tree); Otto's
  // live editor has no BOM or CRLF handling anywhere - grep for `lineSeparator`
  // or `BOM` outside src/file-pane and there are zero hits. So a Windows file
  // edited in Otto is very likely rewritten LF and de-BOM'd. Worth confirming
  // and filing as a product bug; this test is the ready-made regression proof
  // once the capability exists.
  test.skip("preserves a UTF-8 BOM and uses the first line separator after saving", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-encoding-" });
    const sourcePath = path.join(workspace.repoPath, "windows.ts");
    await writeFile(
      sourcePath,
      Buffer.from("\uFEFFconst initial = true;\r\nconst mixed = true;\n", "utf8"),
    );
    await workspace.navigateTo();
    await openWorkspaceFile(page, "windows.ts");

    await replaceEditorText(page, "const saved = true;\nconst normalized = true;\n");
    await editor(page).press("Control+s");

    const expected = Buffer.from(
      "\uFEFFconst saved = true;\r\nconst normalized = true;\r\n",
      "utf8",
    ).toString("hex");
    await expect.poll(async () => (await readFile(sourcePath)).toString("hex")).toBe(expected);
  });

  // DEFERRED(paseoFilePane): already covered on Otto's surface -
  // `editor-dirty-guard.spec.ts` asserts the dirty dot, the confirm-on-close
  // prompt, and buffer survival across a tab switch. This version additionally
  // wants file-conflict-alert (Otto: editor-conflict-banner) and
  // `workspace-tab-modified-<tabId>`, which does not exist on Otto's tabs at
  // all. Reviving this would duplicate a passing spec; prefer extending
  // editor-dirty-guard.spec.ts if the conflict interaction needs coverage.
  test.skip("warns before closing a panel with an unsaved draft", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "file-editing-draft-" });
    const sourcePath = path.join(workspace.repoPath, "draft.ts");
    await writeFile(sourcePath, "const initial = 1;\n", "utf8");
    await workspace.navigateTo();
    await openWorkspaceFile(page, "draft.ts");

    await replaceEditorText(page, "const local = 2;\n");
    await writeFile(sourcePath, "const external = 3;\n", "utf8");
    await expect(page.getByTestId("file-conflict-alert")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-modified-file_draft.ts")).toBeVisible();

    let closePrompt = "";
    page.once("dialog", async (dialog) => {
      closePrompt = dialog.message();
      await dialog.dismiss();
    });
    await page
      .getByTestId("workspace-tab-file_draft.ts")
      .filter({ visible: true })
      .first()
      .click({ button: "right" });
    await page
      .getByTestId("workspace-tab-context-file_draft.ts-close")
      .filter({ visible: true })
      .click();
    expect(closePrompt).toContain("Closing it will discard the draft.");

    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-modified-file_draft.ts")).toBeVisible();
  });

  // DEFERRED(paseoFilePane): the mode-switching half is covered by
  // `file-tab-mode-bar.spec.ts` (markdown opens in preview, all three surfaces
  // switch, per-file mode memory), just under file-view-mode-* instead of
  // file-mode-*. The genuinely uncovered part is the live-refresh behaviour -
  // markdown and image panes updating when the file changes on disk. Note
  // `workspace-file-pane` DOES resolve here (components/file-pane.tsx), so the
  // image half is close to portable on its own.
  test.skip("refreshes Markdown and images while preserving Preview and Source behavior", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-preview-" });
    const markdownPath = path.join(workspace.repoPath, "notes.md");
    const imagePath = path.join(workspace.repoPath, "pixel.png");
    await writeFile(markdownPath, "# First heading\n", "utf8");
    await writeFile(imagePath, RED_PIXEL);
    await workspace.navigateTo();
    await openWorkspaceFile(page, "notes.md");

    await expect(page.getByText("First heading", { exact: true })).toBeVisible();
    await expect(page.getByTestId("file-markdown-mode")).toBeVisible();
    await writeFile(markdownPath, "# Updated heading\n", "utf8");
    await expect(page.getByText("Updated heading", { exact: true })).toBeVisible();

    await page.getByTestId("file-mode-source").click();
    await expect(page.getByTestId("file-source-editor")).toBeVisible();
    await replaceEditorText(page, "# Saved from source\n");
    await expect.poll(() => readFile(markdownPath, "utf8")).toBe("# Saved from source\n");
    await page.getByTestId("file-mode-preview").click();
    await expect(page.getByText("Saved from source", { exact: true })).toBeVisible();

    await openWorkspaceFile(page, "pixel.png");
    const image = page.getByTestId("workspace-file-pane").locator("img");
    await expect(image).toBeVisible();
    const initialSource = await image.getAttribute("src");
    await writeFile(imagePath, BLUE_PIXEL);
    await expect.poll(() => image.getAttribute("src")).not.toBe(initialSource);
  });

  // DEFERRED(paseoFilePane): half real, half absent. The setting exists and
  // persists - settings/editor renders a `vim-keybindings-toggle` switch
  // labelled "Vim keybindings" (screens/settings/editor-section.tsx) - so the
  // first block should pass. What is missing is the readout: "Vim mode NORMAL"
  // and "Line 1, column 1" come from `panels.file.editor.vimMode` / `.cursor`,
  // which only the dead `file-pane/bar.tsx` renders. Whether the toggle
  // actually wires Vim into Otto's live CM6 editor is unverified and is the
  // first thing to check - the setting may currently be inert.
  test.skip("persists Vim keybindings and reports Vim mode with cursor position", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "file-editing-vim-" });
    await writeFile(path.join(workspace.repoPath, "vim.ts"), "const vim = true;\n", "utf8");

    await page.goto("/settings/editor");
    const toggle = page.getByRole("switch", { name: "Vim keybindings" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Vim keybindings" })).toBeChecked();

    await workspace.navigateTo();
    await openWorkspaceFile(page, "vim.ts");
    await expect(page.getByLabel("Vim mode NORMAL")).toBeVisible();
    await expect(page.getByLabel("Line 1, column 1")).toBeVisible();
    await editor(page).click();
    await editor(page).press("i");
    await expect(page.getByLabel("Vim mode INSERT")).toBeVisible();
    await editor(page).press("Escape");
    await expect(page.getByLabel("Vim mode NORMAL")).toBeVisible();
  });
});
