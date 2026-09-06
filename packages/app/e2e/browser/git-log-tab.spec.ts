import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import {
  changedTreeFile,
  commitFixtureFiles,
  gitOutput,
  openWorkspaceChanges,
} from "../support/helpers/git-changes";
import { seedWorkspace } from "../support/helpers/seed-client";

// The Git Log tab is the daemon's git *operation* log (checkout.git.get_operation_log
// backfill + checkout.git.log_appended live stream), not a repository-history
// browser: it records each git operation Otto runs - heading, the exact git
// commands, their output, and a "created commit <sha>" outcome line. This spec
// proves commits made through the daemon land in the visible tab with their
// messages and hashes.

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];

const ALPHA_BEFORE = "export const alpha = 1;\n";
const ALPHA_AFTER = "export const alpha = 2;\n";
const BETA_BEFORE = "export const beta = 1;\n";
const BETA_AFTER = "export const beta = 2;\n";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("git log tab records daemon commits with messages and hashes", async ({ page }) => {
  const workspace = await seedWorkspace({
    repoPrefix: "git-log-tab-",
    repo: {
      files: [
        { path: "src/alpha.ts", content: ALPHA_BEFORE },
        { path: "src/beta.ts", content: BETA_BEFORE },
      ],
    },
  });
  cleanupTasks.push({ run: () => workspace.cleanup() });

  // Dirty both tracked files out of band and make the writes authoritative
  // before asserting on them in the UI (no racing the FS watcher debounce).
  await writeFile(path.join(workspace.repoPath, "src/alpha.ts"), ALPHA_AFTER);
  await writeFile(path.join(workspace.repoPath, "src/beta.ts"), BETA_AFTER);
  await workspace.client.checkoutRefresh(workspace.repoPath);

  await openWorkspaceChanges(page, {
    workspaceId: workspace.workspaceId,
    expectFileName: "alpha.ts",
  });

  // Commit only alpha through the real daemon, leaving beta dirty. This
  // exercises log backfill without invoking an AI message-generation session.
  const committedSha = await commitFixtureFiles(workspace, ["src/alpha.ts"], "log commit alpha");
  await expect(changedTreeFile(page, "alpha.ts")).toHaveCount(0, { timeout: 30_000 });
  await expect(changedTreeFile(page, "beta.ts")).toBeVisible();

  const firstSha = gitOutput(workspace.repoPath, ["rev-parse", "HEAD"]);
  expect(firstSha).toMatch(/^[0-9a-f]{40}$/);
  expect(firstSha).toBe(committedSha);

  // Open the Git Commit log tab and assert the commit was recorded with its
  // exact command (message included) and the "created commit <sha>" outcome.
  await page.getByTestId("changes-options-menu").filter({ visible: true }).click();
  await page.getByTestId("changes-open-git-log").click();
  const gitCommitTab = page.getByTestId("explorer-sidebar-tab-gitlog_commit");
  await expect(gitCommitTab).toBeVisible();

  const logPane = page.getByTestId("git-log-pane");
  await expect(logPane).toBeVisible({ timeout: 30_000 });
  await expect(logPane).toContainText("── git commit");
  await expect(logPane).toContainText("log commit alpha");
  await expect(logPane).toContainText(`created commit ${firstSha}`);

  // The repository agrees with what the log claims.
  expect(gitOutput(workspace.repoPath, ["log", "-1", "--pretty=%s"])).toBe("log commit alpha");
});
