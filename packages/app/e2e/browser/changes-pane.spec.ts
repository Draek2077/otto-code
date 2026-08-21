import { execFileSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { MAX_CODE_FONT_SIZE, MIN_CODE_FONT_SIZE } from "../../src/hooks/use-settings/limits";
import { test, expect } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

interface DirtyWorkspace {
  id: string;
  repoPath: string;
}

interface WorkspaceFixtureOptions {
  includeDeletedFile?: boolean;
  includeNestedFolders?: boolean;
  includeRenamedFile?: boolean;
  includeUntrackedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@otto:app-settings";

async function failNextDiscardRequest(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      if (typeof message === "string") {
        const envelope = JSON.parse(message) as {
          message?: { type?: string; cwd?: string; requestId?: string };
        };
        if (envelope.message?.type === "checkout.discard_changes.request") {
          browserSocket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "checkout.discard_changes.response",
                payload: {
                  cwd: envelope.message.cwd,
                  success: false,
                  error: { code: "UNKNOWN", message: "Injected revert failure" },
                  requestId: envelope.message.requestId,
                },
              },
            }),
          );
          return;
        }
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => browserSocket.send(message));
  });
}

const CHANGES_PREFERENCES_KEY = "@otto:changes-preferences";

// One changed line, far wider than the Changes pane, in a language the
// Structural presentation can parse.
const LONG_LINE_NEEDLE = "wrap-me-".repeat(40);
const LONG_LINE_BEFORE = `export const banner = "start";\n`;
const LONG_LINE_AFTER = `export const banner = "${LONG_LINE_NEEDLE}end";\n`;

const BEFORE = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds };
}
`;

const AFTER = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

interface DeriveRenderMountedTabIdsInput {
  activeTabId: string | null;
  availableTabIds: Set<string>;
  cap: number;
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function deriveRenderMountedTabIds(input: DeriveRenderMountedTabIdsInput): Set<string> {
  const { activeTabId, availableTabIds, cap, mountedTabIds } = input;
  if (!activeTabId || !availableTabIds.has(activeTabId) || mountedTabIds.has(activeTabId)) {
    return mountedTabIds;
  }

  const next = new Set<string>([activeTabId]);
  const maxSize = Math.max(1, cap);
  for (const tabId of mountedTabIds) {
    if (next.size >= maxSize) {
      break;
    }
    if (availableTabIds.has(tabId)) {
      next.add(tabId);
    }
  }
  return next;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);
  const renderMountedTabIds = useMemo(
    () =>
      deriveRenderMountedTabIds({
        activeTabId,
        availableTabIds,
        cap,
        mountedTabIds,
      }),
    [activeTabId, availableTabIds, cap, mountedTabIds],
  );

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds: renderMountedTabIds };
}
`;

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("changes diff keeps code rows aligned with the gutter", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, MIN_CODE_FONT_SIZE);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectDiffCodeFontSize(page, MIN_CODE_FONT_SIZE);
  await expectVisibleDiffRowsAligned(page);
  await expectDiffCodeTextAlignedWithGutterText(page, [
    {
      codeText: "function createInitialMountedTabIds(input: UseMountedTabSetInput)",
      lineNumber: "20",
    },
    { codeText: "return next;", lineNumber: "55" },
    { codeText: "useLayoutEffect(() => {", lineNumber: "78" },
  ]);
  await expectHoverCommentButtonAlignedWithCodeLine(page, {
    codeText: "function createInitialMountedTabIds(input: UseMountedTabSetInput)",
    lineNumber: "20",
  });
});

test("changes file actions open below the right-click without a reserved kebab", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expect(page.getByTestId("diff-file-1")).toContainText("zz-deleted.ts");
  const deletedFileName = page.getByText("zz-deleted.ts", { exact: true });
  await expect(deletedFileName).toHaveCSS("user-select", "none");
  await deletedFileName.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-file-1-toggle").click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.getByText("Copy path", { exact: true }).click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await expect(page.getByTestId("diff-file-1-open-file")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const fileRow = page.getByTestId("diff-file-0-toggle");
  const fileRowBounds = await fileRow.boundingBox();
  expect(fileRowBounds).not.toBeNull();
  await fileRow.click({ button: "right", position: { x: 80, y: 10 } });
  await expect(page.getByTestId("diff-file-0-open-file")).toBeVisible();
  const menuBounds = await page.getByTestId("diff-file-0-context-menu").boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeCloseTo(fileRowBounds!.x + 80, 0);
  expect(menuBounds!.y).toBeGreaterThan(fileRowBounds!.y + 10);
  await page.getByTestId("diff-file-0-open-file").click();

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
});

