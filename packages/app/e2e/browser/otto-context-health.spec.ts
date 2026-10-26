import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { CONTEXT_WARNING_PREFERENCE } from "../../src/otto/context-management/health-model";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
for (const compact of [false, true]) {
  test(`Composer context warning, mute, Manage and preference recovery (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-context-health-",
      title: "Context health fixture",
      git: false,
    });
    await writeFile(
      path.join(workspace.repoPath, "AGENTS.md"),
      "Use only the project's documented commands.\n".repeat(2100),
    );
    ottoProvider.setContextWindow(65536);
    await ottoProvider.refreshCatalog();
    try {
      const agent = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        initialPrompt: "Reply Ready without using tools.",
        title: "Context health chat",
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      const pill = page.getByTestId("composer-context-health").filter({ visible: true });
      await expect(pill).toBeVisible({ timeout: 20000 });
      await pill.click();
      await expect(page.getByTestId("composer-context-health-summary")).toContainText(
        "fixed tokens",
      );
      await page.screenshot({
        path: testInfo.outputPath(`context-warning-${compact ? "compact" : "wide"}.png`),
      });
      await page.getByTestId("composer-context-health-dismiss").click();
      await expect(pill).toBeHidden();
      // Mutes have the original device-session lifetime; a new app load reads only
      // the durable enabled preference, never a report or prompt cached in storage.
      await page.reload();
      await expect(pill).toBeVisible({ timeout: 20000 });
      await pill.click();
      await page.getByTestId("composer-context-health-manage").click();
      const context = page.getByTestId("otto-context-management").filter({ visible: true });
      await expect(context).toBeVisible();
      const enabled = context.getByRole("switch", {
        name: "Composer context warnings",
        exact: true,
      });
      await expect(enabled).toBeChecked();
      await enabled.click();
      await expect(enabled).not.toBeChecked();
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).enabled,
          CONTEXT_WARNING_PREFERENCE,
        ),
      ).toBe(false);
      await page.evaluate(
        (key) => localStorage.setItem(key, "invalid-warning-fixture"),
        CONTEXT_WARNING_PREFERENCE,
      );
      await page.reload();
      await expect(
        context.getByText("Context warning preferences could not be read.", { exact: false }),
      ).toBeVisible();
      await expect(enabled).toBeDisabled();
      expect(
        await page.evaluate((key) => localStorage.getItem(key), CONTEXT_WARNING_PREFERENCE),
      ).toBe("invalid-warning-fixture");
      await page.evaluate(
        (key) => localStorage.setItem(key, JSON.stringify({ version: 1, enabled: false })),
        CONTEXT_WARNING_PREFERENCE,
      );
      await context.getByRole("button", { name: "Reload warning preference", exact: true }).click();
      await expect(enabled).toBeEnabled();
      await expect(enabled).not.toBeChecked();
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
      await expect(
        page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
      ).toBeVisible();
      await expect(pill).toBeHidden();
    } finally {
      await workspace.cleanup();
    }
  });
}
