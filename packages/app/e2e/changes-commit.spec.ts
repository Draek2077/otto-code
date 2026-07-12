import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../src/utils/host-routes";
import { test, expect } from "./fixtures";
import { getServerId } from "./helpers/server-id";
import { connectSeedClient } from "./helpers/seed-client";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";

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
const NOTES_CONTENT = "untracked scratch notes\n";

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("changes tab commits only the selected files with the typed message", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoChanges();
  await openWorkspaceChanges(page, workspace);

  await expect(page.getByTestId("changes-commit-section")).toBeVisible();
  await expect(page.getByTestId("changes-commit-message")).toBeVisible();
  await expect(fileRowContaining(page, "alpha.ts")).toBeVisible();
  await expect(fileRowContaining(page, "notes.txt")).toBeVisible();

  // Empty message: the commit button is present but disabled.
  await expect(page.getByTestId("changes-commit-button")).toBeDisabled();

  // Deselect the untracked notes file; alpha.ts stays checked by default.
  await fileRowContaining(page, "notes.txt").locator('[data-testid$="-checkbox"]').click();
  await expect(page.getByText("1 of 2 files selected")).toBeVisible();

  await page.getByTestId("changes-commit-message").fill("commit alpha only");
  await expect(page.getByTestId("changes-commit-button")).toBeEnabled();
  await page.getByTestId("changes-commit-button").click();

  // The committed file leaves the uncommitted list; the deselected one stays.
  await expect(fileRowContaining(page, "alpha.ts")).toHaveCount(0, { timeout: 30_000 });
  await expect(fileRowContaining(page, "notes.txt")).toBeVisible();

  // The repository has exactly the selected path in the new commit.
  const subject = gitOutput(workspace.repoPath, ["log", "-1", "--pretty=%s"]);
  expect(subject).toBe("commit alpha only");
  const committedFiles = gitOutput(workspace.repoPath, ["show", "--name-only", "--pretty=format:"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(committedFiles).toEqual(["src/alpha.ts"]);
  const porcelain = gitOutput(workspace.repoPath, ["status", "--porcelain"]);
  expect(porcelain).toBe("?? notes.txt");
});

test("select-all checkbox toggles every file and reflects partial selection", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoChanges();
  await openWorkspaceChanges(page, workspace);

  // Everything is selected by default, so the master checkbox starts checked.
  const selectAll = page.getByTestId("changes-commit-select-all");
  await expect(selectAll).toBeVisible();
  await expect(selectAll).toHaveAttribute("aria-checked", "true");

  // Deselecting one file puts the master checkbox into the indeterminate state.
  await fileRowContaining(page, "notes.txt").locator('[data-testid$="-checkbox"]').click();
  await expect(page.getByText("1 of 2 files selected")).toBeVisible();
  await expect(selectAll).toHaveAttribute("aria-checked", "mixed");

  // Clicking while indeterminate selects everything.
  await selectAll.click();
  await expect(page.getByText("2 of 2 files selected")).toBeVisible();
  await expect(selectAll).toHaveAttribute("aria-checked", "true");

  // Clicking while fully selected clears the selection and disables commit.
  await selectAll.click();
  await expect(page.getByText("0 of 2 files selected")).toBeVisible();
  await expect(selectAll).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("changes-commit-message").fill("nothing selected");
  await expect(page.getByTestId("changes-commit-button")).toBeDisabled();

  // Clicking once more restores the full selection.
  await selectAll.click();
  await expect(page.getByText("2 of 2 files selected")).toBeVisible();
  await expect(page.getByTestId("changes-commit-button")).toBeEnabled();
});

test("log button opens a single Git Commit log tab that fills live", async ({ page }) => {
  const workspace = await createWorkspaceWithTwoChanges();
  await openWorkspaceChanges(page, workspace);

  // Opening before any commit shows the empty log state.
  await page.getByTestId("changes-commit-log-button").click();
  const gitCommitTab = page.getByRole("button", { name: "Git Commit" });
  await expect(gitCommitTab).toBeVisible();
  await expect(page.getByText("Nothing logged yet")).toBeVisible();

  // Re-clicking focuses the existing tab instead of opening a second one.
  await page.getByTestId("changes-commit-log-button").click();
  await expect(gitCommitTab).toHaveCount(1);

  // Keep one file uncommitted so the commit section survives the commit
  // (an emptied changes list unmounts it, log button included).
  await fileRowContaining(page, "notes.txt").locator('[data-testid$="-checkbox"]').click();

  // Committing streams the operation into the already-open pane.
  await page.getByTestId("changes-commit-message").fill("logged commit");
  await page.getByTestId("changes-commit-button").click();
  await expect(page.getByTestId("git-log-pane")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("git-log-pane")).toContainText("── git commit");
  await expect(page.getByTestId("git-log-pane")).toContainText("created commit");
  await expect(gitCommitTab).toHaveCount(1);
});

function gitOutput(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args])
    .toString()
    .trim();
}

function fileRowContaining(page: Page, fileName: string) {
  return page.getByTestId(/^diff-file-\d+$/).filter({ hasText: fileName });
}

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
  await writeFile(path.join(repo.path, "notes.txt"), NOTES_CONTENT);
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
  await page.getByRole("button", { name: "Open explorer" }).click();
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("explorer-tab-changes").click();
  await expect(page.getByText("alpha.ts")).toBeVisible({ timeout: 30_000 });
}
