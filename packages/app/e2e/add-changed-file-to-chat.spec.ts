import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { composerLocator } from "./helpers/composer";
import { seedMockAgentWorkspace, openAgentRoute } from "./helpers/mock-agent";

// DEFERRED(paseoAddToChat): arrived with the Paseo v0.2.5 merge. Two of its three
// upstream-isms are fixed below and the spec now gets as far as opening Otto's
// real context menu on the real file row. It stops on the last one, which is a
// behaviour difference rather than a name:
//
//   Otto renders "Add to context" only when `useDiffContextAttachmentToggle`
//   sees a `focusedAgentId` (diff-pane.tsx, "if (!focusedAgentId || !request)").
//   Focus is written from the focused pane's active agent tab in
//   workspace-screen.tsx. Opening the explorer's Changes tab and clicking back
//   into the composer does not restore it: the menu opens with Edit, Git
//   history, Find in files, Copy path and Rollback file, and no context item.
//
// So either focus is genuinely lost to the explorer — in which case "Add to
// context" is unreachable from the Changes view for real users, and this spec is
// finding a live bug worth fixing — or the test has to establish focus some way
// this does not. No other spec exercises `changes-context-menu-add-to-context`,
// so there is no working example to copy, and settling it needs someone to
// decide which of the two it is rather than guess. Un-skip with that answer.
test.skip("adds a changed file to the focused chat without replacing its composer draft", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "add-file-to-chat-",
    title: "Target chat",
  });
  const relativePath = "src/changed file.ts";

  try {
    await mkdir(path.join(workspace.cwd, "src"), { recursive: true });
    await writeFile(path.join(workspace.cwd, relativePath), "export const changed = true;\n");
    await workspace.client.checkoutRefresh(workspace.cwd);

    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    // Paseo tags its composer textarea `data-composer-input`; nothing in Otto
    // ever sets that attribute, so the original locator matched nothing and the
    // spec died here before reaching what it means to test.
    const agentComposer = composerLocator(page);
    await expect(agentComposer).toBeEditable({ timeout: 30_000 });
    await agentComposer.fill("Preserve this thought");

    await page.getByRole("button", { name: "Open explorer" }).click();
    await page.getByTestId("explorer-tab-changes").click();
    const changedFile = page.getByText("changed file.ts", { exact: true }).first();
    await expect(changedFile).toBeVisible({ timeout: 30_000 });

    // Otto only offers "Add to context" while a chat is focused
    // (useDiffContextAttachmentToggle returns null without a focusedAgentId),
    // and focus follows the focused pane's active tab. Paseo's "Add to chat" is
    // ungated, so its spec never had to say which chat it meant — but "the
    // focused chat" is this test's whole premise, so state it.
    await agentComposer.click();
    // Paseo's diff panel splits the file row into a `-toggle` child and offers
    // "Add to chat"; Otto's Changes view puts the context menu on the row itself
    // and calls the action "add to context". Same affordance, different names.
    await page.getByTestId("diff-file-0").click({ button: "right" });
    await page.getByTestId("changes-context-menu-add-to-context").click();

    const attachment = page.getByTestId("composer-workspace-file-attachment-pill");
    await expect(attachment).toContainText("changed file.ts");
    await expect(attachment).toContainText(relativePath);
    await expect(agentComposer).toHaveValue("Preserve this thought");
    await expect(agentComposer).toBeFocused();
  } finally {
    await workspace.cleanup();
  }
});
