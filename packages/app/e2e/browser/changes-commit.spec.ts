import { execFileSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
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

test("Manual commits apply the selected type and include only checked files alongside Commits", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithTwoChanges();
  await writeFile(path.join(workspace.repoPath, "src/beta.ts"), "export const beta = 1;\n");
  await openWorkspaceChanges(page, workspace);
  const form = page.getByTestId("changes-commit-section").filter({ visible: true });
  await expect(form).toBeVisible();
  await expect(page.getByTestId("commits-section-header").filter({ visible: true })).toBeVisible();
  await form.getByTestId("changes-commit-select-all").click();
  await form.getByTestId("changes-commit-message").fill("handle null cursor");
  await expect(form.getByTestId("changes-commit-button")).toBeDisabled();
  await page.getByTestId("changes-selection-src/alpha.ts").filter({ visible: true }).click();
  await form.getByTestId("changes-commit-type-selector").click();
  await page.getByTestId("changes-commit-type-option-fix").click();
  await expect(form.getByTestId("changes-commit-message")).toHaveValue("handle null cursor");
  await form.getByTestId("changes-commit-button").click();
  await expect
    .poll(() => git(workspace, ["log", "-1", "--format=%s"]))
    .toBe("fix: handle null cursor");
  expect(git(workspace, ["show", "--format=", "--name-only", "HEAD"])).toBe("src/alpha.ts");
  expect(git(workspace, ["status", "--porcelain"])).toBe("?? src/beta.ts");
  await expect(form.getByTestId("changes-commit-message")).toHaveValue("");
  await expect(form.getByTestId("changes-commit-type-selector")).toContainText("fix");
  await page.getByTestId("commits-section-header").filter({ visible: true }).click();
  await expect(
    page.getByText("fix: handle null cursor", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
});

test("Manual commit hook failure preserves the draft for retry", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoChanges();
  const hookPath = path.join(workspace.repoPath, ".git/hooks/pre-commit");
  await writeFile(hookPath, "#!/bin/sh\necho 'fixture hook rejects commit' >&2\nexit 1\n", {
    mode: 0o755,
  });
  await openWorkspaceChanges(page, workspace);
  const form = page.getByTestId("changes-commit-section").filter({ visible: true });
  await form.getByTestId("changes-commit-type-selector").click();
  await page.getByTestId("changes-commit-type-option-feat").click();
  await form.getByTestId("changes-commit-message").fill("fix(api): preserve explicit scope");
  await form.getByTestId("changes-commit-button").click();
  await expect(form.getByTestId("changes-commit-error")).toBeVisible();
  await expect(form.getByTestId("changes-commit-message")).toHaveValue(
    "fix(api): preserve explicit scope",
  );
  await expect(form.getByTestId("changes-commit-button")).toBeEnabled();
  await rm(hookPath);
  await form.getByTestId("changes-commit-button").click();
  await expect
    .poll(() => git(workspace, ["log", "-1", "--format=%s"]))
    .toBe("fix(api): preserve explicit scope");
  await expect(form).toBeHidden();
});

function git(workspace: CommitWorkspace, args: string[]): string {
  return execFileSync("git", args, { cwd: workspace.repoPath, encoding: "utf8" }).trim();
}

async function createWorkspaceWithTwoChanges(): Promise<CommitWorkspace> {
  const repo = await createTempGitRepo("changes-commit-", {
    files: [{ path: "src/alpha.ts", content: ALPHA_BEFORE }],
  });
  execFileSync("git", ["checkout", "-b", "manual-commit"], { cwd: repo.path, stdio: "ignore" });
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
