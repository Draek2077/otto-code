import { resolve, win32 } from "node:path";
import { isGitHubHost, parseGitRemoteLocation } from "@otto-code/protocol/git-remote";
import { getRealpathAwareRelativePath, normalizePathForIdentity } from "../utils/path.js";

/**
 * Persisted opaque key used to join the same remote across hosts.
 *
 * GitHub owner/repo is case-insensitive, so the remote path is lowercased and
 * two clones spelled differently collapse to one project. That changed in the
 * v0.2.5 merge: keys persisted before it kept the original case.
 *
 * **Never compare a stored `projectId` against a value from this function.**
 * Upgrading installs still carry mixed-case ids, and legacy ids were derived
 * from this same shape, so such a comparison reads as "different project" and
 * duplicates it. Nothing does this today and the upgrade is safe because
 * lookups go through `rootPath` and rewrite a stale `projectKey` in place
 * (pinned by `workspace-registry.test.ts`). `projectId` is opaque: workspace
 * records point at it, so it is deliberately never re-derived.
 */
export function deriveProjectKey(input: {
  rootPath: string;
  remoteUrl: string | null;
  worktreeRoot: string | null;
  mainRepoRoot: string | null;
  serverId?: string;
}): string {
  const remote = input.remoteUrl ? parseGitRemoteLocation(input.remoteUrl) : null;
  const selectedPath = input.worktreeRoot
    ? getRealpathAwareRelativePath(input.worktreeRoot, input.rootPath) || null
    : null;
  if (remote) {
    const host = remote.port ? `${remote.host}:${remote.port}` : remote.host;
    const path = isGitHubHost(remote.host) ? remote.path.toLowerCase() : remote.path;
    const remoteKey = `remote:${host}/${path}`;
    return selectedPath ? `${remoteKey}#subdir:${selectedPath.replaceAll("\\", "/")}` : remoteKey;
  }

  const localPathParts = [
    selectedPath && input.mainRepoRoot ? input.mainRepoRoot : input.rootPath,
    selectedPath && input.mainRepoRoot ? selectedPath : "",
  ];
  const resolvedLocalPath = localPathParts.some(looksLikeWindowsPath)
    ? win32.resolve(...localPathParts)
    : resolve(...localPathParts);
  const localPath = normalizePathForIdentity(resolvedLocalPath);
  return input.serverId ? `host:${input.serverId}:${localPath}` : localPath;
}

export function deriveProjectGroupingDisplayName(input: {
  rootPath: string;
  remoteUrl: string | null;
  worktreeRoot: string | null;
}): string {
  const selectedPath = input.worktreeRoot
    ? getRealpathAwareRelativePath(input.worktreeRoot, input.rootPath)
    : null;
  if (selectedPath) return lastPathSegment(input.rootPath);

  const remote = input.remoteUrl ? parseGitRemoteLocation(input.remoteUrl) : null;
  if (!remote) return lastPathSegment(input.rootPath);
  return remote.path.split("/").filter(Boolean).slice(-2).join("/") || input.rootPath;
}

function lastPathSegment(inputPath: string): string {
  const segments = inputPath.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? inputPath;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(value);
}
