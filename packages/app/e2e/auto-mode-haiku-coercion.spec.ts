import { expect, test } from "./fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

// Auto mode on a Haiku model coerces to "dontAsk" client-side
// (coerceModeForModel in packages/app/src/provider-selection/mode-support.ts,
// keyed on the daemon stamping `supportsAutoMode: false` on Claude's Haiku
// catalog entries). That trigger requires the real Claude catalog, so the
// coercion ITSELF cannot run deterministically in Tier-1 — what CAN is the
// user-facing result: a live agent stuck in a non-user-selectable mode locks
// the mode control into LockedAgentModeBadge (testID "mode-control-locked",
// packages/app/src/composer/agent-controls/mode-control.tsx) instead of the
// interactive dropdown chip (testID "mode-control").
//
// The mock provider mirrors Claude's hidden mode for exactly this: its
// manifest carries a dev-only "dontAsk" mode with `userSelectable: false`
// (packages/protocol/src/provider-manifest.ts, MOCK_LOAD_TEST_MODES), so a
// seeded mock agent whose snapshot carries the coerced mode renders the same
// locked badge a coerced Claude agent would.
test.describe("Locked agent mode badge (auto -> dontAsk coercion surface)", () => {
  test("a live agent in the hidden dontAsk mode locks the mode control", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "locked-mode-badge-",
      title: "Locked mode badge e2e",
      modeId: "dontAsk",
    });

    try {
      await openAgentRoute(page, session);

      // The locked badge renders with the mode's label and no dropdown.
      const lockedBadge = page.getByTestId("mode-control-locked").first();
      await expect(lockedBadge).toBeVisible({ timeout: 60_000 });
      await expect(lockedBadge).toContainText("Don't ask");
      await expect(page.getByTestId("mode-control")).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });

  test("a live agent in a user-selectable mode keeps the interactive control", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "unlocked-mode-chip-",
      title: "Unlocked mode chip e2e",
      modeId: "load-test",
    });

    try {
      await openAgentRoute(page, session);

      const modeChip = page.getByTestId("mode-control").first();
      await expect(modeChip).toBeVisible({ timeout: 60_000 });
      await expect(modeChip).toContainText("Load test");
      await expect(page.getByTestId("mode-control-locked")).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
});
