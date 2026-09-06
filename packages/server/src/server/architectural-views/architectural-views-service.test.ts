import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { repositoryKnowledgeStore } from "../agent/project-knowledge/project-knowledge-store.js";
import { ArchitecturalViewsService } from "./architectural-views-service.js";

const temporaryDirectories: string[] = [];

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
}

async function createStore(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "otto-architectural-views-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ArchitecturalViewsService", () => {
  it("packages a view with the Knowledge store it explains", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const result = await service.deliver({
      cwd: projectRoot,
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath: join(
        repositoryRoot(),
        "vendor",
        "archify",
        "archify",
        "examples",
        "web-app.architecture.json",
      ),
    });

    expect(result).toMatchObject({
      viewId: "runtime-overview",
      storeLocation: "repository",
      htmlPath: ".otto/architectural-views/runtime-overview/view.architecture.json",
    });
    await expect(
      readFile(
        join(projectRoot, ".otto", "architectural-views", "runtime-overview", "view.json"),
        "utf8",
      ),
    ).resolves.toContain('"id": "runtime-overview"');
    await expect(
      readFile(
        join(
          projectRoot,
          ".otto",
          "architectural-views",
          "runtime-overview",
          "view.architecture.html",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("discovers Knowledge-linked views and serves renderer HTML with Otto's CSP", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    await service.deliver({
      cwd: projectRoot,
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath: join(
        repositoryRoot(),
        "vendor",
        "archify",
        "archify",
        "examples",
        "web-app.architecture.json",
      ),
    });

    await expect(service.list(projectRoot, { kind: "root", id: "architecture" })).resolves.toEqual([
      expect.objectContaining({ id: "runtime-overview", title: "Runtime overview" }),
    ]);
    await expect(
      service.list(projectRoot, { kind: "record", id: "architecture" }),
    ).resolves.toEqual([]);
    await expect(service.getContent(projectRoot, "runtime-overview")).resolves.toEqual(
      expect.objectContaining({
        view: expect.objectContaining({ id: "runtime-overview" }),
        html: expect.stringContaining("Content-Security-Policy"),
      }),
    );
  });

  it("marks a view stale only when a cited Knowledge page changed after delivery", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const architecturePath = join(projectRoot, ".otto", "knowledge", "architecture.md");
    await mkdir(dirname(architecturePath), { recursive: true });
    await writeFile(architecturePath, "# Architecture\n\nOriginal source\n", { encoding: "utf8" });
    await service.deliver({
      cwd: projectRoot,
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath: join(
        repositoryRoot(),
        "vendor",
        "archify",
        "archify",
        "examples",
        "web-app.architecture.json",
      ),
    });

    await expect(service.list(projectRoot)).resolves.toEqual([
      expect.objectContaining({ sourceStatus: "current" }),
    ]);
    await writeFile(architecturePath, "# Architecture\n\nChanged source\n", { encoding: "utf8" });
    await expect(service.getContent(projectRoot, "runtime-overview")).resolves.toEqual(
      expect.objectContaining({ view: expect.objectContaining({ sourceStatus: "stale" }) }),
    );
  });

  it("keeps draft work separate and rejects a stale publish", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const sourcePath = join(
      repositoryRoot(),
      "vendor",
      "archify",
      "archify",
      "examples",
      "web-app.architecture.json",
    );
    await service.deliver({
      cwd: projectRoot,
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath,
    });

    const draft = await service.createDraft({
      cwd: projectRoot,
      viewId: "runtime-overview",
      draftId: "edit-one",
      title: "Ignored because the published document owns it",
      knowledgeReferences: [{ kind: "record", id: "ignored" }],
    });
    expect(draft.baseSpecificationSha256).not.toBeNull();
    await expect(
      service.bindDraftAuthoringAgent({
        cwd: projectRoot,
        viewId: "runtime-overview",
        draftId: "edit-one",
        agentId: "authoring-agent-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ authoringAgentId: "authoring-agent-1" }));
    await expect(
      service.getDraftContent(projectRoot, "runtime-overview", "edit-one"),
    ).resolves.toEqual(
      expect.objectContaining({ html: expect.stringContaining("Content-Security-Policy") }),
    );
    await expect(
      service.publishDraft({ cwd: projectRoot, viewId: "runtime-overview", draftId: "edit-one" }),
    ).resolves.toEqual(expect.objectContaining({ id: "runtime-overview" }));
    await expect(
      service.getDraftContent(projectRoot, "runtime-overview", "edit-one"),
    ).resolves.toBeNull();
    const revisions = await readdir(
      join(projectRoot, ".otto", "architectural-views", "runtime-overview", "revisions"),
    );
    expect(revisions).toHaveLength(1);
    await expect(
      readFile(
        join(
          projectRoot,
          ".otto",
          "architectural-views",
          "runtime-overview",
          "revisions",
          revisions[0] ?? "",
          "view.architecture.html",
        ),
        "utf8",
      ),
    ).rejects.toThrow();

    await service.createDraft({
      cwd: projectRoot,
      viewId: "runtime-overview",
      draftId: "edit-two",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath,
    });
    const changedSourcePath = join(projectRoot, "changed-view.json");
    await writeFile(
      changedSourcePath,
      (await readFile(sourcePath, "utf8")).replace("Sample Web App", "Changed Web App"),
    );
    await service.deliver({
      cwd: projectRoot,
      viewId: "runtime-overview",
      title: "Runtime overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
      sourcePath: changedSourcePath,
    });
    await expect(
      service.publishDraft({ cwd: projectRoot, viewId: "runtime-overview", draftId: "edit-two" }),
    ).rejects.toThrow("changed since this work began");
    await service.discardDraft({
      cwd: projectRoot,
      viewId: "runtime-overview",
      draftId: "edit-two",
    });
    await expect(
      service.getDraftContent(projectRoot, "runtime-overview", "edit-two"),
    ).resolves.toBeNull();
  }, 15_000);

  it("creates a valid durable starter draft without a workspace JSON file", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });

    const draft = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-first",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });

    await expect(service.getDraftContent(projectRoot, draft.viewId, draft.id)).resolves.toEqual(
      expect.objectContaining({ html: expect.stringContaining("Architecture overview") }),
    );
    await expect(
      service.listDrafts(projectRoot, { kind: "root", id: "architecture" }),
    ).resolves.toEqual([expect.objectContaining({ id: draft.id, viewId: draft.viewId })]);
  });

  it("creates a valid typed starter for every Interactive View kind", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const types = ["workflow", "sequence", "dataflow", "lifecycle"] as const;

    for (const diagramType of types) {
      const draft = await service.createDraft({
        cwd: projectRoot,
        viewId: `knowledge-${diagramType}`,
        draftId: `knowledge-${diagramType}-first`,
        title: `Knowledge ${diagramType}`,
        knowledgeReferences: [{ kind: "root", id: "architecture" }],
        diagramType,
      });
      expect(draft.diagramType).toBe(diagramType);
      await expect(service.getDraftContent(projectRoot, draft.viewId, draft.id)).resolves.toEqual(
        expect.objectContaining({ html: expect.stringContaining("Content-Security-Policy") }),
      );
    }
  }, 30_000);

  it("returns the existing staged draft when creation is requested again", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const first = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-first",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });

    const repeated = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-second",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });

    expect(repeated).toEqual(first);
    await expect(service.listDrafts(projectRoot)).resolves.toEqual([first]);
  });

  it("discards unpublished work only when its bound authoring chat ends", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const draft = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-first",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });
    await service.bindDraftAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "authoring-chat",
    });

    await service.discardDraftForAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "different-chat",
    });
    await expect(
      service.getDraftContent(projectRoot, draft.viewId, draft.id),
    ).resolves.not.toBeNull();

    await service.discardDraftForAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "authoring-chat",
    });
    await expect(service.getDraftContent(projectRoot, draft.viewId, draft.id)).resolves.toBeNull();
  });

  it("lets a fresh Create or Update chat replace a stale authoring binding", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const draft = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-first",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });
    await service.bindDraftAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "first-authoring-chat",
    });

    await expect(
      service.bindDraftAuthoringAgent({
        cwd: projectRoot,
        viewId: draft.viewId,
        draftId: draft.id,
        agentId: "fresh-update-chat",
      }),
    ).resolves.toMatchObject({ authoringAgentId: "fresh-update-chat" });
  });

  it("keeps an unfinished draft but releases its chat binding when the chat moves", async () => {
    const projectRoot = await createStore();
    const service = new ArchitecturalViewsService({
      resolveStore: async () => repositoryKnowledgeStore(projectRoot),
    });
    const draft = await service.createDraft({
      cwd: projectRoot,
      viewId: "architecture-overview",
      draftId: "architecture-overview-first",
      title: "Architecture overview",
      knowledgeReferences: [{ kind: "root", id: "architecture" }],
    });
    await service.bindDraftAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "authoring-chat",
    });

    await service.releaseDraftAuthoringAgent({
      cwd: projectRoot,
      viewId: draft.viewId,
      draftId: draft.id,
      agentId: "authoring-chat",
    });

    await expect(service.getDraftContent(projectRoot, draft.viewId, draft.id)).resolves.toEqual(
      expect.objectContaining({ draft: expect.objectContaining({ authoringAgentId: null }) }),
    );
  });
});
