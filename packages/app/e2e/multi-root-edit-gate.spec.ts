import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page } from "./fixtures";
import {
  editorTabCloseTestId,
  filePreviewSurface,
  fileTabEditorContent,
  fileTabPane,
} from "./helpers/file-tab";
import { openAgentRoute } from "./helpers/mock-agent";
import {
  connectProjectLinksClient,
  linksContainPair,
  type ProjectLinksClient,
} from "./helpers/project-links";
import { openProjects, openProjectSettings } from "./helpers/project-settings";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { createTempDirectory, type TempDirectory } from "./helpers/workspace";

// Multi-root file opening (projects/cross-project-open.ts resolveEditGate):
// any file opens and edits in place. Origin decides the banner, not a gate -
// none for the current or a linked project, a project-named one for another
// unlinked project, an unnamed one for a file outside every project. Editing is
// never held behind a confirm dialog (file-tab-pane.tsx): the banner carries the
// trade-off instead, since an out-of-project edit is not part of the agent's
// context and not part of this workspace's Git changes. The UI entry
// point for a cross-project open is a chat file link (an absolute path in
// assistant inline code, components/message.tsx code_inline rule →
// AssistantInlineCodePathLink). The mock provider has no free-text echo, so
// the specs ride its structured title/branch JSON turn
// (parseStructuredBranchNamePrompt in mock-load-test-agent.ts), which echoes
// the seed line - backticked absolute path included - into assistant markdown.

let workspaceA: SeededWorkspace;
let workspaceB: SeededWorkspace;
let outsideDir: TempDirectory;
let links: ProjectLinksClient;

const GATED_FILE = "gated-note.md";
const LINKED_FILE = "linked-note.md";
const OUTSIDE_FILE = "outside-note.md";

function buildInlinePathEchoPrompt(absolutePath: string): string {
  const forwardSlashPath = absolutePath.replace(/\\/g, "/");
  // Matches the mock provider's structured title/branch trigger; the seed's
  // first line becomes the JSON "title", carrying the backticked path into
  // the rendered assistant markdown as an inline-code file link.
  return [
    "Generate a title and a git branch name for a coding agent.",
    "Return JSON only with fields 'title' and 'branch'.",
    "<user-prompt>",
    `Open \`${forwardSlashPath}\` now`,
    "</user-prompt>",
  ].join("\n");
}

async function openChatWithFileLink(page: Page, absolutePath: string): Promise<string> {
  const agent = await workspaceA.client.createAgent({
    provider: "mock",
    cwd: workspaceA.repoPath,
    workspaceId: workspaceA.workspaceId,
    title: "Cross-project link echo",
    model: "ten-second-stream",
    initialPrompt: buildInlinePathEchoPrompt(absolutePath),
  });
  await workspaceA.client.waitForFinish(agent.id, 30_000);
  await openAgentRoute(page, { workspaceId: workspaceA.workspaceId, agentId: agent.id });
  return agent.id;
}

function chatFileLink(page: Page, fileName: string) {
  // Assistant file links render as anchors on web (assistant-file-links/link.tsx).
  return page.getByTestId("assistant-message").locator("a").filter({ hasText: fileName }).first();
}

async function unlinkAB(): Promise<void> {
  await links.unlinkProjects(workspaceA.projectId, workspaceB.projectId).catch(() => undefined);
}

test.beforeAll(async () => {
  workspaceA = await seedWorkspace({ repoPrefix: "mr-a-" });
  workspaceB = await seedWorkspace({
    repoPrefix: "mr-b-",
    repo: {
      files: [
        { path: GATED_FILE, content: "# Gated\n\nGated note body.\n" },
        { path: LINKED_FILE, content: "# Linked\n\nLinked note body.\n" },
      ],
    },
  });
  outsideDir = await createTempDirectory("mr-out-");
  await writeFile(join(outsideDir.path, OUTSIDE_FILE), "# Outside\n\nOutside note body.\n");
  links = await connectProjectLinksClient();
});

test.afterAll(async () => {
  if (links) {
    await unlinkAB();
    await links.close().catch(() => undefined);
  }
  await workspaceA?.cleanup();
  await workspaceB?.cleanup();
  await outsideDir?.cleanup();
});

