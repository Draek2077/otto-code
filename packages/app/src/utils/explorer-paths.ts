import { isAbsolutePath } from "./path";

interface BuildAbsoluteExplorerPathInput {
  workspaceRoot: string;
  entryPath: string;
}

export function buildAbsoluteExplorerPath({
  workspaceRoot,
  entryPath,
}: BuildAbsoluteExplorerPathInput): string {
  const normalizedWorkspaceRoot = workspaceRoot.trim().replace(/[\\/]+$/, "");
  const normalizedEntryPath = entryPath.trim();

  if (!normalizedWorkspaceRoot) {
    return normalizedEntryPath;
  }

  if (!normalizedEntryPath || normalizedEntryPath === ".") {
    return normalizedWorkspaceRoot;
  }

  if (isAbsolutePath(normalizedEntryPath)) {
    return normalizedEntryPath;
  }

  const separator = normalizedWorkspaceRoot.includes("\\") ? "\\" : "/";
  const segments = normalizedEntryPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return normalizedWorkspaceRoot;
  }

  return `${normalizedWorkspaceRoot}${separator}${segments.join(separator)}`;
}

/**
 * Explorer paths on the wire are always workspace-relative and always
 * forward-slashed, with "." for the root - so the three helpers below are plain
 * string surgery rather than anything platform-aware. Do not reach for
 * `path.posix` here: the app bundle has no node:path on native.
 */
export function explorerParentPath(entryPath: string): string {
  const index = entryPath.lastIndexOf("/");
  return index < 0 ? "." : entryPath.slice(0, index) || ".";
}

export function explorerBaseName(entryPath: string): string {
  const index = entryPath.lastIndexOf("/");
  return index < 0 ? entryPath : entryPath.slice(index + 1);
}

export function joinExplorerPath(parentPath: string, name: string): string {
  const parent = parentPath.trim();
  return !parent || parent === "." ? name : `${parent}/${name}`;
}
