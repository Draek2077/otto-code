import { expect, test } from "../../e2e/fixtures";
import { expectFileTabOpen } from "../../e2e/helpers/file-explorer";
import { gotoWorkspace } from "../../e2e/helpers/launcher";
import { applyDemoAppearance } from "../helpers/appearance";
import { DemoRecorder } from "../helpers/capture";
import { beat, humanClick, resetPacingSeed } from "../helpers/pacing";
import { seedDemoWorkspace, type DemoWorkspace } from "../staging/seed";

/**
 * Scenario 03 — Diff review + IDE surfaces.
 * The storefront template ships with staged working-tree changes, so this
 * walkthrough needs no agent run: open the workspace, browse the file
 * explorer, open a file, then review the pending diff in flat and tree views.
 */

let workspace: DemoWorkspace;

test.beforeAll(async () => {
  workspace = await seedDemoWorkspace({
    template: "mango-storefront",
    originOwner: "mango-labs",
    title: "Storefront search",
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test("diff review walkthrough", async ({ page }, testInfo) => {
  resetPacingSeed();
  // Site assets run Neotokyo (UI theme + matching syntax highlighting).
  await applyDemoAppearance(page, { darkTheme: "cyberpunk", syntaxTheme: "neotokyo" });
  // Pin the walkthrough to a known diff starting state (flat list, unified).
  await page.addInitScript(() => {
    localStorage.setItem(
      "@otto:changes-preferences",
      JSON.stringify({
        layout: "unified",
        viewMode: "flat",
        wrapLines: false,
        hideWhitespace: false,
      }),
    );
  });
  const recorder = await DemoRecorder.start(page, "03-diff-review");

  await gotoWorkspace(page, workspace.workspaceId);
  await beat(page);
  await recorder.shot(
    "workspace",
    "Your project, open in Otto",
    "A real repository opened as a workspace — agents, terminals, files, and diffs all live here.",
  );

  await humanClick(page, page.getByRole("button", { name: "Open explorer" }).first());
  await humanClick(page, page.getByTestId("explorer-tab-files"));
  const tree = page.getByTestId("file-explorer-tree-scroll");
  await expect(tree).toBeVisible({ timeout: 30_000 });
  await beat(page);
  await recorder.shot(
    "file-explorer",
    "Browse the whole repository",
    "The file explorer shows the real working tree with language-aware icons.",
  );

  await humanClick(page, tree.getByText("README.md", { exact: true }).first());
  await expectFileTabOpen(page, "README.md");
  await beat(page);
  await recorder.shot(
    "file-view",
    "Open any file as a tab",
    "Files open in workspace tabs alongside your agents and terminals.",
  );

  await humanClick(page, page.getByTestId("explorer-tab-changes"));
  await expect(page.getByTestId("diff-file-0")).toBeVisible({ timeout: 30_000 });
  await beat(page);
  await recorder.shot(
    "changes-list",
    "Uncommitted changes at a glance",
    "Every modified file in the working tree, straight from git.",
  );

  await humanClick(page, page.getByTestId("diff-file-0"));
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await beat(page);
  await recorder.shot(
    "diff-view",
    "Review the diff line by line",
    "Full syntax-highlighted diffs with gutter line numbers — review from anywhere.",
  );

  // The tree toggle lives in the options menu unless pinned to the strip.
  await humanClick(page, page.getByTestId("changes-options-menu"));
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible({ timeout: 15_000 });
  await beat(page);
  await recorder.shot(
    "changes-options",
    "Diff tools at hand",
    "Split layout, whitespace, line wrapping, and tree view — all per-workspace preferences.",
  );

  await humanClick(page, page.getByTestId("changes-toggle-view-mode").first());
  await beat(page);
  await recorder.shot(
    "diff-tree",
    "Flat list or folder tree",
    "Switch the changed-file list between flat and tree layouts.",
  );

  await recorder.finish(testInfo);
});
