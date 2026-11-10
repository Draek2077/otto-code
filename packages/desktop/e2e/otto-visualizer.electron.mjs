import path from "node:path";
import { expect } from "@playwright/test";

async function openVisualizer(page, option) {
  await page
    .getByRole("button", { name: "Visualizer", exact: true })
    .and(page.locator("[aria-expanded]"))
    .filter({ visible: true })
    .click();
  await page.getByRole("menuitem", { name: option, exact: true }).click();
}
async function guestIdentity(page) {
  return page.locator('webview[partition="otto-visualizer"]').evaluate(async (guest) => {
    const status = await guest.executeJavaScript(`({
      ready: window.__OTTO_VISUALIZER_READY__ === true,
      canvas: document.querySelectorAll('canvas').length,
      require: typeof require, process: typeof process,
      channel: window.__OTTO_VISUALIZER_CHANNEL__,
      policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
    })`);
    return { id: guest.getWebContentsId(), ...status };
  });
}
export async function runVisualizerRegression({ page, setHidden, artifactDir }) {
  // This is an external observer of the actual production webview guest. It
  // shares the existing CI-owned daemon/Metro/Electron runner and browser pane.
  await page.keyboard.press("Escape");
  await openVisualizer(page, "Picture in picture");
  const pip = page.getByTestId("visualizer-window-pip");
  const guest = page.locator('webview[partition="otto-visualizer"]');
  // The first open lazily compiles the production renderer/Surface in Metro.
  // Use the browser lane's bounded readiness budget, retaining every assertion.
  await expect(pip).toBeVisible({ timeout: 30000 });
  await expect(guest).toHaveCount(1);
  await expect.poll(async () => (await guestIdentity(page)).ready, { timeout: 30000 }).toBe(true);
  const first = await guestIdentity(page);
  expect(first.canvas).toBeGreaterThan(0);
  expect(first.require).toBe("undefined");
  expect(first.process).toBe("undefined");
  expect(first.policy).toContain("connect-src 'none'");
  const bounds = await guest.boundingBox();
  expect(bounds.width).toBeGreaterThan(100);
  expect(bounds.height).toBeGreaterThan(100);
  const blocked = await guest.evaluate((node) =>
    node.executeJavaScript(
      'fetch("https://visualizer-network-must-not-open.invalid").then(()=>false,()=>true)',
    ),
  );
  expect(blocked).toBe(true);
  await page.screenshot({ path: path.join(artifactDir, "visualizer-over-browser.png") });
  await setHidden(true);
  await expect(guest).toHaveCount(0);
  await setHidden(false);
  await expect(guest).toHaveCount(1);
  await expect.poll(async () => (await guestIdentity(page)).ready).toBe(true);
  const restored = await guestIdentity(page);
  expect(restored.id).not.toBe(first.id);
  expect(restored.channel).not.toBe(first.channel);
  await pip.hover();
  await pip.getByRole("button", { name: "Open Visualizer tab", exact: true }).click();
  await expect(pip).toHaveCount(0);
  await expect(guest).toHaveCount(1);
  await expect.poll(async () => (await guestIdentity(page)).ready).toBe(true);
  // Closing the actual tab retires its guest; descriptor owners remain Paseo's.
  const tab = page
    .locator('[data-testid^="workspace-tab-plugin_workspace_15_otto-visualizer"]')
    .filter({ visible: true })
    .first();
  await tab.click({ button: "right" });
  await page
    .getByTestId("workspace-tab-context-plugin_workspace_15_otto-visualizer_10_visualizer-close")
    .click();
  await expect(guest).toHaveCount(0);
  return {
    privateGuest: "passed",
    offlinePolicy: "passed",
    windowVisibility: "passed",
    handoff: "passed",
    retiredWebContents: first.id,
  };
}
