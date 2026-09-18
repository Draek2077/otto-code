import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  openGlobalNewWorkspaceComposer,
  selectNewWorkspaceProject,
  selectWorkspaceIsolation,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// Occupied-directory guard. One directory is one physical checkout, so it backs one live
// workspace: the daemon refuses a second visible workspace on an occupied directory
// (`WorkspaceDirectoryOccupiedError`, wire errorCode `workspace_directory_occupied`), and the
// New workspace screen turns that refusal into a choice instead of a dead end - "Open it"
// carries the submission into the workspace already there, "Create a worktree" replays it
// with worktree isolation. See "One directory = one live workspace" in
// docs/workspace-lifecycle.md.
//
// This file used to assert the retired model where two workspaces shared one directory.

type DaemonClient = Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;

async function workspacesBackingDirectory(
  client: DaemonClient,
  directory: string,
): Promise<string[]> {
  const payload = await client.fetchWorkspaces();
  return payload.entries
    .filter((entry) => entry.workspaceDirectory === directory)
    .map((entry) => entry.id);
}

async function submitLocalWorkspaceOnOccupiedDirectory(
  page: Page,
  seeded: SeededWorkspace,
  prompt: string,
): Promise<void> {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await expect(
    page.getByTestId(`sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`),
  ).toBeVisible({ timeout: 30_000 });

  await openGlobalNewWorkspaceComposer(page);
  await selectNewWorkspaceProject(page, {
    projectKey: seeded.projectKey,
    projectDisplayName: seeded.projectDisplayName,
  });
  await selectWorkspaceIsolation(page, "local");
  await submitNewWorkspacePrompt(page, prompt);
}

async function expectOccupiedDirectorySteer(page: Page, seeded: SeededWorkspace): Promise<void> {
  await expect(page.getByText("This folder already has a workspace", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(`This directory already backs the workspace "${seeded.workspaceName}"`),
  ).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-confirm")).toHaveText("Open it");
  await expect(page.getByTestId("confirm-dialog-alternate")).toHaveText("Create a worktree");
}

test.describe("Occupied-directory guard", () => {
  let client: DaemonClient;

  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    await client?.close().catch(() => undefined);
  });

  test("the daemon refuses a second workspace on an occupied directory and names the one there", async () => {
    const seeded = await seedWorkspace({ repoPrefix: "occupied-dir-refused-" });

    try {
      const refused = await seeded.client.createWorkspace({
        source: { kind: "directory", path: seeded.repoPath, projectId: seeded.projectId },
        title: "Second view",
      });

      expect(refused.workspace).toBeNull();
      expect(refused.errorCode).toBe("workspace_directory_occupied");
      expect(refused.error).toContain(
        `This directory already backs the workspace "${seeded.workspaceName}"`,
      );
      expect(await workspacesBackingDirectory(client, seeded.workspaceDirectory)).toEqual([
        seeded.workspaceId,
      ]);
    } finally {
      await seeded.cleanup();
    }
  });

  test("Open it carries the submission into the workspace already on the directory", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "occupied-dir-open-" });
    const prompt = "Continue in the workspace that already owns this folder";

    try {
      await submitLocalWorkspaceOnOccupiedDirectory(page, seeded, prompt);
      await expectOccupiedDirectorySteer(page, seeded);

      await page.getByTestId("confirm-dialog-confirm").click();

      await expect(page).toHaveURL(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId("user-message").filter({ hasText: prompt })).toBeVisible({
        timeout: 30_000,
      });
      expect(await workspacesBackingDirectory(client, seeded.workspaceDirectory)).toEqual([
        seeded.workspaceId,
      ]);
    } finally {
      await seeded.cleanup();
    }
  });

  test("Create a worktree replays the submission in a worktree of its own", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "occupied-dir-worktree-" });
    let worktreeDirectory: string | null = null;

    try {
      await submitLocalWorkspaceOnOccupiedDirectory(page, seeded, "Work on an independent branch");
      await expectOccupiedDirectorySteer(page, seeded);

      await page.getByTestId("confirm-dialog-alternate").click();

      const worktree = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId: getServerId(),
        client,
        previousWorkspaceId: seeded.workspaceId,
        projectDisplayName: seeded.projectDisplayName,
        assertSidebarRow: true,
        assertHeader: false,
      });
      worktreeDirectory = worktree.workspaceDirectory;

      expect(worktree.workspaceDirectory).not.toBe(seeded.workspaceDirectory);
      const descriptor = (await client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === worktree.workspaceId,
      );
      expect(descriptor?.workspaceKind).toBe("worktree");
      expect(await workspacesBackingDirectory(client, seeded.workspaceDirectory)).toEqual([
        seeded.workspaceId,
      ]);
    } finally {
      if (worktreeDirectory) {
        await client
          .archiveOttoWorktree({ worktreePath: worktreeDirectory })
          .catch(() => undefined);
      }
      await seeded.cleanup();
    }
  });
});
