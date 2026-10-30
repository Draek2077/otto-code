import path from "node:path";

/** Worktrees may be outside their project root; registered workspace ownership wins. */
export function bitbucketProjectForCwd(
  cwd: string,
  workspaces: readonly { cwd: string; projectId: string }[],
  projects: readonly { rootPath: string; projectId: string }[],
): string | undefined {
  const absolute = path.resolve(cwd);
  const registered = workspaces.map((workspace) => ({
    root: workspace.cwd,
    id: workspace.projectId,
  }));
  return (
    select(absolute, registered) ??
    select(
      absolute,
      projects.map((project) => ({ root: project.rootPath, id: project.projectId })),
    )
  );
}
function select(
  absolute: string,
  candidates: readonly { root: string; id: string }[],
): string | undefined {
  let selected: { root: string; id: string } | undefined;
  for (const candidate of candidates) {
    const relative = path.relative(path.resolve(candidate.root), absolute);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep))
      continue;
    if (!selected || candidate.root.length > selected.root.length) selected = candidate;
  }
  return selected?.id;
}
