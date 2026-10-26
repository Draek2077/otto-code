import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

async function drag(page: Page, handle: Locator, delta: { x: number; y: number }) {
  const bounds = await handle.getByRole("separator").boundingBox();
  if (!bounds) throw Error("Visible splitter geometry is unavailable");
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta.x, y + delta.y, { steps: 8 });
  await page.mouse.up();
}
const Preference = z.object({ version: z.literal(1), width: z.number(), summaryRatio: z.number() });
async function saved(page: Page) {
  return Preference.parse(
    await page.evaluate(() => JSON.parse(localStorage.getItem("otto-context-layout") ?? "null")),
  );
}
test("Context reading width and pane height persist; compact geometry does not reset them", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspace = await seedWorkspace({
    repoPrefix: "otto-context-layout-",
    title: "Reading layout fixture",
    git: false,
  });
  await writeFile(path.join(workspace.repoPath, "AGENTS.md"), "READING_LAYOUT_PROOF\n");
  try {
    await gotoAppShell(page);
    await openWorkspaceContextMenu(page, workspace.workspaceId);
    await page.getByText("Open Context Management", { exact: true }).click();
    const surface = page.getByTestId("otto-context-management").filter({ visible: true });
    const sidebar = surface.getByTestId("context-reading-sidebar");
    const summary = surface.getByTestId("context-reading-summary");
    await expect(sidebar).toBeVisible();
    const initialWidth = (await sidebar.boundingBox())!.width;
    const initialHeight = (await summary.boundingBox())!.height;
    await drag(page, surface.getByTestId("context-reading-splitter"), { x: 90, y: 0 });
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBeGreaterThan(initialWidth + 40);
    await drag(page, surface.getByTestId("context-summary-splitter"), { x: 0, y: 60 });
    await expect
      .poll(async () => (await summary.boundingBox())!.height)
      .toBeGreaterThan(initialHeight + 30);
    await expect.poll(async () => (await saved(page)).summaryRatio).toBeGreaterThan(0.5);
    const preference = await saved(page);
    const width = (await sidebar.boundingBox())!.width;
    const height = (await summary.boundingBox())!.height;
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(surface.getByTestId("context-reading-splitter")).toHaveCount(0);
    await expect(surface.getByTestId("context-summary-splitter")).toHaveCount(0);
    expect(await saved(page)).toEqual(preference);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(width, 0);
    // Reload constructs a fresh app store and restores the persisted preference.
    await page.reload();
    await expect(sidebar).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBeCloseTo(preference.width, 0);
    expect(await saved(page)).toEqual(preference);
    expect(height).toBeGreaterThan(initialHeight);
    await page.screenshot({
      path: testInfo.outputPath("context-reading-preferences.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});
