import { rm } from "node:fs/promises";
import path from "node:path";
import type {
  OrchestrationGraph,
  WorkflowGraphExport,
  WorkflowGraphImportResult,
} from "@otto-code/protocol/workflow";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { moneyShot } from "../support/helpers/evidence";
import { asRunsSeedClient } from "../support/helpers/runs";
import { asScheduleSeedClient, deleteScheduleById, latestRun } from "../support/helpers/schedules";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildRunsRoute, buildSchedulesRoute } from "../../src/utils/host-routes";

interface WorkflowGraphSeedClient extends SeedDaemonClient {
  saveOrchestrationGraph(graph: OrchestrationGraph): Promise<OrchestrationGraph>;
  exportWorkflowGraph(graphId: string): Promise<WorkflowGraphExport>;
  importWorkflowGraph(input: {
    cwd: string;
    export: WorkflowGraphExport;
    confirmed: boolean;
  }): Promise<WorkflowGraphImportResult>;
  listProjectWorkflowGraphs(cwd: string): Promise<OrchestrationGraph[]>;
}

function asWorkflowGraphSeedClient(client: SeedDaemonClient): WorkflowGraphSeedClient {
  return client as WorkflowGraphSeedClient;
}

function deterministicCheckGraph(input: { id: string; name: string }): OrchestrationGraph {
  return {
    id: input.id,
    name: input.name,
    description: "A deterministic saved Graph used to prove Schedule execution.",
    nodes: [
      { id: "root", kind: "orchestrator", title: "Orchestrator" },
      {
        id: "check",
        kind: "check",
        title: "Deterministic schedule check",
        check: { expression: "true", message: "The deterministic check did not pass." },
      },
    ],
    edges: [],
  };
}

async function importProjectGraph(input: {
  client: WorkflowGraphSeedClient;
  cwd: string;
  graph: OrchestrationGraph;
}): Promise<OrchestrationGraph> {
  await input.client.saveOrchestrationGraph(input.graph);
  const exported = await input.client.exportWorkflowGraph(input.graph.id);
  const reviewed = await input.client.importWorkflowGraph({
    cwd: input.cwd,
    export: exported,
    confirmed: false,
  });
  expect(reviewed.status).toBe("review_required");
  const imported = await input.client.importWorkflowGraph({
    cwd: input.cwd,
    export: exported,
    confirmed: true,
  });
  expect(imported.status).toBe("imported");
  if (!imported.graph) {
    throw new Error(`Workflow Graph ${input.graph.id} was not returned after import.`);
  }
  return imported.graph;
}

async function selectProject(page: Parameters<typeof gotoAppShell>[0], projectKey: string) {
  await page.getByRole("button", { name: /select project/i }).click();
  await page.getByTestId(`schedule-project-option-${projectKey}`).click();
}

async function workflowRunProjection(client: SeedDaemonClient, runId: string) {
  const run = (await asRunsSeedClient(client).getRunsSnapshot()).find(
    (candidate) => candidate.id === runId,
  );
  return run
    ? {
        status: run.status,
        graphId: run.graphId,
        scheduleSource: run.scheduleSource,
      }
    : null;
}

async function scheduledWorkflowCount(client: SeedDaemonClient, scheduleRunId: string) {
  const runs = await asRunsSeedClient(client).getRunsSnapshot();
  return runs.filter((run) => run.scheduleSource?.scheduleRunId === scheduleRunId).length;
}

