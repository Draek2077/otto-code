import { test, expect } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import {
  agentProfileRow,
  openAgentProfileSettings,
  openModelPicker,
  applyProfileFromPicker,
  profilePickerRow,
  closeModelPicker,
} from "../support/helpers/agent-profiles";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectComposerVisible } from "../support/helpers/composer";
import { openMobileAgentSidebar, closeMobileAgentSidebar } from "../support/helpers/sidebar";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

import type { Locator, Page } from "@playwright/test";
async function openPicker(page: Page, width: number) {
  if (width >= 720) return openModelPicker(page);
  await page.getByTestId("combined-model-selector").filter({ visible: true }).first().click();
  await page.getByTestId("agent-controls-model").click();
  await expect(page.getByTestId("agent-controls-model-browser-sheet")).toBeVisible();
}
function scopedRow(page: Page, width: number, name: string) {
  if (width >= 720) return profilePickerRow(page, name);
  return page
    .getByTestId("agent-controls-model-browser-viewport")
    .locator('[data-testid^="model-profile-row-"]')
    .filter({ hasText: name });
}

async function expectSidebarTeamInsets(page: Page, picker: Locator) {
  const shortcuts = page.getByTestId("sidebar-shortcuts").filter({ visible: true }).first();
  const schedules = shortcuts.getByTestId("sidebar-schedules");
  await expect
    .poll(async () => {
      const [group, row, trigger] = await Promise.all([
        shortcuts.boundingBox(),
        schedules.boundingBox(),
        picker.boundingBox(),
      ]);
      if (!group || !row || !trigger) return null;
      const rowInset = row.x - group.x;
      const pickerRightInset = group.x + group.width - trigger.x - trigger.width;
      return (
        rowInset > 0 && Math.abs(trigger.x - row.x) < 1 && Math.abs(pickerRightInset - rowInset) < 1
      );
    })
    .toBe(true);
}

async function expectTeamPopupToMatchTrigger(page: Page, picker: Locator) {
  const popup = page.getByTestId("combobox-desktop-container").filter({ visible: true });
  await expect(popup).toBeVisible();
  await expect
    .poll(async () => {
      const [trigger, menu] = await Promise.all([picker.boundingBox(), popup.boundingBox()]);
      if (!trigger || !menu) return null;
      return Math.abs(trigger.x - menu.x) < 1 && Math.abs(trigger.width - menu.width) < 1;
    })
    .toBe(true);
}

