import { test, type Page } from "@playwright/test";
import { EVIDENCE_SEPARATOR, MONEY_SHOT_PREFIX, STEP_SHOT_PREFIX } from "./evidence-names";

/**
 * QA evidence capture. Playwright's built-in `screenshot: "only-on-failure"`
 * proves nothing about a *passing* test — a human reviewing the suite has no way
 * to see what "green" actually looked like. These helpers attach intentional
 * screenshots so every test ships its own visual proof.
 *
 * Two kinds:
 *  - `qaShot`     — an intermediate step, kept with the test's own evidence.
 *  - `moneyShot`  — THE frame that confirms the behavior under test. Exactly one
 *                   per test is the norm; it is copied into the run-wide digest
 *                   (`e2e-report/money-shots/`) so the whole suite can be
 *                   validated by eye in one place.
 *
 * A test that never calls `moneyShot` still gets one: the auto fixture in
 * `fixtures.ts` captures the final frame of every passing test as a fallback.
 * Prefer an explicit call — the fallback frame is whatever the page happened to
 * show at teardown, which is often after the interesting state is gone.
 *
 * The reporter parses these attachment names, so the separator is a contract:
 * `<prefix>::<label>`. See `e2e/reporters/qa-reporter.ts`.
 */

export { EVIDENCE_SEPARATOR, MONEY_SHOT_PREFIX, STEP_SHOT_PREFIX };

async function attachScreenshot(page: Page, prefix: string, label: string): Promise<void> {
  const info = test.info();
  let body: Buffer;
  try {
    // Viewport, not fullPage: the frame the user would actually be looking at,
    // and fullPage explodes on virtualized lists (chat timelines, file trees).
    body = await page.screenshot();
  } catch {
    // The page can be closed by the test itself or torn down mid-navigation.
    // Evidence capture must never be the reason a green test turns red.
    return;
  }
  await info.attach(`${prefix}${EVIDENCE_SEPARATOR}${label}`, {
    body,
    contentType: "image/png",
  });
}

/** Records an intermediate frame — context for how the test got where it did. */
export async function qaShot(page: Page, label: string): Promise<void> {
  await attachScreenshot(page, STEP_SHOT_PREFIX, label);
}

/**
 * Records the frame that proves the test's claim. `claim` is shown verbatim
 * under the image in the digest, so write it as the assertion in plain English
 * ("the denied write never landed on disk"), not as a step name ("after deny").
 */
export async function moneyShot(page: Page, claim: string): Promise<void> {
  await attachScreenshot(page, MONEY_SHOT_PREFIX, claim);
}
