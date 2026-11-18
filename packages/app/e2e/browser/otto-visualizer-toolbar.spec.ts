import type { Locator } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

async function expectCenteredControls(toolbar: Locator) {
  await expect(toolbar).toBeVisible();
  const controls = await toolbar.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const top = bounds.top + parseFloat(style.borderTopWidth);
    const bottom = bounds.bottom - parseFloat(style.borderBottomWidth);
    return Array.from(element.querySelectorAll('[role="button"]')).map((button) => {
      const rect = button.getBoundingClientRect();
      const icon = button.querySelector("svg")?.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label"),
        imbalance: rect.top - top - (bottom - rect.bottom),
        iconOffset: icon ? icon.top + icon.height / 2 - (rect.top + rect.height / 2) : 0,
      };
    });
  });
  expect(controls.length).toBeGreaterThanOrEqual(5);
  for (const control of controls) {
    expect(
      Math.abs(control.imbalance),
      `${control.label}: equal space above and below`,
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(control.iconOffset), `${control.label}: centered icon`).toBeLessThanOrEqual(
      0.5,
    );
  }
}

for (const compact of [false, true]) {
  test(`Visualizer toolbar centers controls (${compact ? "compact" : "wide"})`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      compact ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    );
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "visualizer-toolbar-",
      title: "Toolbar chat",
      initialPrompt: "Hello",
    });
    try {
      await openAgentRoute(page, agent);
      if (compact) {
        await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
        await page.getByRole("menuitem", { name: "Open Visualizer", exact: true }).click();
      } else {
        await page.getByTestId("workspace-visualizer-button").filter({ visible: true }).click();
      }
      const toolbar = page.getByTestId("visualizer-toolbar").filter({ visible: true });
      await expect(toolbar).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: info.outputPath("visualizer-toolbar.png") });
      await expectCenteredControls(toolbar);
      await toolbar.getByRole("button", { name: "Visualizer chat", exact: false }).click();
      await page.getByText("All active chats", { exact: true }).filter({ visible: true }).click();
      await expectCenteredControls(toolbar);
      await toolbar.getByRole("button", { name: "Picture in picture", exact: true }).click();
      const pip = page.getByTestId("visualizer-window-pip");
      await expect(pip).toBeVisible();
      await pip.hover();
      await expectCenteredControls(pip.getByTestId("visualizer-toolbar"));
      await page.screenshot({ path: info.outputPath("visualizer-pip-toolbar.png") });
    } finally {
      await agent.client.archiveAgent(agent.agentId).catch(() => undefined);
      await agent.cleanup();
    }
  });
}
