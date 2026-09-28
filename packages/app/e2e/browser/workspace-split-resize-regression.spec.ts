/**
 * Adding panes could leave later dividers inert after an earlier resize:
 * the saved sizes outlived the group's child list. Exercise actual
 * pointer drags and rendered pane widths, including live preview and reload.
 */
import type { Locator, Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { moneyShot } from "../support/helpers/evidence";

async function splitRight(page: Page, pane: Locator) {
  await pane.getByTestId("workspace-new-tab-menu-trigger").click();
  await page.getByTestId("workspace-new-tab-menu-split-right").click();
}

async function paneWidths(panes: Locator) {
  return panes.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
}

async function resizeDivider(page: Page, panes: Locator, index: number, delta: number) {
  const handles = page.getByTestId("workspace-split-resize-handle").filter({ visible: true });
  const box = await handles.nth(index).boundingBox();
  expect(box).not.toBeNull();
  const before = await paneWidths(panes);
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + delta, y, { steps: 8 });
    // Check before release: committing new sizes alone cannot pass this test.
    await expect
      .poll(async () => (await paneWidths(panes))[index]! - before[index]!)
      .toBeGreaterThan(25);
    const during = await paneWidths(panes);
    expect(during[index + 1]!).toBeLessThan(before[index + 1]! - 25);
    for (let i = 0; i < before.length; i++) {
      if (i !== index && i !== index + 1) expect(during[i]!).toBeCloseTo(before[i]!, 0);
    }
  } finally {
    await page.mouse.up();
  }
  const after = await paneWidths(panes);
  expect(after[index]!).toBeGreaterThan(before[index]! + 25);
  return after;
}

test("all dividers resize after adding panes to an already resized row", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 2200, height: 1000 });
  const workspace = await seedWorkspace({ repoPrefix: "split-resize-regression-" });
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    const panes = page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true });
    await expect(panes).toHaveCount(1);
    await splitRight(page, panes.first());
    await expect(panes).toHaveCount(2);
    await resizeDivider(page, panes, 0, 60);

    await splitRight(page, panes.last());
    await expect(panes).toHaveCount(3);
    await resizeDivider(page, panes, 1, 60);
    await resizeDivider(page, panes, 0, 60);

    await splitRight(page, panes.last());
    await expect(panes).toHaveCount(4);
    await resizeDivider(page, panes, 2, 40);
    const saved = await resizeDivider(page, panes, 1, 40);
    await page.reload();
    await expect(panes).toHaveCount(4);
    await expect.poll(() => paneWidths(panes)).toEqual(saved);
    await resizeDivider(page, panes, 2, 40);
    await moneyShot(page, "All four panes remain resizable after splitting, saving, and reloading");
  } finally {
    await workspace.cleanup();
  }
});
