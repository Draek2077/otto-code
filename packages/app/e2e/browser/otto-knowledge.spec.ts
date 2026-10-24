import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Page, Locator } from "@playwright/test";
import {
  mutateKnowledge,
  readKnowledgePage,
  readKnowledgeCatalog,
  readKnowledgeRoot,
  readKnowledgeLinkHealth,
  inspectKnowledgeFormat,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { gotoAppShell } from "../support/helpers/app";
import { openWorkspaceContextMenu } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { z } from "zod";
test.use({ e2eDaemonConfig: { pluginsEnabled: true } });

async function proveConfirmedPurge(
  page: Page,
  surface: Locator,
  client: Pick<DaemonClient, "invokePluginRpc">,
  scope: KnowledgeScope,
  id: string,
) {
  const result = mutateKnowledge.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", mutateKnowledge.name, {
      scope,
      command: {
        action: "create",
        kind: "finding",
        id,
        title: "Accidental fixture",
        statement: "This selected fixture will be purged.",
        tags: [],
      },
    }),
  );
  expect(result.ok).toBe(true);
  await surface.getByRole("button", { name: "Back to pages", exact: true }).click();
  await surface
    .getByTestId(`knowledge-record-${id}`)
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await surface.getByRole("button", { name: "Permanently delete", exact: true }).click();
  const editor = surface.getByTestId("knowledge-editor");
  await editor
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill("Human confirmed removing this accidental fixture.");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await editor.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue(
    "Human confirmed removing this accidental fixture.",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await editor.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Back to pages", exact: true })).toHaveCount(0);
  const removed = readKnowledgePage.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", readKnowledgePage.name, {
      scope,
      kind: "finding",
      id,
    }),
  );
  expect(removed).toMatchObject({ ok: false, error: { code: "not_found" } });
}

async function callKnowledgeMcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${getE2EDaemonPort()}/mcp/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`Isolated Knowledge MCP request failed: ${response.status}`);
  const text = await response.text();
  const event = text.split("\n").find((line) => line.startsWith("data:"));
  const envelope = z
    .object({
      result: z.object({
        structuredContent: z.unknown(),
        content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
      }),
    })
    .parse(JSON.parse(event ? event.slice(5).trim() : text));
  expect(envelope.result.content).toHaveLength(1);
  expect(JSON.parse(envelope.result.content[0].text)).toEqual(envelope.result.structuredContent);
  return envelope.result.structuredContent;
}

async function proveLinkHealth(
  surface: Locator,
  client: Pick<DaemonClient, "invokePluginRpc">,
  scope: KnowledgeScope,
  workspaceId: string,
) {
  const root = readKnowledgeRoot.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", readKnowledgeRoot.name, {
      scope,
      slug: "background",
    }),
  );
  if (!root.ok || !root.value) throw new Error("Initialized fixture root is unavailable");
  const changed = mutateKnowledge.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", mutateKnowledge.name, {
      scope,
      command: {
        action: "root",
        slug: "background",
        expectedRevision: root.value.revision,
        body: "# Background\n\nLink-health source fixture.\n\n[[missing-link-proof|Unresolved fixture]]",
      },
    }),
  );
  expect(changed.ok).toBe(true);
  const health = surface.getByTestId("knowledge-link-health");
  await health.getByRole("button", { name: "Check links", exact: true }).click();
  await expect(
    health.getByText("Missing or inactive target: [[missing-link-proof]]", { exact: true }),
  ).toBeVisible();
  const mcp = readKnowledgeLinkHealth.output.parse(
    await callKnowledgeMcp("lint_project_knowledge_links", { workspaceId, limit: 50 }),
  );
  expect(mcp).toMatchObject({
    ok: true,
    value: {
      issues: [{ source: { type: "root", slug: "background" }, target: "missing-link-proof" }],
    },
  });
  await health.getByRole("button", { name: "Open source", exact: true }).click();
  await expect(surface.getByRole("button", { name: "Edit root", exact: true })).toBeVisible();
  await expect(surface.getByText("Link-health source fixture.", { exact: true })).toBeVisible();
}

