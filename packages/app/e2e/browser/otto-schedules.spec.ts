import { z } from "zod";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Locator, Page } from "@playwright/test";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import * as workflows from "@getpaseo/plugin/otto/workflows";
import * as artifacts from "@getpaseo/plugin/otto/artifacts";
import type { ScheduleRef } from "@getpaseo/plugin/otto/schedules";
import { buildSchedulesRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { gotoAppShell } from "../support/helpers/app";
import { waitForOttoSurface } from "../support/helpers/otto-surfaces";

test.use({
  e2eInjectPaseoTools: true,
  e2eDaemonConfig: {
    pluginsEnabled: true,
    agents: {
      metadataGeneration: { providers: [{ provider: "openai-compatible", model: "fixture" }] },
    },
  },
});
type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
type ScheduleApi = Awaited<ReturnType<typeof scheduleApi>>;
async function scheduleApi(client: Client) {
  // Match the daemon client's native-ESM boundary. Loading app TS here mixes
  // Playwright's CJS transform with already-built protocol ESM modules.
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, "../../../plugin/dist/otto/schedules/index.js"),
  ).href;
  const rpc: typeof import("@getpaseo/plugin/otto/schedules") = await import(moduleUrl);
  async function call<I extends z.ZodType, T>(
    contract: {
      name: string;
      input: I;
      output: {
        parse(value: unknown): { ok: true; value: T } | { ok: false; error: { message: string } };
      };
    },
    input: z.input<NoInfer<I>>,
  ): Promise<T> {
    const result = contract.output.parse(
      await client.invokePluginRpc("otto-schedules", contract.name, contract.input.parse(input)),
    );
    if (!result.ok) throw new Error(result.error.message);
    rpc.assertScheduleAcknowledgement(contract.name, input, result.value);
    return result.value;
  }
  return {
    list: (input: z.input<typeof rpc.listSchedules.input>) => call(rpc.listSchedules, input),
    read: (input: z.input<typeof rpc.readSchedule.input>) => call(rpc.readSchedule, input),
    update: (input: z.input<typeof rpc.updateSchedule.input>) => call(rpc.updateSchedule, input),
    control: (input: z.input<typeof rpc.controlSchedule.input>) => call(rpc.controlSchedule, input),
    history: (input: z.input<typeof rpc.readScheduleHistory.input>) =>
      call(rpc.readScheduleHistory, input),
    storage: (input: z.input<typeof rpc.readScheduleStorage.input>) =>
      call(rpc.readScheduleStorage, input),
  };
}
const seat = { provider: "openai-compatible", model: "fixture", modeId: "bypassPermissions" };
const seats = { conductor: seat, worker: seat, judge: seat };
const template =
  '<!doctype html><html><head><title>Schedule report</title></head><body><h1>Report</h1><script id="otto-artifact-data" type="application/json">{"value":1}</script></body></html>';
