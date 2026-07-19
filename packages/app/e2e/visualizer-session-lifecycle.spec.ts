import { test, expect } from "./fixtures";
import { waitForTabBar } from "./helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  closeVisualizerChatsDropdown,
  expectVisualizerBooted,
  openVisualizerChatsDropdown,
  openVisualizerFromHeader,
  visualizerChatsTrigger,
} from "./helpers/visualizer";

// With the Visualizer open, agent lifecycle drives the guest's session list,
// observed through the host-side session mirror (the toolbar chats dropdown —
// page -> host `session-state`, docs/visualizer.md):
//   - a new root agent in the workspace adds a session,
//   - archiving an agent REMOVES its session (regression: archive drives the
//     page's `close-session`, not `agent_complete` — an archived chat must
//     disappear rather than linger as a completed node/session).
// Mock-provider agents only; all daemon state is cleaned up at the end.

test.describe("Visualizer session lifecycle", () => {
  test.describe.configure({ timeout: 180_000 });

  test("starting an agent adds a session; archiving removes it", async ({ page }) => {
    // Session labels are capped at 24 chars in the toolbar mirror
    // (truncateSessionLabel) — keep titles short so they survive verbatim.
    const suffix = Date.now().toString(36).slice(-6);
    const titleA = `VisLife A ${suffix}`;
    const titleB = `VisLife B ${suffix}`;
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "vis-lifecycle-",
      title: titleA,
    });

    try {
      await openAgentRoute(page, {
        workspaceId: mock.workspaceId,
        agentId: mock.agentId,
      });
      await waitForTabBar(page);
      await openVisualizerFromHeader(page);
      await expectVisualizerBooted(page, titleA);

      // A second mock agent seeded out of band becomes a new session in the
      // live mirror without reopening the tab.
      const agentB = await mock.client.createAgent({
        provider: "mock",
        cwd: mock.cwd,
        workspaceId: mock.workspaceId,
        title: titleB,
        modeId: "load-test",
        model: "ten-second-stream",
      });

      let dialog = await openVisualizerChatsDropdown(page);
      await expect(dialog.getByText(titleA, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByText(titleB, { exact: true })).toBeVisible({ timeout: 30_000 });

      // Archive B while the dropdown is open: the option list is driven by the
      // live session mirror, so the entry disappears in place (close-session).
      await mock.client.archiveAgent(agentB.id);
      await expect(dialog.getByText(titleB, { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(dialog.getByText(titleA, { exact: true })).toBeVisible();
      await closeVisualizerChatsDropdown(page, dialog);

      // The surviving chat (A) keeps the selection after B is archived away.
      // (A is the session the Visualizer booted with — its open chat tab
      // anchors it in the page↔host mirror, so it persists as the primary
      // session; B, added out of band with no tab, is what archive retires.
      // The close-session removal is proven by B disappearing above.)
      await expect(visualizerChatsTrigger(page)).toContainText(titleA);
    } finally {
      await mock.cleanup();
    }
  });
});
