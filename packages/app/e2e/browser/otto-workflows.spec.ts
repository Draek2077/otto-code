import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Page, Locator } from "@playwright/test";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import * as workflows from "@getpaseo/plugin/otto/workflows";
import { aggregateArtifacts } from "@getpaseo/plugin/otto/artifacts";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { submitMessageWithButton } from "../support/helpers/composer";
import { buildPluginSurfaceRoute } from "../../src/plugins/routes";

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
type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: "invalid" | "conflict" | "busy" | "unavailable" | "unsupported";
        message: string;
      };
    };
function caller(client: Client) {
  return async <T>(
    definition: { name: string; output: { parse(value: unknown): Result<T> } },
    input: unknown,
  ): Promise<T> =>
    workflows.unwrapWorkflowResult(
      definition.output.parse(
        await client.invokePluginRpc("otto-workflows", definition.name, input),
      ),
    );
}
function scope(workspace: SeededWorkspace) {
  return { hostId: getServerId(), projectId: workspace.projectId };
}
async function confirmAction(page: Page, button: Locator, expected: string) {
  const waiting = page.waitForEvent("dialog");
  const clicked = button.click();
  const dialog = await waiting;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toContain(expected);
  await dialog.accept();
  await clicked;
}
async function openLibrary(page: Page, workspace: SeededWorkspace, run?: workflows.WorkflowRef) {
  await page.goto(
    buildPluginSurfaceRoute(
      getServerId(),
      "otto-workflows",
      { kind: "surface", id: "workflows" },
      {
        projectId: workspace.projectId,
        projectHostId: getServerId(),
        workspaceId: workspace.workspaceId,
        ...(run ? { runId: run.id, location: run.location, storeKey: run.storeKey ?? "" } : {}),
      },
    ),
  );
  await expect(page.getByTestId("otto-workflows-page").filter({ visible: true })).toBeVisible();
}
const request = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
  tools: z
    .array(
      z.object({ function: z.object({ name: z.string(), description: z.string().optional() }) }),
    )
    .optional(),
});
function text(body: z.infer<typeof request>) {
  return body.messages
    .flatMap((message) => (typeof message.content === "string" ? [message.content] : []))
    .join("\n");
}
const seat = { provider: "openai-compatible", model: "fixture", modeId: "bypassPermissions" };
const seats = { conductor: seat, worker: seat, judge: seat };
const limits = { ...workflows.DEFAULT_WORKFLOW_LIMITS, timeoutMinutes: 2 };

