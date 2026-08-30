import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repositoryKnowledgeStore } from "../../agent/project-knowledge/project-knowledge-store.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { ArchitecturalViewsSession } from "./architectural-views-session.js";

const temporaryDirectories: string[] = [];

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");
}

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "otto-architectural-views-session-"));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, "view.json"),
    await readFile(
      join(
        repositoryRoot(),
        "vendor",
        "archify",
        "archify",
        "examples",
        "web-app.architecture.json",
      ),
      "utf8",
    ),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ArchitecturalViewsSession", () => {
  it("delivers a workspace source into the workspace Knowledge store", async () => {
    const workspaceRoot = await createWorkspace();
    const emit = vi.fn<(message: SessionOutboundMessage) => void>();
    const session = new ArchitecturalViewsSession({
      host: { emit },
      workspaceRegistry: {
        get: vi.fn().mockResolvedValue({ cwd: workspaceRoot }),
      } as never,
      projectKnowledgeStores: {
        resolveForCwd: vi.fn().mockResolvedValue(repositoryKnowledgeStore(workspaceRoot)),
      } as never,
      logger: pino({ enabled: false }),
    });

    await session.handleDeliverRequest({
      type: "architectural-views.deliver.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath: "view.json",
      requestId: "request-1",
    });

    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.deliver.response",
      payload: {
        requestId: "request-1",
        viewId: "runtime-overview",
        success: true,
        storeLocation: "repository",
        htmlPath: ".otto/architectural-views/runtime-overview/view.architecture.html",
        error: null,
      },
    });

    emit.mockClear();
    await session.handleDraftCreateRequest({
      type: "architectural-views.draft.create.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      draftId: "session-edit",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      requestId: "request-draft-create",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.draft.create.response",
      payload: expect.objectContaining({
        requestId: "request-draft-create",
        success: true,
        draft: expect.objectContaining({ id: "session-edit" }),
        error: null,
      }),
    });

    emit.mockClear();
    await session.handleDraftUpdateRequest({
      type: "architectural-views.draft.update.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      draftId: "session-edit",
      sourcePath: "view.json",
      requestId: "request-draft-update",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.draft.update.response",
      payload: expect.objectContaining({
        requestId: "request-draft-update",
        success: true,
        draft: expect.objectContaining({ id: "session-edit" }),
        error: null,
      }),
    });

    emit.mockClear();
    await session.handleDraftGetContentRequest({
      type: "architectural-views.draft.get-content.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      draftId: "session-edit",
      requestId: "request-draft-content",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.draft.get-content.response",
      payload: expect.objectContaining({
        requestId: "request-draft-content",
        success: true,
        draft: expect.objectContaining({ id: "session-edit" }),
        html: expect.stringContaining("Content-Security-Policy"),
        error: null,
      }),
    });

    emit.mockClear();
    await session.handleDraftPublishRequest({
      type: "architectural-views.draft.publish.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      draftId: "session-edit",
      requestId: "request-draft-publish",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.draft.publish.response",
      payload: expect.objectContaining({
        requestId: "request-draft-publish",
        success: true,
        view: expect.objectContaining({ id: "runtime-overview" }),
        error: null,
      }),
    });

    emit.mockClear();
    await session.handleListRequest({
      type: "architectural-views.list.request",
      workspaceId: "workspace-1",
      knowledgeReference: { kind: "root", id: "architecture" },
      requestId: "request-2",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.list.response",
      payload: expect.objectContaining({
        requestId: "request-2",
        success: true,
        views: [expect.objectContaining({ id: "runtime-overview" })],
        error: null,
      }),
    });

    emit.mockClear();
    await session.handleGetContentRequest({
      type: "architectural-views.get-content.request",
      workspaceId: "workspace-1",
      viewId: "runtime-overview",
      requestId: "request-3",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "architectural-views.get-content.response",
      payload: expect.objectContaining({
        requestId: "request-3",
        success: true,
        view: expect.objectContaining({ id: "runtime-overview" }),
        html: expect.stringContaining("Content-Security-Policy"),
        error: null,
      }),
    });
  });
});
