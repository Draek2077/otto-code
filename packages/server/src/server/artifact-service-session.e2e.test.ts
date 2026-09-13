import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { expect, test } from "vitest";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { createOttoDaemon, type OttoDaemonConfig } from "./bootstrap.js";
import { ArtifactStore } from "./artifact/artifact-store.js";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";

const TEST_TIMEOUT_MS = 15_000;
const ARTIFACT_ID = "shared-service-artifact";

test(
  "two client sessions share daemon-owned ArtifactService watchers through client mutations and disconnects",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-service-session-"));
    const projectRoot = path.join(root, "project");
    const ottoHome = path.join(root, "otto-home");
    const staticDir = path.join(root, "static");
    const port = await findFreePort();
    await Promise.all([mkdir(projectRoot), mkdir(ottoHome), mkdir(staticDir)]);

    const daemon = await createOttoDaemon(
      daemonConfig({ port, ottoHome, staticDir }),
      pino({ level: "silent" }),
    );
    let first: DaemonClient | null = null;
    let second: DaemonClient | null = null;

    try {
      await daemon.start();
      first = await connectClient(port, "artifact-first-client");
      second = await connectClient(port, "artifact-second-client");
      const opened = await first.openProject(projectRoot);
      await second.openProject(projectRoot);
      expect(opened.workspace?.id).toEqual(expect.any(String));
      const workspaceId = opened.workspace!.id;
      await second.fetchWorkspaces({ subscribe: { subscriptionId: "artifact-peer" } });
      const workspaceUpdates: Array<
        Extract<SessionOutboundMessage, { type: "workspace_update" }>["payload"]
      > = [];
      second.on("workspace_update", (message) => workspaceUpdates.push(message.payload));
      const created: string[] = [];
      const deleted: string[] = [];
      second.on("artifact.created.notification", (message) =>
        created.push(message.payload.artifact.id),
      );
      second.on("artifact.deleted.notification", (message) =>
        deleted.push(message.payload.artifactId),
      );

      const store = new ArtifactStore(path.join(projectRoot, ".otto", "artifacts"));
      const artifact = readyArtifact(store, projectRoot);
      await store.create(artifact);
      await writeFile(artifact.filePath, artifactHtml(1, "Initial output"), "utf-8");

      // Index the real store through the first websocket session before the
      // second session mutates it. A per-session service would not share that
      // state or its watcher with the next request.
      await first.artifactList({ projectId: projectRoot });
      const attached = await first.artifactAttachWorkspace({
        workspaceId,
        artifactId: ARTIFACT_ID,
      });
      expect(attached.success).toBe(true);
      await expect
        .poll(() =>
          workspaceUpdates.some(
            (update) =>
              update.kind === "upsert" &&
              update.workspace.id === workspaceId &&
              update.workspace.artifactIds?.includes(ARTIFACT_ID),
          ),
        )
        .toBe(true);
      // The shared membership survives another client attaching the same item.
      expect(
        (await second.artifactAttachWorkspace({ workspaceId, artifactId: ARTIFACT_ID })).success,
      ).toBe(true);
      expect(
        (await second.fetchWorkspaces()).entries.find((workspace) => workspace.id === workspaceId)
          ?.artifactIds,
      ).toEqual([ARTIFACT_ID]);
      const siblingPath = path.join(projectRoot, "sibling");
      await mkdir(siblingPath);
      const sibling = await first.createWorkspace({
        source: { kind: "directory", path: siblingPath, projectId: opened.workspace!.projectId },
      });
      expect(sibling.error).toBeNull();
      expect(sibling.workspace?.id).not.toBe(workspaceId);
      expect(
        (await second.fetchWorkspaces()).entries.find((entry) => entry.id === sibling.workspace!.id)
          ?.artifactIds,
      ).toEqual([]);
      const otherProject = path.join(root, "other-project");
      await mkdir(otherProject);
      const other = await first.openProject(otherProject);
      expect(
        (
          await first.artifactAttachWorkspace({
            workspaceId: other.workspace!.id,
            artifactId: ARTIFACT_ID,
          })
        ).success,
      ).toBe(false);
      const secondArtifact = {
        ...artifact,
        id: "concurrent-artifact",
        filePath: store.htmlPath("concurrent-artifact"),
      };
      await store.create(secondArtifact);
      await writeFile(secondArtifact.filePath, artifactHtml(1, "Another report"), "utf8");
      const attachedTogether = await Promise.all([
        first.artifactAttachWorkspace({ workspaceId, artifactId: ARTIFACT_ID }),
        second.artifactAttachWorkspace({ workspaceId, artifactId: secondArtifact.id }),
      ]);
      expect(attachedTogether.map((result) => result.success)).toEqual([true, true]);
      expect(
        (await second.fetchWorkspaces()).entries.find((entry) => entry.id === workspaceId)
          ?.artifactIds,
      ).toEqual([ARTIFACT_ID, secondArtifact.id]);
      expect((await first.artifactDelete({ artifactId: secondArtifact.id })).success).toBe(true);
      await expect
        .poll(() =>
          workspaceUpdates.findLast(
            (update) => update.kind === "upsert" && update.workspace.id === workspaceId,
          ),
        )
        .toMatchObject({ kind: "upsert", workspace: { artifactIds: [ARTIFACT_ID] } });
      expect(
        (
          await first.artifactAttachWorkspace({
            workspaceId: "missing-workspace",
            artifactId: ARTIFACT_ID,
          })
        ).success,
      ).toBe(false);
      expect(
        (await first.artifactAttachWorkspace({ workspaceId, artifactId: "missing-artifact" }))
          .success,
      ).toBe(false);

      // UI creation announces the object immediately, even before generation settles.
      const generated = await first.artifactCreate({
        name: "Peer-created",
        description: "A test",
        projectId: projectRoot,
        provider: "mock",
      });
      expect(generated.success).toBe(true);
      await expect.poll(() => created).toContain(generated.artifact.id);
      expect((await first.artifactDelete({ artifactId: generated.artifact.id })).success).toBe(
        true,
      );
      await expect.poll(() => deleted).toContain(generated.artifact.id);

      await second.artifactUpdateData({ artifactId: ARTIFACT_ID, data: { revision: 2 } });
      await expect
        .poll(async () => (await store.get(ARTIFACT_ID))?.status, { timeout: TEST_TIMEOUT_MS })
        .toBe("ready");

      await first.close();
      first = null;
      await writeFile(artifact.filePath, artifactHtml(2, "First client disconnected"), "utf-8");
      await expect
        .poll(
          async () => (await second?.artifactGetContent({ artifactId: ARTIFACT_ID }))?.content,
          { timeout: TEST_TIMEOUT_MS },
        )
        .toContain("First client disconnected");

      // updateData temporarily disarms and re-arms the ready watcher. Let its
      // normal polling interval elapse: a second service would misread that
      // daemon-owned write as an external edit and leave the record in error.
      await second.artifactUpdateData({ artifactId: ARTIFACT_ID, data: { revision: 3 } });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await expect(store.get(ARTIFACT_ID)).resolves.toMatchObject({
        status: "ready",
        errorMessage: null,
      });

      await second.close();
      second = await connectClient(port, "artifact-reconnected-client");
      expect(
        (await second.fetchWorkspaces()).entries.find((workspace) => workspace.id === workspaceId)
          ?.artifactIds,
      ).toEqual([ARTIFACT_ID]);
      await second.close();
      second = null;
      await writeFile(artifact.filePath, "not an HTML artifact", "utf-8");
      await expect
        .poll(async () => (await store.get(ARTIFACT_ID))?.status, { timeout: TEST_TIMEOUT_MS })
        .toBe("error");
    } finally {
      await first?.close().catch(() => undefined);
      await second?.close().catch(() => undefined);
      await daemon.stop().catch(() => undefined);
      await daemon.agentManager.flush().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS + 5_000,
);

function daemonConfig(input: {
  port: number;
  ottoHome: string;
  staticDir: string;
}): OttoDaemonConfig {
  return {
    listen: `127.0.0.1:${input.port}`,
    ottoHome: input.ottoHome,
    corsAllowedOrigins: [],
    hostnames: true,
    mcpEnabled: false,
    staticDir: input.staticDir,
    mcpDebug: false,
    agentClients: createTestAgentClients(),
    agentStoragePath: path.join(input.ottoHome, "agents"),
    relayEnabled: false,
    appBaseUrl: "https://app.otto-code.me",
    openai: undefined,
    speech: undefined,
  };
}

function readyArtifact(store: ArtifactStore, projectId: string): ArtifactMetadata {
  return {
    id: ARTIFACT_ID,
    name: "Shared daemon service proof",
    description: "A ready artifact used to prove shared session wiring.",
    projectId,
    filePath: store.htmlPath(ARTIFACT_ID),
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    generationAgentId: null,
    generationProvider: "test",
    generationModel: null,
    storageLocation: "repository",
    errorMessage: null,
  };
}

function artifactHtml(revision: number, content: string): string {
  return `<!doctype html><html><body><main>${content}</main><script type="application/json" id="otto-artifact-data">{"revision":${revision}}</script></body></html>`;
}

async function connectClient(port: number, clientId: string): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId,
    reconnect: { enabled: false },
  });
  await client.connect();
  return client;
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP port for the ArtifactService integration daemon");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
}
