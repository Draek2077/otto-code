import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures";
import { fileRowContaining, gitOutput, openWorkspaceChanges } from "./helpers/git-changes";
import { seedWorkspace } from "./helpers/seed-client";

// Regression coverage for the vanished git-actions split button: checkout
// status is a push-only cache, so after a commit it could freeze at
// isDirty:false and the CTA never came back when the tree went dirty again.
// The fix reconciles the status cache from the live uncommitted-diff
// subscription (push-router → reconcileCheckoutStatusWithUncommittedDiff).
// This spec drives the full commit → clean → re-dirty cycle in a remote-less
// repo and asserts the CTA reflects each state instead of staying gone.

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];

const ALPHA_ORIGINAL = "export const alpha = 1;\n";
const ALPHA_FIRST_EDIT = "export const alpha = 2;\n";
const ALPHA_SECOND_EDIT = "export const alpha = 3;\n";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("commit CTA reconciles across commit and re-dirty instead of vanishing", async ({ page }) => {
  // No remote: after committing, pull/push/PR can never be the next action.
  const workspace = await seedWorkspace({
    repoPrefix: "git-cta-reconcile-",
    repo: { files: [{ path: "src/alpha.ts", content: ALPHA_ORIGINAL }] },
  });
  cleanupTasks.push({ run: () => workspace.cleanup() });

  const alphaPath = path.join(workspace.repoPath, "src/alpha.ts");
  await writeFile(alphaPath, ALPHA_FIRST_EDIT);
  await workspace.client.checkoutRefresh(workspace.repoPath);

  await openWorkspaceChanges(page, {
    workspaceId: workspace.workspaceId,
    expectFileName: "alpha.ts",
  });

  // Dirty tree: the split button's primary action is Commit.
  const cta = page.getByTestId("changes-primary-cta");
  await expect(cta).toBeVisible({ timeout: 30_000 });
  await expect(cta).toHaveAttribute("aria-label", "Commit");

  // Commit through the manual commit box (typed message, no AI handoff).
  await page.getByTestId("changes-commit-message").fill("reconcile commit");
  await page.getByTestId("changes-commit-button").click();
  await expect(fileRowContaining(page, "alpha.ts")).toHaveCount(0, { timeout: 30_000 });
  expect(gitOutput(workspace.repoPath, ["log", "-1", "--pretty=%s"])).toBe("reconcile commit");

  // Clean tree on the base branch of a remote-less checkout has no primary
  // action by policy — the CTA leaving here is expected, not the regression.
  await expect(page.getByTestId("changes-primary-cta")).toHaveCount(0, { timeout: 30_000 });

  // Re-dirty the tree out of band. The uncommitted-diff subscription must heal
  // the push-only checkout-status cache so the Commit CTA returns — the
  // regression was the split button staying vanished at exactly this point.
  //
  // NOTE (Windows local): the daemon's git file-watcher fails with EPERM on
  // Windows, so an out-of-band change is never observed and this assertion
  // cannot pass on a Windows workstation. On Linux/macOS (and CI) the watcher
  // detects the write and pushes the diff that reconciles the status. This
  // spec therefore validates the fix on CI; treat a Windows-local failure here
  // as the known EPERM-watcher environment gap, not a regression.
  await writeFile(alphaPath, ALPHA_SECOND_EDIT);
  await workspace.client.checkoutRefresh(workspace.repoPath);

  await expect(fileRowContaining(page, "alpha.ts")).toBeVisible({ timeout: 30_000 });
  const ctaAfterRedirty = page.getByTestId("changes-primary-cta");
  await expect(ctaAfterRedirty).toBeVisible({ timeout: 30_000 });
  await expect(ctaAfterRedirty).toHaveAttribute("aria-label", "Commit");
});
