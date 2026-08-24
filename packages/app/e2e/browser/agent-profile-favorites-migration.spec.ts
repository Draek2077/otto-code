import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsHostSection } from "../support/helpers/settings";
import { getServerId } from "../support/helpers/server-id";
import {
  expectHostAgentProfiles,
  seedAgentProfiles,
  stageLegacyFavoritesForHostMigration,
} from "../support/helpers/agent-profiles";

const MIGRATED_ID = "legacy_favorite:mock:one-minute-stream";

// Same route the Personality CRUD spec uses: Settings -> Host -> Teams hosts
// the one roster editor (settings-host-section-agents -> AgentPersonalitiesSection).
async function openAgentsSettingsSection(page: Page): Promise<void> {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "teams");
  await expect(page.getByTestId("agent-personalities-section")).toBeVisible({ timeout: 30_000 });
}

// A device's old model favourites migrate once into the host's stored-template
// roster. Since the two template systems converged there is only one roster and
// one editor, so the migrated row has to land somewhere the user can actually
// reach it - that is the half of this behaviour worth guarding, and the half
// that silently broke when the second editor was retired.
test.describe("Legacy favourite migration", () => {
  test("a device favourite becomes an editable entry in the one roster", async ({ page }) => {
    const seed = await seedAgentProfiles([]);

    try {
      await stageLegacyFavoritesForHostMigration(page, [
        { provider: "mock", modelId: "one-minute-stream" },
      ]);

      await expectHostAgentProfiles([
        {
          id: MIGRATED_ID,
          name: "One minute stream",
          provider: "mock",
          model: "one-minute-stream",
        },
      ]);

      await openAgentsSettingsSection(page);
      await expect(
        page
          .getByTestId("agent-personalities-card")
          .getByTestId(`agent-personality-row-${MIGRATED_ID}`),
      ).toBeVisible({ timeout: 30_000 });
      // Editable, not just listed: the migration used to write rows no UI owned.
      await expect(page.getByTestId(`agent-personality-edit-${MIGRATED_ID}`)).toBeVisible();
    } finally {
      await seed.restore();
    }
  });
});
