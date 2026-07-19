import { expect, test, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { openSettingsHostSection } from "./helpers/settings";
import { getServerId } from "./helpers/server-id";
import {
  connectPersonalitiesClient,
  findPersonalityByName,
  MOCK_MODEL_LABEL,
  MOCK_PROVIDER_LABEL,
  removePersonalitiesByName,
  uniquePersonalityName,
  type PersonalitiesDaemonClient,
} from "./helpers/personalities";

// The personalities editor lives in the host settings "Agents" section
// (settings-host-section-agents → AgentPersonalitiesSection).
async function openAgentsSettingsSection(page: Page): Promise<void> {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "agents");
  await expect(page.getByTestId("agent-personalities-section")).toBeVisible({ timeout: 30_000 });
}

function personalityRowByName(page: Page, name: string) {
  return page
    .getByTestId("agent-personalities-card")
    .locator('[data-testid^="agent-personality-row-"]')
    .filter({ hasText: name })
    .first();
}

// The editor is a TabbedModalSheet; tabs render as buttons inside the
// segmented control tagged agent-personality-tabs.
async function switchEditorTab(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("agent-personality-tabs")
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function pickComboOption(page: Page, triggerTestId: string, optionLabel: string) {
  await page.getByTestId(triggerTestId).click();
  const option = page
    .getByTestId("combobox-desktop-container")
    .getByText(optionLabel, { exact: true })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible({
    timeout: 10_000,
  });
}

async function waitForPersonalityInConfig(client: PersonalitiesDaemonClient, name: string) {
  await expect
    .poll(async () => (await findPersonalityByName(client, name)) !== null, { timeout: 30_000 })
    .toBe(true);
  const personality = await findPersonalityByName(client, name);
  if (!personality) {
    throw new Error(`Personality "${name}" not found in daemon config after poll`);
  }
  return personality;
}

test.describe("Agent personalities settings CRUD", () => {
  test.describe.configure({ timeout: 180_000 });

  test("create, edit, and delete a personality through the tabbed editor", async ({ page }) => {
    const client = await connectPersonalitiesClient();
    // Distinct bases (A/B) so a substring text filter for one name can never
    // match the other row.
    const createdName = uniquePersonalityName("E2eCrA");
    const renamedName = uniquePersonalityName("E2eCrB");

    try {
      await openAgentsSettingsSection(page);

      // ── Create ──────────────────────────────────────────────────────────
      await page.getByTestId("agent-personalities-add-button").click();
      const modal = page.getByTestId("agent-personality-edit-modal");
      await expect(modal).toBeVisible({ timeout: 15_000 });

      // Identity tab (default): name, roles (leave the all-roles default),
      // spinner color via the hex input.
      await page.getByTestId("agent-personality-name-input").fill(createdName);
      await page.getByTestId("agent-personality-glow-a-input").fill("#112233");

      // Personality tab: the prompt.
      await switchEditorTab(page, "Personality");
      await page
        .getByTestId("agent-personality-prompt-input")
        .fill("You are the settings CRUD e2e personality.");

      // Model tab: bind the deterministic mock provider + model.
      await switchEditorTab(page, "Model");
      await pickComboOption(page, "agent-personality-provider-picker", MOCK_PROVIDER_LABEL);
      await pickComboOption(page, "agent-personality-model-picker", MOCK_MODEL_LABEL);

      // Voice tab: hand-write one cue line so saving never routes through the
      // daemon's AI voice-cue generation (save-time auto-fill only runs when
      // every cue group is empty).
      await switchEditorTab(page, "Voice");
      await page.getByRole("button", { name: "Add line", exact: true }).first().click();
      await page.getByTestId("agent-personality-cue-join-0").fill("On it");

      await page.getByTestId("agent-personality-save-button").click();
      await expect(modal).not.toBeVisible({ timeout: 30_000 });

      const createdRow = personalityRowByName(page, createdName);
      await expect(createdRow).toBeVisible({ timeout: 30_000 });
      await expect(createdRow).toContainText(`${MOCK_PROVIDER_LABEL} · ${MOCK_MODEL_LABEL}`);

      const created = await waitForPersonalityInConfig(client, createdName);
      expect(created.provider).toBe("mock");
      expect(created.model).toBe("ten-second-stream");
      expect(created.spinner?.glowA).toBe("#112233");
      expect(created.personalityPrompt).toBe("You are the settings CRUD e2e personality.");

      // ── Edit ────────────────────────────────────────────────────────────
      await createdRow.locator('[data-testid^="agent-personality-edit-"]').click();
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("agent-personality-name-input")).toHaveValue(createdName);

      await page.getByTestId("agent-personality-name-input").fill(renamedName);
      await switchEditorTab(page, "Personality");
      await page
        .getByTestId("agent-personality-prompt-input")
        .fill("You are the renamed settings CRUD e2e personality.");
      await page.getByTestId("agent-personality-save-button").click();
      await expect(modal).not.toBeVisible({ timeout: 30_000 });

      const renamedRow = personalityRowByName(page, renamedName);
      await expect(renamedRow).toBeVisible({ timeout: 30_000 });
      await expect(personalityRowByName(page, createdName)).not.toBeVisible();

      const renamed = await waitForPersonalityInConfig(client, renamedName);
      // Edit keeps the identity (same roster id), only fields change.
      expect(renamed.id).toBe(created.id);
      expect(renamed.personalityPrompt).toBe("You are the renamed settings CRUD e2e personality.");
      expect(await findPersonalityByName(client, createdName)).toBeNull();

      // ── Delete ──────────────────────────────────────────────────────────
      await renamedRow.locator('[data-testid^="agent-personality-remove-"]').click();
      await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("confirm-dialog-confirm").click();

      await expect(personalityRowByName(page, renamedName)).not.toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => (await findPersonalityByName(client, renamedName)) === null, {
          timeout: 30_000,
        })
        .toBe(true);
    } finally {
      // Safety net: the daemon is shared across the whole run, so strip any
      // spec-owned roster entries even when an assertion failed mid-flow.
      await removePersonalitiesByName(client, [createdName, renamedName]).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  });
});
