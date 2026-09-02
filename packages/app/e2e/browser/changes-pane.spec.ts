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

interface ObservedRequest {
  type?: string;
  cwd?: string;
  path?: string;
  paths?: string[];
  requestId?: string;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@otto:app-settings";

async function readTextFileOrNull(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    // Windows can briefly report EBUSY while the daemon refreshes a path. A
    // missing file is also the expected intermediate state for create/restore.
    return null;
  }
}

async function failNextDiscardRequest(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      const envelope = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      ) as {
        message?: { type?: string; cwd?: string; requestId?: string };
      };
      if (envelope.message?.type === "checkout.git.rollback.request") {
        browserSocket.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "checkout.git.rollback.response",
              payload: {
                cwd: envelope.message.cwd,
                success: false,
                rolledBackPaths: [],
                error: { kind: "git_failed", detail: "Injected revert failure" },
                requestId: envelope.message.requestId,
              },
            },
          }),
        );
        return;
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => browserSocket.send(message));
  });
}

async function observeNextRequest(
  page: Page,
  requestType: string,
): Promise<{ wait: () => Promise<ObservedRequest> }> {
  let resolveRequest: ((request: ObservedRequest) => void) | undefined;
  const requestSeen = new Promise<ObservedRequest>((resolve) => {
    resolveRequest = resolve;
  });
  await page.routeWebSocket(daemonWsRoutePattern(), (browserSocket) => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      const envelope = JSON.parse(
        typeof message === "string" ? message : message.toString("utf8"),
      ) as { message?: ObservedRequest };
      if (envelope.message?.type === requestType) {
        resolveRequest?.(envelope.message);
        resolveRequest = undefined;
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => browserSocket.send(message));
  });
  return { wait: () => requestSeen };
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

test("changes diff paints code and gutter on one canvas surface", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, MIN_CODE_FONT_SIZE);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectDiffCodeFontSize(page, MIN_CODE_FONT_SIZE);
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.locator('[data-testid^="diff-code-row-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="diff-gutter-row-"]')).toHaveCount(0);
});

test("changes file actions open below the right-click without a reserved kebab", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  await expect(page.getByTestId("diff-tree-file-1")).toContainText("zz-deleted.ts");
  const deletedFileName = page.getByTestId("diff-tree-file-1-name");
  await expect(deletedFileName).toHaveCSS("user-select", "none");
  await deletedFileName.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-tree-file-1-toggle").click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await page.getByText("Copy path", { exact: true }).click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await expect(page.getByTestId("diff-tree-file-1-open-file")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("diff-tree-file-0").click();
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

  await expect(
    page.getByTestId("explorer-sidebar-tab-file_src/use-mounted-tab-set.ts"),
  ).toBeVisible();
});

test("changes context menus duplicate files and folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  const duplicateRequest = await observeNextRequest(page, "fs.entry.duplicate.request");
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-file-0-duplicate").click();
  expect(await duplicateRequest.wait()).toMatchObject({ path: "src/use-mounted-tab-set.ts" });
  await expect
    .poll(() =>
      readTextFileOrNull(path.join(workspace.repoPath, "src/use-mounted-tab-set copy.ts")),
    )
    .toBe(AFTER);

  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  const changesTree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await changesTree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-duplicate").click();
  await expect
    .poll(() =>
      readTextFileOrNull(path.join(workspace.repoPath, "src copy/use-mounted-tab-set.ts")),
    )
    .toBe(AFTER);
});

