import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { restartTestDaemon } from "../support/helpers/daemon-restart";
import { asRunsSeedClient, removeSeededRunFile, writeSeededRunFile } from "../support/helpers/runs";
import {
  connectSeedClient,
  seedWorkspace,
  type SeedDaemonClient,
} from "../support/helpers/seed-client";
import {
  buildMockPersonality,
  buildTeam,
  connectPersonalitiesClient,
  type E2EAgentPersonality,
  type E2EAgentTeam,
} from "../support/helpers/personalities";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { buildHostWorkspaceRoute, buildRunsRoute } from "../../src/utils/host-routes";
import { moneyShot } from "../support/helpers/evidence";

interface WorkflowLaunchClient {
  close(): Promise<void>;
  getDaemonConfig(): Promise<{
    config: {
      agentProfiles?: E2EAgentPersonality[];
      agentTeams?: { teams?: E2EAgentTeam[]; activeTeamId?: string | null };
    };
  }>;
  patchDaemonConfig(patch: {
    agentProfiles?: E2EAgentPersonality[];
    agentTeams?: { teams?: E2EAgentTeam[]; activeTeamId?: string | null };
  }): Promise<unknown>;
  startWorkflow(input: {
    flavor: "ai";
    cwd: string;
    workspaceId: string;
    title: string;
    prompt: string;
    orchestratorPersonalityId: string;
  }): Promise<{ runId?: string; agentId?: string }>;
  respondToWorkflowStartConfirmation(input: { runId: string; approved: boolean }): Promise<boolean>;
}

/** Clear the seeded run and project through a post-restart client, then close it. */
async function cleanupSeededRunState(client: SeedDaemonClient, projectId: string): Promise<void> {
  await asRunsSeedClient(client)
    .clearFinishedRuns()
    .catch(() => undefined);
  await client.removeProject(projectId).catch(() => undefined);
  await client.close().catch(() => undefined);
}

async function findRunById(client: SeedDaemonClient, runId: string) {
  const snapshot = await asRunsSeedClient(client).getRunsSnapshot();
  return snapshot.find((run) => run.id === runId) ?? null;
}

