import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { getServerId } from "./server-id";
import { VisualizerCommand } from "../../../../otto-visualizer/src/contracts";

export async function observeVisualizer(page: Page) {
  // External observation of real presentation frames, never a replacement
  // transport, app store, provider event or renderer implementation.
  await page.addInitScript(() => {
    const frames: unknown[] = [];
    Object.defineProperty(window, "__ottoVisualizerObserved", { value: frames });
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (typeof event.data !== "string" || event.data.length > 1_000_000) return;
      try {
        const value: unknown = JSON.parse(event.data);
        if (value && typeof value === "object" && Reflect.get(value, "version") === 1) {
          frames.push(value);
          if (frames.length > 400) frames.shift();
        }
      } catch {
        /* Non-Visualizer page messages are irrelevant. */
      }
    });
  });
}
export const visualizerContent = (page: Page) =>
  page
    .frameLocator('iframe[title="Visualizer"]')
    .frameLocator('iframe[title="Visualizer content"]');

export async function observedCommands(page: Page) {
  let frames: unknown;
  try {
    frames = await page
      .frameLocator('iframe[title="Visualizer"]')
      .locator("body")
      .evaluate(() => Reflect.get(window, "__ottoVisualizerObserved"));
  } catch (error) {
    // A new bootstrap gets a new nonce/frame. The caller's bounded poll still
    // requires the actual canonical replay in the replacement guest.
    if (error instanceof Error && error.message.includes("Frame was detached")) return [];
    throw error;
  }
  return z
    .array(z.object({ version: z.literal(1), channel: z.string(), message: z.unknown() }))
    .parse(frames)
    .flatMap((frame) => {
      const parsed = VisualizerCommand.safeParse(frame.message);
      return parsed.success ? [parsed.data] : [];
    });
}
export async function visualizerMenu(page: Page, label: string, compact = false) {
  if (compact)
    await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
  else
    await page
      .getByRole("button", { name: "Visualizer", exact: true })
      .and(page.locator("[aria-expanded]"))
      .filter({ visible: true })
      .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
export async function selectWorkspace(page: Page, workspaceId: string, compact: boolean) {
  if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
  await page
    .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`)
    .filter({ visible: true })
    .first()
    .click();
}
export async function expectVisualizerReady(page: Page) {
  await expect(page.locator('iframe[title="Visualizer"]')).toHaveCount(1);
  await expect(visualizerContent(page).locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Reconnect Visualizer", exact: true })).toHaveCount(
    0,
  );
}
export async function dragAndResizePip(page: Page) {
  const pip = page.getByTestId("visualizer-window-pip");
  const move = page.getByRole("separator", { name: "Move Visualizer", exact: true });
  const bounds = await move.boundingBox();
  if (!bounds) throw new Error("PIP drag handle must be measured");
  await page.mouse.move(bounds.x + 20, bounds.y + 4);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 100, bounds.y + 80, { steps: 8 });
  await page.mouse.up();
  const before = await pip.boundingBox();
  const viewport = page.viewportSize();
  if (!before || !viewport) throw new Error("PIP must belong to the app window");
  const right = viewport.width - before.x - before.width;
  const top = before.y;
  await page.setViewportSize({ width: viewport.width + 160, height: viewport.height + 100 });
  await expect
    .poll(async () => {
      const box = await pip.boundingBox();
      return box ? Math.round(viewport.width + 160 - box.x - box.width) : -1;
    })
    .toBe(Math.round(right));
  await expect
    .poll(async () => Math.round((await pip.boundingBox())?.y ?? -1))
    .toBe(Math.round(top));
}
