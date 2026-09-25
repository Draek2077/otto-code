import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createIdleAgent, createMockIdleAgent } from "../support/helpers/archive-tab";
import { gotoWorkspace } from "../support/helpers/launcher";
import { moneyShot, qaShot } from "../support/helpers/evidence";
import { openCommandCenter } from "../support/helpers/command-center";
import { addOfflineHostAndReload } from "../support/helpers/hosts";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

const PRIMARY_HOST_LABEL = "Primary Host";
const SECONDARY_HOST_ID = "host-command-center-workspaces-secondary";
const WORKSPACE_TITLE = "Payments Refactor";
const WORKSPACE_BRANCH = "feature/cmd-k-workspaces";
const AGENT_TITLE = "Fix checkout retries";

test.describe("Command center workspaces", () => {
  test.describe.configure({ timeout: 180_000 });

  test("global chat message search crosses projects and opens the matching message", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const first = await seedWorkspace({ repoPrefix: "chat-search-first-", title: "First project" });
    const second = await seedWorkspace({
      repoPrefix: "chat-search-second-",
      title: "Second project",
    });
    const needle = "Apricot rendezvous in the distant orchard";
    const chatTitle =
      "Orchard conversation with a deliberately long title that must truncate before its Archived pill";
    try {
      const agent = await createMockIdleAgent(second.client, {
        cwd: second.repoPath,
        workspaceId: second.workspaceId,
        title: chatTitle,
      });
      await second.client.sendAgentMessage(agent.id, needle);
      await second.client.waitForFinish(agent.id, 30_000);
      await second.client.archiveAgent(agent.id);
      await expect
        .poll(
          async () =>
            (
              await second.client.searchChatMessages({
                query: "apricot rendezvous",
                projectId: second.projectId,
              })
            ).hits,
          { timeout: 30_000 },
        )
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: agent.id, archived: true, provider: "mock" }),
          ]),
        );
      await gotoWorkspace(page, first.workspaceId);
      const panel = await openCommandCenter(page);
      await expect(panel.getByRole("button", { name: /^New workspace/ })).toBeVisible();
      const normalPadding = await panel
        .getByRole("button", { name: /^New workspace/ })
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            top: style.paddingTop,
            right: style.paddingRight,
            bottom: style.paddingBottom,
            left: style.paddingLeft,
          };
        });
      await expect(panel.getByTestId("command-center-result-type")).toHaveCount(0);
      await expect(panel.getByTestId("command-center-chat-scope")).toHaveCount(0);
      await panel.getByTestId("command-center-input").fill("apricot rendezvous");
      const result = panel.getByTestId("command-center-message-result").filter({ hasText: needle });
      await expect(result).toBeVisible();
      const title = result.getByTestId("command-center-message-title");
      const badge = result.getByTestId("command-center-message-archived");
      await expect(title).toHaveText(chatTitle);
      await expect(badge).toHaveText("Archived");
      await expect(title).toHaveCSS("text-overflow", "ellipsis");
      const metadata = result.getByTestId("command-center-message-metadata");
      const preview = result.getByTestId("command-center-message-snippet");
      const provider = result.getByTestId("command-center-message-provider");
      await expect(provider).toBeVisible();
      expect((await preview.boundingBox())!.y).toBeLessThan((await metadata.boundingBox())!.y);
      const matchPadding = await result.locator("..").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          top: style.paddingTop,
          right: style.paddingRight,
          bottom: style.paddingBottom,
          left: style.paddingLeft,
        };
      });
      expect(matchPadding).toEqual(normalPadding);
      await expect(metadata).not.toContainText("Archived");
      const titleColor = await title.evaluate((element) => getComputedStyle(element).color);
      const metadataColor = await metadata.evaluate((element) => getComputedStyle(element).color);
      expect(metadataColor).not.toBe(titleColor);
      await expect(result.getByTestId("command-center-message-snippet")).toHaveCSS(
        "color",
        metadataColor,
      );
      await qaShot(page, "Archived message uses History pill and normal search typography");
      await page.setViewportSize({ width: 520, height: 850 });
      // Crossing the compact breakpoint remounts the palette and resets its query.
      await expect
        .poll(async () => (await panel.boundingBox())?.width ?? Infinity)
        .toBeLessThan(520);
      await panel.getByTestId("command-center-input").fill("apricot rendezvous");
      await expect(badge).toBeVisible();
      const titleBox = (await title.boundingBox())!;
      const badgeBox = (await badge.boundingBox())!;
      const rowBox = (await result.boundingBox())!;
      const providerBox = (await provider.boundingBox())!;
      expect(
        Math.abs(providerBox.y + providerBox.height / 2 - (titleBox.y + titleBox.height / 2)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(badgeBox.y + badgeBox.height / 2 - (titleBox.y + titleBox.height / 2)),
      ).toBeLessThanOrEqual(1);
      expect(titleBox.width).toBeGreaterThan(0);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(badgeBox.x);
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      await qaShot(
        page,
        "Narrow search keeps the Archived pill visible beside an ellipsized title",
      );
      await result.click();
      // The mock provider resumes with empty history. Verify stale-match feedback rather
      // than pretending it persists conversations, then exercise a fresh live match.
      await expect(
        page.getByText("This message changed. Search again to see the current results.", {
          exact: true,
        }),
      ).toBeVisible();
      await second.client.sendAgentMessage(agent.id, needle);
      await second.client.waitForFinish(agent.id, 30_000);
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await openCommandCenter(page);
      await panel.getByTestId("command-center-input").fill("apricot rendezvous");
      await expect(result).toBeVisible();
      await expect(badge).toHaveCount(0);
      await result.click();
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), second.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByText(needle, { exact: true })).toBeVisible();
      await moneyShot(page, "Global Search opens the matching message in another project");
    } finally {
      await second.cleanup();
      await first.cleanup();
    }
  });

  test("workspace results show their title, host, and branch and open the workspace", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "command-center-workspace-",
      title: WORKSPACE_TITLE,
    });

    try {
      execFileSync("git", ["checkout", "-b", WORKSPACE_BRANCH], {
        cwd: seeded.repoPath,
        stdio: "ignore",
      });
      const refreshed = await seeded.client.checkoutRefresh(seeded.repoPath);
      if (!refreshed.success) {
        throw new Error(`Failed to refresh checkout: ${JSON.stringify(refreshed.error)}`);
      }
      const agent = await createIdleAgent(seeded.client, {
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title: AGENT_TITLE,
      });

      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: SECONDARY_HOST_ID,
        label: "Secondary Host",
        primaryLabel: PRIMARY_HOST_LABEL,
      });

      const panel = await openCommandCenter(page);
      const row = panel.getByTestId(
        `command-center-workspace-${getServerId()}:${seeded.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText(WORKSPACE_TITLE);
      await expect(row).toContainText(WORKSPACE_BRANCH);

      // The subtitle disambiguates by project: host · project · branch (multi-host).
      const subtitle = row.getByTestId("command-center-workspace-subtitle");
      await expect(subtitle).toContainText(PRIMARY_HOST_LABEL);
      await expect(subtitle).toContainText(seeded.projectDisplayName);
      await expect(subtitle).toContainText(WORKSPACE_BRANCH);

      // The agent subtitle is unchanged by the shared-helper refactor.
      const agentRow = panel.getByTestId(`command-center-agent-${getServerId()}:${agent.id}`);
      await expect(agentRow).toContainText(AGENT_TITLE);
      await expect(agentRow).toContainText(PRIMARY_HOST_LABEL);
      await expect(agentRow).toContainText(WORKSPACE_TITLE);
      await expect(agentRow).not.toContainText(seeded.repoPath);

      const workspaceSectionTop = await panel
        .getByText("Workspaces", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      const agentSectionTop = await panel
        .getByText("Agents", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(workspaceSectionTop).toBeLessThan(agentSectionTop);

      const input = panel.getByTestId("command-center-input");
      await input.fill(PRIMARY_HOST_LABEL);
      await expect(row).toBeVisible();
      await expect(agentRow).toBeVisible();

      await input.fill(WORKSPACE_BRANCH);
      await expect(row).toBeVisible();
      await expect(agentRow).not.toBeVisible();

      await input.fill(WORKSPACE_TITLE);
      await expect(row).toBeVisible();
      await expect(agentRow).toBeVisible();

      await input.fill(seeded.repoPath);
      await expect(agentRow).toBeVisible();
      await expect(row).not.toBeVisible();

      // The project name is now part of the workspace searchText.
      await input.fill(seeded.projectDisplayName);
      await expect(row).toBeVisible();

      await input.fill(AGENT_TITLE);
      await expect(agentRow).toBeVisible();
      await expect(row).not.toBeVisible();

      await input.fill(WORKSPACE_TITLE);
      await page.keyboard.press("Enter");

      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), seeded.workspaceId), {
        timeout: 30_000,
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("single-host workspace subtitle omits the host and shows project · branch", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "command-center-workspace-single-",
      title: WORKSPACE_TITLE,
    });

    try {
      execFileSync("git", ["checkout", "-b", WORKSPACE_BRANCH], {
        cwd: seeded.repoPath,
        stdio: "ignore",
      });
      const refreshed = await seeded.client.checkoutRefresh(seeded.repoPath);
      if (!refreshed.success) {
        throw new Error(`Failed to refresh checkout: ${JSON.stringify(refreshed.error)}`);
      }

      // No secondary host: with a single host, the host label is gated away.
      await gotoAppShell(page);

      const panel = await openCommandCenter(page);
      const row = panel.getByTestId(
        `command-center-workspace-${getServerId()}:${seeded.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });

      const subtitle = row.getByTestId("command-center-workspace-subtitle");
      await expect(subtitle).toHaveText(`${seeded.projectDisplayName} · ${WORKSPACE_BRANCH}`);
    } finally {
      await seeded.cleanup();
    }
  });
});
