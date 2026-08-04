import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "./fixtures";
import {
  CLEAR_PNG_BASE64,
  RED_PNG_BASE64,
  dispatchEditorDrop,
  dispatchEditorPaste,
  dropPointOnLine,
} from "./helpers/editor-image-drop";
import { expandFolder, openFileExplorer, openFileFromExplorer } from "./helpers/file-explorer";
import { fileTabEditorContent, fileTabPane } from "./helpers/file-tab";
import { moneyShot } from "./helpers/evidence";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

// Markdown image paste and drop, end to end: the gesture on the CM6 content
// element (editor/markdown/markdown-commands.ts) through the host hook
// (editor/markdown/use-markdown-image-drop.ts) to a real daemon write and the
// link that appears in the buffer.
//
// The naming and path arithmetic is already unit-covered
// (editor/markdown/markdown-image-drop.test.ts), and so is the daemon's refusal
// to write outside a workspace. What only a real browser and a real daemon can
// prove is the wiring: that the handler is registered on the right element,
// that the asynchronous read reaches the host, and above all that the link
// lands where the pointer was rather than where the caret was - the pointer
// position is gone by the time the FileReader resolves, so that is the piece
// most likely to regress.
//
// **The feature is withheld whole without `features.binaryFileWrite`**: no
// handler is registered at all and the drop keeps whatever the platform does
// with it. A spec that asserted "no error" would therefore pass on a host that
// never offered the feature, by doing nothing. Every test here asserts the link
// appears instead, which can only happen if the capability was advertised, the
// write succeeded, and the insert ran.

let workspace: SeededWorkspace;

const CARET_LINE = "Caret parks on this line.";
const SECTION_LINE = "## Section";
const DROP_LINE = "Drop lands on this line.";
const TAIL_LINE = "Tail line, for a second drop.";

// The `## Section` marker sits well below line 1 on purpose. Live preview
// reveals the caret's own line, and a fresh editor puts the caret at offset 0,
// so a marker on line 1 is legitimately visible and would prove nothing about
// whether Formatted is off.
const DOCUMENT = [
  "# Image drop",
  "",
  CARET_LINE,
  "",
  SECTION_LINE,
  "",
  DROP_LINE,
  "",
  TAIL_LINE,
  "",
].join("\n");

// One folder per test, so each gets its own `assets/` directory and no test can
// read another's leftovers.
const DROP_DOCUMENT = { folder: "drop-point", file: "dropped.md" };
const PASTE_DOCUMENT = { folder: "paste-in", file: "pasted.md" };
const CLASH_DOCUMENT = { folder: "clash", file: "clash.md" };
const PLAIN_DOCUMENT = { folder: "non-image", file: "plain-drop.md" };

const ALL_DOCUMENTS = [DROP_DOCUMENT, PASTE_DOCUMENT, CLASH_DOCUMENT, PLAIN_DOCUMENT];

/** `pasted-image-20260802-163055.png` - a clipboard image has no name to keep. */
const PASTED_IMAGE_NAME = /^pasted-image-\d{8}-\d{6}\.png$/;
const PASTED_IMAGE_LINK = /!\[\]\(assets\/pasted-image-\d{8}-\d{6}\.png\)/;

function editorLine(page: Page, text: string) {
  return fileTabEditorContent(page).locator(".cm-line").filter({ hasText: text }).first();
}

function assetPath(document: { folder: string }, name: string): string {
  return join(workspace.repoPath, document.folder, "assets", name);
}

/**
 * Open a seeded markdown document in the editor with live preview turned off.
 *
 * Markdown opens in preview, so the editor is an explicit choice. Formatted is
 * then switched off because live preview hides `URL` and `LinkMark` nodes: with
 * it on, the very text these tests assert on is the text the decoration is
 * designed to hide.
 */
