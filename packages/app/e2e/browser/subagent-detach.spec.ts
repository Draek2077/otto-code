import { expect, test } from "../support/fixtures";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { expectAgentTabActive } from "../support/helpers/launcher";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { seedAppSettings } from "../support/helpers/settings";
import {
  detachSubagentFromTrack,
  expectSubagentRowGone,
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithSubagent,
} from "../support/helpers/subagents";

test.describe("Subagent detach", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subagent-detach-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("detaching a subagent focuses it as a workspace tab", async ({ page }) => {
    await seedAppSettings(page, { subagentTrackPresentation: "panels" });
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Detach parent",
      childTitle: "Detached child",
    });

    await openAgentRoute(page, {
      workspaceId: agents.workspaceId,
      agentId: agents.parent.id,
    });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, agents.child.id);

    await detachSubagentFromTrack(page, agents.child.id);

    await expectWorkspaceTabVisible(page, agents.child.id);
    await expectAgentTabActive(page, agents.child.id);

    // Detach's other half: the parent's track stops listing the child. Assert it
    // on the parent tab rather than page-wide. Detaching focuses the child, so
    // the parent's pane is inactive by the time the old page-wide count ran, and
    // an inactive pane does not re-render - its stale row stayed in the DOM even
    // though the store had already dropped the parent link (probed: null right
    // after the detach and still null 3s later). The assertion was measuring a
    // pane nobody can see; this measures the one the user comes back to.
    await openAgentRoute(page, {
      workspaceId: agents.workspaceId,
      agentId: agents.parent.id,
    });
    await expectSubagentRowGone(page, agents.child.id);
  });

  test("the pill presentation opens and detaches a subagent", async ({ page }) => {
    await seedAppSettings(page, { subagentTrackPresentation: "pills" });
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Pill detach parent",
      childTitle: "Pill detached child",
    });

    await openAgentRoute(page, {
      workspaceId: agents.workspaceId,
      agentId: agents.parent.id,
    });
    await expect(page.getByTestId("subagents-pill-track")).toBeVisible();
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, agents.child.id);

    await detachSubagentFromTrack(page, agents.child.id);

    await expectWorkspaceTabVisible(page, agents.child.id);
    await expectAgentTabActive(page, agents.child.id);
  });
});
