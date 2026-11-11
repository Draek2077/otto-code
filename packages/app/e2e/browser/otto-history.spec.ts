import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  createMockIdleAgent,
  expectSessionRowVisible,
  openSessions,
} from "../support/helpers/archive-tab";
import { openCommandCenter } from "../support/helpers/command-center";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

function nonce() {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

async function confirmArchive(page: Page, action: "dismiss" | "accept") {
  const shown = page.waitForEvent("dialog");
  const click = page.getByTestId("sessions-clear-archived").click();
  const dialog = await shown;
  const message = dialog.message();
  await dialog[action]();
  await click;
  return message;
}

test.describe("Otto History restoration", () => {
  test.describe.configure({ timeout: 180_000 });

  test("search finds a message across chats and opens its timeline", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "otto-global-chat-search-" });
    const phrase = `apricot${nonce()} orchard`;
    const input = { cwd: workspace.repoPath, workspaceId: workspace.workspaceId };
    try {
      const matching = await createMockIdleAgent(workspace.client, {
        ...input,
        title: "Search target",
      });
      await createMockIdleAgent(workspace.client, { ...input, title: "Unrelated chat" });
      await workspace.client.sendAgentMessage(matching.id, phrase);
      await workspace.client.waitForFinish(matching.id, 20_000);

      await gotoAppShell(page);
      const palette = await openCommandCenter(page);
      await palette.getByTestId("command-center-input").fill(phrase);
      const row = palette
        .getByTestId("command-center-chat-message")
        .filter({ hasText: "Search target" })
        .first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText(phrase);
      await row.click();
      await expect(palette).not.toBeVisible();
      const target = page.getByTestId("user-message").filter({ hasText: phrase });
      await expect(target).toBeInViewport({ timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("a cancelled archive review keeps the row; confirmation clears only that host's archived record", async ({
    page,
  }) => {
    // Never sweep the shared acceptance daemon; other specs own its archives.
    const host = await startIsolatedHostDaemon(`otto_history_${nonce()}`);
    try {
      const workspace = await seedWorkspace({ port: host.port, repoPrefix: "otto-clear-history-" });
      try {
        const input = { cwd: workspace.repoPath, workspaceId: workspace.workspaceId };
        const archived = await createMockIdleAgent(workspace.client, {
          ...input,
          title: "Archived fixture chat",
        });
        const active = await createMockIdleAgent(workspace.client, {
          ...input,
          title: "Active fixture chat",
        });
        await workspace.client.archiveAgent(archived.id);
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, {
          serverId: host.serverId,
          label: "Archive fixture host",
          port: host.port,
        });
        await openSessions(page);
        await page.getByTestId("sessions-host-filter-trigger").click();
        const option = page.getByTestId(`sessions-host-filter-item-${host.serverId}`);
        await expect(option).toContainText(/\b(?:B|KB)\b/, { timeout: 30_000 });
        await option.click();
        await page.getByTestId("sessions-archive-archived").click();
        await expectSessionRowVisible(page, archived.title);

        const cancelled = await confirmArchive(page, "dismiss");
        expect(cancelled).toContain("Clear 1 archived chat?");
        expect(cancelled).toContain("Archive fixture host");
        expect(cancelled).toContain("provider transcripts stay");
        await expectSessionRowVisible(page, archived.title);

        await confirmArchive(page, "accept");
        await expect(page.getByText(archived.title, { exact: true })).toHaveCount(0, {
          timeout: 30_000,
        });
        await page.getByTestId("sessions-archive-active").click();
        await expectSessionRowVisible(page, active.title);
      } finally {
        await workspace.cleanup();
      }
    } finally {
      await host.close();
    }
  });
});
