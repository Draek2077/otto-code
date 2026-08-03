/**
 * Bug: on the Home screen the "New project" tile did nothing, and neither did
 * the new-agent keyboard shortcut. Both called `useOpenAddProject`, which wrote
 * a request into `add-project-flow-store`, a store whose only reader was the
 * Paseo `AddProjectFlowHost` overlay, and that component was never mounted. The
 * click set state nobody rendered, so the user got no feedback at all.
 *
 * Fix: both entry points now call `useOpenProjectPicker`, the same hook the
 * sidebar and the command center already used, which routes to the New project
 * page. The dead overlay and its store were deleted so nothing can regress onto
 * them again.
 *
 * Symptom to guard: pressing either entry point leaves the Home screen up.
 */
import { expect, test, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { moneyShot } from "./helpers/evidence";

// The `agent.new` binding is Cmd+O on mac and Ctrl+O everywhere else, which is
// exactly what Playwright's ControlOrMeta resolves to per platform. Its binding
// ids still say "cmd-shift-o"; they are frozen so user overrides survive
// upgrades, so read the combo, not the id.
const NEW_PROJECT_SHORTCUT = "ControlOrMeta+O";

// The shell mounts the compact and desktop sidebars together and hides one with
// CSS, so every shared testID matches twice. Filter to the rendered one.
function visible(page: Page, testID: string) {
  return page.locator(`[data-testid="${testID}"]:visible`).first();
}

async function gotoProjectHome(page: Page): Promise<void> {
  await gotoAppShell(page);
  await visible(page, "sidebar-home").click();
  await expect(visible(page, "open-project-submit")).toBeVisible({ timeout: 30_000 });
}

async function expectNewProjectPage(page: Page): Promise<void> {
  // The seeded fixture has a single host, so the chooser resolves it without a
  // prompt and lands straight on the page.
  await expect(visible(page, "new-project-directory-input")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/new-project\?.*serverId=/u);
}

test.describe("Open project home regression", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the home New project tile opens the New project page", async ({ page }) => {
    await gotoProjectHome(page);

    await visible(page, "open-project-submit").click();

    await expectNewProjectPage(page);
    await moneyShot(page, "The home New project tile lands on the New project page");
  });

  test("the new-agent shortcut opens the New project page", async ({ page }) => {
    await gotoProjectHome(page);

    await page.keyboard.press(NEW_PROJECT_SHORTCUT);

    await expectNewProjectPage(page);
    await moneyShot(page, "The new-agent shortcut lands on the New project page");
  });
});
