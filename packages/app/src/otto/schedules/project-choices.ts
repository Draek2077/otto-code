import type { ProjectSummary } from "@/utils/projects";
import { buildProjectOptionId } from "@/schedules/schedule-project-targets";
import type { ScheduleProjectChoice } from "./native-fields";

/** Carry canonical project IDs from the host registry. Never derive identity or
 * a remote path from a client working directory or from the first workspace. */
export function scheduleProjectChoices(
  projects: readonly ProjectSummary[],
  hostIds: readonly string[],
  multiplicity: ReadonlyMap<string, boolean>,
): ScheduleProjectChoice[] {
  const allowed = new Set(hostIds),
    choices: ScheduleProjectChoice[] = [];
  for (const project of projects)
    for (const host of project.hosts) {
      if (!allowed.has(host.serverId)) continue;
      choices.push({
        projectId: host.projectId,
        label: host.projectName,
        target: {
          optionId: buildProjectOptionId(host.serverId, project.viewKey),
          serverId: host.serverId,
          serverName: host.serverName,
          projectViewKey: project.viewKey,
          projectName: host.projectName,
          cwd: host.repoRoot,
          isGit: !!host.gitRuntime,
        },
        supportsWorkspaceMultiplicity: multiplicity.get(host.serverId) === true,
        workspaces: host.workspaces
          .filter((row) => !row.archivingAt)
          .map((row) => ({ value: row.id, label: row.title ?? row.name })),
      });
    }
  return choices;
}