test("changes context menu recursively collapses descendant folders", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeNestedFolders: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  const changesTree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await expect(changesTree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(changesTree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();

  await changesTree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  await page.getByTestId("diff-folder-src-collapse-folder").click();
  await expect(changesTree.getByTestId("diff-folder-src/zz-folder")).toHaveCount(0);

  await changesTree.getByTestId("diff-folder-src-toggle").click();
  await expect(changesTree.getByTestId("diff-folder-src/zz-folder")).toBeVisible();
  await expect(changesTree.getByText("root.ts", { exact: true })).toHaveCount(0);

  await changesTree.getByTestId("diff-folder-src/zz-folder-toggle").click();
  await expect(changesTree.getByText("root.ts", { exact: true })).toBeVisible();
  await expect(changesTree.getByTestId("diff-folder-src/zz-folder/nested")).toBeVisible();
  await expect(changesTree.getByText("changed.ts", { exact: true })).toHaveCount(0);

  await changesTree.getByTestId("diff-folder-src/zz-folder/nested-toggle").click();
  await expect(changesTree.getByText("changed.ts", { exact: true })).toBeVisible();
});

test("changes context menus expose folder revert and restore a file after confirmation", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  const changesTree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await changesTree.getByTestId("diff-folder-src-toggle").click({ button: "right" });
  const folderRevert = page.getByTestId("diff-folder-src-revert");
  await expect(folderRevert).toBeVisible();
  const revertLabelColor = await folderRevert
    .getByText("Discard changes", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(folderRevert.locator("svg")).toHaveCSS("color", revertLabelColor);
  await page.keyboard.press("Escape");

  await changesTree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-tree-file-0-revert").click();
  await expect(page.getByText(/src\/use-mounted-tab-set\.ts/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(changesTree.getByTestId("diff-tree-file-0")).toBeVisible();
  await expect
    .poll(() => readTextFileOrNull(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts")))
    .toBe(AFTER);

  await changesTree.getByTestId("diff-tree-file-0-toggle").click({ button: "right" });
  await page.getByTestId("diff-tree-file-0-revert").click();
  await expect(page.getByText(/src\/use-mounted-tab-set\.ts/)).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();

  await expect(changesTree.getByTestId("diff-tree-file-0")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(() => readTextFileOrNull(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts")))
    .toBe(BEFORE);
});

test("discarding a staged rename restores its source path", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeRenamedFile: true });
  const rollbackRequest = await observeNextRequest(page, "checkout.git.rollback.request");
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const renamedToggle = page
    .getByTestId(/^diff-file-\d+-toggle$/)
    .filter({ hasText: "zz-renamed.ts" });
  const toggleTestId = await renamedToggle.getAttribute("data-testid");
  expect(toggleTestId).not.toBeNull();
  const rowTestId = toggleTestId!.slice(0, -"-toggle".length);
  await renamedToggle.click({ button: "right" });
  await page.getByTestId(`${rowTestId}-revert`).click();
  await expect(page.getByText(/src\/zz-renamed\.ts/)).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  expect(await rollbackRequest.wait()).toMatchObject({
    paths: ["src/zz-renamed.ts", "src/rename-source.ts"],
  });

  await expect(page.getByText("zz-renamed.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect
    .poll(() => readTextFileOrNull(path.join(workspace.repoPath, "src/rename-source.ts")))
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
  await page.getByTestId(`${rowTestId}-revert`).click();
  await expect(
    page.getByText('Changes to "zz-untracked.txt" will be permanently discarded.'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();

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
  await page.getByTestId("diff-file-0-revert").click();
  await expect(page.getByText(/src\/use-mounted-tab-set\.ts/)).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();

  await expect(page.getByText("Injected revert failure", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await expect
    .poll(() => readTextFileOrNull(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts")))
    .toBe(AFTER);
});

test("Changes keeps diff options and tree interactions in their host tabs", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);
  const visibleLayoutToggle = page.getByTestId("changes-toggle-layout").filter({ visible: true });
  const visibleWhitespaceToggle = page
    .getByTestId("changes-toggle-whitespace")
    .filter({ visible: true });
  const visibleWrapToggle = page.getByTestId("changes-toggle-wrap-lines").filter({ visible: true });
  const visibleOptionsMenu = page.getByTestId("changes-options-menu").filter({ visible: true });
  // A file tab is a diff-only host, so its diff controls render directly in
  // the toolbar instead of inside the combined Changes options menu.
  await expect(visibleLayoutToggle).toBeVisible();
  await expect(visibleWhitespaceToggle).toBeVisible();
  await expect(visibleWrapToggle).toBeVisible();
  await expect(visibleOptionsMenu).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-unified")).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-split")).toHaveCount(0);

  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  const changesTree = page.getByTestId("changes-tree-panel").filter({ visible: true });
  await page.getByTestId("changes-options-menu").filter({ visible: true }).click();
  await expect(page.getByTestId("changes-open-tab")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-layout").filter({ visible: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(changesTree.getByTestId("diff-folder-src")).toBeVisible();
  await expect(
    changesTree.getByTestId("diff-folder-src").getByText("src", { exact: true }),
  ).toHaveCSS("user-select", "none");
  await expect(changesTree.getByTestId("diff-tree-file-0")).toBeVisible();
  const folderToggleBounds = await changesTree.getByTestId("diff-folder-src-toggle").boundingBox();
  const folderChevronBounds = await changesTree
    .getByTestId("diff-folder-src-toggle")
    .locator("svg")
    .first()
    .boundingBox();
  expect(folderToggleBounds).not.toBeNull();
  expect(folderChevronBounds).not.toBeNull();
  expect(folderChevronBounds!.y + folderChevronBounds!.height / 2).toBeCloseTo(
    folderToggleBounds!.y + folderToggleBounds!.height / 2,
    0,
  );

  const folderToggle = changesTree.getByTestId("diff-folder-src-toggle");
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(changesTree.getByTestId("diff-tree-file-0")).toHaveCount(0);
  await folderToggle.click();
  await expect(folderToggle).toHaveAttribute("aria-selected", "true");
  await expect(changesTree.getByTestId("diff-tree-file-0")).toBeVisible();

  const fileToggle = changesTree.getByTestId("diff-tree-file-0-toggle");
  await fileToggle.click({ button: "right" });
  await expect(fileToggle).toHaveAttribute("aria-selected", "true");
  await expect(folderToggle).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("diff-tree-file-0-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await changesTree.getByTestId("diff-folder-src-toggle").click();
  await expect(changesTree.getByTestId("diff-tree-file-0")).toHaveCount(0);
});

test("changes diff applies code size changes to gutter and code typography", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await changeCodeFontSizeFromSettings(page, 18);
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);

  await expectDiffCodeFontSize(page, 18);
  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
});

test("changes diff wraps long structural rows inside the pane", async ({ page }) => {
  const workspace = await createWorkspaceWithLongChangedLine();
  await useCodeFont(page, 12);
  await useWrappedStructuralDiffLines(page);
  await openWorkspaceChangesForLongLine(page, workspace);

  await expect(page.getByTestId("git-diff-canvas")).toBeVisible();
  await expect(page.getByTestId("diff-file-0-horizontal-scroll")).toHaveCount(0);
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

async function expectFlatFileList(page: Page): Promise<void> {
  const diffPanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(diffPanel.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(diffPanel.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(diffPanel.getByTestId("diff-file-0")).toContainText("src");
}

async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      return page
        .getByTestId("git-diff-canvas")
        .evaluate((text) => Number.parseFloat(getComputedStyle(text).fontSize));
    })
    .toBe(fontSize);
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
  await expect(page.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("banner.ts")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("diff-tree-file-0").click();
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
  await openMountedTabDiffFromTree(page);
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  const explorer = page.getByTestId("workspace-explorer-sidebar");
  if (!(await explorer.isVisible())) {
    const openExplorer = page.getByRole("button", { name: "Open explorer" });
    if (await openExplorer.isVisible()) {
      await openExplorer.click();
    }
  }
  await expect(explorer).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("explorer-sidebar-tab-changes_tree").click();
  await expect(
    page.getByTestId(/^diff-tree-file-\d+$/).filter({ hasText: "use-mounted-tab-set.ts" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
}

async function openMountedTabDiffFromTree(page: Page): Promise<void> {
  await page
    .getByTestId(/^diff-tree-file-\d+$/)
    .filter({ hasText: "use-mounted-tab-set.ts" })
    .click();
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
  await openMountedTabDiffFromTree(page);
  await expectExpandedMountedTabDiff(page);
}
