import type { Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { gotoAppShell } from "../support/helpers/app";
import { addRetainedFixtureHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { openChangesTreePanel } from "../support/helpers/workspace-tabs";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";

async function openChanges(page: Page, compact: boolean) {
  if (compact) {
    await page.getByTestId("workspace-explorer-toggle").filter({ visible: true }).first().click();
    await page.getByTestId("explorer-tab-changes").filter({ visible: true }).click();
  } else await openChangesTreePanel(page);
  const panel = page
    .getByTestId(compact ? "explorer-content-area" : "changes-tree-panel")
    .filter({ visible: true });
  await expect(panel.getByTestId("changes-header")).toBeVisible();
  return panel;
}
async function expectFiles(panel: Locator, compact: boolean, paths: string[]) {
  if (compact) {
    const headers = panel.locator("[data-diff-header-path]");
    await expect
      .poll(() =>
        headers.evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-diff-header-path")),
        ),
      )
      .toEqual(paths);
  } else {
    await expect(
      panel.locator('[data-testid^="diff-tree-file-"][data-testid$="-name"]'),
    ).toHaveText(paths);
  }
}

for (const compact of [false, true]) {
  test(`parent branch changes the stacked diff and survives reload (${compact ? "compact" : "wide"})`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize(
      compact ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    );
    const repo = await createTempGitRepo("comparison-picker-");

    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo.path,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      git("checkout", "-b", "parent");
      await writeFile(path.join(repo.path, "parent.txt"), "parent work\n");
      git("add", ".");
      git("commit", "-m", "parent work");
      git("checkout", "-b", "child");
      await writeFile(path.join(repo.path, "child.txt"), "child work\n");
      git("add", ".");
      git("commit", "-m", "child work");
      git("branch", "disappearing-parent", "parent");
      git("update-ref", "refs/remotes/origin/parent", "main");
      const head = git("rev-parse", "HEAD");
      const owner = await startIsolatedHostDaemon("comparison-base-fixture");
      try {
        const client = await connectSeedClient({ port: owner.port });
        const created = await client
          .createWorkspace({ source: { kind: "directory", path: repo.path } })
          .finally(() => client.close());
        if (!created.workspace)
          throw new Error(created.error ?? "The stacked workspace could not be opened");
        await gotoAppShell(page);
        await addRetainedFixtureHostAndReload({
          page,
          serverId: owner.serverId,
          label: "Comparison fixture",
          port: owner.port,
        });
        const route = buildHostWorkspaceRoute(owner.serverId, created.workspace.id);
        await page.goto(route, { waitUntil: "commit" });
        const panel = await openChanges(page, compact);
        await expect(panel.getByTestId("changes-branch-switcher")).toContainText("child");
        const mode = panel.getByTestId("changes-diff-status-trigger");
        await mode.click();
        await page.getByTestId("changes-diff-mode-committed").click();
        await expectFiles(panel, compact, ["child.txt", "parent.txt"]);
        const picker = panel.getByTestId("changes-diff-base");
        await picker.click();
        await expect(
          page.getByText("origin/parent", { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        await page.screenshot({ path: info.outputPath("parent-branch-options.png") });
        await page
          .getByRole("button", { name: "origin/parent", exact: true })
          .filter({ visible: true })
          .click();
        await expect(picker).toContainText("vs origin/parent");
        await expectFiles(panel, compact, ["child.txt", "parent.txt"]);
        await picker.click();
        await page
          .getByRole("button", { name: "parent", exact: true })
          .filter({ visible: true })
          .click();
        await expect(picker).toContainText("vs parent");
        await expectFiles(panel, compact, ["child.txt"]);
        await page.screenshot({ path: info.outputPath("parent-branch-picker.png") });
        await page.reload({ waitUntil: "commit" });
        await openChanges(page, compact);
        await expect(picker).toContainText("vs parent");
        await expectFiles(panel, compact, ["child.txt"]);
        await picker.click();
        await expect(
          page.getByText("disappearing-parent", { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        git("branch", "-D", "disappearing-parent");
        await page
          .getByText("disappearing-parent", { exact: true })
          .filter({ visible: true })
          .click();
        await expect(
          page.getByRole("alert").filter({ hasText: "That parent branch no longer exists" }),
        ).toBeVisible();
        await expect(picker).toContainText("vs parent");
        await page
          .getByText("Repository default", { exact: true })
          .filter({ visible: true })
          .click();
        await expect(picker).toContainText("vs main");
        await expectFiles(panel, compact, ["child.txt", "parent.txt"]);
        expect(git("rev-parse", "HEAD")).toBe(head);
        expect(git("status", "--porcelain")).toBe("");
      } finally {
        // This daemon's observers and Git processes can lock the checkout on Windows.
        await owner.close();
      }
    } finally {
      await repo.cleanup();
    }
  });
}