interface RosterClient {
  fetchAgent(input: { agentId: string }): Promise<{
    agent: { labels: Record<string, string>; model: string | null; provider: string };
  } | null>;
  connect(): Promise<void>;
  getDaemonConfig(): Promise<{ config: MutableDaemonConfig }>;
  patchDaemonConfig(p: MutableDaemonConfigPatch): Promise<unknown>;
  close(): Promise<void>;
}
for (const width of [1280, 390]) {
  test(`Team switch scopes the picker and keeps the current chat at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 844 });
    const client = await connectDaemonClient<RosterClient>({ clientIdPrefix: "otto-team-browser" });
    const { config } = await client.getDaemonConfig();
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "otto-team-ui-",
      title: "Team selection",
      model: "one-minute-stream",
      modeId: "load-test",
    });
    const profile = {
      id: "chatter-a",
      name: "Aster",
      provider: "mock",
      model: "one-minute-stream",
      roles: ["chatter"],
    };
    const second = { ...profile, id: "chatter-b", name: "Birch" };
    const writer = { ...profile, id: "writer", name: "Writer only", roles: ["writer"] };
    const secondTeamName = "Team B with a longer name for the sidebar dropdown";
    try {
      await client.patchDaemonConfig({
        agentProfiles: [profile, second, writer],
        agentTeams: {
          activeTeamId: "a",
          teams: [
            { id: "a", name: "Team A", memberIds: [profile.id, writer.id] },
            { id: "b", name: secondTeamName, memberIds: [second.id] },
          ],
        },
      });
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openPicker(page, width);
      await expect(scopedRow(page, width, profile.name)).toBeVisible();
      await expect(scopedRow(page, width, writer.name)).toHaveCount(0);
      if (width >= 720) await applyProfileFromPicker(page, profile.name);
      else await scopedRow(page, width, profile.name).click();
      await expect
        .poll(
          async () => {
            const snapshot = await client.fetchAgent({ agentId: workspace.agentId });
            return (
              snapshot?.agent.labels?.["otto.profile"] ||
              (
                await page
                  .getByText(/unavailable|failed|disconnected|Update the host/i)
                  .allTextContents()
              ).join(" ")
            );
          },
          { message: "Owning daemon acknowledges the chosen Profile before switching Teams" },
        )
        .toContain(profile.name);
      if (width < 720) await openMobileAgentSidebar(page);
      const teamPicker = page.getByTestId("active-team-switcher").filter({ visible: true }).first();
      await expectSidebarTeamInsets(page, teamPicker);
      await teamPicker.click();
      if (width >= 720) await expectTeamPopupToMatchTrigger(page, teamPicker);
      await page
        .getByText(secondTeamName, { exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await expect
        .poll(async () => (await client.getDaemonConfig()).config.agentTeams?.activeTeamId)
        .toBe("b");
      if (width < 720) await closeMobileAgentSidebar(page);
      await openPicker(page, width);
      await expect(scopedRow(page, width, second.name)).toBeVisible();
      await expect(scopedRow(page, width, profile.name)).toHaveCount(0);
      await expect(page.getByText(/Aster/).filter({ visible: true }).first()).toBeVisible();
      if (width >= 720) await closeModelPicker(page);
      else {
        // Same provider/model, but an explicit bare-model pick releases the existing Profile.
        await page
          .getByTestId("agent-controls-model-browser-viewport")
          .getByTestId("model-row-mock-one-minute-stream")
          .click();
        await expect
          .poll(
            async () =>
              (await client.fetchAgent({ agentId: workspace.agentId }))?.agent.labels?.[
                "otto.profile"
              ] ?? null,
          )
          .toBeNull();
      }
    } finally {
      await workspace.client.archiveAgent(workspace.agentId).catch(() => undefined);
      await workspace.cleanup();
      await client.patchDaemonConfig({
        agentProfiles: config.agentProfiles ?? [],
        agentTeams: {
          teams: config.agentTeams?.teams ?? [],
          activeTeamId: config.agentTeams?.activeTeamId ?? null,
        },
      });
      await client.close();
    }
  });
}

test("Host settings restore a missing Crew member and persist four editable voice cues", async ({
  page,
}) => {
  const client = await connectDaemonClient<RosterClient>({
    clientIdPrefix: "otto-profile-authoring",
  });
  const { config } = await client.getDaemonConfig();
  const original = config.agentProfiles ?? [];
  const p = { id: "voice-author", name: "Authoring fixture", provider: "mock", roles: ["writer"] };
  try {
    expect(config.agentTeams?.teams?.some((t) => t.name === "The Otto Crew")).toBe(true);
    expect(original.some((item) => item.name === "Vera")).toBe(true);
    await client.patchDaemonConfig({
      agentProfiles: [...original.filter((item) => item.name !== "Vera"), p],
    });
    await openAgentProfileSettings(page);
    await page.getByRole("button", { name: "Restore missing", exact: true }).click();
    await expect(agentProfileRow(page, "Vera")).toBeVisible();
    await agentProfileRow(page, p.name)
      .getByRole("button", { name: "Edit profile", exact: true })
      .click();
    const editor = page.getByTestId("agent-profile-edit-modal");
    await expect(
      editor.getByRole("button", { name: "Generate prompt", exact: true }),
    ).toBeVisible();
    await editor.getByRole("button", { name: "Voice", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Generate voice lines", exact: true }),
    ).toBeVisible();
    const cues = {
      join: ["Hello."],
      thinking: ["Working."],
      waiting: ["Waiting."],
      done: ["Finished."],
    };
    for (const [moment, lines] of Object.entries(cues))
      await editor.getByTestId(`profile-cue-${moment}`).fill(lines[0]);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await client.getDaemonConfig()).config.agentProfiles?.find((item) => item.id === p.id)
            ?.voiceCues,
      )
      .toEqual(cues);
  } finally {
    await client.patchDaemonConfig({ agentProfiles: original });
    await client.close();
  }
});

test("Changing models in an existing chat preserves the conversation and new-chat defaults", async ({
  page,
}) => {
  const client = await connectDaemonClient<RosterClient>({ clientIdPrefix: "otto-live-model" });
  const { config } = await client.getDaemonConfig();
  const original = config.agentProfiles ?? [];
  const prompt = "Keep this message when changing models.";
  const chat = await seedMockAgentWorkspace({
    repoPrefix: "otto-live-model-",
    title: "Model switch",
    initialPrompt: prompt,
    model: "ten-second-stream",
    modeId: "load-test",
  });
  const first = {
    id: "model-switcher",
    name: "Model Switcher",
    provider: "mock",
    model: "one-minute-stream",
    roles: ["chatter"],
  };
  try {
    await client.patchDaemonConfig({
      agentProfiles: [...original, first],
      agentTeams: { activeTeamId: null },
    });
    await openAgentRoute(page, chat);
    await expectComposerVisible(page);
    await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
    await chat.client.waitForAgentUpsert(chat.agentId, (agent) => agent.status === "idle", 30000);
    const prefs = () => page.evaluate(() => localStorage.getItem("@otto:create-agent-preferences"));
    const baseline = await prefs();
    await openModelPicker(page);
    await applyProfileFromPicker(page, first.name);
    await expect
      .poll(async () => {
        const a = (await client.fetchAgent({ agentId: chat.agentId }))?.agent;
        return [a?.model, a?.provider, !!a?.labels?.["otto.profile"]];
      })
      .toEqual([first.model, "mock", true]);
    await openModelPicker(page);
    await page
      .getByTestId("model-row-mock-ten-second-stream")
      .filter({ visible: true })
      .first()
      .click();
    await expect
      .poll(async () => {
        const a = (await client.fetchAgent({ agentId: chat.agentId }))?.agent;
        return [a?.model, !!a?.labels?.["otto.profile"]];
      })
      .toEqual(["ten-second-stream", false]);
    await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
    expect(await prefs()).toBe(baseline);
  } finally {
    await chat.client.archiveAgent(chat.agentId).catch(() => undefined);
    await chat.cleanup();
    await client.patchDaemonConfig({
      agentProfiles: original,
      agentTeams: { activeTeamId: config.agentTeams?.activeTeamId ?? null },
    });
    await client.close();
  }
});
