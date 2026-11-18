import { test as base } from "../fixtures";

export { expect } from "../fixtures";

// These Paseo regression journeys inspect individual tool rows and position while streaming.
// The grouped presentation has its own wide and compact reader-position journeys.
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.addInitScript(() => {
      const key = "@otto:app-settings";
      const previous = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...previous, groupConsecutiveActions: false }));
    });
    await provide(page);
  },
});
