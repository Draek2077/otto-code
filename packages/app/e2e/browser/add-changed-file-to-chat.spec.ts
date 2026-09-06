import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { composerLocator } from "../support/helpers/composer";
import { moneyShot } from "../support/helpers/evidence";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { openChangesPanel } from "../support/helpers/workspace-tabs";

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

    const agentComposer = composerLocator(page);
    await expect(agentComposer).toBeEditable({ timeout: 30_000 });
    await agentComposer.fill("Preserve this thought");

    await openChangesPanel(page);
    const changedFile = page.getByTestId("diff-file-0").filter({ visible: true });
    await expect(changedFile).toContainText("changed file.ts");

    // Keep the chat selected while interacting with its Explorer diff.
    await agentComposer.click();
    await changedFile.click({ button: "right" });
    await page.getByTestId("diff-file-0-add-to-chat").click();

    const attachment = page.getByTestId("composer-workspace-file-attachment-pill");
    await expect(attachment).toContainText("changed file.ts");
    await expect(attachment).toContainText(relativePath);
    await expect(agentComposer).toHaveValue("Preserve this thought");
    await moneyShot(
      page,
      "the changed file is attached to the focused chat and its existing draft is preserved",
    );
  } finally {
    await workspace.cleanup();
  }
});
