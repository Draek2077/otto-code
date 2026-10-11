import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { buildHostWorkspaceRoute } from "../../../src/utils/host-routes";
import { connectDaemonClient } from "./daemon-client-loader";
import { getServerId } from "./server-id";
import { openChangesTreePanel, waitForWorkspaceTabsVisible } from "./workspace-tabs";
import type { SeededWorkspace } from "./seed-client";

/** Commit through the real daemon without invoking its AI message generator. */
export async function commitFixtureFiles(
  workspace: Pick<SeededWorkspace, "repoPath" | "client">,
  paths: string[],
  message: string,
): Promise<string> {
  const result = await workspace.client.checkoutGitCommit(workspace.repoPath, { paths, message });
  expect(result.error).toBeNull();
  expect(result.success).toBe(true);
  expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
  return result.commitSha!;
}

/**
 * A changed file's header inside the Changes panel. Headers are painted on the
 * diff canvas, so they carry no DOM text: the file is identified by the
 * header's accessible name (`src/alpha.ts, +1, -1`).
 */
export function changedTreeFile(page: Page, fileName: string): Locator {
  return fileRowContaining(page, fileName, page.getByTestId("changes-tree-panel"));
}

/** Runs git against the fixture repo and returns trimmed stdout. */
export function gitOutput(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args])
    .toString()
    .trim();
}

/**
 * A changed file in the Changes panel whose path contains `fileName`: either a
 * header of the inline diff (testID `diff-file-N`) or a row of the file-only
 * tree (`diff-tree-file-N`). Inline-diff headers are painted on the canvas and
 * expose the path only through their accessible name, never as text, so they
 * are matched by label; tree rows render the name as text.
 */
export function fileRowContaining(
  page: Page,
  fileName: string,
  scope: Page | Locator = page,
): Locator {
  const inlineHeader = scope.getByTestId(/^diff-file-\d+$/).and(page.getByLabel(fileName));
  const treeRow = scope.getByTestId(/^diff-tree-file-\d+$/).filter({ hasText: fileName });
  return inlineHeader.or(treeRow);
}

/** Boots the app at the workspace route on a desktop viewport and waits for the tab row. */
export async function openWorkspaceScreen(page: Page, workspaceId: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspaceId));
  await waitForWorkspaceTabsVisible(page);
}

/**
 * Opens the workspace, expands the explorer sidebar, switches to the Changes
 * tab, and waits for the given changed file to render in the list.
 */
export async function openWorkspaceChanges(
  page: Page,
  input: { workspaceId: string; expectFileName: string },
): Promise<void> {
  await openWorkspaceScreen(page, input.workspaceId);
  await openChangesTreePanel(page);
  await expect(fileRowContaining(page, input.expectFileName).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Minimal typed view over the daemon client for reading/patching mutable
 * daemon config out of band (e.g. seeding an agent profile roster so
 * writer-agent resolution is deterministic regardless of which provider CLIs
 * exist on the machine).
 */
export interface DaemonConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(requestId?: string): Promise<{
    requestId: string;
    config: Pick<MutableDaemonConfig, "agentProfiles" | "metadataGeneration">;
  }>;
  patchDaemonConfig(
    config: Record<string, unknown>,
    requestId?: string,
  ): Promise<{ requestId: string; config: unknown }>;
}

export async function connectDaemonConfigClient(): Promise<DaemonConfigClient> {
  return connectDaemonClient<DaemonConfigClient>({ clientIdPrefix: "git-changes-config" });
}
