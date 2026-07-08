import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { toErrorMessage } from "@/utils/error-messages";

export const ALL_ARTIFACT_HOSTS_FAILED_MESSAGE = "No connected hosts could load artifacts";

export interface ArtifactHostInput {
  serverId: string;
  serverName: string;
}

export interface ArtifactRuntimeSnapshot {
  connectionStatus: string;
}

export interface ArtifactRuntime {
  getClient(serverId: string): Pick<DaemonClient, "artifactList"> | null;
  getSnapshot(serverId: string): ArtifactRuntimeSnapshot | null | undefined;
}

/** An artifact tagged with the host it came from, so mutations and tab opens can
 * be scoped to the right daemon without host sections in the UI. */
export interface AggregatedArtifact extends ArtifactMetadata {
  serverId: string;
  serverName: string;
}

export interface ArtifactHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export interface FetchAggregatedArtifactsResult {
  artifacts: AggregatedArtifact[];
  hostErrors: ArtifactHostError[];
}

export interface FetchAggregatedArtifactsInput {
  hosts: readonly ArtifactHostInput[];
  projectId?: string;
  runtime: ArtifactRuntime;
}

/**
 * Fetch artifacts across connected hosts and merge them into one flat list.
 * Mirrors `fetchAggregatedSchedules`: connectivity is checked here at execution
 * time so the query reliably picks a host up the moment it comes online.
 *
 * Offline hosts are skipped. A connected host that fails contributes to
 * `hostErrors` while the rest still render; only when every connected host fails
 * do we throw so the screen shows a full error.
 */
export async function fetchAggregatedArtifacts(
  input: FetchAggregatedArtifactsInput,
): Promise<FetchAggregatedArtifactsResult> {
  const artifacts: AggregatedArtifact[] = [];
  const hostErrors: ArtifactHostError[] = [];
  let connectedAttempts = 0;

  await Promise.all(
    input.hosts.map(async (host) => {
      const snapshot = input.runtime.getSnapshot(host.serverId);
      const isOnline = snapshot?.connectionStatus === "online";
      const client = input.runtime.getClient(host.serverId);
      if (!client || !isOnline) {
        return;
      }
      connectedAttempts += 1;
      try {
        const payload = await client.artifactList(
          input.projectId ? { projectId: input.projectId } : undefined,
        );
        if (!payload.success) {
          throw new Error(payload.error ?? "Failed to list artifacts");
        }
        for (const artifact of payload.artifacts) {
          artifacts.push({ ...artifact, serverId: host.serverId, serverName: host.serverName });
        }
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  if (connectedAttempts > 0 && artifacts.length === 0 && hostErrors.length === connectedAttempts) {
    throw new Error(ALL_ARTIFACT_HOSTS_FAILED_MESSAGE);
  }

  return { artifacts, hostErrors };
}
