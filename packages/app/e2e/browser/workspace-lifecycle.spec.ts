import { test, expect } from "../support/fixtures";
import { connectSeedClient } from "../support/helpers/seed-client";
import { expectWorkspaceAbsentFromSidebar } from "../support/helpers/sidebar"; // OTTO(workspace-lifecycle)
import {
  createAgentChatFromLauncher,
  createStandaloneTerminalFromLauncher,
  expectTerminalCwd,
  submitAgentChatAndExpectCwd,
} from "../support/helpers/workspace-lifecycle";

async function findPlacement(
  client: Awaited<ReturnType<typeof connectSeedClient>>,
  agentId: string,
) {
  const agents = await client.fetchAgents({ scope: "active" });
  const moved = agents.entries.find(({ agent }) => agent.id === agentId)?.agent;
  return moved && { workspaceId: moved.workspaceId, cwd: moved.cwd };
}

test.describe("Workspace lifecycle", () => {
  // The first test after a spec-file switch can intermittently fail because
  // the shared daemon still holds stale sessions from the previous spec.
  // One retry is enough for the daemon to stabilize.
  test.describe.configure({ retries: 1 });

  test("main checkout creates an agent chat and terminal in the project root", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "lifecycle-main-" });
    await workspace.navigateTo();

    await test.step("submitting a draft creates an agent in the project root", async () => {
      await createAgentChatFromLauncher(page);
      await submitAgentChatAndExpectCwd(page, workspace);
    });

    await test.step("creates a terminal in the project root", async () => {
      await createStandaloneTerminalFromLauncher(page);
      await expectTerminalCwd(page, workspace.repoPath);
    });
  });

  // OTTO(workspace-lifecycle): a move preserves the agent session and its checkout.
  test("moves a chat from its tab without moving its transcript or working directory", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const source = await withWorkspace({ prefix: "move-chat-source-" });
    const destination = await withWorkspace({ prefix: "move-chat-target-" });
    await source.navigateTo();
    await createAgentChatFromLauncher(page);
    await submitAgentChatAndExpectCwd(page, source);
    const client = await connectSeedClient();
    try {
      const snapshot = await client.fetchAgents({ scope: "active" });
      const entry = snapshot.entries.find(({ agent }) => agent.workspaceId === source.workspaceId);
      if (!entry) throw new Error("Fixture chat was not created.");
      const agentId = entry.agent.id;
      const tab = page.getByTestId(`workspace-tab-agent_${agentId}`).first();
      await tab.click({ button: "right" });
      await page.getByTestId(/^workspace-tab-context-.*-move-chat$/).click();
      const picker = page.getByTestId("otto-workspace-move");
      await picker.getByTestId(`otto-workspace-choice-${destination.workspaceId}`).click();
      await expect
        .poll(() => findPlacement(client, agentId))
        .toEqual({ workspaceId: destination.workspaceId, cwd: source.repoPath });
      await expect(picker).toHaveCount(0);
      await expect(page.getByText("cwd draft create", { exact: true }).first()).toBeVisible();
    } finally {
      await client.close();
    }
  });

  // OTTO(workspace-lifecycle): exercise the archived record through the real Git checkout.
  test("reopens an archived worktree with the original workspace ID", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ worktree: true, prefix: "reopen-worktree-" });
    await workspace.navigateTo();
    const client = await connectSeedClient();
    try {
      expect((await client.archiveWorkspace(workspace.workspaceId)).error).toBeNull();
      await expectWorkspaceAbsentFromSidebar(page, workspace.workspaceId);
      await page
        .getByTestId(/^sidebar-project-row-/)
        .first()
        .click({ button: "right" });
      await page.getByTestId(/^sidebar-project-menu-reopen-/).click();
      const picker = page.getByTestId("otto-workspace-reopen");
      await picker.getByTestId(`otto-workspace-choice-${workspace.workspaceId}`).click();
      await expect(picker).toHaveCount(0);
      await expect(
        page.getByTestId(new RegExp(`^sidebar-workspace-row-.*:${workspace.workspaceId}$`)),
      ).toBeVisible();
    } finally {
      await client.close();
    }
  });

  test("worktree creates an agent chat and terminal in its directory", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ worktree: true, prefix: "lifecycle-wt-" });
    await workspace.navigateTo();

    await test.step("creates an agent chat", async () => {
      await createAgentChatFromLauncher(page);
    });

    await test.step("creates a terminal in the worktree", async () => {
      await createStandaloneTerminalFromLauncher(page);
      await expectTerminalCwd(page, workspace.repoPath);
    });
  });
});
