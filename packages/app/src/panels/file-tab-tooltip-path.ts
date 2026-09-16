import type { WorkspaceFileTabTarget } from "@/workspace/file-open";
import { isAbsolutePath } from "@/utils/path";

/**
 * The path a File Editor tab shows on hover: relative to the workspace that
 * hosts the tab when the file lives inside it, otherwise the full path.
 *
 * A tab with an `origin` is served from another workspace (or from its own
 * directory), so its `path` is relative to `origin.cwd` and it is by
 * definition not in the hosting workspace.
 */
export function formatFileTabTooltipPath(
  target: Pick<WorkspaceFileTabTarget, "path" | "origin">,
  workspaceRoot: string | null | undefined,
): string {
  const path = toForwardSlashes(target.path);
  if (target.origin) {
    return isAbsolutePath(path) ? path : joinPath(toForwardSlashes(target.origin.cwd), path);
  }
  if (!isAbsolutePath(path) || !workspaceRoot) {
    return path;
  }
  const root = toForwardSlashes(workspaceRoot).replace(/\/+$/, "");
  const prefix = `${root}/`;
  // Windows paths compare case-insensitively; POSIX paths never do.
  const caseInsensitive = /^[A-Za-z]:\//.test(root);
  const comparablePath = caseInsensitive ? path.toLowerCase() : path;
  const comparablePrefix = caseInsensitive ? prefix.toLowerCase() : prefix;
  return comparablePath.startsWith(comparablePrefix) ? path.slice(prefix.length) : path;
}

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function joinPath(root: string, child: string): string {
  return `${root.replace(/\/+$/, "")}/${child.replace(/^\.?\/+/, "")}`;
}
