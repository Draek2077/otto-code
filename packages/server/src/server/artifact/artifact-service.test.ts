import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../agent/agent-manager.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import { ArtifactService } from "./artifact-service.js";
import { ArtifactStore } from "./artifact-store.js";
import { ArtifactStoreRegistry } from "./artifact-store-registry.js";
import { ArtifactStoreResolver } from "./artifact-store-resolver.js";
import { windowsShortPath } from "../../test-utils/windows-short-path.js";

describe("ArtifactService storage routing", () => {
  let root: string;
  let repositoryProject: string;
  let hostProject: string;
  let legacyArtifactsDirectory: string;
  let service: ArtifactService;
  let registry: ArtifactStoreRegistry;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "artifact-service-"));
    repositoryProject = path.join(root, "repository-project");
    hostProject = path.join(root, "host-project");
    legacyArtifactsDirectory = path.join(root, "legacy", ".otto", "artifacts");
    registry = new ArtifactStoreRegistry({
      resolver: new ArtifactStoreResolver({
        ottoHome: path.join(root, "otto-home"),
        findProjectByRoot: async (projectRoot) => ({
          projectId: projectRoot,
          rootPath: projectRoot,
          displayName: path.basename(projectRoot),
          customName: null,
          projectKey: null,
          artifactLocation:
            path.resolve(projectRoot) === path.resolve(hostProject) ? "host" : "repository",
          artifactDirectoryName: `${path.basename(projectRoot)}-1234`,
        }),
        persistDirectoryName: async () => undefined,
        defaultLocation: () => "repository",
        logger: pino({ enabled: false }),
      }),
      resolveProjectRoot: async (cwd) => path.resolve(cwd),
      listProjectRoots: async () => [repositoryProject, hostProject],
      legacyArtifactsDirectory,
    });
    service = createArtifactService(registry);
  });

  function createArtifactService(
    storeRegistry: ArtifactStoreRegistry,
    agentManager: AgentManager = {
      // Keep generation pending: most tests prove storage routing, not watcher completion.
      createAgent: () => new Promise<never>(() => undefined),
    } as unknown as AgentManager,
    broadcastArtifactUpdate: (
      metadata: import("@otto-code/protocol/artifacts/types").ArtifactMetadata,
    ) => void = () => undefined,
    providerSnapshotManager: ProviderSnapshotManager = {
      resolveCreateConfig: async () => ({ modeId: undefined, featureValues: undefined }),
    } as unknown as ProviderSnapshotManager,
  ): ArtifactService {
    return new ArtifactService({
      storeRegistry,
      logger: pino({ enabled: false }),
      agentManager,
      providerSnapshotManager,
      broadcastArtifactUpdate,
    });
  }

  afterEach(async () => {
    service.stop();
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== "win32")(
    "generates an artifact beneath a Windows short-path project",
    async (context) => {
      const shortRoot = windowsShortPath(root);
      if (!shortRoot.includes("~")) context.skip("Fixture volume does not expose 8.3 names");
      const project = path.join(shortRoot, "repository-project");
      const artifact = await service.create({
        name: "Short path artifact",
        description: "test",
        projectId: project,
        provider: "mock",
      });
      expect(artifact.filePath).toBe(
        path.join(project, ".otto", "artifacts", `${artifact.id}.html`),
      );
      await writeFile(artifact.filePath, "<!doctype html><html><body>Short path</body></html>");
      await expect.poll(async () => (await service.inspect(artifact.id)).status).toBe("ready");
    },
  );

  it("creates repository and host-owned artifacts in their resolved project stores", async () => {
    const repository = await service.create({
      name: "Repository artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const host = await service.create({
      name: "Host artifact",
      description: "test",
      projectId: hostProject,
      provider: "mock",
    });

    expect(repository.filePath).toBe(
      path.join(repositoryProject, ".otto", "artifacts", `${repository.id}.html`),
    );
    expect(host.filePath).toBe(
      path.join(root, "otto-home", "project-artifacts", "host-project-1234", `${host.id}.html`),
    );
    expect(repository.projectId).toBe(path.resolve(repositoryProject));
    expect(host.projectId).toBe(path.resolve(hostProject));
    expect(repository.storageLocation).toBe("repository");
    expect(host.storageLocation).toBe("host");
  });

  it("settles controlled repository and host documents with durable output and retained transcripts", async () => {
    let agentCount = 0;
    const createAgent = vi.fn(async () => ({ id: `controlled-agent-${++agentCount}` }));
    const runAgent = vi.fn(async (_agentId: string, prompt: string) => {
      const htmlPath = prompt.match(/Write the HTML file to: (.+)$/m)?.[1];
      if (!htmlPath) throw new Error("Missing artifact output path");
      await writeFile(
        htmlPath,
        '<!doctype html><html><body><main id="report">Controlled report</main></body></html>',
        "utf-8",
      );
    });
    const captureRetainedTranscript = vi.fn(async () => undefined);
    const closeAgent = vi.fn(async () => undefined);
    service.stop();
    service = createArtifactService(registry, {
      createAgent,
      runAgent,
      captureRetainedTranscript,
      closeAgent,
    } as unknown as AgentManager);

    const repositoryArtifact = await service.create({
      name: "Controlled artifact",
      description: "Create a controlled report",
      projectId: repositoryProject,
      provider: "mock",
    });
    await expect
      .poll(
        async () => {
          const record = await service.inspect(repositoryArtifact.id);
          return record.status === "ready" && record.runs.at(-1)?.status === "succeeded";
        },
        { timeout: 6000 },
      )
      .toBe(true);

    const hostArtifact = await service.create({
      name: "Controlled host artifact",
      description: "Create a controlled host report",
      projectId: hostProject,
      provider: "mock",
    });
    await expect
      .poll(
        async () => {
          const record = await service.inspect(hostArtifact.id);
          return record.status === "ready" && record.runs.at(-1)?.status === "succeeded";
        },
        { timeout: 6000 },
      )
      .toBe(true);

    const repositoryCompleted = await service.inspect(repositoryArtifact.id);
    const hostCompleted = await service.inspect(hostArtifact.id);
    expect(repositoryCompleted).toMatchObject({
      status: "ready",
      generationAgentId: "controlled-agent-1",
      storageLocation: "repository",
    });
    expect(repositoryCompleted.runs.at(-1)).toMatchObject({
      trigger: "create",
      status: "succeeded",
      agentId: "controlled-agent-1",
      provider: "mock",
    });
    expect(hostCompleted).toMatchObject({
      status: "ready",
      generationAgentId: "controlled-agent-2",
      storageLocation: "host",
      filePath: path.join(
        root,
        "otto-home",
        "project-artifacts",
        "host-project-1234",
        `${hostArtifact.id}.html`,
      ),
    });
    await expect(readFile(repositoryArtifact.filePath, "utf-8")).resolves.toContain(
      "Controlled report",
    );
    await expect(readFile(`${repositoryArtifact.filePath}.last-good`, "utf-8")).resolves.toContain(
      "Controlled report",
    );
    await expect(readFile(hostArtifact.filePath, "utf-8")).resolves.toContain("Controlled report");
    await expect(readFile(`${hostArtifact.filePath}.last-good`, "utf-8")).resolves.toContain(
      "Controlled report",
    );
    expect(createAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: "mock", unattended: true, internal: true }),
      undefined,
      expect.objectContaining({ initialTitle: "Controlled artifact" }),
    );
    expect(runAgent).toHaveBeenCalledWith(
      "controlled-agent-1",
      expect.stringContaining(repositoryArtifact.filePath),
    );
    expect(runAgent).toHaveBeenCalledWith(
      "controlled-agent-2",
      expect.stringContaining(hostArtifact.filePath),
    );
    expect(captureRetainedTranscript).toHaveBeenCalledWith(
      "controlled-agent-1",
      { kind: "artifact", id: repositoryArtifact.id },
      { title: "Controlled artifact" },
    );
    expect(captureRetainedTranscript).toHaveBeenCalledWith(
      "controlled-agent-2",
      { kind: "artifact", id: hostArtifact.id },
      { title: "Controlled host artifact" },
    );
    expect(closeAgent).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("replaces an interactive requested mode with the provider unattended mode", async () => {
    const createAgent = vi.fn(async () => ({ id: "unattended-agent-1" }));
    const runAgent = vi.fn(async (_agentId: string, prompt: string) => {
      const htmlPath = prompt.match(/Write the HTML file to: (.+)$/m)?.[1];
      if (!htmlPath) throw new Error("Missing artifact output path");
      await writeFile(htmlPath, "<!doctype html><html><body>Unattended</body></html>", "utf-8");
    });
    const listModes = vi.fn(async () => [{ id: "ask", isUnattended: false }]);
    const resolveCreateConfig = vi.fn(async () => ({
      modeId: "safe-unattended",
      featureValues: { approval: "deny" },
    }));
    service.stop();
    service = createArtifactService(
      registry,
      {
        createAgent,
        runAgent,
        captureRetainedTranscript: vi.fn(),
        closeAgent: vi.fn(),
      } as unknown as AgentManager,
      undefined,
      { listModes, resolveCreateConfig } as unknown as ProviderSnapshotManager,
    );

    const artifact = await service.create({
      name: "Unattended artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
      modeId: "ask",
    });
    await expect
      .poll(async () => (await service.inspect(artifact.id)).runs.at(-1)?.status, { timeout: 3000 })
      .toBe("succeeded");

    expect(listModes).toHaveBeenCalledWith({
      provider: "mock",
      cwd: repositoryProject,
      wait: true,
    });
    expect(resolveCreateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mock", requestedMode: undefined, unattended: true }),
    );
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ modeId: "safe-unattended", unattended: true }),
      undefined,
      expect.anything(),
    );
  });

  it("preserves an explicitly requested provider-marked bypass mode", async () => {
    const createAgent = vi.fn(async () => ({ id: "bypass-agent-1" }));
    const runAgent = vi.fn(async () => undefined);
    const listModes = vi.fn(async () => [{ id: "bypassPermissions", isUnattended: true }]);
    const resolveCreateConfig = vi.fn(async () => ({
      modeId: "dontAsk",
      featureValues: undefined,
    }));
    service.stop();
    service = createArtifactService(
      registry,
      {
        createAgent,
        runAgent,
        captureRetainedTranscript: vi.fn(),
        closeAgent: vi.fn(),
      } as unknown as AgentManager,
      undefined,
      { listModes, resolveCreateConfig } as unknown as ProviderSnapshotManager,
    );

    await service.create({
      name: "Bypass artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
      modeId: "bypassPermissions",
    });

    await vi.waitFor(() => expect(createAgent).toHaveBeenCalledTimes(1));
    expect(resolveCreateConfig).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ modeId: "bypassPermissions", unattended: true }),
      undefined,
      expect.anything(),
    );
  });

  it("refuses to turn a metadata edit into a cross-project file move", async () => {
    const artifact = await service.create({
      name: "Repository artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    await expect(
      service.update({ artifactId: artifact.id, projectId: hostProject }),
    ).rejects.toThrow("Artifacts cannot be moved between projects");
  });

  it("persists the latest daemon-stamped source provenance", async () => {
    const artifact = await service.create({
      name: "Chat-sourced artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
      source: { kind: "chat", agentId: "chat-source-1" },
    });

    await expect(service.inspect(artifact.id)).resolves.toMatchObject({
      source: { kind: "chat", agentId: "chat-source-1" },
    });
  });

  it("moves a settled artifact and its last-good output between repository and host stores", async () => {
    const artifact = await service.create({
      name: "Movable artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const source = await registry.resolveForProjectAtLocation(repositoryProject, "repository");
    const destination = await registry.resolveForProjectAtLocation(repositoryProject, "host");
    const html = "<!doctype html><html><body><script>window.DATA={count:2}</script></body></html>";
    const snapshot = "<!doctype html><html><body>Last good output</body></html>";
    // This fixture supplies a settled record directly; stop the create watcher
    // first so it cannot race the deliberate metadata rewrite on Windows.
    service.stop();
    await writeFile(artifact.filePath, html, "utf-8");
    await writeFile(`${artifact.filePath}.last-good`, snapshot, "utf-8");
    await source.store.patchCurrentRun(artifact.id, {
      status: "succeeded",
      endedAt: "2026-08-29T01:00:00.000Z",
      error: null,
    });
    await source.store.update(artifact.id, { status: "ready", errorMessage: null });
    const moved = await service.move(artifact.id, "host");

    expect(moved).toMatchObject({
      id: artifact.id,
      storageLocation: "host",
      filePath: destination.store.htmlPath(artifact.id),
      status: "ready",
    });
    await expect(source.store.inspect(artifact.id)).resolves.toBeNull();
    await expect(destination.store.inspect(artifact.id)).resolves.toMatchObject({
      id: artifact.id,
      storageLocation: "host",
      runs: [expect.objectContaining({ trigger: "create", status: "succeeded" })],
    });
    // A ready watcher may add the existing security policy during the move's
    // destination watch, but the artifact's data-bearing rendered content is
    // retained rather than regenerated.
    await expect(readFile(destination.store.htmlPath(artifact.id), "utf-8")).resolves.toContain(
      "window.DATA={count:2}",
    );
    await expect(
      readFile(`${destination.store.htmlPath(artifact.id)}.last-good`, "utf-8"),
    ).resolves.toBe(snapshot);
  });

  it("refuses to move an artifact while its generation is still active", async () => {
    const artifact = await service.create({
      name: "Generating artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });

    await expect(service.move(artifact.id, "host")).rejects.toThrow(
      "Cancel or wait for artifact generation before moving it",
    );
  });

  it.each(["repository", "host"] as const)(
    "explicitly migrates an unlabelled legacy artifact to %s without reassigning its project",
    async (destination) => {
      const artifact = await service.create({
        name: "Legacy artifact",
        description: "test",
        projectId: repositoryProject,
        provider: "mock",
      });
      const repository = await registry.resolveForProjectAtLocation(
        repositoryProject,
        "repository",
      );
      const destinationStore = await registry.resolveForProjectAtLocation(
        repositoryProject,
        destination,
      );
      const legacy = new ArtifactStore(legacyArtifactsDirectory);
      const legacyFilePath = legacy.htmlPath(artifact.id);
      const { storageLocation: _storageLocation, ...unlabelled } = artifact;
      const legacyHtml = "<!doctype html><html><body>Legacy output</body></html>";
      const legacyLastGoodHtml = "<!doctype html><html><body>Legacy last good</body></html>";
      service.stop();
      await repository.store.delete(artifact.id);
      await legacy.create({
        ...unlabelled,
        name: "Legacy migration artifact",
        description: "Retain this metadata during migration",
        starred: true,
        generationModel: "legacy-model",
        source: { kind: "chat", agentId: "legacy-chat" },
        filePath: legacyFilePath,
        status: "ready",
        errorMessage: null,
      });
      await legacy.appendRun(artifact.id, {
        id: "legacy-run",
        trigger: "create",
        status: "succeeded",
        startedAt: "2026-08-28T23:00:00.000Z",
        endedAt: "2026-08-28T23:01:00.000Z",
        agentId: "legacy-agent",
        provider: "mock",
        model: "legacy-model",
        personalityName: null,
        error: null,
      });
      await writeFile(legacyFilePath, legacyHtml, "utf-8");
      await writeFile(`${legacyFilePath}.last-good`, legacyLastGoodHtml, "utf-8");

      // Legacy discovery is read-only: selecting a project or opening the library
      // must not silently move it or make it belong to another project.
      await expect(service.list(repositoryProject)).resolves.toMatchObject([
        { id: artifact.id, projectId: repositoryProject, name: "Legacy migration artifact" },
      ]);
      await expect(service.list(hostProject)).resolves.not.toContainEqual(
        expect.objectContaining({ id: artifact.id }),
      );
      const beforeMove = await legacy.inspect(artifact.id);
      expect(beforeMove).toMatchObject({
        projectId: repositoryProject,
        runs: [expect.objectContaining({ id: "legacy-run", status: "succeeded" })],
      });

      const moved = await service.move(artifact.id, destination);

      expect(moved).toMatchObject({
        storageLocation: destination,
        status: "ready",
        projectId: repositoryProject,
        filePath: destinationStore.store.htmlPath(artifact.id),
      });
      await expect(legacy.inspect(artifact.id)).resolves.toBeNull();
      await expect(destinationStore.store.inspect(artifact.id)).resolves.toMatchObject({
        id: artifact.id,
        name: "Legacy migration artifact",
        description: "Retain this metadata during migration",
        starred: true,
        projectId: repositoryProject,
        generationModel: "legacy-model",
        source: { kind: "chat", agentId: "legacy-chat" },
        storageLocation: destination,
        filePath: destinationStore.store.htmlPath(artifact.id),
        runs: beforeMove?.runs,
      });
      // Moving a ready document starts its normal ready watcher, which may add
      // Otto's existing CSP. The actual legacy document remains intact.
      await expect(
        readFile(destinationStore.store.htmlPath(artifact.id), "utf-8"),
      ).resolves.toContain("<body>Legacy output</body>");
      await expect(
        readFile(`${destinationStore.store.htmlPath(artifact.id)}.last-good`, "utf-8"),
      ).resolves.toBe(legacyLastGoodHtml);
    },
  );

  it("settles an interrupted initial generation into a recoverable error after restart", async () => {
    const artifact = await service.create({
      name: "Interrupted initial artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    service.stop();

    service = createArtifactService(registry);
    await expect(service.reconcileInterruptedGenerations()).resolves.toBe(1);

    const recovered = await service.inspect(artifact.id);
    expect(recovered.status).toBe("error");
    expect(recovered.errorMessage).toBe("Generation interrupted when Otto restarted");
    expect(recovered.generationAgentId).toBeNull();
    expect(recovered.runs.at(-1)).toMatchObject({
      trigger: "create",
      status: "failed",
      error: recovered.errorMessage,
    });
  });

  it("recovers an interrupted regeneration after restart without losing the last ready HTML", async () => {
    const artifact = await service.create({
      name: "Recoverable artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const { store } = await registry.resolveForProject(repositoryProject);
    const lastReadyHtml = "<!doctype html><html><body>Last ready output</body></html>";
    service.stop();
    await writeFile(artifact.filePath, lastReadyHtml, "utf-8");
    await store.patchCurrentRun(artifact.id, {
      status: "succeeded",
      endedAt: "2026-08-29T01:00:00.000Z",
      error: null,
    });
    await store.update(artifact.id, { status: "ready", errorMessage: null });

    const generatingService = createArtifactService(registry);
    await generatingService.regenerate(artifact.id);
    generatingService.stop();

    service = createArtifactService(registry);
    await expect(service.reconcileInterruptedGenerations()).resolves.toBe(1);

    const recovered = await service.inspect(artifact.id);
    expect(recovered.status).toBe("error");
    expect(recovered.errorMessage).toBe(
      "Generation interrupted when Otto restarted; the previous ready output was restored",
    );
    expect(recovered.runs.at(-1)).toMatchObject({
      trigger: "regenerate",
      status: "failed",
      error: recovered.errorMessage,
    });
    await expect(readFile(artifact.filePath, "utf-8")).resolves.toBe(lastReadyHtml);
  });

  it("preserves invalid external HTML until explicit repair restores the last good output", async () => {
    const artifact = await service.create({
      name: "Externally edited artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const lastGoodHtml = "<!doctype html><html><body>Last good output</body></html>";
    await writeFile(artifact.filePath, lastGoodHtml, "utf-8");

    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");
    await expect(readFile(`${artifact.filePath}.last-good`, "utf-8")).resolves.toContain(
      "Last good output",
    );

    const invalidHtml = "This is not an HTML artifact";
    await writeFile(artifact.filePath, invalidHtml, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).repairAvailable, { timeout: 3000 })
      .toBe(true);
    await expect(service.getContent(artifact.id)).rejects.toThrow("needs repair");
    await expect(readFile(artifact.filePath, "utf-8")).resolves.toBe(invalidHtml);

    await service.repair(artifact.id);
    await expect(readFile(artifact.filePath, "utf-8")).resolves.toContain("Last good output");
    await expect(service.inspect(artifact.id)).resolves.toMatchObject({
      status: "ready",
      repairAvailable: false,
      errorMessage: null,
    });
  });

  it("broadcasts a valid external metadata edit without rewriting the HTML", async () => {
    const broadcasts = vi.fn();
    service.stop();
    service = createArtifactService(registry, undefined, broadcasts);
    const artifact = await service.create({
      name: "Metadata watcher artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const html = "<!doctype html><html><body>Stable output</body></html>";
    await writeFile(artifact.filePath, html, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");
    const settledHtml = await readFile(artifact.filePath, "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 25));
    broadcasts.mockClear();

    const { store } = await registry.resolveForProject(repositoryProject);
    const record = await store.inspect(artifact.id);
    if (!record) throw new Error("Artifact record not found");
    await writeFile(
      store.recordPath(artifact.id),
      JSON.stringify({ ...record, name: "Externally renamed" }),
      "utf-8",
    );

    const sawRenamedMetadata = () =>
      broadcasts.mock.calls.some(([metadata]) => metadata.name === "Externally renamed");
    await expect.poll(sawRenamedMetadata, { timeout: 3000 }).toBe(true);
    await expect(readFile(artifact.filePath, "utf-8")).resolves.toBe(settledHtml);
  });

  it("regenerates a ready artifact without the ready watcher flagging the backup as an external edit", async () => {
    const artifact = await service.create({
      name: "Regenerated artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const firstHtml = "<!doctype html><html><body>First output</body></html>";
    await writeFile(artifact.filePath, firstHtml, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");

    await service.regenerate(artifact.id);
    await expect(readFile(`${artifact.filePath}.bak`, "utf-8")).resolves.toContain("First output");

    // Outlast the ready watcher's poll interval: the record must stay
    // "generating" rather than collapsing into a repairable error.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(service.inspect(artifact.id)).resolves.toMatchObject({
      status: "generating",
      repairAvailable: false,
    });

    const secondHtml = "<!doctype html><html><body>Second output</body></html>";
    await writeFile(artifact.filePath, secondHtml, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");
    await expect(service.getContent(artifact.id)).resolves.toContain("Second output");
    await expect(readFile(`${artifact.filePath}.last-good`, "utf-8")).resolves.toContain(
      "Second output",
    );
  });

  it("cancelling a regeneration restores the last output without offering repair", async () => {
    const artifact = await service.create({
      name: "Cancelled regeneration",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const readyHtml = "<!doctype html><html><body>Kept output</body></html>";
    await writeFile(artifact.filePath, readyHtml, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");

    await service.regenerate(artifact.id);
    const cancelled = await service.cancel(artifact.id);

    expect(cancelled).toMatchObject({ status: "error", repairAvailable: false });
    await expect(readFile(artifact.filePath, "utf-8")).resolves.toContain("Kept output");
  });

  it("stands down if an accidental duplicate service is regenerating an artifact", async () => {
    const artifact = await service.create({
      name: "Shared store artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    const readyHtml = "<!doctype html><html><body>Shared output</body></html>";
    await writeFile(artifact.filePath, readyHtml, "utf-8");
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");

    // Production has one daemon-owned service. Keep this defensive case so an
    // accidental duplicate during direct host construction cannot turn the
    // other instance's regeneration rename into an external-edit error.
    const observer = createArtifactService(registry);
    try {
      await expect(observer.watchReadyArtifacts()).resolves.toBe(1);
      await service.regenerate(artifact.id);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await expect(observer.inspect(artifact.id)).resolves.toMatchObject({
        status: "generating",
        repairAvailable: false,
      });
    } finally {
      observer.stop();
    }
  });

  it("accepts a metadata edit whose projectId spells the same root differently", async () => {
    const artifact = await service.create({
      name: "Renamed artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });

    const renamed = await service.update({
      artifactId: artifact.id,
      name: "Renamed by the edit sheet",
      projectId: path.join(repositoryProject, "..", path.basename(repositoryProject)),
    });

    expect(renamed.name).toBe("Renamed by the edit sheet");
    expect(renamed.projectId).toBe(artifact.projectId);
  });

  it("tolerates a momentarily invalid file while an editor saves over it", async () => {
    const artifact = await service.create({
      name: "Editor-saved artifact",
      description: "test",
      projectId: repositoryProject,
      provider: "mock",
    });
    await writeFile(
      artifact.filePath,
      "<!doctype html><html><body>Before save</body></html>",
      "utf-8",
    );
    await expect
      .poll(async () => (await service.inspect(artifact.id)).status, { timeout: 3000 })
      .toBe("ready");

    // Truncate then complete the write, the way write-temp-then-rename saves
    // look to a watcher, with the final content valid.
    await writeFile(artifact.filePath, "", "utf-8");
    await writeFile(
      artifact.filePath,
      "<!doctype html><html><body>After save</body></html>",
      "utf-8",
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(service.inspect(artifact.id)).resolves.toMatchObject({
      status: "ready",
      repairAvailable: false,
      errorMessage: null,
    });
    await expect(service.getContent(artifact.id)).resolves.toContain("After save");
  });
});
