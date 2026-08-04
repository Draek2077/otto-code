import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  archiveLocalWorkspaceFromDaemon,
  archiveWorkspaceFromDaemon,
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  expectWorkspaceIsolationSelected,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  openStartingRefPicker,
  selectBranchInPicker,
} from "./helpers/new-workspace";
import { expectNoTruncation } from "./helpers/no-truncation";
import { createTempGitRepo, type TempRepo } from "./helpers/workspace";
import { getServerId } from "./helpers/server-id";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

// Regression for "the local / worktree selection in the new workspace is not
// remembered." The isolation choice persists in the create-form preferences
// (FormPreferences.isolation), so it must survive the create→reopen remount:
// creating a worktree workspace navigates away from /new and unmounts it, and
// reopening New Workspace has to still show "New worktree".
test.describe("New workspace isolation memory", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  const localWorkspaceIds = new Set<string>();
  const localProjectIds = new Set<string>();
  const createdWorktreeDirectories = new Set<string>();
  const tempRepos = new Set<TempRepo>();

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  // Order matters and only runs one way: every daemon record goes first, the
  // directories last. Archiving a worktree runs git inside the repo, so doing it
  // after the repo is deleted fails and strands the workspace on a path that no
  // longer exists - which then breaks the *next* spec's composer rather than
  // this one. The repos are removed here, not in the test body, for that reason.
  test.afterEach(async () => {
    if (client) {
      for (const workspaceDirectory of createdWorktreeDirectories) {
        await archiveWorkspaceFromDaemon(client, workspaceDirectory).catch(() => undefined);
      }
      for (const workspaceId of localWorkspaceIds) {
        await archiveLocalWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
      for (const projectId of localProjectIds) {
        await client.removeProject(projectId).catch(() => undefined);
      }
    }
    createdWorktreeDirectories.clear();
    localWorkspaceIds.clear();
    localProjectIds.clear();
    await client?.close().catch(() => undefined);
    for (const repo of tempRepos) {
      await repo.cleanup().catch(() => undefined);
    }
    tempRepos.clear();
  });

  test("remembers the worktree isolation choice after creating a workspace", async ({ page }) => {
    const serverId = getServerId();
    const tempRepo = await createTempGitRepo("isolation-memory-", { branches: ["main", "dev"] });
    tempRepos.add(tempRepo);

    const openedProject = await openProjectViaDaemon(client, tempRepo.path);
    localWorkspaceIds.add(openedProject.workspaceId);
    localProjectIds.add(openedProject.projectId);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    // First visit: the screen opens on Local, switch it to New worktree and create.
    await openNewWorkspaceComposer(page, {
      projectKey: openedProject.projectKey,
      projectDisplayName: openedProject.projectDisplayName,
    });
    await expectWorkspaceIsolationSelected(page, "local");
    await page.getByTestId("workspace-create-isolation-trigger").click();
    const isolationPopup = page.getByTestId("combobox-desktop-container").last();
    await expect(isolationPopup).toBeVisible({ timeout: 30_000 });
    await expectNoTruncation(isolationPopup);
    await page.getByTestId("workspace-create-isolation-worktree").click();
    await expectWorkspaceIsolationSelected(page, "worktree");

    await openStartingRefPicker(page);
    await selectBranchInPicker(page, "dev");

    const createButton = page
      .getByTestId("message-input-root")
      .getByRole("button", { name: "Create" });
    await expect(createButton).toBeVisible({ timeout: 30_000 });
    await createButton.click();

    const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
      serverId,
      client,
      previousWorkspaceId: openedProject.workspaceId,
      projectDisplayName: openedProject.projectDisplayName,
    });
    createdWorktreeDirectories.add(createdWorkspace.workspaceDirectory);

    // Second visit (fresh mount of /new): the worktree choice must stick.
    await openNewWorkspaceComposer(page, {
      projectKey: openedProject.projectKey,
      projectDisplayName: openedProject.projectDisplayName,
    });
    await expectWorkspaceIsolationSelected(page, "worktree");
  });
});
