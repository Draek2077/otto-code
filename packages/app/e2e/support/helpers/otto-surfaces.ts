import { expect, type Page } from "@playwright/test";

/** Cold Metro loads compile thousands of modules after real navigation. Bound that
 * entry separately; ordinary controls retain the normal ten-second assertion limit. */
export async function waitForOttoSurface(page: Page, testId: string) {
  const surface = page.getByTestId(testId).filter({ visible: true });
  await expect(surface).toBeVisible({ timeout: 30_000 });
  return surface;
}
