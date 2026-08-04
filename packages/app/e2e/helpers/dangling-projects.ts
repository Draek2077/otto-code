import { existsSync } from "node:fs";
import { connectSeedClient } from "./seed-client";

/**
 * Remove daemon projects whose root directory no longer exists on disk.
 *
 * Specs seed a temp directory, register it as a project, and delete the
 * directory when they finish - routinely before, or instead of, removing the
 * project record. The shard's daemon is shared and long-lived, so the dead
 * project keeps being served for the rest of the run, and it poisons every spec
 * that comes after:
 *
 * - The New Workspace composer preselects the last active project and asks the
 *   daemon to list that draft's provider features. `listDraftFeatures` stats the
 *   cwd through `normalizeConfig` and throws `Working directory does not exist`,
 *   which the client retries at 1s/2s/4s. In CI run 30768976339 one leaked
 *   directory produced 35 of these over the 13 minutes *after* its owning test
 *   had finished, and took most of shard 4 with it.
 * - The file explorer realpaths the active workspace directory on boot and
 *   fails the same way (36 hits against the same directory).
 * - `WorkspaceGitServiceImpl.startWorkspaceWatchers` tries to watch
 *   `<gone>/.git/refs/heads` and throws ENOENT.
 *
 * Specs should still tear their own records down - that is the ordering rule:
 * remove daemon records first, delete the directory second. This sweep is the
 * net under it, because the failure mode is silent in the owning spec and only
 * shows up as unrelated specs failing later.
 *
 * A project whose root directory is gone is garbage by definition, so this is
 * safe for suites that deliberately share a project across their tests: their
 * directory still exists while they run. Specs that delete a *workspace*
 * directory on purpose (worktree restore/recovery) keep their project root, so
 * they are untouched.
 */
export async function sweepDanglingProjects(): Promise<string[]> {
  const removedProjectIds: string[] = [];
  const client = await connectSeedClient();
  try {
    const { projects } = await client.listProjects();
    for (const project of projects) {
      if (existsSync(project.projectRootPath)) {
        continue;
      }
      await client.removeProject(project.projectId);
      removedProjectIds.push(`${project.projectId} (${project.projectRootPath})`);
    }
  } finally {
    await client.close().catch(() => undefined);
  }
  return removedProjectIds;
}
