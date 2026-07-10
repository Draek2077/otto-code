import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { openFileExplorer } from "./helpers/file-explorer";
import { gotoWorkspace } from "./helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "file-finder-",
    repo: {
      files: [
        { path: "src/widget-renderer.ts", content: "export const render = 1;\n" },
        { path: "src/util.ts", content: "export const noop = () => {};\n" },
        { path: "docs/guide.md", content: "# Guide\n" },
      ],
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("File finder", () => {
  test("fuzzy-opens a file by name", async ({ page }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    await page.getByTestId("explorer-tab-files").click();

    await page.getByTestId("file-explorer-open-finder").click();
    const input = page.getByTestId("file-finder-input");
    await expect(input).toBeVisible({ timeout: 30_000 });

    // A scattered subsequence still matches "widget-renderer".
    await input.fill("wren");
    await expect(page.getByTestId("file-finder-result-src/widget-renderer.ts")).toBeVisible({
      timeout: 30_000,
    });

    // Enter opens the top hit as a file tab (code defaults to the editor view).
    await input.press("Enter");
    await expect(page.getByTestId("workspace-tab-file_src/widget-renderer.ts").first()).toBeVisible(
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByTestId("workspace-file-tab-pane")).toBeVisible();
  });
});
