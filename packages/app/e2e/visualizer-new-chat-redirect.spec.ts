import { test, expect } from "./fixtures";
import { waitForTabBar } from "./helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  openVisualizerFromHeader,
  visualizerPaneTabsRow,
  visualizerTabChip,
} from "./helpers/visualizer";

// Regression (resolveWorkspaceNewChatPlacement, workspace-pane-state.ts): a
// "New chat" fired from the Visualizer's own pane must never land as a second
// tab inside that pane — the Visualizer is a companion view that owns its pane.
// The draft is redirected to a sibling pane (reusing the chat pane already on
// screen), and the Visualizer stays where it is.

const DRAFT_TAB_SELECTOR = '[data-testid^="workspace-tab-draft_"]';

test.describe("Visualizer new-chat redirect", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a new chat from the Visualizer pane lands in the chat pane, not the Visualizer's", async ({
    page,
  }) => {
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "vis-redirect-",
      title: `VisRedirect ${Date.now().toString(36).slice(-6)}`,
    });

    try {
      await openAgentRoute(page, {
        workspaceId: mock.workspaceId,
        agentId: mock.agentId,
      });
      await waitForTabBar(page);

      // Opening from the header splits the Visualizer into its own pane to the
      // right of the chat (open-visualizer-tab.ts) and focuses it.
      await openVisualizerFromHeader(page);
      const visualizerRow = visualizerPaneTabsRow(page);
      await expect(visualizerRow).toBeVisible({ timeout: 30_000 });

      // Sanity: the Visualizer owns its pane — the chat tab lives in another
      // pane's tab row.
      await expect(
        visualizerRow.locator(`[data-testid="workspace-tab-agent_${mock.agentId}"]`),
      ).toHaveCount(0);

      // Trigger "New agent" from the Visualizer pane's own tab-row menu, so the
      // requested pane for the draft is the Visualizer's pane.
      await visualizerRow.getByTestId("workspace-new-tab-menu-trigger").click();
      const newAgentItem = page
        .locator('[data-testid="workspace-new-tab-menu-agent"]:visible')
        .first();
      await expect(newAgentItem).toBeVisible({ timeout: 10_000 });
      await newAgentItem.click();

      // The draft tab appears — but never inside the Visualizer's pane.
      const draftTab = page.locator(`${DRAFT_TAB_SELECTOR}:visible`).first();
      await expect(draftTab).toBeVisible({ timeout: 30_000 });
      await expect(visualizerRow.locator(DRAFT_TAB_SELECTOR)).toHaveCount(0);

      // It reused the sibling chat pane: the draft shares a tab row with the
      // agent tab.
      const draftRow = page
        .locator('[data-testid="workspace-tabs-row"]')
        .filter({ has: page.locator(DRAFT_TAB_SELECTOR) })
        .filter({ visible: true })
        .first();
      await expect(draftRow).toBeVisible({ timeout: 15_000 });
      await expect(
        draftRow.locator(`[data-testid="workspace-tab-agent_${mock.agentId}"]`),
      ).toHaveCount(1);

      // And the Visualizer stays put: still open, alone in its own pane.
      await expect(visualizerTabChip(page)).toBeVisible();
      await expect(visualizerRow.locator('[data-testid="workspace-tab-visualizer"]')).toHaveCount(
        1,
      );
    } finally {
      await mock.cleanup();
    }
  });
});
