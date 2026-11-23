import path from "node:path";
import { expect } from "@playwright/test";

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
// OTTO(tab-drag): exercise the normal dnd-kit gesture over real Electron guests.
async function dragTabOverGuest(page, tab, guest, position) {
  const source = await tab.boundingBox();
  const target = await guest.boundingBox();
  if (!source || !target) throw new Error("The tab and guest must have visible bounds");
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const drop = {
    x: position === "right" ? target.x + target.width - 24 : target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 3 });
  const shield = page.getByTestId("workspace-tab-drag-layer");
  const preview = page.locator("#overlay-root").getByTestId("workspace-tab-drop-preview");
  await expect(shield).toBeVisible();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await expect(preview).toBeVisible();
  expect(
    await shield.evaluate((layer, { x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit === layer || hit?.parentElement === layer.parentElement;
    }, drop),
  ).toBe(true);
  if (position === "cancel") await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(shield).toHaveCount(0);
  await expect(preview).toHaveCount(0);
}

async function expectTabDragAcrossGuests(page, browserId, visualizerTab, visualizerGuest) {
  const browserTab = page
    .getByTestId(`workspace-tab-browser_${browserId}`)
    .filter({ visible: true });
  const browserGuest = page.locator(`webview[data-paseo-browser-id="${browserId}"]`);
  const browserContentsId = await browserGuest.evaluate((guest) => guest.getWebContentsId());
  const panes = page.getByTestId(/^workspace-pane-/).filter({ visible: true });
  const visualizerPane = panes.filter({ has: visualizerTab });
  await dragTabOverGuest(page, browserTab, visualizerGuest, "right");
  await expect(visualizerPane.getByTestId(`workspace-tab-browser_${browserId}`)).toHaveCount(0);

  const browserPane = panes.filter({ has: browserTab });
  await expect(browserPane).toBeVisible();
  await expect(browserGuest.locator("..")).toHaveAttribute("aria-hidden", "false");
  await expect(browserGuest).toBeVisible();
  await dragTabOverGuest(page, visualizerTab, browserGuest, "cancel");
  await expect(browserPane.filter({ has: visualizerTab })).toHaveCount(0);
  await dragTabOverGuest(page, visualizerTab, browserGuest, "center");
  await expect(browserPane.filter({ has: visualizerTab })).toBeVisible();
  expect(await browserGuest.evaluate((guest) => guest.getWebContentsId())).toBe(browserContentsId);
}

export async function runVisualizerRegression({ page, setHidden, artifactDir, browserId }) {
  // This is an external observer of the actual production webview guest. It
  // shares the existing CI-owned daemon/Metro/Electron runner and browser pane.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Visualizer", exact: true }).click();
  await page.getByRole("button", { name: "Picture in picture", exact: true }).click();
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
  const windowVisible = () =>
    page.evaluate(() => window.paseoDesktop.visualizerWindow.getSnapshot());
  await setHidden(true);
  await expect.poll(windowVisible).toBe(false);
  await expect(guest).toHaveCount(0);
  await setHidden(false);
  await expect.poll(windowVisible).toBe(true);
  await expect(guest).toHaveCount(1);
  await expect.poll(async () => (await guestIdentity(page)).ready).toBe(true);
  const restored = await guestIdentity(page);
  expect(restored.id).not.toBe(first.id);
  expect(restored.channel).not.toBe(first.channel);
  await expect(guest).toHaveCSS("pointer-events", "none");
  // Hover the graph itself. The host, not the separate webview, owns PIP input.
  await pip.hover();
  await expect(pip.getByTestId("visualizer-toolbar")).toHaveCSS("opacity", "1");
  await pip.getByRole("button", { name: "Open Visualizer tab", exact: true }).click();
  await expect(pip).toHaveCount(0);
  await expect(guest).toHaveCount(1);
  await expect.poll(async () => (await guestIdentity(page)).ready).toBe(true);
  await expect(guest).toHaveCSS("pointer-events", "auto");
  // Closing the actual tab retires its guest; descriptor owners remain Paseo's.
  const tab = page
    .locator('[data-testid^="workspace-tab-plugin_workspace_15_otto-visualizer"]')
    .filter({ visible: true })
    .first();
  await expectTabDragAcrossGuests(page, browserId, tab, guest);
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
    workspaceTabDragAcrossGuests: "passed",
    retiredWebContents: first.id,
  };
}
