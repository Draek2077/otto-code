import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { composerLocator } from "./helpers/composer";
import { moneyShot } from "./helpers/evidence";
import { seedMockAgentWorkspace, openAgentRoute } from "./helpers/mock-agent";

test("adds a changed file to the focused chat without replacing its composer draft", async ({
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
    // (useDiffContextAttachmentToggle returns null without a focusedAgentId).
    // Focus follows the focused pane's active tab, not the DOM, so booting
    // straight onto the agent route is what establishes it — this click is here
    // to prove the draft survives a real interaction, not to set focus.
    await agentComposer.click();
    // Paseo's diff panel splits the file row into a `-toggle` child and offers
    // "Add to chat"; Otto's Changes view puts the context menu on the row itself
    // and calls the action "add to context". Same affordance, different names.
    await page.getByTestId("diff-file-0").click({ button: "right" });
    await page.getByTestId("changes-context-menu-add-to-context").click();

    // Otto files this as a `file_context` attachment, which has its own pill and
    // renders the file name over a "File context" subtitle. Paseo's "add to
    // chat" produced a plain workspace-file pill carrying the relative path;
    // Otto never renders the path here, so there is nothing to assert about it.
    const attachment = page.getByTestId("composer-file-context-attachment-pill");
    await expect(attachment).toContainText("changed file.ts");
    await expect(attachment).toContainText("File context");
    await expect(agentComposer).toHaveValue("Preserve this thought");
    await moneyShot(
      page,
      "the changed file rides in the focused chat's composer as a file-context pill, and the draft it already held is still there",
    );
  } finally {
    await workspace.cleanup();
  }
});
