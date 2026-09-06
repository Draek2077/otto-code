import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  openChangesTreePanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

interface CommitWorkspace {
  id: string;
  repoPath: string;
}

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

test("Changes options open a single Git Commit log tab", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoChanges();
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("changes-options-menu").filter({ visible: true }).click();
  await page.getByTestId("changes-open-git-log").click();
  const gitCommitTab = page.getByTestId("explorer-sidebar-tab-gitlog_commit");
  await expect(gitCommitTab).toBeVisible();
  await expect(page.getByText("Nothing logged yet")).toBeVisible();

  // The log opens in Explorer. Return to Changes to invoke the command again
  // and verify that it focuses the existing log tab.
  await openChangesTreePanel(page);
  await page.getByTestId("changes-options-menu").filter({ visible: true }).click();
  await page.getByTestId("changes-open-git-log").click();
  await expect(gitCommitTab).toHaveCount(1);
});

async function createWorkspaceWithTwoChanges(): Promise<CommitWorkspace> {
  const repo = await createTempGitRepo("changes-commit-", {
    files: [{ path: "src/alpha.ts", content: ALPHA_BEFORE }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/alpha.ts"), ALPHA_AFTER);
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

async function openWorkspaceChanges(page: Page, workspace: CommitWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesTreePanel(page);
  await expect(page.getByText("alpha.ts")).toBeVisible({ timeout: 30_000 });
}
