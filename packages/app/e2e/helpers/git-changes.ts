import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { connectDaemonClient } from "./daemon-client-loader";
import { getServerId } from "./server-id";
import { waitForWorkspaceTabsVisible } from "./workspace-tabs";

/** Runs git against the fixture repo and returns trimmed stdout. */
export function gitOutput(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args])
    .toString()
    .trim();
}

/** A changed-file row in the Changes list (testID `diff-file-N`) containing `fileName`. */
export function fileRowContaining(page: Page, fileName: string): Locator {
  return page.getByTestId(/^diff-file-\d+$/).filter({ hasText: fileName });
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
  // Idempotent: only open the explorer if it isn't already showing its tabs
  // (callers may re-open the Changes view within one test after a reload).
  const changesTab = page.getByTestId("explorer-tab-changes");
  if (!(await changesTab.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open explorer" }).click();
  }
  await expect(changesTab).toBeVisible({ timeout: 30_000 });
  await changesTab.click();
  await expect(page.getByText(input.expectFileName)).toBeVisible({ timeout: 30_000 });
}

/**
 * Minimal typed view over the daemon client for reading/patching mutable
 * daemon config out of band (e.g. seeding an Agent Personality roster so
 * writer-agent resolution is deterministic regardless of which provider CLIs
 * exist on the machine).
 */
export interface DaemonConfigClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(requestId?: string): Promise<{
    requestId: string;
    config: {
      agentPersonalities?: { personalities?: Array<Record<string, unknown>> };
    };
  }>;
  patchDaemonConfig(
    config: Record<string, unknown>,
    requestId?: string,
  ): Promise<{ requestId: string; config: unknown }>;
}

export async function connectDaemonConfigClient(): Promise<DaemonConfigClient> {
  return connectDaemonClient<DaemonConfigClient>({ clientIdPrefix: "git-changes-config" });
}