async function openMarkdownEditor(
  page: Page,
  document: { folder: string; file: string },
): Promise<void> {
  await gotoWorkspace(page, workspace.workspaceId);
  await openFileExplorer(page);
  await expandFolder(page, document.folder);
  await openFileFromExplorer(page, document.file);
  await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("file-view-mode-editor").click();
  await expect(fileTabEditorContent(page)).toContainText(DROP_LINE, { timeout: 30_000 });
  await page.getByTestId("file-view-formatted").click();
  // Raw source is back: the assertions below read literal markdown, not a
  // decorated view of it.
  await expect(fileTabEditorContent(page)).toContainText(SECTION_LINE, { timeout: 30_000 });
}

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "image-drop-",
    repo: {
      files: ALL_DOCUMENTS.map((document) => ({
        path: `${document.folder}/${document.file}`,
        content: DOCUMENT,
      })),
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("Markdown image paste and drop", () => {
  test("a dropped PNG is written under assets/ and linked at the drop point", async ({ page }) => {
    test.setTimeout(120_000);
    await openMarkdownEditor(page, DROP_DOCUMENT);

    const caretLine = editorLine(page, CARET_LINE);
    const dropLine = editorLine(page, DROP_LINE);

    // Park the caret somewhere the image is deliberately NOT dropped. Without
    // this the two positions coincide and the drop-point claim is untestable.
    await caretLine.click();

    await dispatchEditorDrop(fileTabEditorContent(page), {
      point: await dropPointOnLine(dropLine),
      files: [{ name: "shot.png", type: "image/png", base64: RED_PNG_BASE64 }],
    });

    // The link is the proof the whole chain ran, capability included.
    await expect(dropLine).toContainText("![](assets/shot.png)", { timeout: 30_000 });
    // ...and it ran at the pointer, not at the caret.
    await expect(caretLine).toHaveText(CARET_LINE);

    expect(readFileSync(assetPath(DROP_DOCUMENT, "shot.png"))).toEqual(
      Buffer.from(RED_PNG_BASE64, "base64"),
    );

    await moneyShot(
      page,
      "a dropped PNG is written under assets/ and linked on the line it was dropped on, not the line the caret was on",
    );
  });

  test("a pasted clipboard image is written under assets/ and linked at the caret", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openMarkdownEditor(page, PASTE_DOCUMENT);

    const caretLine = editorLine(page, CARET_LINE);
    await caretLine.click();

    // No name, which is what a pasted screenshot actually carries: the target
    // name has to come from the clock and the MIME type instead.
    await dispatchEditorPaste(fileTabEditorContent(page), {
      files: [{ name: "", type: "image/png", base64: RED_PNG_BASE64 }],
    });

    await expect(caretLine).toContainText(PASTED_IMAGE_LINK, { timeout: 30_000 });

    const written = readdirSync(join(workspace.repoPath, PASTE_DOCUMENT.folder, "assets"));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(PASTED_IMAGE_NAME);
    expect(readFileSync(assetPath(PASTE_DOCUMENT, written[0]))).toEqual(
      Buffer.from(RED_PNG_BASE64, "base64"),
    );

    await moneyShot(
      page,
      "a pasted clipboard image is written under assets/ with a timestamped name and linked at the caret",
    );
  });

  test("a second image with the same name is suffixed and never clobbers the first", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openMarkdownEditor(page, CLASH_DOCUMENT);

    const dropLine = editorLine(page, DROP_LINE);
    const tailLine = editorLine(page, TAIL_LINE);

    await dispatchEditorDrop(fileTabEditorContent(page), {
      point: await dropPointOnLine(dropLine),
      files: [{ name: "shot.png", type: "image/png", base64: RED_PNG_BASE64 }],
    });
    await expect(dropLine).toContainText("![](assets/shot.png)", { timeout: 30_000 });

    // Same name, different bytes. The daemon has no overwrite mode, so it
    // answers `exists` and the host retries at `-2`.
    await dispatchEditorDrop(fileTabEditorContent(page), {
      point: await dropPointOnLine(tailLine),
      files: [{ name: "shot.png", type: "image/png", base64: CLEAR_PNG_BASE64 }],
    });
    await expect(tailLine).toContainText("![](assets/shot-2.png)", { timeout: 30_000 });

    // The first file still holds the first drop's bytes: the second write went
    // somewhere else rather than over the top of it.
    expect(readFileSync(assetPath(CLASH_DOCUMENT, "shot.png"))).toEqual(
      Buffer.from(RED_PNG_BASE64, "base64"),
    );
    expect(readFileSync(assetPath(CLASH_DOCUMENT, "shot-2.png"))).toEqual(
      Buffer.from(CLEAR_PNG_BASE64, "base64"),
    );

    await moneyShot(
      page,
      "a second drop of the same name links assets/shot-2.png and leaves the first file's bytes intact",
    );
  });

  test("a non-image drop is left to CodeMirror's own handling", async ({ page }) => {
    test.setTimeout(120_000);
    await openMarkdownEditor(page, PLAIN_DOCUMENT);

    const dropLine = editorLine(page, DROP_LINE);

    await dispatchEditorDrop(fileTabEditorContent(page), {
      point: await dropPointOnLine(dropLine),
      files: [{ name: "notes.txt", type: "text/plain", base64: btoa("dropped-plain-text") }],
    });

    // Declining the event is only half the contract. CodeMirror's built-in drop
    // reads a text file and inserts it, so the dropped text appearing is what
    // proves the handler returned false instead of swallowing the gesture.
    await expect(dropLine).toContainText("dropped-plain-text", { timeout: 30_000 });
    await expect(fileTabEditorContent(page)).not.toContainText("![](");
    expect(existsSync(join(workspace.repoPath, PLAIN_DOCUMENT.folder, "assets"))).toBe(false);

    await moneyShot(
      page,
      "a dropped text file is inserted by CodeMirror itself and writes nothing under assets/",
    );
  });
});