// The Workflows screen lists durable workflow runs and offers a
// "Visualize" action that opens a run-scoped Visualizer tab in the run's
// workspace. Runs have no client-side create RPC (only the conductor `start_workflow`
// tool makes them), so this spec seeds one deterministically by writing a
// terminal run file into $OTTO_HOME/runs and restarting the isolated daemon -
// RunService.init reloads persisted runs on startup. The restart is safe here:
// the app E2E project runs with workers=1 and helpers/daemon-restart.ts
// preserves the global-setup environment.
test.describe("Runs screen", () => {
  test.describe.configure({ retries: 0, timeout: 240_000 });

  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("lists a persisted Graph Workflow and opens its run-scoped Visualizer tab", async ({
    page,
  }) => {
    const serverId = getServerId();
    // The socket closes before the daemon restart. Make the daemon host own
    // this project until the post-restart cleanup, otherwise the client-owned
    // seed wrapper deletes it as part of close.
    const workspace = await seedWorkspace({
      repoPrefix: "runs-screen-",
      git: false,
      projectOwnership: "host",
    });
    cleanupTasks.push(() => workspace.cleanup());

    const runId = `run_e2e_${Date.now().toString(36)}`;
    const runTitle = `E2E seeded Graph Workflow ${runId}`;
    // Terminal timestamps: createdAt -> updatedAt spans exactly 3m30s so the
    // card's frozen elapsed reads "3m 30s" (formatRunElapsed/formatDuration).
    const createdAtMs = Date.now() - 60 * 60 * 1000;
    const createdAt = new Date(createdAtMs).toISOString();
    const updatedAt = new Date(createdAtMs + 210_000).toISOString();

    await writeSeededRunFile({
      id: runId,
      title: runTitle,
      status: "done",
      kind: "graph",
      graphId: "e2e-graph",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      agentCount: 1,
      createdAt,
      updatedAt,
      phases: [
        {
          id: "phase-research",
          type: "agent",
          title: "Research the change",
          task: "Make the seeded change.",
          status: "done",
          candidates: [{ agentId: "agent-e2e-run-candidate" }],
          startedAt: createdAt,
          completedAt: updatedAt,
        },
        {
          id: "phase-gate",
          type: "gate",
          title: "Approve the change",
          task: "Review the proposed change.",
          status: "done",
          startedAt: createdAt,
          completedAt: updatedAt,
        },
        {
          id: "phase-check",
          type: "check",
          title: "Verify the change",
          task: "Check the seeded change.",
          status: "done",
          startedAt: createdAt,
          completedAt: updatedAt,
        },
      ],
    });
    cleanupTasks.push(() => removeSeededRunFile(runId));

    // Bounce the isolated daemon so RunService loads the seeded run, closing
    // the seed connection first (it reconnects fresh below for cleanup).
    await workspace.client.close().catch(() => undefined);
    await restartTestDaemon();
    const client = await connectSeedClient();
    cleanupTasks.push(() => cleanupSeededRunState(client, workspace.projectId));

    // Deterministic gate: the restarted daemon serves the seeded run.
    const snapshot = await asRunsSeedClient(client).getRunsSnapshot();
    expect(snapshot.map((run) => run.id)).toContain(runId);
    // The browser can only render this Workflow if the project/workspace also
    // survived the restart. Keep this daemon fact separate from the UI wait so
    // a regression names the lost layer directly.
    const restartedWorkspaces = await client.fetchWorkspaces();
    expect(restartedWorkspaces.entries.map((entry) => entry.id)).toContain(workspace.workspaceId);

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildRunsRoute());

    // The card distinguishes a declared Graph from an AI Workflow and exposes
    // its completed agent, gate, and deterministic Check history.
    await expect(page.getByText("Workflows", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    const runsList = page.getByTestId("runs-list");
    await expect(runsList).toBeVisible({ timeout: 30_000 });
    await expect(runsList).toContainText(runTitle);
    await expect(runsList).toContainText("Completed");
    await expect(runsList).toContainText("1 agent");
    await expect(runsList).toContainText("1 gate");
    await expect(runsList).toContainText("Graph");
    await expect(runsList).toContainText("Research the change");
    await expect(runsList).toContainText("Approve the change");
    await expect(runsList).toContainText("Verify the change");
    await expect(runsList).toContainText("agent");
    await expect(runsList).toContainText("gate");
    await expect(runsList).toContainText("check");
    await expect(runsList).toContainText("3m 30s");

    // Visualize is the card's primary press (the kebab repeats it): it opens (or
    // focuses) the run-scoped Visualizer tab in the run's workspace layout and
    // routes there, then the workspace tab row shows it. The hop stays
    // client-side so the in-memory layout store is preserved.
    const runCard = page.getByTestId(`run-card-${runId}`);
    await expect(runCard).toBeVisible({ timeout: 30_000 });
    await runCard.click();

    // Pressing the card carries the user into the run's workspace: Workflows
    // is an app-wide screen, so opening the tab without navigating would be
    // invisible until the user switched workspaces by hand.
    await expectAppRoute(page, buildHostWorkspaceRoute(serverId, workspace.workspaceId), {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("keeps canceled Graph history separate from failures, with its reason and skipped work", async ({
    page,
  }) => {
    const serverId = getServerId();
    const workspace = await seedWorkspace({
      repoPrefix: "runs-canceled-",
      git: false,
      projectOwnership: "host",
    });
    cleanupTasks.push(() => workspace.cleanup());
    const runId = `run_canceled_${Date.now().toString(36)}`;
    const title = `E2E canceled Graph Workflow ${runId}`;
    const timestamp = new Date().toISOString();
    await writeSeededRunFile({
      id: runId,
      title,
      status: "canceled",
      error: 'Rejected at gate "Review change": Needs a security review.',
      kind: "graph",
      graphId: "e2e-canceled-graph",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      phases: [
        {
          id: "review",
          type: "gate",
          title: "Review change",
          task: "Review the change before it continues.",
          status: "canceled",
          notes: "Rejected at gate.",
          completedAt: timestamp,
        },
        {
          id: "deliver",
          type: "agent",
          title: "Deliver the change",
          task: "Deliver the change.",
          status: "skipped",
          notes: 'Every node feeding "Deliver the change" was skipped.',
          completedAt: timestamp,
        },
      ],
    });
    cleanupTasks.push(() => removeSeededRunFile(runId));
    await workspace.client.close().catch(() => undefined);
    await restartTestDaemon();
    const client = await connectSeedClient();
    cleanupTasks.push(() => cleanupSeededRunState(client, workspace.projectId));

    await expect
      .poll(async () => findRunById(client, runId), { timeout: 30_000 })
      .toMatchObject({
        status: "canceled",
        error: 'Rejected at gate "Review change": Needs a security review.',
        phases: [
          { status: "canceled", notes: "Rejected at gate." },
          { status: "skipped", notes: 'Every node feeding "Deliver the change" was skipped.' },
        ],
      });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildRunsRoute());

    await page.getByTestId("runs-filter-canceled").click();
    const card = page.getByTestId(`run-card-${runId}`);
    await expect(card).toContainText("Canceled");
    await expect(card).toContainText('Rejected at gate "Review change": Needs a security review.');
    await expect(card).toContainText("Review change");
    await expect(card).toContainText("canceled");
    await expect(card).toContainText("Deliver the change");
    await expect(card).toContainText("skipped");
    await expect(card).not.toContainText("Failed");
    await expect(card).toHaveAttribute("aria-label", `Visualize ${title}, Canceled`);

    await card.click();
    // Pressing the card carries the user into the run's workspace: Workflows
    // is an app-wide screen, so opening the tab without navigating would be
    // invisible until the user switched workspaces by hand.
    await expectAppRoute(page, buildHostWorkspaceRoute(serverId, workspace.workspaceId), {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`workspace-tab-visualizer_run_${runId}`)).toBeVisible({
      timeout: 30_000,
    });
    await moneyShot(
      page,
      "Canceled Workflow history retains its reason, skipped downstream work, and run-scoped Visualizer.",
    );
  });

  test("turns an in-flight Graph Workflow into a durable restart failure", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "runs-restart-",
      git: false,
      projectOwnership: "host",
    });
    cleanupTasks.push(() => workspace.cleanup());
    const runId = `run_restart_${Date.now().toString(36)}`;
    const title = `E2E restart Graph Workflow ${runId}`;
    const timestamp = new Date().toISOString();
    await writeSeededRunFile({
      id: runId,
      title,
      status: "running",
      kind: "graph",
      graphId: "e2e-restart-graph",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      agentCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      phases: [
        {
          id: "worker",
          type: "agent",
          title: "Interrupted worker",
          task: "Work",
          status: "running",
        },
      ],
    });
    cleanupTasks.push(() => removeSeededRunFile(runId));
    await workspace.client.close().catch(() => undefined);
    await restartTestDaemon();
    const client = await connectSeedClient();
    cleanupTasks.push(() => cleanupSeededRunState(client, workspace.projectId));
    await expect
      .poll(
        async () => {
          const run = await findRunById(client, runId);
          return run ? { status: run.status, error: run.error } : null;
        },
        { timeout: 30_000 },
      )
      .toEqual({ status: "failed", error: "Daemon restarted while this Workflow was in flight." });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildRunsRoute());
    const card = page.getByTestId(`run-card-${runId}`);
    await expect(card).toContainText("Daemon restarted while this Workflow was in flight.");
    await expect(card).toContainText("failed");
  });

  test("turns a pending AI Workflow into a durable restart failure", async ({ page }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "runs-ai-restart-",
      git: false,
      projectOwnership: "host",
    });
    cleanupTasks.push(() => workspace.cleanup());
    const runId = `run_ai_restart_${Date.now().toString(36)}`;
    const title = `E2E restart AI Workflow ${runId}`;
    const timestamp = new Date().toISOString();
    await writeSeededRunFile({
      id: runId,
      title,
      status: "pending",
      kind: "ai",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      phases: [],
    });
    cleanupTasks.push(() => removeSeededRunFile(runId));
    await workspace.client.close().catch(() => undefined);
    await restartTestDaemon();
    const client = await connectSeedClient();
    cleanupTasks.push(() => cleanupSeededRunState(client, workspace.projectId));
    await expect
      .poll(
        async () => {
          const run = await findRunById(client, runId);
          return run ? { status: run.status, error: run.error } : null;
        },
        { timeout: 30_000 },
      )
      .toEqual({
        status: "failed",
        error: "Daemon restarted while the orchestrator was still planning this Workflow.",
      });
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildRunsRoute());
    const card = page.getByTestId(`run-card-${runId}`);
    await expect(card).toContainText("AI Workflow");
    await expect(card).toContainText(
      "Daemon restarted while the orchestrator was still planning this Workflow.",
    );
  });

  test("records a declared AI Workflow provider failure through the normal client-to-daemon path", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "runs-ai-provider-failure-",
      git: false,
      projectOwnership: "host",
    });
    const client = (await connectPersonalitiesClient()) as unknown as WorkflowLaunchClient;
    const conductor = buildMockPersonality({
      name: "FailureConductor",
      roles: ["orchestrator"],
    });
    const researcher = buildMockPersonality({
      name: "FailureResearcher",
      roles: ["researcher"],
    });
    const team = buildTeam({
      name: "Failure Workflow Team",
      memberIds: [conductor.id, researcher.id],
    });
    const { config } = await client.getDaemonConfig();
    const previousProfiles = config.agentProfiles ?? [];
    const previousTeams = config.agentTeams?.teams ?? [];
    const previousActiveTeamId = config.agentTeams?.activeTeamId ?? null;
    let runId: string | undefined;
    try {
      await client.patchDaemonConfig({
        agentProfiles: [...previousProfiles, conductor, researcher],
        agentTeams: {
          teams: [...previousTeams, team],
          activeTeamId: team.id,
        },
      });

      // This uses the E2E worker's supervisor-owned daemon over WebSocket,
      // rather than the in-process live-orchestration harness. The mock
      // conductor declares its plan, then its real managed mock worker fails.
      const started = await client.startWorkflow({
        flavor: "ai",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "E2E declared provider failure",
        prompt: "Emit a synthetic AI Workflow provider failure.",
        orchestratorPersonalityId: conductor.id,
      });
      runId = started.runId;
      expect(runId).toMatch(/^run_/);
      expect(started.agentId).toBeTruthy();

      // An AI-declared plan now pauses for its daemon-owned start confirmation
      // before the managed worker starts. This failure-path test deliberately
      // approves that confirmation through the normal client RPC, then proves
      // the worker's provider error is retained on the same Workflow.
      await expect
        .poll(
          async () => {
            const run = runId ? await findRunById(workspace.client, runId) : null;
            return run
              ? { status: run.status, startConfirmation: Boolean(run.startConfirmation) }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({ status: "paused", startConfirmation: true });
      if (!runId) {
        throw new Error("AI Workflow start returned no run id.");
      }
      expect(await client.respondToWorkflowStartConfirmation({ runId, approved: true })).toBe(true);

      await expect
        .poll(
          async () => {
            const run = runId ? await findRunById(workspace.client, runId) : null;
            return run
              ? {
                  status: run.status,
                  error: run.error,
                  phaseStatus: run.phases[0]?.status,
                  candidateError: run.phases[0]?.candidates?.[0]?.error,
                }
              : null;
          },
          { timeout: 30_000 },
        )
        .toEqual({
          status: "failed",
          error:
            'Phase "provider-failure" failed: Requested mock provider failure Review the failed phase, correct the underlying provider or configuration issue, then start a new Workflow.',
          phaseStatus: "failed",
          candidateError: "Requested mock provider failure",
        });

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildRunsRoute());
      const card = page.getByTestId(`run-card-${runId}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText("AI Workflow");
      await expect(card).toContainText("Requested mock provider failure");
      await expect(card).toContainText(
        "Review the failed phase, correct the underlying provider or configuration issue, then start a new Workflow.",
      );
      await moneyShot(
        page,
        "the Runs card preserves a declared AI Workflow provider failure and its recovery guidance",
      );
    } finally {
      if (runId) {
        await asRunsSeedClient(workspace.client)
          .clearFinishedRuns()
          .catch(() => undefined);
      }
      await client
        .patchDaemonConfig({
          agentProfiles: previousProfiles,
          agentTeams: {
            teams: previousTeams,
            activeTeamId: previousActiveTeamId,
          },
        })
        .catch(() => undefined);
      await client.close().catch(() => undefined);
      await workspace.cleanup();
    }
  });
});
