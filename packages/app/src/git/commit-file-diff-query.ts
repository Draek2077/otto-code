import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { checkoutCommitFileDiffQueryKey, COMMIT_FILE_DIFF_STALE_TIME } from "./query-keys";
import { shareCommitFileDiff } from "./diff-sharing";

export function commitFileDiffQueryOptions(input: {
  serverId: string;
  cwd: string;
  sha: string;
  path: string;
  client: Pick<DaemonClient, "getCommitFileDiff"> | null;
  enabled: boolean;
  includeStructuralSource?: boolean; // OTTO(structural-diff)
}) {
  const baseKey = checkoutCommitFileDiffQueryKey(input.serverId, input.cwd, input.sha, input.path);
  return {
    queryKey: input.includeStructuralSource ? [...baseKey, "structural-source"] : baseKey,
    queryFn: () => {
      if (!input.client) throw new Error("Host disconnected");
      if (input.includeStructuralSource)
        return input.client.getCommitFileDiff(input.cwd, input.sha, input.path, undefined, true);
      return input.client.getCommitFileDiff(input.cwd, input.sha, input.path);
    },
    enabled: input.enabled,
    gcTime: COMMIT_FILE_DIFF_STALE_TIME,
    // Only successful file bodies are immutable. Null/error results can recover.
    immutableWhen: (data: Awaited<ReturnType<DaemonClient["getCommitFileDiff"]>>) =>
      data.file !== null,
    dataShape: "value" as const,
    refetchOnWindowFocus: false,
    structuralSharing: shareCommitFileDiff,
  };
}
