import { describe, expect, test, vi } from "vitest";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentManager } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createOttoToolCatalog } from "./otto-tools.js";

const createdArtifact: ArtifactMetadata = {
  id: "artifact-source-1",
  name: "Sourced artifact",
  description: "test",
  projectId: "/project",
  filePath: "/project/.otto/artifacts/artifact-source-1.html",
  kind: "html",
  starred: false,
  status: "generating",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  generationAgentId: null,
  generationProvider: "mock",
  generationModel: null,
  errorMessage: null,
};

describe("create_artifact provenance", () => {
  test("stamps the calling chat as the artifact's durable source", async () => {
    const create = vi.fn(async () => createdArtifact);
    const catalog = createOttoToolCatalog({
      agentManager: {
        getAgent: vi.fn(() => ({
          id: "chat-source-1",
          provider: "mock",
          cwd: "/project",
          labels: {},
          config: { model: undefined, thinkingOptionId: undefined, modeId: undefined },
        })),
      } as unknown as AgentManager,
      agentStorage: {} as AgentStorage,
      providerSnapshotManager: {
        listProviders: async () => [{ provider: "mock", enabled: true, models: [] }],
      } as unknown as ProviderSnapshotManager,
      artifactService: { create } as never,
      callerAgentId: "chat-source-1",
      logger: createTestLogger(),
    });

    await catalog.executeTool("create_artifact", {
      name: "Sourced artifact",
      description: "test",
      provider: "mock",
      projectId: "/project",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "chat", agentId: "chat-source-1" } }),
    );
  });

  test("stamps a scheduled new-agent run before falling back to chat provenance", async () => {
    const create = vi.fn(async () => createdArtifact);
    const catalog = createOttoToolCatalog({
      agentManager: {
        getAgent: vi.fn(() => ({
          id: "scheduled-agent-1",
          provider: "mock",
          cwd: "/project",
          labels: { "otto.schedule-id": "schedule-1", "otto.schedule-run": "run-1" },
          config: { model: undefined, thinkingOptionId: undefined, modeId: undefined },
        })),
      } as unknown as AgentManager,
      agentStorage: {} as AgentStorage,
      providerSnapshotManager: {
        listProviders: async () => [{ provider: "mock", enabled: true, models: [] }],
      } as unknown as ProviderSnapshotManager,
      artifactService: { create } as never,
      callerAgentId: "scheduled-agent-1",
      logger: createTestLogger(),
    });

    await catalog.executeTool("create_artifact", {
      name: "Scheduled artifact",
      description: "test",
      provider: "mock",
      projectId: "/project",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "schedule", scheduleId: "schedule-1", runId: "run-1" },
      }),
    );
  });
});