test("changes context menus duplicate files and folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-duplicate").click();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set copy.ts"), "utf8"))
    .toBe(AFTER);

  await page.getByTestId("changes-toggle-view-mode").click();
  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-duplicate").click();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src copy/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);
});

test("changes context menu recursively collapses descendant folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeNestedFolders: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("changes-toggle-view-mode").click();
  await expect(page.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(page.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();

  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-collapse-folder").click();
  await expect(page.getByTestId("diff-folder-src/zz-folder")).toHaveCount(0);

  await page.getByTestId("diff-folder-src-toggle").click();
  await expect(page.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(page.getByText("root.ts", { exact: true })).toHaveCount(0);

  await page.getByTestId("diff-folder-src/zz-folder-toggle").click();
  await expect(page.getByText("root.ts", { exact: true })).toBeVisible();
  await expect(page.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  await expect(page.getByText("changed.ts", { exact: true })).toHaveCount(0);

  await page.getByTestId("diff-folder-src/zz-folder/nested-toggle").click();
  await expect(page.getByText("changed.ts", { exact: true })).toBeVisible();
});

test("changes context menus expose folder revert and restore a file after confirmation", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("changes-toggle-view-mode").click();
  await page.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  const folderRevert = page.getByTestId("diff-folder-src-revert");
  await expect(folderRevert).toBeVisible();
  const revertLabelColor = await folderRevert
    .getByText("Discard changes", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(folderRevert.locator("svg")).toHaveCSS("stroke", revertLabelColor);
  await page.keyboard.press("Escape");

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const cancelledConfirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      resolve(message);
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  expect(await cancelledConfirmation).toContain("src/use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      resolve(message);
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  expect(await confirmation).toContain("src/use-mounted-tab-set.ts");

  await expect(page.getByTestId("diff-file-0")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(BEFORE);
});

test("discarding a staged rename restores its source path", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeRenamedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const renamedToggle = page
    .getByTestId(/^diff-file-\d+-toggle$/)
    .filter({ hasText: "zz-renamed.ts" });
  const toggleTestId = await renamedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await renamedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-renamed.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/rename-source.ts"), "utf8"))
    .toBe("export const renamed = true;\n");
});

test("discarding an untracked file removes it from the working tree", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeUntrackedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const untrackedToggle = page
    .getByTestId(/^diff-file-\d+-toggle$/)
    .filter({ hasText: "zz-untracked.txt" });
  const toggleTestId = await untrackedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await untrackedToggle.click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await confirmation;

  await expect(page.getByText("zz-untracked.txt", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    readFile(path.join(workspace.repoPath, "zz-untracked.txt"), "utf8"),
  ).rejects.toThrow();
});

test("shows a revert error returned by the daemon", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await failNextDiscardRequest(page);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  const confirmation = new Promise<void>((resolve) => {
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    });
  });
  await page.getByTestId("diff-file-0-revert").click();
  await confirmation;

  await expect(page.getByText("Injected revert failure", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), "utf8"))
    .toBe(AFTER);
});