const completion = z.object({ messages: z.array(z.object({ content: z.unknown().optional() })) });
function reply(raw: unknown) {
  const content = completion
    .parse(raw)
    .messages.flatMap((row) => (typeof row.content === "string" ? [row.content] : []))
    .join("\n");
  if (content.includes("Generate a title and a git branch name"))
    return JSON.stringify({ title: "Schedule worker", branch: "schedule-worker" });
  if (content.includes("Return a single self-contained interactive HTML document as JSON"))
    return JSON.stringify({ html: template });
  return "Schedule worker completed. Human review remains required.";
}
function scope(workspace: SeededWorkspace) {
  return { hostId: getServerId(), projectId: workspace.projectId };
}
async function confirm(page: Page, control: Locator, title: string) {
  const waiting = page.waitForEvent("dialog"),
    clicked = control.click();
  const dialog = await waiting;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toContain(title);
  await dialog.accept();
  await clicked;
}
async function openSchedules(page: Page, workspace: SeededWorkspace) {
  await gotoAppShell(page);
  await page.goto(buildSchedulesRoute());
  await waitForOttoSurface(page, "otto-schedules-page");
  const surface = page.getByTestId("otto-schedules-page").filter({ visible: true });
  await surface.getByTestId("schedule-scope-project").click();
  await page
    .getByText(`${workspace.projectDisplayName} ·`, { exact: false })
    .filter({ visible: true })
    .last()
    .click();
  await expect(surface.getByTestId("schedules-new-button")).toBeEnabled();
  return surface;
}
async function begin(page: Page, surface: Locator, name: string, kind: string) {
  await surface.getByTestId("schedules-new-button").click();
  const editor = surface.getByTestId("schedule-editor");
  await editor.getByTestId("schedule-name-input").fill(name);
  await editor.getByTestId("schedule-prompt-input").fill("Scheduled acceptance proof");
  // Keep automatic firing safely after the journey while bounding the existing
  // minute-scanning cron preview to daily, rather than annual, matches.
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await editor
    .getByTestId("cadence-cron-expression")
    .fill(`${later.getUTCMinutes()} ${later.getUTCHours()} * * *`);
  await editor.getByTestId("schedule-target-kind").click();
  await page.getByText(kind, { exact: true }).filter({ visible: true }).last().click();
  return editor;
}
async function reviewAndSave(editor: Locator) {
  await editor.getByRole("button", { name: "Preview next runs", exact: true }).click();
  await expect(editor.getByText("Next runs · UTC", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Review target", exact: true }).click();
  await expect(editor.getByTestId("schedule-approve-target")).toBeVisible();
  await expect(editor.getByTestId("schedule-form-submit")).toBeDisabled();
  await editor.getByTestId("schedule-approve-target").click();
  await editor.getByTestId("schedule-form-submit").click();
  await expect(editor).toHaveCount(0);
}
async function savedByName(api: ScheduleApi, workspace: SeededWorkspace, name: string) {
  const rows = await api.list({ scope: scope(workspace), refresh: true });
  const row = rows.items.find((item) => item.name === name);
  if (!row) throw new Error(`Missing saved Schedule ${name}`);
  return api.read(row.ref);
}
async function terminal(api: ScheduleApi, ref: ScheduleRef) {
  await expect
    .poll(async () => (await api.history({ ref, offset: 0 })).runs[0]?.status, { timeout: 60000 })
    .toBe("succeeded");
  const history = await api.history({ ref, offset: 0 });
  expect(history.total).toBe(1);
  return history.runs[0];
}
async function seedArtifact(client: Client, workspace: SeededWorkspace) {
  const owner = {
    hostId: getServerId(),
    target: { kind: "project" as const, id: workspace.projectId },
  };
  const created = artifacts.createArtifact.output.parse(
    await client.invokePluginRpc("otto-artifacts", artifacts.createArtifact.name, {
      scope: owner,
      name: "Schedule report",
      description: "A report with refreshable JSON data",
      selection: { provider: "openai-compatible", model: "fixture" },
    }),
  );
  if (!created.ok) throw new Error(created.error.message);
  const ref = { scope: owner, id: created.value.id, location: created.value.location };
  const read = async () => {
    const result = artifacts.readArtifact.output.parse(
      await client.invokePluginRpc("otto-artifacts", artifacts.readArtifact.name, ref),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  await expect.poll(async () => (await read()).artifact.status, { timeout: 60000 }).toBe("ready");
  return { ref, read };
}
async function workflowRead(client: Client, ref: workflows.WorkflowRef) {
  const result = workflows.workflowRead.output.parse(
    await client.invokePluginRpc("otto-workflows", workflows.workflowRead.name, ref),
  );
  // Atomic replacement conflicts are observations inside this bounded read poll.
  // This does not retry any launch, approval, or other mutation.
  if (!result.ok && result.error.code === "conflict") return null;
  return workflows.unwrapWorkflowResult(result);
}

for (const compact of [false, true]) {
  test(`Schedule Artifact editor, CAS recovery, data-only execution and exact result (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, info) => {
    test.setTimeout(120000);
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-schedule-artifact-",
      git: false,
      title: "Scheduled report",
    });
    const client = await connectDaemonClient<Client>({ clientIdPrefix: "schedule-artifact" }),
      api = await scheduleApi(client);
    try {
      ottoProvider.replyWith(reply);
      await ottoProvider.refreshCatalog();
      const artifact = await seedArtifact(client, workspace),
        before = await artifact.read();
      const surface = await openSchedules(page, workspace);
      const editor = await begin(page, surface, "Report refresh", "Artifact update");
      await editor.getByTestId("schedule-saved-target").click();
      await page
        .getByText(/^Schedule report ·/)
        .filter({ visible: true })
        .last()
        .click();
      await editor.getByLabel("JSON data", { exact: true }).fill('{"value":2}');
      await reviewAndSave(editor);
      const saved = await savedByName(api, workspace, "Report refresh");
      expect(saved.schedule.target.type).toBe("artifact-update");
      // A real second writer changes the origin revision. The visible draft must
      // survive the rejection and cannot be blindly submitted a second time.
      await surface.getByRole("button", { name: "Edit or repair target", exact: true }).click();
      await editor.getByTestId("schedule-name-input").fill("Unsaved local title");
      await api.update({
        ref: saved.ref,
        expectedRevision: saved.revision,
        draft: {
          name: "Peer title",
          prompt: saved.schedule.prompt,
          cadence: saved.schedule.cadence,
          target: saved.schedule.target,
          maxRuns: saved.schedule.maxRuns,
          expiresAt: saved.schedule.expiresAt,
        },
      });
      await reviewAndSaveAttempt(editor);
      await expect(editor.getByTestId("schedule-name-input")).toHaveValue("Unsaved local title");
      await expect(
        editor.getByRole("button", { name: "Inspect saved Schedule", exact: true }),
      ).toBeVisible();
      await expect(editor.getByTestId("schedule-form-submit")).toBeDisabled();
      await editor.getByRole("button", { name: "Inspect saved Schedule", exact: true }).click();
      await confirm(
        page,
        editor.getByRole("button", { name: "Reload inspected record", exact: true }),
        "Reload saved Schedule?",
      );
      await expect(editor.getByTestId("schedule-name-input")).toHaveValue("Peer title");
      await confirm(
        page,
        editor.getByRole("button", { name: "Close draft", exact: true }),
        "Close Schedule draft?",
      );
      await surface
        .getByTestId(`otto-schedule-${saved.ref.id}`)
        .getByRole("button", { name: "Open Schedule", exact: true })
        .click();
      await surface
        .getByRole("button", { name: "Refresh Schedule and history", exact: true })
        .click();
      const requests = ottoProvider.requests.length;
      await confirm(
        page,
        surface.getByRole("button", { name: "Run once", exact: true }),
        "Run Schedule once?",
      );
      const run = await terminal(api, saved.ref),
        after = await artifact.read();
      expect(run.otto?.result).toMatchObject({ kind: "artifact", ref: artifact.ref });
      expect(after.html).toBe(
        before.html?.replace('{"value":1}', JSON.stringify({ value: 2 }, null, 2)),
      );
      expect(JSON.parse(after.data ?? "null")).toEqual({ value: 2 });
      expect(ottoProvider.requests).toHaveLength(requests);
      await expect(surface.getByText("Run history · 1", { exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`schedule-artifact-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
      await surface.getByRole("button", { name: "Open artifact result", exact: true }).click();
      await expect(page.getByTestId("otto-artifact-result")).toBeVisible();
      await expect(
        page
          .getByTestId("otto-artifact-result")
          .getByText("Schedule report", { exact: true })
          .first(),
      ).toBeVisible();
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}
async function reviewAndSaveAttempt(editor: Locator) {
  await editor.getByRole("button", { name: "Preview next runs", exact: true }).click();
  await editor.getByRole("button", { name: "Review target", exact: true }).click();
  await editor.getByTestId("schedule-approve-target").click();
  await editor.getByTestId("schedule-form-submit").click();
}

for (const kind of ["agent", "new-agent"] as const) {
  test(`Project-owned ${kind} Schedule preserves native execution and explicit storage controls`, async ({
    page,
    ottoProvider,
  }, info) => {
    test.setTimeout(120000);
    const workspace = await seedWorkspace({
      repoPrefix: "otto-schedule-native-",
      git: false,
      title: "Native Schedule",
    });
    const client = await connectDaemonClient<Client>({ clientIdPrefix: "schedule-native" }),
      api = await scheduleApi(client);
    try {
      ottoProvider.replyWith(reply);
      await ottoProvider.refreshCatalog();
      const agent = await workspace.client.createAgent({
        provider: "openai-compatible",
        model: "fixture",
        modeId: "bypassPermissions",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Existing Schedule target",
      });
      const surface = await openSchedules(page, workspace),
        editor = await begin(
          page,
          surface,
          "Native proof",
          kind === "agent" ? "Existing agent" : "New agent",
        );
      if (kind === "agent") {
        await editor.getByText("Select existing agent", { exact: true }).click();
        await page
          .getByText("Existing Schedule target", { exact: true })
          .filter({ visible: true })
          .last()
          .click();
      } else {
        await editor.getByTestId("combined-model-selector").click();
        await page.getByTestId("model-search-input").filter({ visible: true }).fill("fixture");
        await page.getByText("fixture", { exact: true }).filter({ visible: true }).last().click();
      }
      await reviewAndSave(editor);
      const saved = await savedByName(api, workspace, "Native proof");
      expect(saved.schedule.target.type).toBe(kind);
      await confirm(
        page,
        surface.getByRole("button", { name: "Run once", exact: true }),
        "Run Schedule once?",
      );
      const run = await terminal(api, saved.ref);
      expect(run.otto?.result?.kind).toBe("chat");
      if (kind === "agent") expect(run.agentId).toBe(agent.id);
      await surface
        .getByRole("button", { name: "Refresh Schedule and history", exact: true })
        .click();
      await confirm(
        page,
        surface.getByRole("button", { name: "Pause", exact: true }),
        "Pause Schedule?",
      );
      await surface.getByRole("button", { name: "Copy or move", exact: true }).click();
      await confirm(
        page,
        surface.getByRole("button", { name: "Transfer once", exact: true }),
        "Copy Schedule settings?",
      );
      await expect(surface.getByText("Transfer receipt received.", { exact: false })).toBeVisible();
      const rows = await api.list({ scope: scope(workspace), refresh: true });
      expect(rows.items).toHaveLength(2);
      const copied = rows.items.find((row) => row.ref.id !== saved.ref.id);
      if (!copied) throw new Error("Missing copied Schedule");
      expect(copied).toMatchObject({ status: "paused", runCount: 0 });
      expect((await api.history({ ref: saved.ref })).total).toBe(1);
      await surface.getByRole("button", { name: "Storage", exact: true }).click();
      await expect(surface.getByText("Schedules storage", { exact: true })).toBeVisible();
      await surface.getByText("Use Schedules host default", { exact: true }).click();
      await page.getByTestId("schedule-choice-host").filter({ visible: true }).click();
      await surface.getByRole("button", { name: "Save project override", exact: true }).click();
      await expect(
        surface.getByRole("button", { name: "Save project override", exact: true }),
      ).toBeDisabled();
      expect((await api.storage(scope(workspace))).override).toBe("host");
      const unchanged = await api.read(saved.ref);
      expect(unchanged.ref).toEqual(saved.ref);
      expect((await api.history({ ref: saved.ref })).total).toBe(1);
      await page.screenshot({
        path: info.outputPath(`schedule-${kind}-storage.png`),
        fullPage: true,
      });
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
}

for (const kind of ["graph", "ai"] as const) {
  test(`Scheduled ${kind} Workflow waits for human approval and retains cancellation ownership`, async ({
    page,
    ottoProvider,
  }, info) => {
    test.setTimeout(120000);
    const workspace = await seedWorkspace({
      repoPrefix: `otto-schedule-${kind}-`,
      git: false,
      title: `Scheduled ${kind}`,
    });
    const client = await connectDaemonClient<Client>({ clientIdPrefix: `schedule-${kind}` }),
      api = await scheduleApi(client);
    let scheduled: ScheduleRef | null = null;
    try {
      ottoProvider.replyWith(reply);
      await ottoProvider.refreshCatalog();
      const now = new Date().toISOString();
      const document: workflows.WorkflowAuthoredDocument =
        kind === "ai"
          ? {
              kind: "ai",
              value: {
                format: "otto.workflow.ai",
                formatVersion: 1,
                id: "scheduled-ai",
                title: "Approval proof",
                prompt: "Discuss this plan and wait for approval. Do not invoke start_workflow.",
                seats,
                limits: workflows.DEFAULT_WORKFLOW_LIMITS,
                autopilot: false,
                createdAt: now,
                updatedAt: now,
              },
            }
          : {
              kind: "graph",
              value: {
                id: "scheduled-graph",
                name: "Approval proof",
                nodes: [
                  { id: "root", kind: "orchestrator", title: "Conductor" },
                  {
                    id: "work",
                    kind: "agent",
                    title: "Worker",
                    prompt: "SCHEDULE_WORKFLOW_PROOF: complete the work.",
                  },
                  {
                    id: "approval",
                    kind: "gate",
                    title: "Human review",
                    prompt: "Review before completion",
                  },
                ],
                edges: [
                  { from: "root", to: "work" },
                  { from: "work", to: "approval" },
                ],
              },
            };
      const definition = workflows.unwrapWorkflowResult(
        workflows.workflowSave.output.parse(
          await client.invokePluginRpc("otto-workflows", workflows.workflowSave.name, {
            scope: scope(workspace),
            expectedRevision: null,
            document,
          }),
        ),
      );
      const surface = await openSchedules(page, workspace),
        editor = await begin(page, surface, `${kind} approval`, "Saved Workflow");
      await editor.getByTestId("schedule-saved-target").click();
      await page
        .getByText(/^Approval proof ·/)
        .filter({ visible: true })
        .last()
        .click();
      await editor.getByText("Select execution workspace", { exact: true }).click();
      await page
        .getByTestId(`schedule-choice-${workspace.workspaceId}`)
        .filter({ visible: true })
        .click();
      if (kind === "graph") {
        for (const role of ["conductor", "worker", "judge"]) {
          await editor
            .getByTestId(`schedule-seat-${role}`)
            .getByTestId("combined-model-selector")
            .click();
          await page.getByTestId("model-search-input").filter({ visible: true }).fill("fixture");
          await page.getByText("fixture", { exact: true }).filter({ visible: true }).last().click();
        }
      }
      await reviewAndSave(editor);
      const saved = await savedByName(api, workspace, `${kind} approval`);
      scheduled = saved.ref;
      await confirm(
        page,
        surface.getByRole("button", { name: "Run once", exact: true }),
        "Run Schedule once?",
      );
      await expect
        .poll(async () => (await api.history({ ref: saved.ref })).runs[0]?.otto?.result?.kind, {
          timeout: 60000,
        })
        .toBe("workflow");
      const history = await api.history({ ref: saved.ref }),
        result = history.runs[0].otto?.result;
      if (result?.kind !== "workflow") throw new Error("Expected exact Workflow run link");
      expect(history.runs[0].status).toBe("running");
      await expect
        .poll(
          async () => {
            const run = await workflowRead(client, result.ref);
            if (run?.document.kind !== "run") return null;
            return kind === "graph"
              ? run.document.value.phases?.find((phase) => phase.id === "approval")?.status
              : run.document.value.status;
          },
          { timeout: 60000 },
        )
        .toBe(kind === "graph" ? "blocked" : "planning");
      expect((await api.history({ ref: saved.ref })).runs[0].status).toBe("running");
      expect(definition.ref.kind).toBe(kind);
      await surface
        .getByRole("button", { name: "Refresh Schedule and history", exact: true })
        .click();
      await page.screenshot({
        path: info.outputPath(`schedule-${kind}-waiting.png`),
        fullPage: true,
      });
      if (kind === "graph") {
        await surface.getByRole("button", { name: "Open workflow result", exact: true }).click();
        const runSurface = page.getByTestId("otto-workflows-page").filter({ visible: true });
        await confirm(
          page,
          runSurface.getByRole("button", { name: "Approve gate", exact: true }),
          "Workflow decision",
        );
        await terminal(api, saved.ref);
      } else {
        await confirm(
          page,
          surface.getByRole("button", { name: "Cancel run", exact: true }),
          "Cancel Schedule run?",
        );
        await expect
          .poll(async () => (await api.history({ ref: saved.ref })).runs[0]?.otto?.disposition, {
            timeout: 30000,
          })
          .toBe("canceled");
      }
      scheduled = null;
    } finally {
      if (scheduled) {
        const current = await api.read(scheduled),
          runs = await api.history({ ref: scheduled });
        const running = runs.runs.find((run) => run.status === "running");
        if (running)
          await api.control({
            ref: scheduled,
            expectedRevision: current.revision,
            command: { type: "cancel", runId: running.id },
          });
      }
      await client.close();
      await workspace.cleanup();
    }
  });
}
