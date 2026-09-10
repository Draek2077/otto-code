import path from "node:path";

/** Resolve worktrees to their owning project, including worktrees outside the checkout. */
export function resolveForgeProjectScope(
  cwd: string,
  projects: { projectId: string; rootPath: string; archivedAt?: string | null }[],
  workspaces: {
    projectId: string;
    cwd: string;
    worktreeRoot?: string | null;
    archivedAt?: string | null;
  }[],
): string | null {
  const active = projects.filter((p) => !p.archivedAt);
  const roots = [
    ...active.map((p) => ({ root: p.rootPath, projectId: p.projectId })),
    ...workspaces
      .filter((w) => !w.archivedAt && active.some((p) => p.projectId === w.projectId))
      .map((w) => ({ root: w.worktreeRoot ?? w.cwd, projectId: w.projectId })),
  ].sort((a, b) => b.root.length - a.root.length);
  return (
    roots.find(({ root }) => {
      const relative = path.relative(root, cwd);
      return (
        relative === "" ||
        (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      );
    })?.projectId ?? null
  );
}
