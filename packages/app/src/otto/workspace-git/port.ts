import {
  readGitFetchPolicy,
  saveGitFetchPolicy,
  fetchWorkspaceGit,
  type GitFetchPreferences,
  type GitFetchSettings,
} from "@getpaseo/plugin/otto/workspace-git";

export interface GitFetchPort {
  read(): Promise<GitFetchSettings>;
  save(revision: string, patch: Partial<GitFetchPreferences>): Promise<GitFetchSettings>;
  fetch(workspaceId: string): Promise<void>;
}
export class GitFetchError extends Error {}
function accepted<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new GitFetchError(result.error.message);
  return result.value;
}
export function createGitFetchPort(
  hostId: string,
  invoke: (method: string, input: unknown, timeoutMs?: number) => Promise<unknown>,
): GitFetchPort {
  return {
    read: async () =>
      accepted(readGitFetchPolicy.output.parse(await invoke(readGitFetchPolicy.name, { hostId }))),
    save: async (expectedRevision, patch) =>
      accepted(
        saveGitFetchPolicy.output.parse(
          await invoke(saveGitFetchPolicy.name, { hostId, expectedRevision, patch }),
        ),
      ),
    fetch: async (workspaceId) => {
      // The existing Git command has a 120-second bound. Only this explicit RPC
      // gets the acknowledgement margin; ordinary plugin RPC deadlines stay intact.
      accepted(
        fetchWorkspaceGit.output.parse(
          await invoke(fetchWorkspaceGit.name, { hostId, workspaceId }, 130_000),
        ),
      );
    },
  };
}
export function gitFetchError(error: unknown): string {
  return error instanceof GitFetchError
    ? error.message
    : "The host did not acknowledge the operation. Check its connection and reload before trying again.";
}
