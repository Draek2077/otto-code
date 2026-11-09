import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type * as Views from "@getpaseo/plugin/otto/architectural-views";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect } from "../support/helpers/otto-provider-settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { buildPluginSurfaceRoute } from "../../src/plugins/routes";
import { viewStarter } from "../../../server/src/server/otto/architectural-views/starter";

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
function viewApi(client: Client) {
  const rpc: typeof Views = createRequire(__filename)("@getpaseo/plugin/otto/architectural-views");
  async function call<I extends z.ZodType, T>(
    contract: PluginRpcContract<
      I,
      z.ZodType<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>
    >,
    input: z.input<NoInfer<I>>,
  ): Promise<T> {
    const result = contract.output.parse(
      await client.invokePluginRpc(
        "otto-architectural-views",
        contract.name,
        contract.input.parse(input),
      ),
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
  }
  return { rpc, call };
}
const completion = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
  tools: z
    .array(
      z.object({ function: z.object({ name: z.string(), description: z.string().optional() }) }),
    )
    .optional(),
});
function findDraft(
  rpc: typeof Views,
  messages: z.infer<typeof completion>["messages"],
): Views.ViewDraft | null {
  const pending = messages.filter((row) => row.role === "tool").map((row) => row.content);
  let count = 0;
  while (pending.length && count++ < 500) {
    const value = pending.pop();
    if (typeof value === "string") {
      try {
        pending.push(JSON.parse(value));
      } catch {
        /* Ordinary tool prose is not a draft. */
      }
      continue;
    }
    const parsed = rpc.ViewDocument.safeParse(value);
    if (parsed.success && parsed.data.kind === "draft") return parsed.data.draft;
    if (value && typeof value === "object") pending.push(...Object.values(value));
  }
  return null;
}
for (const compact of [false, true])
  test(`Architectural Views author, repair, publish and export with native chat (${compact ? "compact" : "wide"})`, async ({
    page,
    ottoProvider,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize(
      compact ? { width: 520, height: 900 } : { width: 1440, height: 980 },
    );
    const workspace = await seedWorkspace({
      repoPrefix: "otto-views-",
      title: "Architecture acceptance",
      git: false,
    });
    const client = await connectDaemonClient<Client>({ clientIdPrefix: "views-proof" });
    const { rpc, call } = viewApi(client);
    const scope = {
      hostId: getServerId(),
      target: { kind: "workspace" as const, id: workspace.workspaceId },
    };
    let phase = 0;
    try {
      ottoProvider.replyWith((raw) => {
        const body = completion.parse(raw);
        if (
          body.messages.some(
            (row) =>
              typeof row.content === "string" &&
              row.content.startsWith("Generate a title and a git branch name"),
          )
        )
          return JSON.stringify({ title: "Architecture author", branch: "architecture-author" });
        if (!body.tools?.length) return "Ordinary generation completed.";
        const read = body.tools.find((row) =>
          row.function.description?.startsWith("Read only this chat's bound authoring draft"),
        );
        const update = body.tools.find((row) =>
          row.function.description?.startsWith(
            "Validate and replace only this chat's exact bound draft",
          ),
        );
        if (!read || !update)
          throw new Error("The normal provider did not receive the View authoring tools");
        const tool = (name: string, args: object) => ({
          toolCalls: [{ id: `view-step-${phase}`, name, arguments: JSON.stringify(args) }],
        });
        if (phase++ === 0) return tool(read.function.name, {});
        const draft = findDraft(rpc, body.messages);
        if (!draft) throw new Error("No exact bound draft revision in the tool result");
        if (phase === 2)
          return tool(update.function.name, {
            expectedRevision: draft.revision,
            specification: {
              schema_version: 1,
              diagram_type: "architecture",
              meta: { title: "Invalid geometry" },
              components: [],
            },
          });
        if (phase === 3)
          return tool(update.function.name, {
            expectedRevision: draft.revision,
            title: "Authored architecture",
            specification: viewStarter("architecture", "Source-backed acceptance"),
          });
        return "Architectural View authored and repaired. Human publication is required.";
      });
      await ottoProvider.refreshCatalog();
      await mkdir(path.join(workspace.repoPath, ".otto/knowledge"), { recursive: true });
      await writeFile(
        path.join(workspace.repoPath, ".otto/knowledge/architecture.md"),
        "# Architecture\n\nAcceptance source.\n",
      );
      await gotoAppShell(page);
      if (compact)
        await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
      await expect(page.getByTestId("plugin-sidebar-otto-architectural-views-views")).toBeVisible();
      const route = (target: object) =>
        buildPluginSurfaceRoute(
          getServerId(),
          "otto-architectural-views",
          { kind: "surface", id: "views" },
          {
            projectId: workspace.projectId,
            projectHostId: getServerId(),
            target: JSON.stringify(target),
          },
        );
      await page.goto(route({ reference: { kind: "root", id: "architecture" } }));
      const library = page.getByTestId("architectural-view-library").filter({ visible: true });
      await library.getByRole("button", { name: "New View", exact: true }).click();
      const create = library.getByTestId("architectural-view-create");
      await create.getByLabel("Title", { exact: true }).fill("Architecture acceptance");
      await create.getByRole("button", { name: "Create draft", exact: true }).click();
      await expect(
        library.getByText("Staged starter. Author or edit it before publication.", { exact: true }),
      ).toBeVisible();
      const catalog = await call(rpc.readViews, { scope });
      expect(catalog.drafts).toHaveLength(1);
      const draft = catalog.drafts[0];
      const identity = { viewId: draft.viewId, origin: draft.origin };
      const author = await call(rpc.startViewAuthoring, {
        scope,
        identity,
        draftId: draft.draftId,
        expectedRevision: draft.revision,
        workspaceId: workspace.workspaceId,
        selection: { provider: "openai-compatible", model: "fixture", modeId: "bypassPermissions" },
        userApproved: true,
      });
      await expect
        .poll(
          async () => {
            const doc = await call(rpc.readView, {
              scope,
              identity,
              selection: { kind: "draft", draftId: draft.draftId },
            });
            return doc.kind === "draft" ? doc.draft.title : "missing";
          },
          { timeout: 60000 },
        )
        .toBe("Authored architecture");
      expect(phase).toBeGreaterThanOrEqual(3);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: author.agentId });
      if (compact)
        await page
          .getByRole("button", { name: "View", exact: true })
          .filter({ visible: true })
          .click();
      else {
        await expect(page.getByTestId("architectural-view-authoring-chat")).toBeVisible();
        await expect(page.getByTestId("architectural-view-authoring-preview")).toBeVisible();
      }
      const editor = page.getByTestId("architectural-view-draft").filter({ visible: true });
      await expect(editor.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
      const inner = page
        .frameLocator('iframe[title="Architectural View"]')
        .frameLocator('iframe[title="Artifact content"]');
      await expect(inner.locator("svg").first()).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "Zoom in", exact: true }).filter({ visible: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Zoom in", exact: true })
        .filter({ visible: true })
        .click();
      const dialog = page.waitForEvent("dialog");
      const publishing = editor.getByRole("button", { name: "Publish", exact: true }).click();
      await (await dialog).accept();
      await publishing;
      await expect(
        page.getByRole("button", { name: "Update View", exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Export diagram", exact: true })
        .filter({ visible: true })
        .click();
      const downloading = page.waitForEvent("download");
      await page.getByText("SVG diagram", { exact: true }).filter({ visible: true }).click();
      const download = await downloading;
      const exported = testInfo.outputPath("architecture.svg");
      await download.saveAs(exported);
      expect(await readFile(exported, "utf8")).toContain("<svg");
      await page.screenshot({
        path: testInfo.outputPath(`views-${compact ? "compact" : "wide"}.png`),
        fullPage: true,
      });
      const published = await call(rpc.readView, {
        scope,
        identity,
        selection: { kind: "published" },
      });
      expect(published.kind).toBe("published");
      const changes = await call(rpc.createViewDraft, {
        scope,
        viewId: identity.viewId,
        draftId: "update-proof",
        operationId: "update-proof",
        title: "Second revision",
        diagramType: "architecture",
        knowledgeReferences: draft.knowledgeReferences,
        published: {
          ...identity,
          revision: published.kind === "draft" ? "" : published.view.revision,
        },
        specification: viewStarter("architecture", "Changed architecture"),
      });
      const second = await call(rpc.publishViewDraft, {
        scope,
        identity,
        draftId: changes.draftId,
        expectedRevision: changes.revision,
        operationId: "publish-second",
        userApproved: true,
      });
      expect((await call(rpc.listViewRevisions, { scope, identity })).revisions).toHaveLength(1);
      await expect(
        call(rpc.removeView, {
          scope,
          identity,
          expectedRevision: draft.revision,
          operationId: "stale-removal",
          userApproved: true,
        }),
      ).rejects.toThrow("conflict");
      await call(rpc.showView, { scope, identity, workspaceId: workspace.workspaceId });
      expect((await call(rpc.readViews, { scope })).views[0].revision).toBe(second.revision);
      for (const diagramType of rpc.ViewKind.options.filter((kind) => kind !== "architecture")) {
        const staged = await call(rpc.createViewDraft, {
          scope,
          viewId: `${diagramType}-proof`,
          draftId: "draft-first",
          operationId: `create-${diagramType}`,
          title: `${diagramType} proof`,
          diagramType,
          knowledgeReferences: draft.knowledgeReferences,
          published: null,
          specification: viewStarter(diagramType, `${diagramType} proof`),
        });
        const id = { viewId: staged.viewId, origin: staged.origin };
        const view = await call(rpc.publishViewDraft, {
          scope,
          identity: id,
          draftId: staged.draftId,
          expectedRevision: staged.revision,
          operationId: `publish-${diagramType}`,
          userApproved: true,
        });
        const content = await call(rpc.renderView, {
          scope,
          identity: id,
          selection: { kind: "published" },
          expectedRevision: view.revision,
        });
        expect(content.parts).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
      await workspace.cleanup();
    }
  });
