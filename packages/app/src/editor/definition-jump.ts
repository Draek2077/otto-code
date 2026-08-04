import { absolutePathsEqual, resolveWorkspaceFilePaths } from "@/workspace/file-open";

/**
 * Where a resolved definition should land. Both go-to-definition sources reach
 * here, and they answer in DIFFERENT path shapes: the ctags index reports
 * workspace-relative paths, while a language server reports absolute native
 * ones - backslashes and a drive letter on Windows, because the daemon converts
 * the server's `file://` URI with `fileURLToPath`. Comparing those raw strings
 * against the open tab's path is how a definition in the very file you are
 * reading ends up opening a second tab of that same file.
 *
 * So both sides are resolved to one canonical absolute form before anything is
 * decided, and the path handed on for an open is re-expressed workspace-relative
 * when it lives inside the workspace - the same shape the file explorer and chat
 * links use, so the tab that opens is the tab that is already there rather than
 * a duplicate keyed on the absolute spelling.
 */

export interface DefinitionJumpTarget {
  path: string;
  line: number;
}

export type DefinitionJumpPlan =
  /** The definition is in the open buffer - move the caret, don't open a tab. */
  | { kind: "in-file"; line: number }
  /** The definition is in another file - open it at that line. */
  | { kind: "open"; target: DefinitionJumpTarget };

export function planDefinitionJump(input: {
  target: DefinitionJumpTarget;
  /** The file the editor is showing; may be workspace-relative or absolute. */
  openPath: string;
  workspaceRoot: string;
}): DefinitionJumpPlan {
  const { target, openPath, workspaceRoot } = input;
  const openFile = resolveWorkspaceFilePaths({ path: openPath, workspaceRoot });
  const resolvedTarget = resolveWorkspaceFilePaths({ path: target.path, workspaceRoot });

  if (
    openFile &&
    resolvedTarget &&
    absolutePathsEqual(openFile.absolutePath, resolvedTarget.absolutePath)
  ) {
    return { kind: "in-file", line: target.line };
  }

  // An unresolvable path is left exactly as it arrived: rewriting one we could
  // not anchor would be guessing, and the opener has more context than we do.
  const path = resolvedTarget
    ? (resolvedTarget.relativePath ?? resolvedTarget.absolutePath)
    : target.path;
  return { kind: "open", target: { path, line: target.line } };
}
