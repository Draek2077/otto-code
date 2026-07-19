import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "./fixtures";
import { fileRowContaining, gitOutput, openWorkspaceChanges } from "./helpers/git-changes";
import { seedWorkspace } from "./helpers/seed-client";

// Right-clicking a changed file in the Changes list offers "Rollback file"
// (checkout.git.rollback): a destructive git discard gated behind a confirm
// dialog. Confirming restores the file on disk and removes the row; cancelling
// leaves the change untouched.

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];

const ALPHA_BEFORE = "export const alpha = 1;\n";
const ALPHA_AFTER = "export const alpha = 2;\n";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

async function seedDirtyAlphaWorkspace(repoPrefix: string) {
  const workspace = await seedWorkspace({
    repoPrefix,
    repo: { files: [{ path: "src/alpha.ts", content: ALPHA_BEFORE }] },
  });
  cleanupTasks.push({ run: () => workspace.cleanup() });

  // Dirty the tracked file out of band, then force the daemon to recompute its
  // snapshot so the write is authoritative before UI assertions.
  await writeFile(path.join(workspace.repoPath, "src/alpha.ts"), ALPHA_AFTER);
  await workspace.client.checkoutRefresh(workspace.repoPath);
  return workspace;
}

async function openRollbackConfirmDialog(page: Page) {
  // The context menu handler lives on the row's toggle pressable (web-only
  // onContextMenu), so right-click that element rather than the outer row.
  await fileRowContaining(page, "alpha.ts")
    .locator('[data-testid$="-toggle"]')
    .click({ button: "right" });
  const contextMenu = page.getByTestId("changes-context-menu");
  await expect(contextMenu).toBeVisible();
  await page.getByTestId("changes-context-menu-rollback-file").click();

  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Roll back file?");
  await expect(dialog).toContainText("alpha.ts");
  return dialog;
}

test("rollback from the row context menu discards the change after confirm", async ({ page }) => {
  const workspace = await seedDirtyAlphaWorkspace("changes-rollback-");
  await openWorkspaceChanges(page, {
    workspaceId: workspace.workspaceId,
    expectFileName: "alpha.ts",
  });

  const dialog = await openRollbackConfirmDialog(page);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(dialog).toHaveCount(0);

  // The row leaves the Changes list and the working tree is clean again.
  await expect(fileRowContaining(page, "alpha.ts")).toHaveCount(0, { timeout: 30_000 });
  const alphaPath = path.join(workspace.repoPath, "src/alpha.ts");
  // Git may restore the committed blob with CRLF under core.autocrlf on
  // Windows; normalize line endings so the content check holds on both
  // Windows (local) and Linux (CI). git's own porcelain view (autocrlf-aware)
  // is the authoritative clean-tree proof below.
  await expect
    .poll(async () => (await readFile(alphaPath, "utf8")).replace(/\r\n/g, "\n"), {
      timeout: 10_000,
    })
    .toBe(ALPHA_BEFORE);
  expect(gitOutput(workspace.repoPath, ["status", "--porcelain"])).toBe("");
});

test("cancelling the rollback confirm keeps the change", async ({ page }) => {
  const workspace = await seedDirtyAlphaWorkspace("changes-rollback-cancel-");
  await openWorkspaceChanges(page, {
    workspaceId: workspace.workspaceId,
    expectFileName: "alpha.ts",
  });

  const dialog = await openRollbackConfirmDialog(page);
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(dialog).toHaveCount(0);

  // Nothing was discarded: the row stays and the file keeps the edit.
  await expect(fileRowContaining(page, "alpha.ts")).toBeVisible();
  const alphaPath = path.join(workspace.repoPath, "src/alpha.ts");
  expect(await readFile(alphaPath, "utf8")).toBe(ALPHA_AFTER);
  // The Changes view stages selected files, so the porcelain index column
  // varies; the point is that the edit survives the cancel (still a change).
  expect(gitOutput(workspace.repoPath, ["status", "--porcelain"])).toContain("src/alpha.ts");
});