// The Schedule target is a project-store Graph, not a prompt or a legacy graph
// id. This covers the full browser T1 boundary: eligible picker -> durable
// scheduled launch -> linked Workflow inspection, followed by a missing-target
// repair pause. The deterministic Check never calls a real provider.
test.describe("Saved Workflow Schedule", () => {
  test.describe.configure({ retries: 0, timeout: 180_000 });

  test("selects only a project-store Graph, links its durable Workflow, and pauses for repair", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "schedule-saved-workflow-",
      git: false,
      projectOwnership: "host",
    });
    const foreignWorkspace = await seedWorkspace({
      repoPrefix: "schedule-foreign-workflow-",
      git: false,
      projectOwnership: "host",
    });
    const graphClient = asWorkflowGraphSeedClient(workspace.client);
    const eligibleName = `Eligible scheduled Graph ${Date.now()}`;
    const foreignName = `Foreign scheduled Graph ${Date.now()}`;
    const eligibleGraph = await importProjectGraph({
      client: graphClient,
      cwd: workspace.repoPath,
      graph: deterministicCheckGraph({ id: `graph-schedule-${Date.now()}`, name: eligibleName }),
    });
    await importProjectGraph({
      client: graphClient,
      cwd: foreignWorkspace.repoPath,
      graph: deterministicCheckGraph({ id: `graph-foreign-${Date.now()}`, name: foreignName }),
    });
    const schedules = asScheduleSeedClient(workspace.client);
    let scheduleId = "";
    let workflowRunId = "";

    try {
      await expect
        .poll(() => graphClient.listProjectWorkflowGraphs(workspace.repoPath), { timeout: 30_000 })
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: eligibleGraph.id, name: eligibleName }),
          ]),
        );

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildSchedulesRoute());
      await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("schedules-empty-new").click();

      await page.getByTestId("schedule-target-trigger").click();
      await page.getByText("Saved Workflow", { exact: true }).last().click();
      await selectProject(page, workspace.projectKey);

      const workflowPicker = page.getByTestId("schedule-workflow-trigger");
      await expect(workflowPicker).toBeVisible({ timeout: 30_000 });
      await workflowPicker.click();
      const pickerPopup = page.getByTestId("combobox-desktop-container").last();
      await expect(pickerPopup.getByText(eligibleName, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(pickerPopup.getByText(foreignName, { exact: true })).toHaveCount(0);
      await pickerPopup.getByText(eligibleName, { exact: true }).click();
      await expect(workflowPicker).toContainText(eligibleName);

      const scheduleName = `Saved Workflow Schedule ${Date.now()}`;
      await page.getByLabel("Schedule name").fill(scheduleName);
      await page.getByRole("button", { name: "Create schedule" }).click();
      await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });

      const listed = await schedules.scheduleList();
      const schedule = listed.schedules.find((candidate) => candidate.name === scheduleName);
      expect(schedule).toEqual(
        expect.objectContaining({
          target: expect.objectContaining({
            type: "workflow",
            definitionId: eligibleGraph.id,
            projectRoot: workspace.repoPath,
          }),
        }),
      );
      if (!schedule) {
        throw new Error(`Expected saved Workflow Schedule ${scheduleName} to exist.`);
      }
      scheduleId = schedule.id;

      const fired = await schedules.scheduleRunOnce({ id: scheduleId });
      expect(fired.error).toBeNull();
      if (!fired.schedule) {
        throw new Error("The saved Workflow Schedule did not return its durable run history.");
      }
      const successfulRun = latestRun(fired.schedule);
      expect(successfulRun).toMatchObject({
        status: "succeeded",
        target: {
          type: "workflow",
          definitionId: eligibleGraph.id,
          projectRoot: workspace.repoPath,
        },
        workflow: {
          definitionId: eligibleGraph.id,
          title: eligibleName,
          kind: "graph",
          projectRoot: workspace.repoPath,
        },
      });
      expect(successfulRun.workflow?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      workflowRunId = successfulRun.workflow?.runId ?? "";
      expect(workflowRunId).not.toBe("");

      await expect
        .poll(() => workflowRunProjection(workspace.client, workflowRunId))
        .toEqual({
          status: "done",
          graphId: eligibleGraph.id,
          scheduleSource: { scheduleId, scheduleRunId: successfulRun.id },
        });

      await page.goto(buildRunsRoute());
      const workflowCard = page.getByTestId(`run-card-${workflowRunId}`);
      await expect(workflowCard).toBeVisible({ timeout: 30_000 });
      await expect(workflowCard).toContainText(eligibleName);
      await expect(workflowCard).toContainText("Completed");

      // Remove only the selected project's exact persisted definition. The
      // foreign project copy remains available, so a false fallback would be
      // observable as a second durable Workflow.
      await rm(
        path.join(
          workspace.repoPath,
          ".otto",
          "workflows",
          "definitions",
          `${eligibleGraph.id}.json`,
        ),
      );
      const repaired = await schedules.scheduleRunOnce({ id: scheduleId });
      expect(repaired.error).toBeNull();
      if (!repaired.schedule) {
        throw new Error("The repair run did not return the Schedule history.");
      }
      const repairRun = latestRun(repaired.schedule);
      expect(repaired.schedule).toMatchObject({ status: "paused" });
      expect(repairRun).toMatchObject({
        status: "failed",
        target: {
          type: "workflow",
          definitionId: eligibleGraph.id,
          projectRoot: workspace.repoPath,
        },
      });
      expect(repairRun.workflow).toBeUndefined();
      expect(repairRun.error).toContain(`Saved Workflow ${eligibleGraph.id} is missing.`);
      expect(repairRun.error).toContain("Select a saved Workflow");

      await expect.poll(() => scheduledWorkflowCount(workspace.client, repairRun.id)).toBe(0);

      await page.goto(buildSchedulesRoute());
      const scheduleCard = page.getByTestId(`schedule-card-${scheduleId}`);
      await expect(scheduleCard).toContainText("Failed");
      await expect(scheduleCard).toContainText("Select a saved Workflow");
      await page.getByTestId(`schedule-kebab-${scheduleId}`).click();
      await expect(page.getByTestId(`schedule-menu-resume-${scheduleId}`)).toBeVisible();
      await moneyShot(
        page,
        "A missing saved Workflow pauses its Schedule with repair guidance and starts no fallback Workflow.",
      );
    } finally {
      if (scheduleId) {
        await deleteScheduleById(schedules, scheduleId);
      }
      await asRunsSeedClient(workspace.client)
        .clearFinishedRuns()
        .catch(() => undefined);
      await foreignWorkspace.cleanup();
      await workspace.cleanup();
    }
  });
});