test.describe("Gated multi-root editing", () => {
  test("unlinked project file previews in place and edits behind a banner", async ({ page }) => {
    test.setTimeout(120_000);
    await unlinkAB();
    await openChatWithFileLink(page, `${workspaceB.workspaceDirectory}/${GATED_FILE}`);

    // The chat link opens the other project's file in place (to the side).
    await chatFileLink(page, GATED_FILE).click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });

    // Persistent out-of-project banner names the owning project.
    const banner = page.getByTestId("file-out-of-project-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(workspaceB.projectDisplayName);

    // Markdown still opens in preview (defaultFileViewMode), so the editor is
    // absent until the view mode is switched - not because editing is blocked.
    await expect(filePreviewSurface(page)).toContainText("Gated note body", { timeout: 30_000 });
    await expect(fileTabEditorContent(page)).toHaveCount(0);

    // Switching to editor just works: no confirm dialog, and the banner stays
    // up the whole time as the standing reminder of where the file lives.
    const dialog = page.getByTestId("confirm-dialog");
    await page.getByTestId("file-view-mode-editor").click();
    await expect(dialog).toHaveCount(0);
    await expect(fileTabEditorContent(page)).toContainText("Gated note body", {
      timeout: 30_000,
    });
    await expect(banner).toBeVisible();

    // Reopening the tab re-derives the banner from the live link set rather
    // than from any per-tab acceptance, and still never warns.
    const fileTab = page
      .locator('[data-testid^="workspace-tab-file_"]')
      .filter({ hasText: GATED_FILE })
      .first();
    await fileTab.hover();
    await page.getByTestId(editorTabCloseTestId(GATED_FILE)).first().click();
    await expect(fileTab).toBeHidden({ timeout: 30_000 });
    await chatFileLink(page, GATED_FILE).click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveCount(0);
  });

  test("linking the projects bidirectionally lifts the edit gate", async ({ page }) => {
    test.setTimeout(120_000);
    await unlinkAB();
    const agentId = await openChatWithFileLink(
      page,
      `${workspaceB.workspaceDirectory}/${LINKED_FILE}`,
    );

    // Baseline: while unlinked, the file is gated.
    await chatFileLink(page, LINKED_FILE).click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-out-of-project-banner")).toBeVisible({ timeout: 30_000 });

    // Link A ↔ B through the real UI (project settings → Project links).
    await openProjects(page);
    await openProjectSettings(page, workspaceA.projectDisplayName);
    await expect(page.getByTestId("project-links-group")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`project-link-toggle-${workspaceB.projectId}`).click();
    await expect
      .poll(
        async () => {
          const entries = await links.listProjectLinks();
          return linksContainPair(entries, workspaceA.projectId, workspaceB.projectId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Back in the chat, the same file now opens with no banner and edits
    // freely - no warning dialog on the way into the editor.
    await openAgentRoute(page, { workspaceId: workspaceA.workspaceId, agentId });
    await chatFileLink(page, LINKED_FILE).click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("file-out-of-project-banner")).toBeHidden({ timeout: 30_000 });
    await page.getByTestId("file-view-mode-editor").click();
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await expect(fileTabEditorContent(page)).toContainText("Linked note body", {
      timeout: 30_000,
    });
  });

  test("a file outside every project edits in place under an unnamed banner", async ({ page }) => {
    test.setTimeout(120_000);
    const outsideNotePath = join(outsideDir.path, OUTSIDE_FILE);
    await openChatWithFileLink(page, outsideNotePath);

    await chatFileLink(page, OUTSIDE_FILE).click();
    await expect(fileTabPane(page)).toBeVisible({ timeout: 30_000 });

    // The banner has no project to name, so it says why editing here is different without
    // naming one (editor.outOfProject.badgeNoProject).
    const banner = page.getByTestId("file-out-of-project-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveText(/Editing outside the project/);
    await expect(banner).not.toContainText("(");

    // Markdown opens in preview by default; the editor is one click away.
    await expect(filePreviewSurface(page)).toContainText("Outside note body", {
      timeout: 30_000,
    });
    await expect(fileTabEditorContent(page)).toHaveCount(0);

    // Editing a file that belongs to no project is allowed outright - the
    // banner is the whole warning, so no dialog stands in the way.
    await page.getByTestId("file-view-mode-editor").click();
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await expect(fileTabEditorContent(page)).toContainText("Outside note body", {
      timeout: 30_000,
    });
    await fileTabEditorContent(page).click();
    await page.keyboard.type("edited-outside ");
    await page.getByTestId("editor-save").click();
    await expect
      .poll(() => readFileSync(outsideNotePath, "utf-8"), { timeout: 15_000 })
      .toContain("edited-outside");
  });
});