test("Changes switches between inline and full-tab navigation", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const changesTabToggle = page.getByTestId("changes-open-tab");
  await expect(changesTabToggle).toHaveAccessibleName("Open Changes tab");
  await changesTabToggle.click();
  await expect(changesTabToggle).toHaveAccessibleName("Close Changes tab");

  const visiblePanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(visiblePanel).toBeVisible();
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  await expect(page.getByTestId("workspace-file-pane")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  const workingDiffLayoutToggle = visiblePanel.getByTestId("working-diff-toggle-layout");
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to side-by-side diff");
  await workingDiffLayoutToggle.click();
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to unified diff");
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("working-diff-refresh")).toContainText("Refresh");
  await page.getByTestId("working-diff-toggle-wrap-lines").click();
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText(
    "Scroll long lines",
  );
  await page.keyboard.press("Escape");
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId(/^diff-file-\d+-body$/)).toHaveCount(0);
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);

  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), BEFORE);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), AFTER);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByTestId("explorer-content-area").getByTestId("diff-file-1")).toContainText(
    "zz-deleted.ts",
  );
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-1-toggle").click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);
  await expect(visiblePanel.getByText("zz-deleted.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel.getByRole("img", { name: "Deleted" })).toBeVisible();

  await changesTabToggle.click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(0);
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toBeVisible();
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
});

test("changes diff switches between flat and tree file lists", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);
  // "split" and "tree" are pinned by default, so their controls render as
  // toolbar strip buttons whose testIDs carry the "-pinned" suffix (the bare
  // testID belongs to the ▾-menu row). See changes-toolbar/toolbar.tsx.
  await expect(page.getByTestId("changes-toggle-layout-pinned")).toBeVisible();
  await expect(page.getByTestId("changes-layout-unified")).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-split")).toHaveCount(0);

  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("changes-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("changes-refresh")).toContainText("Refresh");
  await page.getByTestId("changes-toggle-whitespace").click();
  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Show whitespace");
  await page.keyboard.press("Escape");

  await scrollToLowerUnwrappedDiffRows(page);
  await page.getByTestId("changes-toggle-view-mode-pinned").click();
  await expect(page.getByTestId("diff-folder-src")).toBeVisible();
  await expect(page.getByTestId("diff-folder-src").getByText("src", { exact: true })).toHaveCSS(
    "user-select",
    "none",
  );
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect(page.getByTestId("diff-folder-src-toggle").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("diff-file-0-toggle").locator("svg")).toHaveCount(1);
  const folderToggleBounds = await page.getByTestId("diff-folder-src-toggle").boundingBox();
  const folderChevronBounds = await page
    .getByTestId("diff-folder-src-toggle")
    .locator("svg")
    .boundingBox();
  expect(folderToggleBounds).not.toBeNull();
  expect(folderChevronBounds).not.toBeNull();
  expect(folderChevronBounds!.y + folderChevronBounds!.height / 2).toBeCloseTo(
    folderToggleBounds!.y + folderToggleBounds!.height / 2,
    0,
  );
  const folderLabelBounds = await page
    .getByTestId("diff-folder-src")
    .getByText("src", { exact: true })
    .boundingBox();
  const fileLabelBounds = await page
    .getByTestId("diff-file-0")
    .getByText("use-mounted-tab-set.ts", { exact: true })
    .boundingBox();
  expect(folderLabelBounds).not.toBeNull();
  expect(fileLabelBounds).not.toBeNull();
  expect(fileLabelBounds!.x - folderLabelBounds!.x).toBeCloseTo(16, 0);

  const folderToggle = page.getByTestId("diff-folder-src-toggle");
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("diff-file-0")).toBeVisible();

  const fileToggle = page.getByTestId("diff-file-0-toggle");
  await fileToggle.click({ button: "right" });
  await expect(fileToggle).toHaveAttribute("aria-selected", "true");
  await expect(folderToggle).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("diff-file-0-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId("diff-folder-src-toggle").click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);

  await page.getByTestId("changes-toggle-view-mode-pinned").click();
  await expectFlatFileList(page);
});

test("changes diff applies code size changes to gutter and code typography", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await changeCodeFontSizeFromSettings(page, 18);
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);
  await scrollToLowerUnwrappedDiffRows(page);

  await expectDiffCodeFontSize(page, 18);
  await expectVisibleDiffRowsShareTypography(page);
});

