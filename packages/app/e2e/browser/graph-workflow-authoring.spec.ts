import { expect, test } from "../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { asRunsSeedClient } from "../support/helpers/runs";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { moneyShot } from "../support/helpers/evidence";
import { buildHostWorkspaceRoute, buildRunsRoute } from "../../src/utils/host-routes";

async function findRunByTitle(title: string, client: SeedDaemonClient) {
  const runs = await asRunsSeedClient(client).getRunsSnapshot();
  return runs.find((candidate) => candidate.title === title) ?? null;
}

async function hasActiveAgentTitled(title: string, client: SeedDaemonClient): Promise<boolean> {
  const agents = await client.fetchAgents({ scope: "active" });
  return agents.entries.some((entry) => entry.agent.title === title);
}

async function connectGraphPorts(page: Page, from: Locator, to: Locator): Promise<void> {
  const sourceBox = await from.boundingBox();
  const targetBox = await to.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Graph port not visible.");
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function openAgentAdvanced(agent: Locator): Promise<void> {
  await agent.locator(".og-adv > summary").evaluate((summary) => (summary as HTMLElement).click());
}

// This is the smallest real Graph Workflow journey: select a project, create
// a graph draft, configure one explicit fake-backed worker, and complete its
// durable run. It uses no credentials or paid model calls.
test.describe("Graph Workflow authoring", () => {
  test.describe.configure({ retries: 0, timeout: 180_000 });

  test("authors and launches one deterministic agent in the selected workspace", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-authoring-",
      git: false,
      projectOwnership: "host",
    });
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());

      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();

      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill("E2E graph draft");
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves graph authoring resolves the selected workspace.");

      await page.getByTestId("workflow-project-trigger").click();
      // The project selector is portaled above the sheet; the final exact
      // match is its option, after the same project label in the sidebar.
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();

      // The regression used to synthesize a "Project root" target because it
      // compared the host workspace's projectId with a cross-host projectKey.
      // A real workspace here is the prerequisite for opening the designer.
      await expect(page.getByTestId("workflow-workspace-trigger")).toContainText(
        workspace.workspaceName,
      );
      await expect(page.getByTestId("workflow-model-trigger")).toContainText("Ten second stream", {
        timeout: 30_000,
      });

      await page.getByTestId("new-workflow-submit").click();

      await expect(page.getByTestId("graph-add-agent")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("graph-save")).toBeVisible();
      await expect(page.getByTestId("graph-run")).toBeVisible();

      // Explicit model override makes the graph self-contained: no active
      // team role holder, credentials, or network provider is needed.
      await page.getByTestId("graph-add-agent").click();
      const agentNode = page.locator(".og-node:not(.og-node-root)").last();
      await expect(agentNode).toBeVisible();
      await expect(page.getByTestId("graph-validation")).toContainText(
        'Node "Agent 1" has no prompt and no prompt input.',
      );
      await agentNode.locator('[data-og-field="prompt"]').fill("Return a concise project summary.");
      await expect(page.getByTestId("graph-validation")).toHaveCount(0);
      await agentNode.locator(".og-adv > summary").click();
      await agentNode.locator('[data-og-field="model"]').fill("mock/ten-second-stream");

      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("new-workflow-submit")).toHaveText("Run");
      await page.getByTestId("new-workflow-submit").click();

      // The daemon snapshot is the deterministic execution gate. The browser
      // remains responsible for rendering the same durable record afterward.
      let runId = "";
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle("E2E graph draft", workspace.client);
            runId = run?.id ?? "";
            if (run?.status === "failed" || run?.status === "canceled") {
              throw new Error(`Graph Workflow ended ${run.status} before completion.`);
            }
            return run?.status ?? null;
          },
          { timeout: 90_000 },
        )
        .toBe("done");

      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toBeVisible({ timeout: 30_000 });
      await expect(runCard).toContainText("E2E graph draft");
      await expect(runCard).toContainText("Completed");
      await runCard.click();
      // Pressing the card carries the user into the run's workspace: Workflows
      // is an app-wide screen, so opening the tab without navigating would be
      // invisible until the user switched workspaces by hand.
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("pauses a graph at an attended approval gate and resumes from the Workflows library", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-gate-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph approval gate";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());

      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();

      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves attended Graph Workflow approval through the durable library.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await expect(page.getByTestId("workflow-workspace-trigger")).toContainText(
        workspace.workspaceName,
      );

      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-gate")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-gate").click();
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();

      // A gate is an attended control, not an agent. The daemon must persist
      // its pause before the browser is asked to resolve it.
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run ? { status: run.status, agentCount: run.agentCount } : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "paused", agentCount: 0 });

      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toBeVisible({ timeout: 30_000 });
      await expect(runCard).toContainText("Awaiting approval: Approval gate");
      await runCard.getByRole("button", { name: "Approve", exact: true }).click();

      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            if (run?.status === "failed" || run?.status === "canceled") {
              throw new Error(`Gated Graph Workflow ended ${run.status}.`);
            }
            return run?.status ?? null;
          },
          { timeout: 30_000 },
        )
        .toBe("done");
      await expect(runCard).toContainText("Completed");
    } finally {
      if (runId) {
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      }
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("routes a false Check through its declared fail port and persists recovery", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-check-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph false check";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves a false deterministic Check follows only its declared recovery port.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-check")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-check").click();
      const checkNode = page.locator(".og-node.og-node-check").last();
      await checkNode.locator('[data-og-field="checkExpression"]').fill("false");
      await checkNode
        .locator('[data-og-field="checkMessage"]')
        .fill("Deliberate E2E check failure.");
      await page.getByTestId("graph-add-agent").click();
      await page.getByTestId("graph-add-agent").click();
      const agents = page.locator(".drawflow-node.og-agent");
      await agents
        .nth(0)
        .locator('[data-og-field="prompt"]')
        .fill("This pass branch must not run.");
      await openAgentAdvanced(agents.nth(0));
      await agents.nth(0).locator('[data-og-field="model"]').fill("mock/ten-second-stream");
      await agents.nth(1).locator('[data-og-field="prompt"]').fill("Recover the failed check.");
      await openAgentAdvanced(agents.nth(1));
      await agents.nth(1).locator('[data-og-field="model"]').fill("mock/ten-second-stream");
      await connectGraphPorts(
        page,
        page.locator(".drawflow-node.og-check .output_1"),
        agents.nth(0).locator(".input_1"),
      );
      await connectGraphPorts(
        page,
        page.locator(".drawflow-node.og-check .output_2"),
        agents.nth(1).locator(".input_1"),
      );
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run
              ? {
                  status: run.status,
                  agentCount: run.agentCount,
                  checkStatus: run.phases?.[0]?.status,
                  passStatus: run.phases?.[1]?.status,
                  passSkipReason: run.phases?.[1]?.skipReason,
                  recoveryStatus: run.phases?.[2]?.status,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({
          status: "done",
          agentCount: 1,
          checkStatus: "failed",
          passStatus: "skipped",
          passSkipReason: "port",
          recoveryStatus: "done",
        });
      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toBeVisible({ timeout: 30_000 });
      await expect(runCard).toContainText("Deliberate E2E check failure.");
      await expect(runCard).toContainText("Completed");
      await moneyShot(page, "the durable Workflow shows the Check failure recovery completed");
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("rejects an attended approval gate without starting an agent", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-reject-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph rejected gate";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves rejection cancels an attended Graph gate without an agent.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-gate")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-gate").click();
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run ? { status: run.status, agentCount: run.agentCount } : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "paused", agentCount: 0 });
      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toContainText("Awaiting approval: Approval gate");
      await runCard.getByRole("button", { name: "Reject", exact: true }).click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            return run
              ? {
                  status: run.status,
                  agentCount: run.agentCount,
                  phaseStatus: run.phases[0]?.status,
                  error: run.error,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({
          status: "canceled",
          agentCount: 0,
          phaseStatus: "canceled",
          error: 'Rejected at gate "Approval gate".',
        });
      await expect(runCard).toContainText("Canceled");
      await expect(runCard).toContainText('Rejected at gate "Approval gate".');
      await expect(runCard).not.toContainText("Failed");
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("routes a true Check through its declared pass port and persists the skipped fail branch", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-check-pass-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph true check";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves true deterministic checks complete without consuming an agent.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-check")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-check").click();
      await page.getByTestId("graph-add-agent").click();
      await page.getByTestId("graph-add-agent").click();
      const agents = page.locator(".drawflow-node.og-agent");
      await agents.nth(0).locator('[data-og-field="prompt"]').fill("Ship the accepted result.");
      await openAgentAdvanced(agents.nth(0));
      await agents.nth(0).locator('[data-og-field="model"]').fill("mock/ten-second-stream");
      await agents.nth(1).locator('[data-og-field="prompt"]').fill("Repair the rejected result.");
      await openAgentAdvanced(agents.nth(1));
      await agents.nth(1).locator('[data-og-field="model"]').fill("mock/ten-second-stream");
      await connectGraphPorts(
        page,
        page.locator(".drawflow-node.og-check .output_1"),
        agents.nth(0).locator(".input_1"),
      );
      await connectGraphPorts(
        page,
        page.locator(".drawflow-node.og-check .output_2"),
        agents.nth(1).locator(".input_1"),
      );
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run
              ? {
                  status: run.status,
                  agentCount: run.agentCount,
                  checkNotes: run.phases?.[0]?.notes,
                  passStatus: run.phases?.[1]?.status,
                  failStatus: run.phases?.[2]?.status,
                  failSkipReason: run.phases?.[2]?.skipReason,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({
          status: "done",
          agentCount: 1,
          checkNotes: "Check passed: true",
          passStatus: "done",
          failStatus: "skipped",
          failSkipReason: "port",
        });
      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toContainText("Completed");
      await moneyShot(page, "the durable Workflow shows the Check pass branch completed");
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("blocks an invalid deterministic Check before launching an orchestrator", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-invalid-check-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph invalid check";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves invalid graph feedback prevents any workflow launch.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-check")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-check").click();
      const checkNode = page.locator(".og-node.og-node-check").last();
      await checkNode.locator('[data-og-field="checkExpression"]').fill("(");
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();

      await expect(sheet).toContainText(
        'Graph is not executable: The Check "Check output" has an invalid expression:',
      );
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            return run ? { status: run.status, agentCount: run.agentCount } : null;
          },
          { timeout: 10_000 },
        )
        .toEqual({ status: "draft", agentCount: 0 });
      await expect
        .poll(() => hasActiveAgentTitled(title, workspace.client), { timeout: 10_000 })
        .toBe(false);
    } finally {
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("cancels a running Graph Workflow from its Workflows card", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "graph-workflow-cancel-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E graph cancellation";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-graph").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves active Graph work can be canceled from Workflows.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect(page.getByTestId("graph-add-agent")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("graph-add-agent").click();
      const agentNode = page.locator(".og-node:not(.og-node-root)").last();
      await agentNode
        .locator('[data-og-field="prompt"]')
        .fill("Wait for this deterministic worker to be canceled.");
      await agentNode.locator(".og-adv > summary").click();
      await agentNode.locator('[data-og-field="model"]').fill("mock/ten-second-stream");
      await page.getByTestId("graph-run").click();
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run ? { status: run.status, agentCount: run.agentCount } : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "running", agentCount: 1 });
      await page.goto(buildRunsRoute());
      const runCard = page.getByTestId(`run-card-${runId}`);
      await expect(runCard).toBeVisible({ timeout: 30_000 });
      await page.getByTestId(`run-kebab-${runId}`).click();
      await page.getByTestId(`run-menu-cancel-${runId}`).click();
      await expect(page.getByTestId("confirm-dialog")).toContainText("Cancel workflow");
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            return run
              ? {
                  status: run.status,
                  phaseStatus: run.phases[0]?.status,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "canceled", phaseStatus: "canceled" });
      await expect(runCard).toContainText("Canceled");
      await expect(runCard).not.toContainText("Failed");
      await runCard.click();
      // Pressing the card carries the user into the run's workspace: Workflows
      // is an app-wide screen, so opening the tab without navigating would be
      // invisible until the user switched workspaces by hand.
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("creates a durable AI Workflow planning record before its mock planner fails", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "ai-workflow-launch-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E AI workflow planning";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-ai").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves the durable AI Workflow planning record.");
      await page
        .getByTestId("workflow-prompt-input")
        .fill("Do not declare a plan; finish immediately.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run?.status ?? null;
          },
          { timeout: 30_000 },
        )
        .toBe("pending");
      await page.goto(buildRunsRoute());
      const card = page.getByTestId(`run-card-${runId}`);
      await expect(card).toContainText("AI Workflow");
      await expect(card).toContainText("Planning");
      await card.click();
      // Pressing the card carries the user into the run's workspace: Workflows
      // is an app-wide screen, so opening the tab without navigating would be
      // invisible until the user switched workspaces by hand.
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () => (await findRunByTitle(title, workspace.client))?.status ?? null, {
          timeout: 90_000,
        })
        .toBe("failed");
      await page.goto(buildRunsRoute());
      await expect(page.getByTestId(`run-card-${runId}`)).toContainText("failed");
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("confirms a mock-declared AI Workflow, then preserves its attended gate", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "ai-workflow-attended-gate-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E attended AI Workflow";
    let runId = "";
    const runsNamed = async () =>
      (await asRunsSeedClient(workspace.client).getRunsSnapshot()).filter(
        (run) => run.title === title,
      );
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      await expect(page.getByTestId("new-workflow-sheet")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-ai").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves start confirmation preserves the ordinary attended gate.");
      await page
        .getByTestId("workflow-prompt-input")
        .fill("Emit a synthetic attended AI Workflow gate.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();

      await expect
        .poll(
          async () => {
            const matching = await runsNamed();
            const run = matching[0];
            runId = run?.id ?? "";
            return {
              count: matching.length,
              status: run?.status ?? null,
              startConfirmation: Boolean(run?.startConfirmation),
              phase: run?.phases?.[0]?.status ?? null,
            };
          },
          { timeout: 30_000 },
        )
        .toEqual({ count: 1, status: "paused", startConfirmation: true, phase: "pending" });

      await page.goto(buildRunsRoute());
      const card = page.getByTestId(`run-card-${runId}`);
      await expect(card).toContainText("AI Workflow");
      await expect(card).toContainText("Awaiting confirmation");
      await expect(card).toContainText("The AI Workflow declared a plan that will start 0 agents.");
      await page
        .getByTestId(`run-start-confirmation-${runId}`)
        .getByRole("button", {
          name: "Start workflow",
        })
        .click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            return {
              status: run?.status ?? null,
              startConfirmation: Boolean(run?.startConfirmation),
              phase: run?.phases?.[0]?.status ?? null,
            };
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "paused", startConfirmation: false, phase: "blocked" });
      await expect(card).toContainText("Awaiting approval: Review the AI plan");
      await card.click();
      // Pressing the card carries the user into the run's workspace: Workflows
      // is an app-wide screen, so opening the tab without navigating would be
      // invisible until the user switched workspaces by hand.
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
        timeout: 30_000,
      });

      await page.goto(buildRunsRoute());
      await page.getByTestId(`run-card-${runId}`).getByRole("button", { name: "Approve" }).click();
      await expect
        .poll(
          async () => {
            const matching = await runsNamed();
            return {
              count: matching.length,
              id: matching[0]?.id ?? null,
              status: matching[0]?.status ?? null,
            };
          },
          { timeout: 30_000 },
        )
        .toEqual({ count: 1, id: runId, status: "done" });
      await expect(page.getByTestId(`run-card-${runId}`)).toContainText("Completed");
      await moneyShot(
        page,
        "An AI Workflow start confirmation preserves its ordinary attended gate.",
      );
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("rejects a mock-declared AI Workflow start confirmation without creating a second Workflow", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "ai-workflow-attended-rejection-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E rejected AI Workflow start";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      await expect(page.getByTestId("new-workflow-sheet")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-ai").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves start confirmation rejection remains on one durable Workflow record.");
      await page
        .getByTestId("workflow-prompt-input")
        .fill("Emit a synthetic attended AI Workflow gate.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();

      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run
              ? {
                  status: run.status,
                  startConfirmation: Boolean(run.startConfirmation),
                  phase: run.phases?.[0]?.status ?? null,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "paused", startConfirmation: true, phase: "pending" });

      await page.goto(buildRunsRoute());
      const card = page.getByTestId(`run-card-${runId}`);
      await expect(card).toContainText("Awaiting confirmation");
      await page
        .getByTestId(`run-start-confirmation-${runId}`)
        .getByRole("button", {
          name: "Reject",
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            return run ? { id: run.id, status: run.status } : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ id: runId, status: "canceled" });
      await expect(card).toContainText("Canceled");
      await expect(card).not.toContainText("Failed");
      await moneyShot(
        page,
        "An AI Workflow start confirmation keeps one record and cancels after rejection.",
      );
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });

  test("cancels an AI Workflow while its planner is still pending", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "ai-workflow-cancel-",
      git: false,
      projectOwnership: "host",
    });
    const title = "E2E AI workflow cancellation";
    let runId = "";
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const newWorkflow = page
        .getByTestId("runs-empty-new")
        .or(page.getByTestId("runs-new-workflow"))
        .first();
      await expect(newWorkflow).toBeVisible({ timeout: 30_000 });
      await newWorkflow.click();
      const sheet = page.getByTestId("new-workflow-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workflow-flavor-ai").click();
      await page.getByTestId("workflow-name-input").fill(title);
      await page
        .getByTestId("workflow-description-input")
        .fill("Proves AI planning can be canceled from Workflows.");
      await page
        .getByTestId("workflow-prompt-input")
        .fill("Wait for cancellation without declaring a plan.");
      await page.getByTestId("workflow-project-trigger").click();
      await page.getByText(workspace.projectDisplayName, { exact: true }).last().click();
      await page.getByTestId("new-workflow-submit").click();
      await expect
        .poll(
          async () => {
            const run = await findRunByTitle(title, workspace.client);
            runId = run?.id ?? "";
            return run?.status ?? null;
          },
          { timeout: 30_000 },
        )
        .toBe("pending");
      await page.goto(buildRunsRoute());
      await page.getByTestId(`run-kebab-${runId}`).click();
      await page.getByTestId(`run-menu-cancel-${runId}`).click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect
        .poll(async () => (await findRunByTitle(title, workspace.client))?.status ?? null, {
          timeout: 30_000,
        })
        .toBe("canceled");
      const card = page.getByTestId(`run-card-${runId}`);
      await expect(card).toContainText("Canceled");
      await expect(card).not.toContainText("Failed");
    } finally {
      if (runId)
        await asRunsSeedClient(workspace.client)
          .cancelRun(runId)
          .catch(() => undefined);
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await workspace.cleanup();
    }
  });
});
