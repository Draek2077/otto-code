import { test, expect } from "./fixtures";
import { waitForTabBar } from "./helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  expectVisualizerBooted,
  openVisualizerFromHeader,
  visualizerChatsTrigger,
  visualizerIframe,
} from "./helpers/visualizer";

// P0: opening the Visualizer tab boots the vendored canvas page. Headless
// Chromium runs WebGL/canvas through swiftshader, so nothing here asserts on
// rendered pixels — the boot proof is bridge/DOM state only (docs/visualizer.md
// "The bridge contract"):
//   1. the native Otto toolbar renders above the tab,
//   2. the sandboxed guest iframe attaches (visualizer-view.web.tsx),
//   3. the toolbar's chats dropdown lists the workspace's chat — which requires
//      the guest to have booted, sent `ready`, received the adapter's
//      `session-started`, and mirrored `session-state` back to the host.

test.describe("Visualizer open + boot", () => {
  test.describe.configure({ timeout: 180_000 });

  test("opening the Visualizer from the workspace header boots the canvas page", async ({
    page,
  }) => {
    // Session labels are capped at 24 chars in the toolbar mirror
    // (truncateSessionLabel) — keep the title short so it survives verbatim.
    const title = `VisBoot ${Date.now().toString(36).slice(-6)}`;
    const mock = await seedMockAgentWorkspace({
      repoPrefix: "vis-boot-",
      title,
    });

    try {
      await openAgentRoute(page, {
        workspaceId: mock.workspaceId,
        agentId: mock.agentId,
      });
      await waitForTabBar(page);

      // Before opening: no guest iframe is mounted anywhere (the render bundle
      // stays behind its lazy boundary until a Visualizer tab exists).
      await expect(visualizerIframe(page)).toHaveCount(0);

      await openVisualizerFromHeader(page);

      // Boot: iframe attached, no load-failure state, session mirror live.
      await expectVisualizerBooted(page, title);

      // The chats dropdown is enabled once the mirror carries a session (it is
      // disabled in the "No chats" empty state).
      await expect(visualizerChatsTrigger(page)).toBeEnabled();
    } finally {
      await mock.cleanup();
    }
  });
});
