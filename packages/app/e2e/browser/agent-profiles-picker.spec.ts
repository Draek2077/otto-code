import { expect, test } from "../support/fixtures";
import {
  closeModelPicker,
  expectComposerMode,
  expectComposerModel,
  expectModelRowSelected,
  openModelPicker,
  seedAgentProfiles,
} from "../support/helpers/agent-profiles";
import { openSettings } from "../support/helpers/app";
import { openSettingsHostSection } from "../support/helpers/settings";
import { getServerId } from "../support/helpers/server-id";
import { expectModelTriggerShowsPersonality } from "../support/helpers/personalities";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const PROFILE = {
  id: "agent_profile_e2e_ui_work",
  name: "UI work",
  icon: "🎨",
  provider: "mock",
  model: "one-minute-stream",
  modeId: "approval-test",
  notes: "Use for UI work.",
  roles: ["chatter"],
};

const PROFILE_SUMMARY = "Mock Load Test · One minute stream";

test.describe("Agent profiles in the model picker", () => {
  test("an empty host offers models and manages profiles through host Settings", async ({
    page,
  }) => {
    const seed = await seedAgentProfiles([]);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "agent-profiles-empty-",
      title: "Agent profiles empty",
    });

    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openModelPicker(page);
      const picker = page.getByTestId("combobox-desktop-container");
      await expect(picker.locator('[data-testid^="personality-row-"]')).toHaveCount(0);
      await expect(picker.getByTestId("model-row-mock-ten-second-stream")).toBeVisible();
      // Otto deliberately owns profile creation in its host roster, rather
      // than adopting upstream's model-chooser creation modal.
      await closeModelPicker(page);
      await openSettings(page);
      await openSettingsHostSection(page, getServerId(), "teams");
      await expect(page.getByTestId("agent-personalities-section")).toBeVisible();
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });

  test("applying a pinned profile updates the brain and retains its identity", async ({ page }) => {
    const seed = await seedAgentProfiles([PROFILE]);
    // A live agent is one provider's process, so the profile has to name that
    // same provider or the picker will not offer it at all.
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "agent-profiles-picker-",
      title: "Agent profiles picker",
      model: "ten-second-stream",
      modeId: "load-test",
    });

    try {
      await test.step("the agent starts on its seeded model and mode", async () => {
        await openAgentRoute(page, workspace);
        await expectComposerVisible(page);
        await expectComposerModel(page, "Ten second stream");
        await expectComposerMode(page, "Load test");
      });

      await test.step("the sole provider opens directly", async () => {
        await openModelPicker(page);
        await expect(page.getByTestId("model-search-input").first()).toBeVisible();
        await expect(page.getByTestId("sheet-header-back")).toHaveCount(0);
        await expect(page.locator('[data-testid^="model-provider-"]')).toHaveCount(0);
        const row = page.getByTestId(`personality-row-${PROFILE.id}`);
        await expect(row).toContainText(PROFILE.name);
        await expect(row).toContainText(PROFILE_SUMMARY);
      });

      await test.step("applying it writes its model and mode into the composer", async () => {
        await page.getByTestId(`personality-row-${PROFILE.id}`).click();
        await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
        await page.getByTestId("confirm-dialog-confirm").click();
        await expectModelTriggerShowsPersonality(page, PROFILE.name);
        await expectComposerMode(page, "Approval test");
        await expectWorkspaceAgentConfiguration(workspace, {
          id: workspace.agentId,
          provider: "mock",
          model: "one-minute-stream",
          modeId: "approval-test",
        });
      });

      await test.step("reopening returns directly to the provider models", async () => {
        await openModelPicker(page);
        await expect(page.getByTestId("model-search-input").first()).toBeVisible();
        await expect(page.getByTestId(`personality-row-${PROFILE.id}`)).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expectModelRowSelected(page, { provider: "mock", modelId: "one-minute-stream" });
        await closeModelPicker(page);
      });

      await test.step("reloading preserves the bound profile identity", async () => {
        await page.reload();
        await expectModelTriggerShowsPersonality(page, PROFILE.name);
      });
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });
});
