import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { openFileExplorer } from "./helpers/file-explorer";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

let workspace: SeededWorkspace;

// The bulk-replace confirmation dialog only appears at 10+ selected matches
// (see project-search-replace-warning.ts); alpha.ts needs that many "shared"
// occurrences so the replace-selected step below actually exercises it.
const ALPHA_MATCH_COUNT = 10;
const alphaLines = (token: string) =>
  Array.from({ length: ALPHA_MATCH_COUNT }, (_, i) => `const v${i} = ${token};`).join("\n") + "\n";

test.beforeAll(async () => {
  // .gitignore exclusion is covered by the daemon unit tests; the seed helper
  // git-adds each file, so it can't stage a gitignored path.
  workspace = await seedWorkspace({
    repoPrefix: "project-search-",
    repo: {
      files: [
        { path: "src/alpha.ts", content: alphaLines("shared") },
        { path: "src/beta.ts", content: "shared here too\n" },
      ],
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("Project search", () => {
  test("finds matches, opens at line, and replaces selected matches", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);

    await page.getByTestId("explorer-tab-search").click();
    const input = page.getByTestId("project-search-input");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("shared");
    await input.press("Enter");

    // 10 matches in alpha.ts, 1 in beta.ts.
    await expect(page.getByTestId("project-search-summary")).toHaveText("11 matches in 2 files", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("project-search-file-src/alpha.ts")).toBeVisible();
    await expect(page.getByTestId("project-search-file-src/beta.ts")).toBeVisible();

    // A match row opens the file tab at that line (code defaults to the editor).
    await page.getByTestId("project-search-match-src/alpha.ts-1").click();
    await expect(page.getByTestId("workspace-tab-file_src/alpha.ts").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("workspace-file-tab-pane")).toBeVisible();

    // Replace selected: uncheck beta.ts entirely, then replace the rest.
    await page.getByTestId("project-search-replace-expand").click();
    await page.getByTestId("project-search-replace-input").fill("renamed");
    await page.getByTestId("project-search-file-check-src/beta.ts").click();
    await page.getByTestId("project-search-replace-selected").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("confirm-dialog-confirm").click();

    await expect
      .poll(() => readFileSync(join(workspace.repoPath, "src/alpha.ts"), "utf-8"), {
        timeout: 15_000,
      })
      .toBe(alphaLines("renamed"));
    // The unchecked file is untouched.
    expect(readFileSync(join(workspace.repoPath, "src/beta.ts"), "utf-8")).toBe(
      "shared here too\n",
    );

    // The pane re-ran the search against the rewritten tree.
    await expect(page.getByTestId("project-search-summary")).toHaveText("1 matches in 1 files", {
      timeout: 30_000,
    });
  });
});