test("changes diff wraps long structural rows inside the pane", async ({ page }) => {
  const workspace = await createWorkspaceWithLongChangedLine();
  await useCodeFont(page, 12);
  await useWrappedStructuralDiffLines(page);
  await openWorkspaceChangesForLongLine(page, workspace);

  // Falling back to Line presentation would pass the width assertion for the
  // wrong reason - Line rows have always wrapped.
  await expect(page.getByTestId("structural-diff").first()).toBeVisible();

  const body = await readDiffBodyOverflow(page, LONG_LINE_NEEDLE);
  const report = JSON.stringify(body, null, 2);
  // Nothing runs past the pane, and the changed line is taller than one line -
  // it soft-wrapped rather than being clipped.
  expect(body.widestDescendant, report).toBeLessThanOrEqual(body.width + 1);
  expect(body.longLineWidth, report).toBeLessThanOrEqual(body.width + 1);
  expect(body.longLineHeight, report).toBeGreaterThan(body.longLineLineHeight * 1.5);
});

async function useCodeFont(page: Page, codeFontSize: number): Promise<void> {
  await page.addInitScript(
    ({ settingsKey, fontSize }) => {
      if (localStorage.getItem(settingsKey)) {
        return;
      }
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          theme: "dark",
          sendBehavior: "interrupt",
          serviceUrlBehavior: "ask",
          terminalScrollbackLines: 10_000,
          uiFontFamily: "",
          monoFontFamily: "",
          uiFontSize: 16,
          codeFontSize: fontSize,
          syntaxTheme: "default",
        }),
      );
    },
    { settingsKey: APP_SETTINGS_KEY, fontSize: codeFontSize },
  );
}

async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: "unified",
          viewMode: "flat",
          wrapLines: false,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function useWrappedStructuralDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          presentation: "structural",
          layout: "unified",
          viewMode: "flat",
          wrapLines: true,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function readDiffBodyOverflow(
  page: Page,
  needle: string,
): Promise<{
  width: number;
  widestDescendant: number;
  longLineWidth: number;
  longLineHeight: number;
  longLineLineHeight: number;
}> {
  return page.getByTestId("diff-file-0-body").evaluate((body, text) => {
    const width = body.getBoundingClientRect().width;
    let widestDescendant = 0;
    // The innermost element still holding the whole changed line: the code
    // element itself, not a row or column wrapper around it.
    let longLine: Element | null = null;
    for (const node of body.querySelectorAll("*")) {
      widestDescendant = Math.max(widestDescendant, node.getBoundingClientRect().width);
      if (node.textContent?.includes(text)) {
        longLine = node;
      }
    }
    if (!longLine) {
      throw new Error("The changed line is not rendered in the diff body");
    }
    const box = longLine.getBoundingClientRect();
    return {
      width,
      widestDescendant,
      longLineWidth: box.width,
      longLineHeight: box.height,
      longLineLineHeight: Number.parseFloat(getComputedStyle(longLine).lineHeight),
    };
  }, needle);
}

async function expectFlatFileList(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(page.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toContainText("src");
}

async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      return page
        .getByTestId("diff-code-text-1")
        .evaluate((text) => Number.parseFloat(getComputedStyle(text).fontSize));
    })
    .toBe(fontSize);
}

async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  const geometry = await readVisibleDiffRowGeometry(page);
  expect(geometry.mismatchedTypography, JSON.stringify(geometry, null, 2)).toEqual([]);
}

async function expectVisibleDiffRowsAligned(page: Page): Promise<void> {
  const geometry = await readVisibleDiffRowGeometry(page);
  expect(geometry.maxDelta, JSON.stringify(geometry.rows, null, 2)).toBeLessThanOrEqual(1);
}

