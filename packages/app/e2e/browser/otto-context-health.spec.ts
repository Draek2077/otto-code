import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { CONTEXT_WARNING_PREFERENCE } from "../../src/otto/context-management/health-model";
import { readContextReport } from "@getpaseo/plugin/otto/context-management";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";

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
    // A manually pinned ID deliberately skips catalog discovery and has no
    // window metadata. This journey exercises a discovered model instead.
    await ottoProvider.update({ model: "" });
    await ottoProvider.refreshCatalog(65536);
    const inspection = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "context-health-inspection" });
    let prepared: unknown;
    try {
      const agent = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        initialPrompt: "Reply Ready without using tools.",
        title: "Context health chat",
      });
      // Prove that the real provider has prepared the instruction-bearing request
      // before attributing an absent warning to the renderer.
      await expect
        .poll(
          async () => {
            const result = readContextReport.output.parse(
              await inspection.invokePluginRpc("otto-project-knowledge", readContextReport.name, {
                hostId: getServerId(),
                workspaceId: workspace.workspaceId,
                agentId: agent.id,
                windowTokens: 65536,
              }),
            );
            prepared = result.ok
              ? {
                  fixedTokens: result.value.fixedTokens,
                  agentId: result.value.agentId,
                  instructionState: result.value.instructionState,
                  categories: result.value.categories,
                }
              : result;
            return result.ok ? result.value.fixedTokens : 0;
          },
          { timeout: 15000 },
        )
        .toBeGreaterThan(16384);
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
    } catch (error) {
      await writeFile(
        testInfo.outputPath("prepared-context-health.json"),
        JSON.stringify(prepared),
      );
      await testInfo.attach("prepared-context-health", {
        body: JSON.stringify(prepared),
        contentType: "application/json",
      });
      await page
        .screenshot({ path: testInfo.outputPath("context-health-before-cleanup.png") })
        .catch(() => undefined);
      throw error;
    } finally {
      await inspection.close();
      await workspace.cleanup();
    }
  });
}
