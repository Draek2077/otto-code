import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../src/utils/host-routes";
import { moneyShot } from "./helpers/evidence";
import { test, expect } from "./fixtures";
import { getServerId } from "./helpers/server-id";
import { connectSeedClient } from "./helpers/seed-client";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";

interface CommitWorkspace {
  id: string;
  repoPath: string;
}

const cleanupTasks: Array<{ run: () => Promise<void> }> = [];

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("commit type selector is visible, opens, and prefixes the commit message", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithChange();
  await openWorkspaceChanges(page, workspace);

  // 1) The chip row renders above the message input by default.
  const selector = page.getByTestId("changes-commit-type-selector");
  await expect(selector).toBeVisible();
  await expect(selector).toContainText("Commit type");
  await expect(selector).toContainText("None");

  // 2) Clicking opens the combobox with the conventional types.
  await selector.click();
  const fixOption = page.getByTestId("changes-commit-type-option-fix");
  await expect(fixOption).toBeVisible();
  await expect(page.getByTestId("changes-commit-type-option-feat")).toBeVisible();
  await expect(page.getByTestId("changes-commit-type-option-none")).toContainText("None");

  // Visual proof of the open picker for the QA report.
  await moneyShot(page, "the commit type picker opens with none + all git-cz types");

  // 3) Choosing `fix` updates the chip.
  await fixOption.click();
  await expect(selector).toContainText("fix");
  await expect(selector).not.toContainText("None");

  // 4) The message box stays untainted: no prefix badge is rendered inside it.
  await expect(page.getByTestId("changes-commit-type-prefix")).toHaveCount(0);

  // Visual proof: chip shows `fix`, the message box below it is clean.
  await moneyShot(page, "the picked type lives in the chip and the message box stays clean");

  // 5) Committing still sends the prefixed message verbatim to git. The
  // committed file leaves the uncommitted list, which unmounts the section.
  await page.getByTestId("changes-commit-message").fill("handle null cursor");
  await page.getByTestId("changes-commit-button").click();
  await expect(page.getByTestId(/^diff-file-\d+$/).filter({ hasText: "alpha.ts" })).toHaveCount(0, {
    timeout: 30_000,
  });

  const subject = gitOutput(workspace.repoPath, ["log", "-1", "--pretty=%s"]);
  expect(subject).toBe("fix: handle null cursor");
});

function gitOutput(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args])
    .toString()
    .trim();
}

async function createWorkspaceWithChange(): Promise<CommitWorkspace> {
  const repo = await createTempGitRepo("commit-type-verify-", {
    files: [{ path: "src/alpha.ts", content: "export const alpha = 1;\n" }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/alpha.ts"), "export const alpha = 2;\n");
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
  await expect(page.getByTestId("changes-commit-section")).toBeVisible({ timeout: 30_000 });
}