async function readVisibleDiffRowGeometry(page: Page): Promise<{
  maxDelta: number;
  mismatchedTypography: { index: number; gutterLineHeight: number; codeLineHeight: number }[];
  rows: {
    index: number;
    gutterTop: number;
    codeTop: number;
    gutterLineHeight: number;
    codeLineHeight: number;
  }[];
}> {
  return page.locator("body").evaluate(({ ownerDocument }) => {
    const root = ownerDocument.querySelector('[data-testid="diff-file-0-body"]');
    if (!root) {
      throw new Error("Expanded diff body is not mounted");
    }

    const readRows = (prefix: string, textPrefix: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).map((row) => {
        const testId = row.getAttribute("data-testid") ?? "";
        const index = Number(testId.slice(prefix.length));
        const rect = row.getBoundingClientRect();
        const text = root.querySelector<HTMLElement>(`[data-testid="${textPrefix}${index}"]`);
        const lineHeight = text ? Number.parseFloat(getComputedStyle(text).lineHeight) : 0;
        return { index, top: rect.top, height: rect.height, lineHeight };
      });

    const gutters = new Map(
      readRows("diff-gutter-row-", "diff-gutter-text-").map((row) => [row.index, row]),
    );
    const codes = readRows("diff-code-row-", "diff-code-text-");
    const rows = codes
      .map((code) => {
        const gutter = gutters.get(code.index);
        if (!gutter) {
          throw new Error(`Missing gutter row ${code.index}`);
        }
        return {
          index: code.index,
          gutterTop: gutter.top,
          codeTop: code.top,
          gutterLineHeight: gutter.lineHeight,
          codeLineHeight: code.lineHeight,
        };
      })
      .filter((row) => row.gutterTop >= 0 && row.codeTop >= 0);

    return {
      maxDelta: rows.reduce(
        (largestDelta, row) => Math.max(largestDelta, Math.abs(row.gutterTop - row.codeTop)),
        0,
      ),
      mismatchedTypography: rows
        .filter((row) => Math.abs(row.gutterLineHeight - row.codeLineHeight) > 0.5)
        .map((row) => ({
          index: row.index,
          gutterLineHeight: row.gutterLineHeight,
          codeLineHeight: row.codeLineHeight,
        })),
      rows,
    };
  });
}

async function createWorkspaceWithLongChangedLine(): Promise<DirtyWorkspace> {
  const repo = await createTempGitRepo("diff-wrap-", {
    files: [{ path: "src/banner.ts", content: LONG_LINE_BEFORE }],
  });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/banner.ts"), LONG_LINE_AFTER);
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

async function openWorkspaceChangesForLongLine(
  page: Page,
  workspace: DirtyWorkspace,
): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await page.getByRole("button", { name: "Open explorer" }).click();
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("banner.ts")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("diff-file-0").click();
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
}

async function createWorkspaceWithMountedTabDiff(
  options: WorkspaceFixtureOptions = {},
): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options.includeDeletedFile) {
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
  }
  if (options.includeRenamedFile) {
    files.push({ path: "src/rename-source.ts", content: "export const renamed = true;\n" });
  }
  if (options.includeNestedFolders) {
    files.push(
      { path: "src/zz-folder/root.ts", content: "export const root = 1;\n" },
      { path: "src/zz-folder/nested/changed.ts", content: "export const nested = 1;\n" },
    );
  }
  const repo = await createTempGitRepo("changes-pane-", { files });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  if (options.includeUntrackedFile) {
    await writeFile(path.join(repo.path, "zz-untracked.txt"), "remove me\n");
  }
  if (options.includeDeletedFile) {
    await unlink(path.join(repo.path, "src/zz-deleted.ts"));
  }
  if (options.includeRenamedFile) {
    execFileSync("git", ["mv", "src/rename-source.ts", "src/zz-renamed.ts"], {
      cwd: repo.path,
    });
  }
  if (options.includeNestedFolders) {
    await writeFile(path.join(repo.path, "src/zz-folder/root.ts"), "export const root = 2;\n");
    await writeFile(
      path.join(repo.path, "src/zz-folder/nested/changed.ts"),
      "export const nested = 2;\n",
    );
  }
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await page.getByRole("button", { name: "Open explorer" }).click();
  await openChangesInVisibleExplorer(page);
  await page.getByTestId("diff-file-0").click();
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("use-mounted-tab-set.ts")).toBeVisible({ timeout: 30_000 });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("function createInitialMountedTabIds")).toBeVisible({
    timeout: 30_000,
  });
}

