import { join, resolve } from "node:path";
import type pino from "pino";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import type { SessionOutboundMessage } from "../../messages.js";
import type { SessionOptions } from "../../session.js";
import type { ProjectRegistry } from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import { ArtifactService } from "../../artifact/artifact-service.js";
import { ArtifactStoreRegistry } from "../../artifact/artifact-store-registry.js";
import { ArtifactStoreResolver } from "../../artifact/artifact-store-resolver.js";
import { areEquivalentPaths } from "../../../utils/path.js";

/**
 * A session-scoped ArtifactService for hosts that construct a Session without
 * the daemon-wide one (unit tests). Production sessions never take this path:
 * bootstrap shares its single service, which owns every ready-file watcher.
 */
function createSessionLocalArtifactService(deps: {
  ottoHome: string;
  projectRegistry: ProjectRegistry;
  workspaceGitService: WorkspaceGitService;
  daemonConfigStore: DaemonConfigStore;
  agentManager: AgentManager;
  providerSnapshotManager: ProviderSnapshotManager;
  onActivity: SessionOptions["onActivity"];
  logger: pino.Logger;
  emit: (msg: SessionOutboundMessage) => void;
}): ArtifactService {
  return new ArtifactService({
    storeRegistry: new ArtifactStoreRegistry({
      resolver: new ArtifactStoreResolver({
        ottoHome: deps.ottoHome,
        findProjectByRoot: async (rootPath) =>
          (await deps.projectRegistry.list()).find(
            (project) => !project.archivedAt && areEquivalentPaths(project.rootPath, rootPath),
          ) ?? null,
        persistDirectoryName: async ({ projectId, directoryName }) => {
          await deps.projectRegistry.update(projectId, (record) => ({
            ...record,
            artifactDirectoryName: directoryName,
            updatedAt: new Date().toISOString(),
          }));
        },
        defaultLocation: () =>
          deps.daemonConfigStore.get().projectArtifacts?.defaultStoreLocation ?? "repository",
        logger: deps.logger,
      }),
      resolveProjectRoot: async (cwd) => {
        try {
          return await deps.workspaceGitService.resolveRepoRoot(cwd);
        } catch {
          return resolve(cwd);
        }
      },
      listProjectRoots: async () =>
        (await deps.projectRegistry.list())
          .filter((project) => !project.archivedAt)
          .map((project) => project.rootPath),
      legacyArtifactsDirectory: join(deps.ottoHome, ".otto", "artifacts"),
    }),
    logger: deps.logger,
    agentManager: deps.agentManager,
    providerSnapshotManager: deps.providerSnapshotManager,
    broadcastArtifactUpdate: (metadata: ArtifactMetadata) => {
      deps.emit({
        type: "artifact.updated.notification",
        payload: { artifact: metadata },
      });
    },
    onActivity: deps.onActivity,
  });
}

/** Prefer the daemon-wide service; fall back to a session-local one only when none was provided. */
export function resolveSessionArtifactService(
  shared: ArtifactService | null | undefined,
  deps: Parameters<typeof createSessionLocalArtifactService>[0],
): ArtifactService {
  return shared ?? createSessionLocalArtifactService(deps);
}
