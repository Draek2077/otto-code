import { expect, type Page } from "@playwright/test";
import type { PinnedTabTarget } from "../../src/workspace-pins/target";
import { pinnedTargetKey } from "../../src/workspace-pins/target";

// The new-tab dropdown menu items carry no stable web ARIA role for the inline
// pin toggle (it lives inside a reveal-on-hover slot), so the pins flow is
// addressed through the test ids the feature assigns per target key — the same
// escape-hatch convention the sidebar kebab and tab context menus use.

function pinToggle(page: Page, target: PinnedTabTarget) {
  return page.getByTestId(`workspace-pin-toggle-${pinnedTargetKey(target)}`);
}

function menuItemFor(page: Page, target: PinnedTabTarget) {
  return page.getByTestId(`workspace-new-tab-menu-${target.kind}`);
}

export function tabRowPin(page: Page, target: PinnedTabTarget) {
  return page.getByTestId(`workspace-pinned-target-${pinnedTargetKey(target)}`);
}

// The tab-bar tools strip is hover-revealed: until the pointer is over the
// tab row the strip has pointer-events: none, so Playwright's pre-click
// hit-target check fails before it ever moves the mouse (the move is what
// would reveal the strip). Raw mouse.move first — no actionability check —
// then the strip is revealed and a normal click passes.
export async function clickTabRowPin(page: Page, target: PinnedTabTarget): Promise<void> {
  const pin = tabRowPin(page, target);
  await expect(pin).toBeVisible({ timeout: 10_000 });
  const box = await pin.boundingBox();
  if (!box) {
    throw new Error("Pinned target button has no bounding box");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pin.click({ timeout: 10_000 });
}

export async function openNewTabMenu(page: Page): Promise<void> {
  const trigger = page
    .getByTestId("workspace-new-tab-menu-trigger")
    .filter({ visible: true })
    .first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
}

// The pin toggle is hidden behind reveal-on-hover (opacity + pointerEvents) on
// desktop web, so the menu item must be hovered before the toggle is clickable.
export async function togglePinFromMenu(page: Page, target: PinnedTabTarget): Promise<void> {
  await openNewTabMenu(page);
  const item = menuItemFor(page, target);
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.hover();
  const toggle = pinToggle(page, target);
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();
  await page.keyboard.press("Escape");
}
