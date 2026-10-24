/** Real isolated daemon project configuration; no tracker API, agent, model, or runtime calls. */
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  getProjectConfiguration,
  setProjectTarget,
  type ProjectConfiguration,
} from "@getpaseo/plugin/otto/kanban";
import { test as base, expect, type Page } from "../fixtures";
import { connectDaemonClient } from "./daemon-client-loader";
import { seedWorkspace, type SeededWorkspace } from "./seed-client";
import { getServerId } from "./server-id";

type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
interface KanbanFixture {
  project: SeededWorkspace;
  read(): Promise<ProjectConfiguration>;
  write(target: ProjectConfiguration["target"]): Promise<ProjectConfiguration>;
}

export const test = base.extend<{ kanban: KanbanFixture }>({
  kanban: async ({ e2eWorker }, provide) => {
    void e2eWorker;
    const project = await seedWorkspace({
      repoPrefix: "otto-kanban-",
      title: "Kanban fixture",
      git: false,
    });
    let connection: Client | null = null;
    try {
      const client = await connectDaemonClient<Client>({ clientIdPrefix: "otto-kanban-ui" });
      connection = client;
      const binding = { hostId: getServerId(), projectId: project.projectId };
      const read = async () => {
        const result = getProjectConfiguration.output.parse(
          await client.invokePluginRpc("otto-kanban", getProjectConfiguration.name, binding),
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      await provide({
        project,
        read,
        write: async (target) => {
          const result = setProjectTarget.output.parse(
            await client.invokePluginRpc("otto-kanban", setProjectTarget.name, {
              binding,
              expectedRevision: (await read()).settingsRevision,
              target,
            }),
          );
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      });
    } finally {
      try {
        await connection?.close();
      } finally {
        await project.cleanup();
      }
    }
  },
});
export { expect };

export async function openKanban(page: Page, compact: boolean): Promise<void> {
  if (compact) await page.getByRole("button", { name: "Open menu", exact: true }).first().click();
  await page.locator('[data-testid="plugin-sidebar-otto-kanban-kanban"]:visible').first().click();
  await expect(page.getByRole("button", { name: "Project Settings", exact: true })).toBeVisible();
}
