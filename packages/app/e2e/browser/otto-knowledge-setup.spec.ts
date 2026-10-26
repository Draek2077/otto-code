import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  inspectKnowledgeStorage,
  readKnowledgeCatalog,
  readKnowledgeHostDefaults,
  saveKnowledgeHostDefaults,
  readKnowledgePage,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { test, expect } from "../support/fixtures";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { callKnowledgeMcp, openWorkspaceKnowledge } from "../support/helpers/otto-knowledge";

test.use({ e2eDaemonConfig: { pluginsEnabled: true } });
type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
async function defaults(client: Client) {
  const response = readKnowledgeHostDefaults.output.parse(
    await client.invokePluginRpc("otto-project-knowledge", readKnowledgeHostDefaults.name, {
      hostId: getServerId(),
    }),
  );
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}
async function useDefault(input: { client: Client; location: "repository" | "host" }) {
  const current = await defaults(input.client);
  if (current.defaultStoreLocation === input.location) return;
  const response = saveKnowledgeHostDefaults.output.parse(
    await input.client.invokePluginRpc("otto-project-knowledge", saveKnowledgeHostDefaults.name, {
      hostId: getServerId(),
      expectedRevision: current.revision,
      defaultStoreLocation: input.location,
    }),
  );
  if (!response.ok) throw new Error(response.error.message);
}
async function catalog(input: { client: Client; scope: KnowledgeScope }) {
  return readKnowledgeCatalog.output.parse(
    await input.client.invokePluginRpc("otto-project-knowledge", readKnowledgeCatalog.name, {
      scope: input.scope,
      includeInactive: true,
      query: "",
      offset: 0,
      limit: 50,
    }),
  );
}
async function seedRetained(project: SeededWorkspace) {
  const home = process.env.E2E_PASEO_HOME;
  if (
    !home ||
    !path.isAbsolute(home) ||
    path.resolve(home) === path.join(os.homedir(), ".otto") ||
    !getServerId().startsWith("srv_e2e_worker_")
  )
    throw new Error("Retained fixtures require the isolated worker home");
  const directoryName = `retained-${project.projectId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  const directory = path.join(home, "project-knowledge", directoryName);
  await mkdir(path.join(directory, "knowledge/requirements"), { recursive: true });
  const marker = JSON.stringify({
    projectId: project.projectId,
    projectKey: project.projectKey,
    rootPath: project.repoPath,
    updatedAt: "2026-01-01T00:00:00Z",
    future: "keep-marker",
  });
  const body =
    '---\nid: retained-proof\nkind: requirement\ntitle: Retained host proof\nstatus: confirmed\ntags: []\ncreated_at: "2026-01-01T00:00:00.000Z"\nupdated_at: "2026-01-01T00:00:00.000Z"\nfuture: keep-record\n---\n# Retained host proof\n\n<!-- compiled_truth -->\n\nRetained truth from the original host store.\n\n## Timeline\n\n- time: "2026-01-01T00:00:00.000Z"\n  kind: evidence\n  summary: Original retained evidence\n  future: keep-history\n';
  const file = path.join(directory, "knowledge/requirements/retained-proof.md");
  const markerFile = path.join(directory, "project.json");
  await writeFile(markerFile, marker);
  await writeFile(file, body);
  return { directoryName, directory, file, markerFile, body, marker };
}

for (const compact of [false, true]) {
  for (const choice of ["new", "retained", "repository"] as const) {
    test(`Knowledge ${choice} storage setup preserves owning-host identity (${compact ? "compact" : "wide"})`, async ({
      page,
    }, testInfo) => {
      if (compact) await page.setViewportSize({ width: 390, height: 844 });
      const client = await connectDaemonClient<Client>({ clientIdPrefix: "knowledge-setup-proof" });
      const origin = await defaults(client);
      const project = await seedWorkspace({
        repoPrefix: "otto-knowledge-setup-",
        title: "Storage setup fixture",
        git: false,
      });
      const scope: KnowledgeScope = {
        hostId: getServerId(),
        target: { kind: "workspace", id: project.workspaceId },
      };
      try {
        await useDefault({ client, location: "host" });
        const retained = choice === "retained" ? await seedRetained(project) : null;
        const surface = await openWorkspaceKnowledge({
          page,
          workspaceId: project.workspaceId,
          compact,
        });
        const setup = surface.getByTestId("knowledge-storage-setup");
        await expect(setup).toBeVisible();
        await setup.getByRole("button", { name: "Inspect host stores", exact: true }).click();
        const preview = inspectKnowledgeStorage.output.parse(
          await callKnowledgeMcp("inspect_project_knowledge_storage", {
            workspaceId: project.workspaceId,
          }),
        );
        if (!preview.ok) throw new Error(preview.error.message);
        expect(preview.value.required).toBe(true);
        const label = storageLabel({ choice, retained, project });
        await setup
          .getByRole("button", { name: "Storage choice: Choose a setup action", exact: true })
          .click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        page.once("dialog", (dialog) => void dialog.dismiss());
        await setup.getByRole("button", { name: "Apply storage choice", exact: true }).click();
        expect(await catalog({ client, scope })).toMatchObject({ ok: false });
        await expect(
          setup.getByRole("button", { name: `Storage choice: ${label}`, exact: true }),
        ).toBeVisible();
        page.once("dialog", (dialog) => void dialog.accept());
        await setup.getByRole("button", { name: "Apply storage choice", exact: true }).click();
        await expect(
          surface.getByRole("button", { name: "Initialize roots", exact: true }),
        ).toBeVisible();
        await surface.getByRole("button", { name: "Initialize roots", exact: true }).click();
        await expect
          .poll(async () => {
            const result = await catalog({ client, scope });
            return result.ok
              ? result.value.roots.filter((root) => root.revision !== null).length
              : 0;
          })
          .toBe(6);
        const saved = await catalog({ client, scope });
        if (!saved.ok) throw new Error(saved.error.message);
        expect(saved.value.settings.location).toBe(choice === "repository" ? "repository" : "host");
        if (retained) {
          expect(saved.value.settings.directoryName).toBe(retained.directoryName);
          expect(await readFile(retained.file, "utf8")).toBe(retained.body);
          expect(await readFile(retained.markerFile, "utf8")).toBe(retained.marker);
          await surface
            .getByTestId("knowledge-record-retained-proof")
            .getByRole("button", { name: "Open", exact: true })
            .click();
          await expect(
            surface.getByText("Retained truth from the original host store.", { exact: true }),
          ).toBeVisible();
          const pageRead = readKnowledgePage.output.parse(
            await callKnowledgeMcp("read_project_knowledge", {
              workspaceId: project.workspaceId,
              id: "retained-proof",
            }),
          );
          expect(pageRead).toMatchObject({
            ok: true,
            value: { status: "confirmed", timeline: expect.stringContaining("keep-history") },
          });
        }
        await page.screenshot({ path: testInfo.outputPath(`knowledge-setup-${choice}.png`) });
      } finally {
        try {
          await useDefault({ client, location: origin.defaultStoreLocation });
        } finally {
          try {
            await project.cleanup();
          } finally {
            await client.close();
          }
        }
      }
    });
  }
}

function storageLabel(input: {
  choice: "new" | "retained" | "repository";
  retained: Awaited<ReturnType<typeof seedRetained>> | null;
  project: SeededWorkspace;
}) {
  if (input.choice === "new") return "Create a new empty host store";
  if (input.choice === "repository") return "Use repository storage instead";
  if (!input.retained) throw new Error("Retained fixture is missing");
  return `Reconnect ${input.retained.directoryName} (${input.project.repoPath})`;
}
