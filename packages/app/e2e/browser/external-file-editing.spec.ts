import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page } from "../support/fixtures";
import { filePreviewSurface, fileTabEditorContent, fileTabPane } from "../support/helpers/file-tab";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { createTempDirectory, type TempDirectory } from "../support/helpers/workspace";

// Absolute file links open and edit in place regardless of whether the file is
// owned by another registered workspace or lives outside every workspace. The
// file's serving origin keeps daemon reads and writes correctly scoped; project
// ownership does not add a warning or permission layer.

let workspaceA: SeededWorkspace;
let workspaceB: SeededWorkspace;
let outsideDir: TempDirectory;

const OTHER_WORKSPACE_FILE = "other.md";
const OUTSIDE_FILE = "outside-note.md";

function buildInlinePathEchoPrompt(absolutePath: string): string {
  const forwardSlashPath = absolutePath.replace(/\\/g, "/");
  return [
    "Generate a title and a git branch name for a coding agent.",
    "Return JSON only with fields 'title' and 'branch'.",
    "<user-prompt>",
    `Open \`${forwardSlashPath}\` now`,
    "</user-prompt>",
  ].join("\n");
}

async function openChatWithFileLink(page: Page, absolutePath: string): Promise<void> {
  const agent = await workspaceA.client.createAgent({
    provider: "mock",
    cwd: workspaceA.repoPath,
    workspaceId: workspaceA.workspaceId,
    title: "External file link echo",
    model: "ten-second-stream",
    initialPrompt: buildInlinePathEchoPrompt(absolutePath),
  });
  await workspaceA.client.waitForFinish(agent.id, 30_000);
  await openAgentRoute(page, { workspaceId: workspaceA.workspaceId, agentId: agent.id });
}

function chatFileLink(page: Page, fileName: string) {
  return page.getByTestId("assistant-message").locator("a").filter({ hasText: fileName }).first();
}

async function openAndEditMarkdownFile(page: Page, fileName: string, originalText: string) {
  await chatFileLink(page, fileName).click();
  await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
  await expect(filePreviewSurface(page)).toContainText(originalText, { timeout: 30_000 });

  await page.getByTestId("file-view-mode-editor").click();
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  await expect(fileTabEditorContent(page)).toContainText(originalText, { timeout: 30_000 });
  await fileTabEditorContent(page).click();
  await page.keyboard.type("edited-externally ");
  await page.getByTestId("editor-save").click();
}

test.beforeAll(async () => {
  workspaceA = await seedWorkspace({ repoPrefix: "xa-" });
  workspaceB = await seedWorkspace({
    repoPrefix: "xb-",
    repo: {
      files: [
        {
          path: OTHER_WORKSPACE_FILE,
          content: "# Other workspace\n\nOther workspace note body.\n",
        },
      ],
    },
  });
  outsideDir = await createTempDirectory("xo-");
  await writeFile(join(outsideDir.path, OUTSIDE_FILE), "# Outside\n\nOutside note body.\n");
});

test.afterAll(async () => {
  await workspaceA?.cleanup();
  await workspaceB?.cleanup();
  await outsideDir?.cleanup();
});

test.describe("External file editing", () => {
  test("another workspace's file edits directly without a permission prompt", async ({ page }) => {
    test.setTimeout(120_000);
    const absolutePath = `${workspaceB.workspaceDirectory}/${OTHER_WORKSPACE_FILE}`;
    await openChatWithFileLink(page, absolutePath);
    await openAndEditMarkdownFile(page, OTHER_WORKSPACE_FILE, "Other workspace note body");

    await expect
      .poll(() => readFileSync(absolutePath, "utf-8"), {
        timeout: 15_000,
      })
      .toContain("edited-externally");
  });

  test("a file outside every workspace edits directly without a permission prompt", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const absolutePath = join(outsideDir.path, OUTSIDE_FILE);
    await openChatWithFileLink(page, absolutePath);
    await openAndEditMarkdownFile(page, OUTSIDE_FILE, "Outside note body");

    await expect
      .poll(() => readFileSync(absolutePath, "utf-8"), { timeout: 15_000 })
      .toContain("edited-externally");
  });
});
