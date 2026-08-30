import pino from "pino";
import { describe, expect, test, vi } from "vitest";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import { ArtifactService } from "../../artifact/artifact-service.js";
import { ArtifactSession } from "./artifact-session.js";

function artifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: "artifact-1",
    name: "Release report",
    description: "A report",
    projectId: "/project",
    filePath: "/project/.otto/artifacts/artifact-1.html",
    kind: "html",
    starred: false,
    status: "ready",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    generationAgentId: null,
    generationProvider: "mock",
    generationModel: null,
    errorMessage: null,
    ...overrides,
  };
}

function createSession(service: Partial<ArtifactService>, emit = vi.fn()) {
  return {
    emit,
    session: new ArtifactSession({
      host: { emit },
      artifactService: service as ArtifactService,
      ownsArtifactService: true,
      logger: pino({ enabled: false }),
    }),
  };
}

describe("ArtifactSession lifecycle RPCs", () => {
  test("delegates explicit regeneration and publishes the resulting artifact", async () => {
    const regenerate = vi.fn(async () => artifact({ status: "generating" }));
    const { emit, session } = createSession({ regenerate });

    await session.handleArtifactRegenerateRequest({
      type: "artifact.regenerate.request",
      artifactId: "artifact-1",
      requestId: "request-1",
    });

    expect(regenerate).toHaveBeenCalledWith("artifact-1");
    expect(emit).toHaveBeenNthCalledWith(1, {
      type: "artifact.regenerate.response",
      payload: {
        artifact: expect.objectContaining({ id: "artifact-1", status: "generating" }),
        success: true,
        requestId: "request-1",
      },
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      type: "artifact.updated.notification",
      payload: { artifact: expect.objectContaining({ id: "artifact-1", status: "generating" }) },
    });
  });

  test("delegates cancellation and publishes the recoverable artifact state", async () => {
    const cancel = vi.fn(async () => artifact({ status: "error", errorMessage: "Cancelled" }));
    const { emit, session } = createSession({ cancel });

    await session.handleArtifactCancelRequest({
      type: "artifact.cancel.request",
      artifactId: "artifact-1",
      requestId: "request-1",
    });

    expect(cancel).toHaveBeenCalledWith("artifact-1");
    expect(emit).toHaveBeenNthCalledWith(1, {
      type: "artifact.cancel.response",
      payload: {
        artifact: expect.objectContaining({ id: "artifact-1", status: "error" }),
        success: true,
        requestId: "request-1",
      },
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      type: "artifact.updated.notification",
      payload: { artifact: expect.objectContaining({ id: "artifact-1", status: "error" }) },
    });
  });

  test("delegates repair and publishes restored output metadata", async () => {
    const repair = vi.fn(async () => artifact({ repairAvailable: false }));
    const { emit, session } = createSession({ repair });

    await session.handleArtifactRepairRequest({
      type: "artifact.repair.request",
      artifactId: "artifact-1",
      requestId: "request-1",
    });

    expect(repair).toHaveBeenCalledWith("artifact-1");
    expect(emit).toHaveBeenNthCalledWith(1, {
      type: "artifact.repair.response",
      payload: {
        artifact: expect.objectContaining({ id: "artifact-1", repairAvailable: false }),
        success: true,
        requestId: "request-1",
      },
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      type: "artifact.updated.notification",
      payload: { artifact: expect.objectContaining({ id: "artifact-1" }) },
    });
  });
});