async function changeCodeFontSizeFromSettings(page: Page, codeFontSize: number): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("general")}|/settings$`));
  await page.getByRole("button", { name: "Appearance" }).click();
  await dragCodeFontSizeSlider(page, codeFontSize);
  await expectStoredCodeFontSize(page, codeFontSize);
}

// The code font size control is a custom drag slider (no native <input>, no
// keyboard support - see components/ui/slider.tsx), so setting a value means
// moving the pointer to the track position for that value and releasing it.
async function dragCodeFontSizeSlider(page: Page, codeFontSize: number): Promise<void> {
  const slider = page.getByLabel("Code font size");
  // The fonts card sits below newer appearance sections, so the slider can be
  // outside the viewport; raw mouse coordinates only work once it's scrolled in.
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Code font size slider is not visible");
  }
  const ratio = (codeFontSize - MIN_CODE_FONT_SIZE) / (MAX_CODE_FONT_SIZE - MIN_CODE_FONT_SIZE);
  await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

async function expectStoredCodeFontSize(page: Page, codeFontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (settingsKey) => localStorage.getItem(settingsKey),
        APP_SETTINGS_KEY,
      );
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { codeFontSize?: number }).codeFontSize ?? null;
    })
    .toBe(codeFontSize);
}

async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  const lastRowIndex = await page.getByTestId("diff-file-0-body").evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="diff-code-row-"]'));
    if (rows.length === 0) {
      throw new Error("No unwrapped code rows are mounted");
    }
    return Math.max(
      ...rows.map((row) => Number((row.getAttribute("data-testid") ?? "").slice(14))),
    );
  });
  await page.getByTestId(`diff-code-row-${lastRowIndex}`).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(`diff-code-row-${lastRowIndex}`)).toBeVisible();
}

async function expectDiffCodeTextAlignedWithGutterText(
  page: Page,
  lines: { codeText: string; lineNumber: string }[],
): Promise<void> {
  const geometries = await readDiffTextGeometry(page, lines);
  for (const geometry of geometries) {
    expect(geometry.codeTop, geometry.codeText).toBeCloseTo(geometry.gutterTop, 0);
  }
}

async function expectHoverCommentButtonAlignedWithCodeLine(
  page: Page,
  line: { codeText: string; lineNumber: string },
): Promise<void> {
  const target = await readDiffTextGeometry(page, [line]).then((rows) => rows[0]);
  if (!target) {
    throw new Error(`Could not find target line ${line.lineNumber}`);
  }
  await page.getByTestId(`diff-code-row-${target.index}`).hover();
  const geometry = await page
    .getByTestId(`diff-gutter-action-${target.index}`)
    .evaluate((action, expectedCodeCenterY) => {
      const rect = action.getBoundingClientRect();
      return {
        actionCenterY: rect.top + rect.height / 2,
        codeCenterY: expectedCodeCenterY,
      };
    }, target.codeCenterY);
  expect(geometry.actionCenterY).toBeCloseTo(geometry.codeCenterY, 0);
}

async function readDiffTextGeometry(
  page: Page,
  lines: { codeText: string; lineNumber: string }[],
): Promise<
  { index: number; codeText: string; codeTop: number; gutterTop: number; codeCenterY: number }[]
> {
  return page.locator("body").evaluate(({ ownerDocument }, targets) => {
    const root = ownerDocument.querySelector('[data-testid="explorer-content-area"]');
    if (!root) {
      throw new Error("Changes panel is not mounted");
    }

    const readIndexedElements = (prefix: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).map(
        (element) => {
          const testId = element.getAttribute("data-testid") ?? "";
          return { index: Number(testId.slice(prefix.length)), element };
        },
      );

    const gutterTexts = readIndexedElements("diff-gutter-text-");
    const codeTexts = readIndexedElements("diff-code-text-");

    return targets.map((target) => {
      const gutter = gutterTexts.find(
        ({ element }) => (element.textContent ?? "").trim() === target.lineNumber,
      );
      if (!gutter) {
        throw new Error(`Could not find gutter line ${target.lineNumber}`);
      }
      const code = codeTexts.find(
        ({ index, element }) =>
          index === gutter.index && (element.textContent ?? "").includes(target.codeText),
      );
      if (!code) {
        throw new Error(`Could not find code row ${target.codeText}`);
      }

      const codeRect = code.element.getBoundingClientRect();
      const gutterRect = gutter.element.getBoundingClientRect();

      return {
        index: gutter.index,
        codeText: target.codeText,
        codeTop: codeRect.top,
        gutterTop: gutterRect.top,
        codeCenterY: codeRect.top + codeRect.height / 2,
      };
    });
  }, lines);
}
