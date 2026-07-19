import { test, expect } from "./fixtures";
import { awaitAssistantMessage } from "./helpers/agent-stream";
import { composerLocator, expectComposerVisible, submitMessage } from "./helpers/composer";
import { openAgentRoute } from "./helpers/mock-agent";
import { buildAssistantMarkdownScenarioPrompt } from "./helpers/mock-scenarios";
import { seedWorkspace } from "./helpers/seed-client";

const LINKED_FILE = "src/app.ts";

test.describe("Chat file link side open", () => {
  test("clicking a file link in agent output opens the file beside the chat without displacing it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Side-pane placement is a desktop-web behavior; compact layouts fall back
    // to in-place opens, so pin a desktop viewport.
    await page.setViewportSize({ width: 1440, height: 900 });

    const workspace = await seedWorkspace({
      repoPrefix: "chat-file-link-",
      repo: {
        files: [{ path: LINKED_FILE, content: "export const app = 1;\n" }],
      },
    });
    try {
      const agent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "File link side open",
        modeId: "load-test",
        model: "ten-second-stream",
      });

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expectComposerVisible(page);

      // Drive an assistant message whose inline code span is a workspace-relative
      // file path — the chat renders it as an assistant file link.
      await submitMessage(
        page,
        buildAssistantMarkdownScenarioPrompt(`Take a look at \`${LINKED_FILE}\` for the export.`),
      );
      const assistantMessage = page
        .getByTestId("assistant-message")
        .filter({ hasText: "Take a look at" })
        .first();
      await awaitAssistantMessage(page, "Take a look at");

      const fileLink = page.getByRole("link", { name: LINKED_FILE }).first();
      await expect(fileLink).toBeVisible({ timeout: 15_000 });
      await fileLink.click();

      // The file opens as a tab in a pane beside the chat (never replacing it).
      const fileTab = page
        .locator('[data-testid^="workspace-tab-file_"]')
        .filter({ hasText: "app.ts" })
        .first();
      await expect(fileTab).toBeVisible({ timeout: 15_000 });

      // The chat stays fully intact next to the opened file: same agent tab,
      // same transcript, composer still there.
      await expect(page.getByTestId(`workspace-tab-agent_${agent.id}`).first()).toBeVisible();
      await expect(assistantMessage).toBeVisible();
      await expect(composerLocator(page)).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
