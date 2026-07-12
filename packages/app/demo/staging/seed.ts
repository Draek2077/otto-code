import { connectSeedClient, type SeedDaemonClient } from "../../e2e/helpers/seed-client";
import { materializeTemplate, type MaterializedRepo } from "./materialize";

/**
 * Seeds one staged demo repo into the isolated demo daemon: materializes the
 * template into a real git checkout and opens it as a project/workspace over
 * the daemon WebSocket. Scenarios build on this the same way e2e specs build
 * on seedWorkspace().
 */

export interface DemoWorkspace {
  repo: MaterializedRepo;
  client: SeedDaemonClient;
  workspaceId: string;
  projectId: string;
  projectDisplayName: string;
  cleanup(): Promise<void>;
}

export async function seedDemoWorkspace(input: {
  template: string;
  originOwner: string;
  title?: string;
}): Promise<DemoWorkspace> {
  const repo = await materializeTemplate(input.template, { originOwner: input.originOwner });
  const client = await connectSeedClient();
  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
      title: input.title,
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to open demo workspace at ${repo.path}`);
    }
    // Make the daemon's git snapshot authoritative before the UI reads it, so
    // the staged working changes are visible without racing the fs watcher.
    await client.checkoutRefresh(repo.path);
    const workspace = created.workspace;
    return {
      repo,
      client,
      workspaceId: workspace.id,
      projectId: workspace.projectId,
      projectDisplayName: workspace.projectDisplayName,
      cleanup: async () => {
        await client.removeProject(workspace.projectId).catch(() => undefined);
        await client.close().catch(() => undefined);
        await repo.cleanup().catch(() => undefined);
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
    throw error;
  }
}
