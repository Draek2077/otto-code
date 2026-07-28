import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  addProjectViaDaemon,
  archiveLocalWorkspaceFromDaemon,
  archiveWorkspaceFromDaemon,
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  expectNewWorkspaceProjectSelected,
  openGlobalNewWorkspaceComposer,
  openProjectViaDaemon,
  selectNewWorkspaceProject,
  submitNewWorkspacePrompt,
} from "./helpers/new-workspace";
import {
  buildMockPersonality,
  connectPersonalitiesClient,
  MOCK_MODEL_ID,
  MOCK_PROVIDER_ID,
  openModelPersonalityPicker,
  removePersonalitiesById,
  seedPersonalities,
  selectPersonalityUntilBound,
  uniquePersonalityName,
  waitForAgentInWorkspace,
  waitForAgentSnapshot,
} from "./helpers/personalities";
import { getServerId } from "./helpers/server-id";
import { createTempGitRepo } from "./helpers/workspace";
import { switchWorkspaceViaSidebar, waitForSidebarHydration } from "./helpers/workspace-ui";

// Regression: a draft submitted from the NEW-WORKSPACE composer auto-submits
// inside the freshly created workspace's own draft tab. The personality picked
// in the originating composer rides the pending submission (autoSubmitConfig),
// not the destination tab's picker state — resolveDraftPersonality
// (workspace-tab-core.ts) once read the destination picker and dropped it.
test.describe("Personality survives new-workspace auto-submit", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a personality picked before Create is bound to the auto-submitted agent", async ({
    page,
  }) => {
    const serverId = getServerId();
    const client = await connectPersonalitiesClient();
    const nwClient = await connectNewWorkspaceDaemonClient();
    const personality = buildMockPersonality({
      name: uniquePersonalityName("E2eAuto"),
      prompt: "You are the auto-submit regression e2e personality.",
    });
    const repo = await createTempGitRepo("personality-autosubmit-");
    // A SECOND repo, registered as a project but never backed by a workspace.
    // The composer refuses to create a workspace on a directory that already
    // backs one, and opening `repo` backs it with "main" — so the create must
    // target this workspace-free project instead.
    const targetRepo = await createTempGitRepo("personality-autosubmit-target-");
    let openedProjectWorkspaceId: string | null = null;
    let openedProjectKey: string | null = null;
    let targetProjectKey: string | null = null;
    let createdWorkspaceDirectory: string | null = null;

    try {
      await seedPersonalities(client, [personality]);
      const openedProject = await openProjectViaDaemon(nwClient, repo.path);
      openedProjectWorkspaceId = openedProject.workspaceId;
      openedProjectKey = openedProject.projectKey;
      const targetProject = await addProjectViaDaemon(nwClient, targetRepo.path);
      targetProjectKey = targetProject.projectKey;

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId,
        workspaceId: openedProject.workspaceId,
      });

      await openGlobalNewWorkspaceComposer(page);
      await expectNewWorkspaceProjectSelected(page, openedProject.projectDisplayName);
      await selectNewWorkspaceProject(page, targetProject);

      // Pick the personality in the ORIGINATING composer, then Create with a
      // prompt so the created workspace's draft tab auto-submits.
      await openModelPersonalityPicker(page);
      await selectPersonalityUntilBound(page, personality);

      await submitNewWorkspacePrompt(page, "Personality autosubmit e2e");

      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        client: nwClient,
        previousWorkspaceId: openedProject.workspaceId,
        projectDisplayName: targetProject.projectDisplayName,
        assertSidebarRow: false,
        assertHeader: false,
      });
      createdWorkspaceDirectory = createdWorkspace.workspaceDirectory;
      expect(createdWorkspace.workspaceId).not.toBe(openedProject.workspaceId);

      // The auto-submitted agent must still carry the personality identity.
      const created = await waitForAgentInWorkspace(client, createdWorkspace.workspaceId);
      const agent = await waitForAgentSnapshot(
        client,
        created.id,
        (snapshot) => snapshot.personalityId === personality.id,
      );
      expect(agent.provider).toBe(MOCK_PROVIDER_ID);
      expect(agent.model).toBe(MOCK_MODEL_ID);
      expect(agent.personalityName).toBe(personality.name);
    } finally {
      if (createdWorkspaceDirectory) {
        await archiveWorkspaceFromDaemon(nwClient, createdWorkspaceDirectory).catch(
          () => undefined,
        );
      }
      if (openedProjectWorkspaceId) {
        await archiveLocalWorkspaceFromDaemon(nwClient, openedProjectWorkspaceId).catch(
          () => undefined,
        );
      }
      if (openedProjectKey) {
        await nwClient.removeProject(openedProjectKey).catch(() => undefined);
      }
      if (targetProjectKey) {
        await nwClient.removeProject(targetProjectKey).catch(() => undefined);
      }
      await removePersonalitiesById(client, [personality.id]).catch(() => undefined);
      await nwClient.close().catch(() => undefined);
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
      await targetRepo.cleanup().catch(() => undefined);
    }
  });
});
