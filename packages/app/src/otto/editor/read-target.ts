import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { isAbsolutePath } from "@/utils/path";
/** Explicit external files use their parent, not '/' or a whole drive, as the
 * single-file scope. Registered-workspace browsing remains owned by Paseo. */
export function resolveEditorReadTarget(input: { path: string; workspaceRoot?: string }) {
  const original = resolveFilePreviewReadTarget(input);
  if (!original || !isAbsolutePath(input.path)) return original;
  const known = input.workspaceRoot
    ? resolveWorkspaceFilePaths({ path: input.path, workspaceRoot: input.workspaceRoot })
    : null;
  if (known?.relativePath)
    return { cwd: input.workspaceRoot ?? original.cwd, path: known.absolutePath };
  const absolute =
    resolveWorkspaceFilePaths({ path: input.path, workspaceRoot: original.cwd })?.absolutePath ??
    input.path.replace(/\\/gu, "/");
  const index = absolute.lastIndexOf("/");
  let parent = absolute.slice(0, index);
  if (!parent) parent = "/";
  else if (/^[A-Za-z]:$/u.test(parent)) parent += "/";
  return { cwd: parent, path: absolute };
}
