import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { getServerId } from "../support/helpers/server-id";
import { selectTabFromSwitcher } from "../support/helpers/sheet";
import { createAgentTabFromMenu } from "../support/helpers/workspace-tabs";
import {
  observeVisualizer,
  observedCommands,
  visualizerMenu,
  visualizerContent,
  selectWorkspace,
  expectVisualizerReady,
  dragAndResizePip,
} from "../support/helpers/otto-visualizer";

test.use({
  e2eInjectPaseoTools: true,
  e2eDaemonConfig: {
    pluginsEnabled: true,
    agents: {
      metadataGeneration: { providers: [{ provider: "openai-compatible", model: "fixture" }] },
    },
  },
});
const completion = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
});
function proofReply(body: unknown) {
  const request = completion.parse(body);
  const marker = request.messages.find(
    (row) =>
      row.role === "user" &&
      typeof row.content === "string" &&
      row.content.includes("visualizer-proof:"),
  );
  if (!marker) return "Visualizer fixture";
  const count = request.messages.filter((row) => row.role === "tool").length;
  if (count >= 2) return "Visualizer canonical reply with **Markdown** and a real tool failure.";
  const name = count === 0 ? "otto_write_file" : "otto_read_file";
  if (!request.tools?.some((tool) => tool.function.name === name))
    throw new Error("Normal host tools must be advertised");
  return {
    toolCalls: [
      {
        id: `visualizer-${count}`,
        name,
        arguments: JSON.stringify(
          count === 0
            ? { path: "visualizer-proof.txt", content: "Source-backed Visualizer file activity.\n" }
            : { path: "missing-visualizer-proof.txt" },
        ),
      },
    ],
  };
}
for (const compact of [false, true]) {
  test(`Visualizer canonical sessions, PIP and chat background (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, info) => {
    test.setTimeout(150000);
    await page.setViewportSize(
      compact ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    );
    await observeVisualizer(page);
    await page.addInitScript(() =>
      localStorage.setItem(
        "@otto:create-agent-preferences",
        JSON.stringify({
          provider: "openai-compatible",
          providerPreferences: {
            "openai-compatible": { model: "fixture", mode: "bypassPermissions" },
          },
        }),
      ),
    );
    ottoProvider.replyWith(proofReply);
    await ottoProvider.refreshCatalog();
    const workspace = await seedWorkspace({ repoPrefix: "otto-visualizer-" });
    const other = await seedWorkspace({ repoPrefix: "otto-visualizer-other-" });
    try {
      const root = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Visualizer root",
        modeId: "bypassPermissions",
        initialPrompt: "visualizer-proof: root",
      });
      const child = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Visualizer child",
        modeId: "bypassPermissions",
        labels: { [PARENT_AGENT_ID_LABEL]: root.id },
        initialPrompt: "visualizer-proof: child",
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: root.id });
      await expect(
        page
          .getByText("Visualizer canonical reply with", { exact: false })
          .filter({ visible: true })
          .first(),
      ).toBeVisible({ timeout: 60000 });
      await visualizerMenu(page, "Open Visualizer tab");
      await expectVisualizerReady(page);
      await expect
        .poll(async () =>
          (await observedCommands(page))
            .flatMap((frame) => (frame.type === "agent-event-batch" ? frame.events : []))
            .filter((event) => event.type === "agent_spawn")
            .map((event) => event.payload.name),
        )
        .toEqual(expect.arrayContaining([root.id, child.id]));
      await expect
        .poll(async () =>
          (await observedCommands(page))
            .flatMap((frame) => (frame.type === "agent-event-batch" ? frame.events : []))
            .some((event) => event.type === "tool_call_end" && event.payload.isError === true),
        )
        .toBe(true);
      await page.getByRole("button", { name: "Visualizer options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Failures", exact: true }).click();
      await expect(
        visualizerContent(page).getByText("Failed Tool Calls", { exact: true }),
      ).toBeVisible();
      await expect(
        visualizerContent(page).getByText("missing-visualizer-proof.txt", { exact: false }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Visualizer options", exact: true }).click();
      await page.getByRole("menuitem", { name: "File activity", exact: true }).click();
      await expect(
        visualizerContent(page).getByText("visualizer-proof.txt", { exact: false }).first(),
      ).toBeVisible();
      await expect(
        visualizerContent(page).getByText("File token usage not reported", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`visualizer-${compact ? "compact" : "wide"}.png`),
      });
      await page.getByRole("button", { name: "Picture in picture", exact: true }).click();
      await expect(page.getByTestId("visualizer-window-pip")).toBeVisible();
      await expectVisualizerReady(page);
      if (!compact) await dragAndResizePip(page);
      // Actual retained workspace handoff, with no page reload or route injection.
      await selectWorkspace(page, other.workspaceId, compact);
      await expectVisualizerReady(page);
      await selectWorkspace(page, workspace.workspaceId, compact);
      await expectVisualizerReady(page);
      const pip = page.getByTestId("visualizer-window-pip");
      await pip.hover();
      await pip.getByRole("button", { name: "Open Visualizer tab", exact: true }).click();
      await expect(pip).toHaveCount(0);
      await expectVisualizerReady(page);
      await visualizerMenu(page, "Chat background");
      // Native tab controls restore the existing chat; the Visualizer descriptor remains saved.
      if (compact) await selectTabFromSwitcher(page, "Visualizer root");
      else
        await page
          .getByTestId(`workspace-tab-agent_${root.id}`)
          .filter({ visible: true })
          .first()
          .click();
      const viewport = page.getByTestId("chat-visualizer-viewport").filter({ visible: true });
      await expect(viewport).toBeVisible();
      await expectVisualizerReady(page);
      const composer = page
        .getByRole("textbox", { name: "Message agent...", exact: true })
        .filter({ visible: true });
      await page.getByRole("button", { name: "Show Visualizer only", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Show conversation", exact: true }),
      ).toBeVisible();
      await composer.fill("visualizer-proof: follow-up");
      await composer.press("Enter");
      await expect(
        page.getByRole("button", { name: "Show conversation", exact: true }),
      ).toBeVisible();
      await expect(composer).toBeEnabled();
      await page.getByRole("button", { name: "Show conversation", exact: true }).click();
      await expect(
        page
          .getByText("Visualizer canonical reply with", { exact: false })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`background-${compact ? "compact" : "wide"}.png`),
      });
      await createAgentTabFromMenu(page);
      await page
        .getByRole("button", { name: "Show Visualizer only", exact: true })
        .filter({ visible: true })
        .click();
      const draftPrompt = "visualizer-proof: draft handoff";
      await composer.fill(draftPrompt);
      await composer.press("Enter");
      await expect(page.getByTestId("user-message").filter({ hasText: draftPrompt })).toHaveCount(
        1,
      );
      await expect(
        page
          .getByRole("button", { name: "Show conversation", exact: true })
          .filter({ visible: true }),
      ).toBeVisible();
      await expectVisualizerReady(page);
      await page
        .getByRole("button", { name: "Show conversation", exact: true })
        .filter({ visible: true })
        .click();
      await expect(page.getByTestId("user-message").filter({ hasText: draftPrompt })).toBeVisible();
      await page.getByRole("button", { name: "Close background Visualizer", exact: true }).click();
      await expect(page.locator('iframe[title="Visualizer"]')).toHaveCount(0);
      await expect(composer).toBeEnabled();
    } catch (error) {
      await page.screenshot({ path: info.outputPath("visualizer-before-cleanup.png") });
      await writeFile(
        info.outputPath("visualizer-diagnostic.json"),
        JSON.stringify(
          { page: await page.locator("body").innerText(), requests: ottoProvider.requests },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await other.cleanup();
      await workspace.cleanup();
    }
  });
}
test("Visualizer empty workspace demo stops before live data and never opens another guest", async ({
  page,
}) => {
  test.setTimeout(90000);
  const workspace = await seedWorkspace({ repoPrefix: "otto-visualizer-demo-" });
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    await visualizerMenu(page, "Open Visualizer tab");
    await expectVisualizerReady(page);
    await page.getByRole("button", { name: "Start demo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop demo", exact: true })).toBeVisible();
    await expect(page.locator('iframe[title="Visualizer"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Stop demo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start demo", exact: true })).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});