for (const compact of [false, true])
  test(`Workflow library, original graph designer, retained edits and CAS conflict (${compact ? "compact" : "wide"})`, async ({
    page,
  }, info) => {
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({
      repoPrefix: "otto-workflow-library-",
      git: false,
      title: "Workflow library",
    });
    const client = await connectDaemonClient<Client>({ clientIdPrefix: "workflow-library" });
    const call = caller(client);
    try {
      // Prove the normal nav contribution exists before using its host/project-bound deep link.
      await gotoAppShell(page);
      await expect(page.getByTestId("plugin-sidebar-otto-workflows-workflows")).toBeAttached();
      await openLibrary(page, workspace);
      const surface = page.getByTestId("otto-workflows-page").filter({ visible: true });
      await surface.getByRole("button", { name: "New Graph", exact: true }).click();
      await surface.getByLabel("Graph name", { exact: true }).fill("Reviewed visual graph");
      await surface.getByRole("button", { name: "Add agent", exact: true }).click();
      await expect(surface.locator(".drawflow-node")).toHaveCount(2);
      const title = surface.locator('[data-og-field="title"]').last();
      await title.fill("Canvas worker");
      await title.blur();
      await surface.getByRole("button", { name: "Save", exact: true }).click();
      await expect(surface.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      const list = await call(workflows.workflowList, { scope: scope(workspace), kind: "graph" });
      expect(list.items).toHaveLength(1);
      const original = await call(workflows.workflowRead, list.items[0].ref);
      expect(original.document.value.nodes).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "Canvas worker" })]),
      );
      await surface.getByLabel("Graph name", { exact: true }).fill("Local unsaved edit");
      const peer = structuredClone(original.document);
      peer.value.name = "Peer saved graph";
      await call(workflows.workflowSave, {
        scope: scope(workspace),
        ref: original.ref,
        expectedRevision: original.revision,
        document: peer,
      });
      await surface.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        surface
          .getByText(/changed|revision|Reload/i)
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(surface.getByLabel("Graph name", { exact: true })).toHaveValue(
        "Local unsaved edit",
      );
      await confirmAction(
        page,
        surface.getByRole("button", { name: "Reload saved", exact: true }),
        "Reload saved Workflow?",
      );
      await expect(surface.getByLabel("Graph name", { exact: true })).toHaveValue(
        "Peer saved graph",
      );
      await page.screenshot({
        path: info.outputPath(`workflow-designer-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
      await page.reload();
      await expect(
        surface.getByRole("button", { name: "Peer saved graph", exact: true }),
      ).toBeVisible();
      await surface.getByRole("button", { name: "Peer saved graph", exact: true }).click();
      await expect(surface.locator(".drawflow-node")).toHaveCount(2);
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });

test("real Graph workers, gates, ordinary chats and Artifact provenance use the existing Paseo runtime", async ({
  page,
  ottoProvider,
}, info) => {
  test.setTimeout(120000);
  const workspace = await seedWorkspace({
    repoPrefix: "otto-workflow-runtime-",
    git: false,
    title: "Workflow runtime",
  });
  const client = await connectDaemonClient<Client>({ clientIdPrefix: "workflow-runtime" });
  const call = caller(client),
    project = scope(workspace);
  let createdArtifact = false;
  ottoProvider.replyWith((raw) => {
    const body = request.parse(raw),
      content = text(body);
    if (content.includes("Generate a title and a git branch name"))
      return JSON.stringify({ title: "Workflow proof", branch: "workflow-proof" });
    if (content.includes("Return a single self-contained interactive HTML document as JSON"))
      return JSON.stringify({
        html: "<!doctype html><html><head><title>Workflow Artifact</title></head><body><h1>Workflow proof</h1></body></html>",
      });
    const create = body.tools?.find((tool) =>
      tool.function.description?.includes(
        "Create a durable self-contained interactive HTML deliverable",
      ),
    );
    if (!createdArtifact && content.includes("WORKFLOW_ARTIFACT_WORKER") && create) {
      createdArtifact = true;
      return {
        toolCalls: [
          {
            id: "workflow-artifact",
            name: create.function.name,
            arguments: JSON.stringify({
              name: "Workflow Artifact",
              description: "Self-contained Workflow proof",
            }),
          },
        ],
      };
    }
    return "Paseo runtime completed this turn.";
  });
  let running: workflows.WorkflowRef | null = null;
  try {
    await ottoProvider.refreshCatalog();
    const graph: workflows.OrchestrationGraph = {
      id: "runtime-graph",
      name: "Runtime Graph",
      nodes: [
        { id: "root", kind: "orchestrator", title: "Conductor" },
        {
          id: "work",
          kind: "agent",
          title: "Artifact worker",
          prompt: "WORKFLOW_ARTIFACT_WORKER: create one artifact using create_artifact.",
          tools: ["artifacts"],
        },
        { id: "approval", kind: "gate", title: "Human review", prompt: "Review the deliverable" },
      ],
      edges: [
        { from: "root", to: "work" },
        { from: "work", to: "approval" },
      ],
    };
    const saved = await call(workflows.workflowSave, {
      scope: project,
      expectedRevision: null,
      document: { kind: "graph", value: graph },
    });
    if (saved.document.kind !== "graph") throw new Error("Expected Graph definition");
    const launch = {
      kind: "graph" as const,
      graph: saved.document.value,
      inputs: {},
      seats,
      limits,
      source: { ref: saved.ref, revision: saved.revision },
    };
    const review = await call(workflows.workflowReviewStart, {
      scope: project,
      workspaceId: workspace.workspaceId,
      launch,
      operationId: "runtime-proof",
    });
    const started = await call(workflows.workflowStart, {
      scope: project,
      token: review.token,
      operationId: "runtime-proof",
      confirmed: true,
    });
    running = started.ref;
    await expect
      .poll(
        async () => {
          const entry = await call(workflows.workflowRead, started.ref);
          return entry.document.kind === "run"
            ? (entry.document.value.phases ?? []).find((phase) => phase.id === "approval")?.status
            : null;
        },
        { timeout: 60000 },
      )
      .toBe("blocked");
    const current = await call(workflows.workflowRead, started.ref);
    if (current.document.kind !== "run") throw new Error("Expected run");
    const worker = (current.document.value.phases ?? []).find((phase) => phase.id === "work")
      ?.candidates?.[0];
    expect(worker).toBeDefined();
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: worker!.agentId });
    await expect(page.getByText(/worker chats cannot accept independent messages/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveCount(0);
    const ordinary = await workspace.client.createAgent({
      provider: "openai-compatible",
      model: "fixture",
      modeId: "bypassPermissions",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Ordinary Paseo chat",
    });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: ordinary.id });
    await submitMessageWithButton(
      page,
      "Ordinary chat still works while Workflow waits at a gate.",
    );
    await expect(
      page
        .getByText("Paseo runtime completed this turn.", { exact: true })
        .filter({ visible: true })
        .last(),
    ).toBeVisible({ timeout: 30000 });
    await openLibrary(page, workspace, started.ref);
    const surface = page.getByTestId("otto-workflows-page").filter({ visible: true });
    await expect(surface.getByRole("button", { name: "Approve gate", exact: true })).toBeVisible();
    await confirmAction(
      page,
      surface.getByRole("button", { name: "Approve gate", exact: true }),
      "Workflow decision",
    );
    await expect
      .poll(
        async () => {
          const entry = await call(workflows.workflowRead, started.ref);
          return entry.document.value.status;
        },
        { timeout: 30000 },
      )
      .toBe("done");
    running = null;
    await surface.getByRole("button", { name: "Refresh run", exact: true }).click();
    await expect(surface.getByText("Runtime Graph · done", { exact: true })).toBeVisible();
    const artifacts = async () => {
      const result = aggregateArtifacts.output.parse(
        await client.invokePluginRpc("otto-artifacts", aggregateArtifacts.name, {
          hostId: getServerId(),
        }),
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value.items.find((item) => item.name === "Workflow Artifact");
    };
    await expect.poll(async () => (await artifacts())?.status, { timeout: 60000 }).toBe("ready");
    const artifact = (await artifacts())!;
    const provenance = workflows.unwrapWorkflowResult(
      workflows.workflowArtifactSource.output.parse(
        await client.invokePluginRpc("otto-artifacts", workflows.workflowArtifactSource.name, {
          scope: project,
          id: artifact.id,
          location: artifact.location,
        }),
      ),
    );
    expect(provenance).toMatchObject({ kind: "workflow", ref: started.ref, status: "done" });
    await page.screenshot({ path: info.outputPath("workflow-real-run.png"), fullPage: true });
  } catch (error) {
    await writeFile(
      info.outputPath("workflow-provider-requests.json"),
      JSON.stringify(ottoProvider.requests, null, 2),
    );
    throw error;
  } finally {
    if (running) {
      const entry = await call(workflows.workflowRead, running);
      await call(workflows.workflowControl, {
        ref: running,
        expectedRevision: entry.revision,
        action: "cancel",
        confirmed: true,
      });
    }
    await client.close();
    await workspace.cleanup();
  }
});

test("AI clarification stays in Planning, explicit confirmation admits workers and gate rejection cancels", async ({
  page,
  ottoProvider,
}) => {
  test.setTimeout(90000);
  const workspace = await seedWorkspace({
    repoPrefix: "otto-workflow-ai-",
    git: false,
    title: "AI Workflow",
  });
  const client = await connectDaemonClient<Client>({ clientIdPrefix: "workflow-ai" });
  const call = caller(client),
    project = scope(workspace);
  let declared = false,
    running: workflows.WorkflowRef | null = null;
  ottoProvider.replyWith((raw) => {
    const body = request.parse(raw),
      content = text(body);
    if (content.includes("Generate a title and a git branch name"))
      return JSON.stringify({ title: "AI Workflow", branch: "ai-workflow" });
    const declare = body.tools?.find((tool) =>
      tool.function.description?.startsWith("Declare the AI Workflow plan once."),
    );
    if (!declared && declare && content.includes("Proceed with the plan")) {
      declared = true;
      return {
        toolCalls: [
          {
            id: "declare-plan",
            name: declare.function.name,
            arguments: JSON.stringify({
              title: "AI reviewed plan",
              phases: [
                { id: "read", type: "research", title: "Read", task: "Report without edits" },
                { id: "gate", type: "gate", title: "Review", task: "Human review" },
              ],
            }),
          },
        ],
      };
    }
    return declare && !declared
      ? "Please clarify the desired report before I declare a plan."
      : "Completed the requested report.";
  });
  try {
    await ottoProvider.refreshCatalog();
    const now = new Date().toISOString();
    const definition = {
      format: "otto.workflow.ai" as const,
      formatVersion: 1 as const,
      id: "ai-proof",
      title: "AI Planning proof",
      prompt: "Clarify before declaring the report plan.",
      seats,
      limits,
      autopilot: false,
      createdAt: now,
      updatedAt: now,
    };
    const review = await call(workflows.workflowReviewStart, {
      scope: project,
      workspaceId: workspace.workspaceId,
      launch: { kind: "ai", definition },
      operationId: "ai-proof",
    });
    const start = await call(workflows.workflowStart, {
      scope: project,
      token: review.token,
      operationId: "ai-proof",
      confirmed: true,
    });
    running = start.ref;
    if (start.document.kind !== "run" || !start.document.value.conductorAgentId)
      throw new Error("Missing conductor");
    const conductor = start.document.value.conductorAgentId;
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: conductor });
    await expect(
      page
        .getByText("Please clarify the desired report before I declare a plan.", { exact: true })
        .filter({ visible: true })
        .last(),
    ).toBeVisible({ timeout: 30000 });
    expect((await call(workflows.workflowRead, start.ref)).document.value.status).toBe("planning");
    await submitMessageWithButton(page, "Proceed with the plan");
    await expect
      .poll(
        async () => {
          const entry = await call(workflows.workflowRead, start.ref);
          return entry.document.value.awaitingStartConfirmation;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await openLibrary(page, workspace, start.ref);
    const surface = page.getByTestId("otto-workflows-page").filter({ visible: true });
    await confirmAction(
      page,
      surface.getByRole("button", { name: "Start declared plan", exact: true }),
      "Workflow decision",
    );
    await expect(surface.getByRole("button", { name: "Reject gate", exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      surface.getByRole("button", { name: "Start declared plan", exact: true }),
    ).toHaveCount(0);
    await confirmAction(
      page,
      surface.getByRole("button", { name: "Reject gate", exact: true }),
      "Workflow decision",
    );
    await expect
      .poll(async () => (await call(workflows.workflowRead, start.ref)).document.value.status)
      .toBe("canceled");
    running = null;
  } finally {
    if (running) {
      const entry = await call(workflows.workflowRead, running);
      await call(workflows.workflowControl, {
        ref: running,
        expectedRevision: entry.revision,
        action: "cancel",
        confirmed: true,
      });
    }
    await client.close();
    await workspace.cleanup();
  }
});
