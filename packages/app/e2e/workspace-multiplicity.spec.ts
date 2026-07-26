import { test, expect, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  openGlobalNewWorkspaceComposer,
  selectNewWorkspaceProject,
  selectWorkspaceIsolation,
  submitNewWorkspaceEmpty,
} from "./helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

// A workspace is the unit, and its isolation (local checkout or worktree) is a CHOICE at
// creation. This spec drives the real creation UI (workspace-create-* test IDs).
//
// It used to also prove that one directory could back any number of workspaces. That is no
// longer the product: `createLocalCheckoutWorkspace` refuses a second *visible* workspace on an
// occupied directory and steers the user to a worktree instead — see the settled policy in
// docs/workspace-lifecycle.md. Those two tests were removed rather than rewritten, because there
// is no longer any wire path that mints the duplicate they asserted.

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function createWorkspaceViaUi(
  page: Page,
  input: {
    project: { projectKey: string; projectDisplayName: string };
    // null when the project has no git checkout: there is no Isolation control to
    // touch, the isolation is implicitly local.
    isolation: "local" | "worktree" | null;
    previousWorkspaceId: string;
    client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  },
): Promise<{ workspaceId: string; workspaceName: string; workspaceDirectory: string }> {
  await openGlobalNewWorkspaceComposer(page);
  await selectNewWorkspaceProject(page, input.project);
  if (input.isolation !== null) {
    await selectWorkspaceIsolation(page, input.isolation);
  }
  await submitNewWorkspaceEmpty(page);

  return assertNewWorkspaceSidebarAndHeader(page, {
    serverId: getServerId(),
    client: input.client,
    previousWorkspaceId: input.previousWorkspaceId,
    projectDisplayName: input.project.projectDisplayName,
    assertSidebarRow: false,
    assertHeader: false,
  });
}

test.describe("Workspace multiplicity creation flow", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    await client?.close().catch(() => undefined);
  });

  test("New worktree isolation creates a worktree-backed workspace in a distinct directory", async ({
    page,
  }) => {
    const seeded: SeededWorkspace = await seedWorkspace({
      repoPrefix: "multiplicity-worktree-",
    });

    try {
      const project = {
        projectKey: seeded.projectId,
        projectDisplayName: seeded.projectDisplayName,
      };

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(page.getByTestId(workspaceRowTestId(seeded.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      const worktree = await createWorkspaceViaUi(page, {
        project,
        isolation: "worktree",
        previousWorkspaceId: seeded.workspaceId,
        client,
      });

      // The worktree row appears, pointing at a directory distinct from the
      // local checkout.
      const worktreeRow = page.getByTestId(workspaceRowTestId(worktree.workspaceId));
      await expect(worktreeRow).toBeVisible({ timeout: 30_000 });
      expect(worktree.workspaceId).not.toBe(seeded.workspaceId);
      expect(worktree.workspaceDirectory).not.toBe(seeded.workspaceDirectory);

      // The daemon descriptor confirms the worktree kind (○ row).
      const descriptor = (await client.fetchWorkspaces()).entries.find(
        (entry) => entry.id === worktree.workspaceId,
      );
      expect(descriptor?.workspaceKind).toBe("worktree");

      await client
        .archiveOttoWorktree({ worktreePath: worktree.workspaceDirectory })
        .catch(() => undefined);
    } finally {
      await seeded.cleanup();
    }
  });
});