async function proveFormatConversion(
  page: Page,
  surface: Locator,
  client: Pick<DaemonClient, "invokePluginRpc">,
  scope: KnowledgeScope,
  project: { workspaceId: string; repoPath: string },
  id: string,
) {
  const catalog = readKnowledgeCatalog.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", readKnowledgeCatalog.name, {
      scope,
      includeInactive: true,
      query: "",
      offset: 0,
      limit: 50,
    }),
  );
  if (!catalog.ok) throw new Error(catalog.error.message);
  const oldId = `${id}-old-format`;
  const jsonId = `${id}-json-format`;
  const oldFile = path.join(catalog.value.settings.path, "knowledge/requirements", `${oldId}.md`);
  const oldRaw = `---\nid: ${oldId}\nkind: requirement\ntitle: Older Markdown fixture\nstatus: confirmed\ntags: []\ncreated_at: "2026-01-01T00:00:00.000Z"\nupdated_at: "2026-01-01T00:00:00.000Z"\nfuture: { retained: true }\n---\n# Older Markdown fixture\n\n## Current truth\n\nRetained older truth.\n\n## Evidence\n\nRetained older evidence.\n\n## Timeline\n\n- 2026-01-01T00:00:00.000Z [decision] Original record\n`;
  const jsonFile = path.join(project.repoPath, ".otto/project-knowledge.json");
  const jsonRaw = JSON.stringify({
    version: 1,
    records: [
      {
        id: jsonId,
        kind: "requirement",
        title: "Older JSON fixture",
        statement: "Retained JSON truth.",
        tags: [],
        status: "confirmed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await writeFile(oldFile, oldRaw);
  await writeFile(jsonFile, jsonRaw);
  const form = surface.getByTestId("knowledge-format");
  await form.getByRole("button", { name: "Inspect formats", exact: true }).click();
  await expect(form.getByText("2 records need conversion", { exact: true })).toBeVisible();
  const inspected = inspectKnowledgeFormat.output.parse(
    await callKnowledgeMcp("inspect_project_knowledge_format", {
      workspaceId: project.workspaceId,
    }),
  );
  if (!inspected.ok) throw new Error(inspected.error.message);
  await expect(
    form.getByText(`Recovery: ${inspected.value.recoveryPath}`, { exact: true }),
  ).toBeVisible();
  await form
    .getByRole("textbox", { name: "Conversion reason", exact: true })
    .fill("Human reviewed conversion fixture");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await form.getByRole("button", { name: "Convert formats", exact: true }).click();
  expect(await readFile(oldFile, "utf8")).toBe(oldRaw);
  page.once("dialog", (dialog) => void dialog.accept());
  await form.getByRole("button", { name: "Convert formats", exact: true }).click();
  await expect(
    form.getByText(`2 records converted. Recovery bytes: ${inspected.value.recoveryPath}`, {
      exact: true,
    }),
  ).toBeVisible();
  expect(await readFile(jsonFile, "utf8")).toBe(jsonRaw);
  expect(
    await readFile(
      path.join(inspected.value.recoveryPath, "store/knowledge/requirements", `${oldId}.md`),
      "utf8",
    ),
  ).toBe(oldRaw);
  const imported = readKnowledgePage.output.parse(
    await callKnowledgeMcp("read_project_knowledge", {
      workspaceId: project.workspaceId,
      id: jsonId,
    }),
  );
  expect(imported).toMatchObject({
    ok: true,
    value: { statement: "Retained JSON truth.", status: "confirmed" },
  });
  const converted = readKnowledgePage.output.parse(
    await callKnowledgeMcp("read_project_knowledge", {
      workspaceId: project.workspaceId,
      id: oldId,
    }),
  );
  expect(converted).toMatchObject({
    ok: true,
    value: {
      statement: "Retained older truth.",
      status: "confirmed",
      timeline: expect.stringContaining("Retained older evidence."),
    },
  });
}

for (const compact of [false, true]) {
  test(`Project Knowledge workspace menu, editing, MCP-shared revisions and explicit storage (${compact ? "compact" : "wide"})`, async ({
    page,
    e2eWorker,
  }, testInfo) => {
    void e2eWorker;
    if (compact) await page.setViewportSize({ width: 390, height: 844 });
    const project = await seedWorkspace({
      repoPrefix: "otto-knowledge-",
      title: "Knowledge fixture",
      git: false,
    });
    const client = await connectDaemonClient<
      Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">
    >({ clientIdPrefix: "knowledge-ui-proof" });
    const scope = {
      hostId: getServerId(),
      target: { kind: "workspace" as const, id: project.workspaceId },
    };
    const id = compact ? "compact-proof" : "wide-proof";
    try {
      await gotoAppShell(page);
      if (compact) {
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
        await page
          .getByTestId(`sidebar-workspace-kebab-${getServerId()}:${project.workspaceId}`)
          .click();
      } else await openWorkspaceContextMenu(page, project.workspaceId);
      await page.getByText("Open Project Knowledge", { exact: true }).click();
      const surface = page.getByTestId("otto-knowledge-page").filter({ visible: true });
      await expect(surface).toBeVisible();
      await surface.getByRole("button", { name: "Initialize roots", exact: true }).click();
      await surface.getByRole("button", { name: "New entry", exact: true }).click();
      const editor = surface.getByTestId("knowledge-editor");
      await editor.getByRole("textbox", { name: "Page ID", exact: true }).fill(id);
      await editor.getByRole("textbox", { name: "Title", exact: true }).fill("Knowledge proof");
      await editor
        .getByRole("textbox", { name: "Markdown", exact: true })
        .fill("Original source-backed draft.");
      const bodyBox = await editor
        .getByRole("textbox", { name: "Markdown", exact: true })
        .boundingBox();
      expect(bodyBox!.height).toBeGreaterThanOrEqual(180);
      const box = await editor.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(720);
      expect(box!.x).toBeGreaterThanOrEqual(16);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await surface
        .getByTestId(`knowledge-record-${id}`)
        .getByRole("button", { name: "Open", exact: true })
        .click();
      await expect(
        surface.getByText("Original source-backed draft.", { exact: true }),
      ).toBeVisible();
      const catalog = readKnowledgeCatalog.output.parse(
        await callKnowledgeMcp("list_project_knowledge", {
          workspaceId: project.workspaceId,
          includeInactive: true,
          limit: 50,
        }),
      );
      expect(catalog).toMatchObject({ ok: true, value: { records: [{ id }] } });
      const mcpPage = readKnowledgePage.output.parse(
        await callKnowledgeMcp("read_project_knowledge", {
          workspaceId: project.workspaceId,
          includeInactive: true,
          id,
        }),
      );
      expect(mcpPage).toMatchObject({
        ok: true,
        value: { statement: "Original source-backed draft." },
      });
      const sourcePath = path.join(project.repoPath, ".otto/knowledge/requirements", `${id}.md`);
      const beforeExternal = await readFile(sourcePath, "utf8");
      await writeFile(
        sourcePath,
        beforeExternal.replace("Original source-backed draft.", "External editor conclusion."),
      );
      await expect(surface.getByText("External editor conclusion.", { exact: true })).toBeVisible();
      await surface.getByRole("button", { name: "Edit truth", exact: true }).click();
      const markdown = editor.getByRole("textbox", { name: "Markdown", exact: true });
      await markdown.fill("Local draft survives a peer write.");
      await editor
        .getByRole("textbox", { name: "Reason", exact: true })
        .fill("Review local change");
      const current = readKnowledgePage.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readKnowledgePage.name, {
          scope,
          kind: "requirement",
          id,
        }),
      );
      if (!current.ok) throw new Error(current.error.message);
      const peer = mutateKnowledge.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", mutateKnowledge.name, {
          scope,
          command: {
            action: "truth",
            kind: "requirement",
            id,
            expectedRevision: current.value.revision,
            statement: "Peer conclusion.",
            reason: "Verified peer change",
          },
        }),
      );
      expect(peer.ok).toBe(true);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(markdown).toHaveValue("Local draft survives a peer write.");
      await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(
        editor.getByText("Knowledge changed. Your draft is retained; reload before saving.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("knowledge-draft-conflict.png") });
      page.once("dialog", (dialog) => void dialog.dismiss());
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(markdown).toHaveValue("Local draft survives a peer write.");
      page.once("dialog", (dialog) => void dialog.accept());
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(surface.getByText("Peer conclusion.", { exact: true })).toBeVisible();
      const original = await readFile(sourcePath);
      await surface.getByRole("button", { name: "Change storage", exact: true }).click();
      await surface
        .getByRole("button", { name: "Store location: Repository", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Host", exact: true }).click();
      page.once("dialog", (dialog) => void dialog.accept());
      await surface.getByRole("button", { name: "Save storage", exact: true }).click();
      await expect
        .poll(async () => {
          const result = readKnowledgeCatalog.output.parse(
            await client.invokePluginRpc("otto-project-knowledge", readKnowledgeCatalog.name, {
              scope,
              includeInactive: true,
              query: "",
              offset: 0,
              limit: 50,
            }),
          );
          return result.ok ? result.value.settings.location : "unavailable";
        })
        .toBe("host");
      expect(await readFile(sourcePath)).toEqual(original);
      await page.screenshot({ path: testInfo.outputPath("knowledge-host-settings.png") });
      await proveConfirmedPurge(page, surface, client, scope, `${id}-purge`);
      await surface
        .getByTestId(`knowledge-record-${id}`)
        .getByRole("button", { name: "Open", exact: true })
        .click();
      const hosted = readKnowledgeCatalog.output.parse(
        await client.invokePluginRpc("otto-project-knowledge", readKnowledgeCatalog.name, {
          scope,
          includeInactive: true,
          query: "",
          offset: 0,
          limit: 50,
        }),
      );
      if (!hosted.ok) throw new Error(hosted.error.message);
      await unlink(path.join(hosted.value.settings.path, "knowledge/requirements", `${id}.md`));
      await expect(surface.getByTestId(`knowledge-record-${id}`)).toHaveCount(0);
      await expect(surface.getByRole("button", { name: "Edit truth", exact: true })).toHaveCount(0);
      await expect(surface.getByRole("button", { name: "Back to pages", exact: true })).toHaveCount(
        0,
      );
      await expect(surface.getByRole("button", { name: "New entry", exact: true })).toBeVisible();
      expect(await readFile(sourcePath)).toEqual(original);
      await proveLinkHealth(surface, client, scope, project.workspaceId);
      await proveFormatConversion(page, surface, client, scope, project, id);
      await page.screenshot({ path: testInfo.outputPath("knowledge-format-conversion.png") });
    } finally {
      try {
        await client.close();
      } finally {
        await project.cleanup();
      }
    }
  });
}
