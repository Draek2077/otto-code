// OTTO(storage): browser fixtures seed the physical Otto storage keys.
import { startIsolatedHostDaemon } from "./isolated-host-daemon";
import { seedWorkspace, type SeededWorkspace } from "./seed-client";

export const SECONDARY_MODEL_ID = "one-minute-stream";
export const SECONDARY_MODEL_LABEL = "One minute stream";

export async function createScheduleHost() {
  const daemon = await startIsolatedHostDaemon("schedule-secondary-host");
  let workspace: SeededWorkspace | undefined;
  try {
    workspace = await seedWorkspace({ repoPrefix: "schedule-secondary-", port: daemon.port });
    const seeded = workspace;
    await seeded.client.renameProject(seeded.projectId, "Secondary project");
    return {
      ...seeded,
      projectDisplayName: "Secondary project",
      serverId: daemon.serverId,
      port: daemon.port,
      label: "Secondary host",
      cleanup: async () => {
        await seeded.cleanup();
        await daemon.close();
      },
    };
  } catch (error) {
    await workspace?.cleanup();
    await daemon.close();
    throw error;
  }
}
