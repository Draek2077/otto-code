import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolutionService, type SolutionProjectResult } from "./service.js";
import { toPosixAbsolute } from "./paths.js";
import type {
  SolutionProjectContents,
  SolutionProvider,
  SolutionRefAbsolute,
  SolutionStructure,
} from "./provider.js";

const logger = pino({ level: "silent" });

/**
 * A directory that is definitively not inside the temporary workspace, spelled the way this OS
 * spells an absolute path — on Windows `/elsewhere` resolves onto the current drive.
 */
const OUTSIDE_ROOT = toPosixAbsolute(process.platform === "win32" ? "C:/elsewhere" : "/elsewhere");

/**
 * A provider that records every call. The point of most of these tests is what the service does
 * NOT ask it — "disabled does no work" is only checkable against something that would have been
 * asked.
 */
function createProviderSpy(overrides: Partial<SolutionProvider> = {}) {
  // The spies WRAP the overrides rather than being replaced by them — a test that supplies a
  // `loadTree` still needs to assert how many times it was reached, which is the whole point.
  const calls = {
    detect: vi.fn(overrides.detect ?? (async (): Promise<SolutionRefAbsolute[]> => [])),
    loadTree: vi.fn(
      overrides.loadTree ??
        ((): Promise<SolutionStructure> => Promise.reject(new Error("loadTree not stubbed"))),
    ),
    loadProject: vi.fn(
      overrides.loadProject ??
        ((): Promise<SolutionProjectContents> =>
          Promise.reject(new Error("loadProject not stubbed"))),
    ),
    invalidate: vi.fn(overrides.invalidate ?? (async (): Promise<void> => {})),
    stopWorkspace: vi.fn(overrides.stopWorkspace ?? (async (): Promise<void> => {})),
    stopAll: vi.fn(overrides.stopAll ?? (async (): Promise<void> => {})),
    reapIdle: vi.fn(overrides.reapIdle ?? (async (): Promise<void> => {})),
  };
  const provider: SolutionProvider = { id: "dotnet", ...calls };
  return { provider, calls };
}

/** `[kind, path]` per node — the shape assertions read against. */
function nodeShape(nodes: SolutionProjectResult["nodes"]): [string, string][] {
  return nodes.map((node) => [node.kind, node.path]);
}

function indexByName(
  nodes: SolutionProjectResult["nodes"],
): Map<string, SolutionProjectResult["nodes"][number]> {
  return new Map(nodes.map((node) => [node.name, node]));
}

function structureFor(root: string): SolutionStructure {
  return {
    solutionPath: `${root}/App.slnx`,
    name: "App",
    format: "slnx",
    folders: [
      { path: "/Src/", name: "Src", parentPath: null },
      { path: "/Src/Inner/", name: "Inner", parentPath: "/Src/" },
    ],
    projects: [
      { id: "p1", name: "Core", path: `${root}/src/Core/Core.csproj`, folderPath: "/Src/" },
      // Declared by the solution outside the workspace root — the settled policy case.
      {
        id: "p2",
        name: "Shared",
        path: `${OUTSIDE_ROOT}/Shared/Shared.csproj`,
        folderPath: null,
      },
    ],
    buildTypes: ["Debug", "Release"],
    platforms: ["Any CPU"],
  };
}

describe("SolutionService with the switch off", () => {
  /**
   * "Disabled is genuinely off, not merely hidden" is a Phase 0 deliverable, and this is what it
   * means concretely: with the switch off, nothing reaches the provider at all. No discovery walk,
   * no solution read, no project parse, no process. One boolean, and then nothing.
   */
  it("does no discovery work at all", async () => {
    const { provider, calls } = createProviderSpy();
    const service = new SolutionService({ logger, provider });

    await expect(service.listSolutions("/repo")).resolves.toEqual([]);

    expect(calls.detect).not.toHaveBeenCalled();
  });

  it("refuses a tree request without touching the provider", async () => {
    const { provider, calls } = createProviderSpy();
    const service = new SolutionService({ logger, provider });

    await expect(service.getTree({ root: "/repo", solutionPath: "App.slnx" })).rejects.toThrow(
      /turned off/,
    );

    expect(calls.loadTree).not.toHaveBeenCalled();
  });

  it("refuses a project request without touching the provider", async () => {
    const { provider, calls } = createProviderSpy();
    const service = new SolutionService({ logger, provider });

    await expect(
      service.loadProject({ root: "/repo", solutionPath: "App.slnx", projectPath: "a.csproj" }),
    ).rejects.toThrow(/turned off/);

    expect(calls.loadProject).not.toHaveBeenCalled();
  });

  it("ignores filesystem churn rather than doing bookkeeping for a feature nobody enabled", () => {
    const { provider } = createProviderSpy();
    const service = new SolutionService({ logger, provider });

    expect(service.invalidatePath("/repo/src/Core/Core.csproj")).toEqual([]);
  });

  it("does not reap, because there is nothing that could be running", async () => {
    const { provider, calls } = createProviderSpy();
    const service = new SolutionService({ logger, provider });

    await service.reapIdle();

    expect(calls.reapIdle).not.toHaveBeenCalled();
  });

  it("stops everything and drops the cache the moment the switch is turned off", async () => {
    const { provider, calls } = createProviderSpy();
    const service = new SolutionService({ logger, provider });
    await service.applySettings({ enabled: true });

    await service.applySettings({ enabled: false });

    // Not "eventually, when it idles out" — a feature that keeps a process alive after being
    // disabled is not disabled.
    expect(calls.stopAll).toHaveBeenCalledTimes(1);
  });
});

describe("SolutionService with the switch on", () => {
  let root: string;

  beforeEach(async () => {
    root = toPosixAbsolute(await mkdtemp(join(tmpdir(), "otto-solution-service-")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function enabledService(overrides: Partial<SolutionProvider> = {}) {
    const { provider, calls } = createProviderSpy(overrides);
    const service = new SolutionService({ logger, provider });
    await service.applySettings({ enabled: true });
    return { service, calls };
  }

  it("reports discovered solutions workspace-relative", async () => {
    const { service } = await enabledService({
      detect: async () => [{ path: `${root}/nested/App.slnx`, name: "App", format: "slnx" }],
    });

    await expect(service.listSolutions(root)).resolves.toEqual([
      { path: "nested/App.slnx", name: "App", format: "slnx" },
    ]);
  });

  it("reports no solutions rather than an error when discovery fails", async () => {
    // A host with no SDK, a workspace with no solution, and a broken walk are one silent case for
    // the client, not three states to render.
    const { service } = await enabledService({
      detect: async () => {
        throw new Error("no .NET SDK");
      },
    });

    await expect(service.listSolutions(root)).resolves.toEqual([]);
  });

  it("carries solution folders and configurations through untouched", async () => {
    await writeFile(join(root, "App.slnx"), "<Solution />");
    const { service } = await enabledService({ loadTree: async () => structureFor(root) });

    const tree = await service.getTree({ root, solutionPath: "App.slnx" });

    expect(tree.folders).toEqual([
      { path: "/Src/", name: "Src", parentPath: null },
      { path: "/Src/Inner/", name: "Inner", parentPath: "/Src/" },
    ]);
    expect(tree.buildTypes).toEqual(["Debug", "Release"]);
    expect(tree.platforms).toEqual(["Any CPU"]);
  });

  it("flags an out-of-workspace project instead of hiding or blocking it", async () => {
    await writeFile(join(root, "App.slnx"), "<Solution />");
    const { service } = await enabledService({ loadTree: async () => structureFor(root) });

    const tree = await service.getTree({ root, solutionPath: "App.slnx" });

    expect(tree.projects).toEqual([
      {
        id: "p1",
        name: "Core",
        path: "src/Core/Core.csproj",
        outsideWorkspace: false,
        folderPath: "/Src/",
      },
      {
        id: "p2",
        name: "Shared",
        // Absolute, because there is no sensible relative form — and flagged, so the client never
        // has to work that out by inspecting the string.
        path: `${OUTSIDE_ROOT}/Shared/Shared.csproj`,
        outsideWorkspace: true,
        folderPath: null,
      },
    ]);
  });

  it("re-reads the solution when its file changes, and only then", async () => {
    const solutionPath = join(root, "App.slnx");
    await writeFile(solutionPath, "<Solution />");
    const { service, calls } = await enabledService({ loadTree: async () => structureFor(root) });

    await service.getTree({ root, solutionPath: "App.slnx" });
    await service.getTree({ root, solutionPath: "App.slnx" });
    expect(calls.loadTree).toHaveBeenCalledTimes(1);

    // A different size gives a different stamp regardless of mtime granularity, which is the
    // point: the check is content identity, not a timestamp race.
    await writeFile(solutionPath, "<Solution>  </Solution>");
    await service.getTree({ root, solutionPath: "App.slnx" });
    expect(calls.loadTree).toHaveBeenCalledTimes(2);
  });

  describe("project membership", () => {
    async function serviceWithProject(files: SolutionProjectContents["files"]) {
      await writeFile(join(root, "App.slnx"), "<Solution />");
      await writeFile(join(root, "Core.csproj"), "<Project />");
      const contents: SolutionProjectContents = {
        projectPath: `${root}/Core.csproj`,
        status: "ok",
        files,
        projectReferences: [`${root}/other/Other.csproj`],
        packageReferences: [{ name: "System.Text.Json", version: "8.0.5" }],
        targetFrameworks: ["net8.0"],
        outputType: "Library",
        isSdkStyle: true,
        error: null,
      };
      const built = await enabledService({
        loadTree: async () => structureFor(root),
        loadProject: async () => contents,
      });
      await built.service.getTree({ root, solutionPath: "App.slnx" });
      return built;
    }

    it("synthesises directories from the files that are actually in the project", async () => {
      const { service } = await serviceWithProject([
        { path: `${root}/Program.cs`, itemType: "Compile", isImplicit: true },
        { path: `${root}/Models/Widget.cs`, itemType: "Compile", isImplicit: true },
        { path: `${root}/Models/Nested/Deep.cs`, itemType: "Compile", isImplicit: true },
      ]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      // No `obj/` node exists because no evaluated item is in `obj/` — not because anything
      // filters it. That is the thing a filesystem tree structurally cannot do.
      expect(nodeShape(project.nodes)).toEqual([
        ["directory", "Models"],
        ["directory", "Models/Nested"],
        ["file", "Models/Nested/Deep.cs"],
        ["file", "Models/Widget.cs"],
        ["file", "Program.cs"],
      ]);
    });

    it("parents a file directly beside the project at the project node itself", async () => {
      const { service } = await serviceWithProject([
        { path: `${root}/Program.cs`, itemType: "Compile", isImplicit: true },
      ]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      expect(project.nodes[0].parentId).toBeNull();
    });

    it("marks which items the SDK contributed, which is what Phase 2 turns on", async () => {
      const { service } = await serviceWithProject([
        { path: `${root}/Program.cs`, itemType: "Compile", isImplicit: true },
        { path: `${root}/legacy.txt`, itemType: "Content", isImplicit: false },
      ]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      const byName = indexByName(project.nodes);
      expect(byName.get("Program.cs")).toMatchObject({ isImplicit: true, itemType: "Compile" });
      expect(byName.get("legacy.txt")).toMatchObject({ isImplicit: false, itemType: "Content" });
    });

    it("lets an explicit declaration win when a file appears under two item types", async () => {
      const { service } = await serviceWithProject([
        { path: `${root}/config.json`, itemType: "None", isImplicit: true },
        { path: `${root}/config.json`, itemType: "Content", isImplicit: false },
      ]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      expect(project.nodes).toHaveLength(1);
      expect(project.nodes[0]).toMatchObject({ itemType: "Content", isImplicit: false });
    });

    it("attaches a linked file from outside the project folder at the project root", async () => {
      // `<Compile Include="../Shared/X.cs" />` has no place in this project's directory chain, and
      // inventing a synthetic parent tree for it would describe a structure that does not exist.
      const { service } = await serviceWithProject([
        { path: `${root}/../Shared/Linked.cs`, itemType: "Compile", isImplicit: false },
      ]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      expect(project.nodes).toHaveLength(1);
      expect(project.nodes[0].parentId).toBeNull();
      expect(project.nodes[0].name).toBe("Linked.cs");
    });

    it("passes references and framework metadata through, workspace-relative", async () => {
      const { service } = await serviceWithProject([]);

      const project = await service.loadProject({
        root,
        solutionPath: "App.slnx",
        projectPath: "Core.csproj",
      });

      expect(project.projectReferences).toEqual(["other/Other.csproj"]);
      expect(project.packageReferences).toEqual([{ name: "System.Text.Json", version: "8.0.5" }]);
      expect(project.targetFrameworks).toEqual(["net8.0"]);
      expect(project.isSdkStyle).toBe(true);
    });
  });

  describe("staleness", () => {
    it("drops every solution beneath a changed Directory.Build.props", async () => {
      // The projects' own files did not change, so their freshness stamps still match — this is
      // the one case the read-side check cannot see, and the reason the push path exists.
      await writeFile(join(root, "App.slnx"), "<Solution />");
      const { service } = await enabledService({ loadTree: async () => structureFor(root) });
      await service.getTree({ root, solutionPath: "App.slnx" });

      expect(service.invalidatePath(`${root}/Directory.Build.props`)).toEqual([`${root}/App.slnx`]);
    });

    it("ignores an ordinary source edit, because membership is by glob", async () => {
      await writeFile(join(root, "App.slnx"), "<Solution />");
      const { service } = await enabledService({ loadTree: async () => structureFor(root) });
      await service.getTree({ root, solutionPath: "App.slnx" });

      expect(service.invalidatePath(`${root}/src/Core/Widget.cs`)).toEqual([]);
    });

    it("drops the solutions that name a changed project", async () => {
      await writeFile(join(root, "App.slnx"), "<Solution />");
      const { service } = await enabledService({ loadTree: async () => structureFor(root) });
      await service.getTree({ root, solutionPath: "App.slnx" });

      expect(service.invalidatePath(`${root}/src/Core/Core.csproj`)).toEqual([`${root}/App.slnx`]);
    });
  });

  it("releases the sidecar and the cache when a workspace goes away", async () => {
    await writeFile(join(root, "App.slnx"), "<Solution />");
    const { service, calls } = await enabledService({ loadTree: async () => structureFor(root) });
    await service.getTree({ root, solutionPath: "App.slnx" });

    await service.stopWorkspace(root);

    expect(calls.stopWorkspace).toHaveBeenCalledWith(root);
    // Cache dropped too: the next read must not answer from a workspace nobody has open.
    expect(service.invalidatePath(`${root}/App.slnx`)).toEqual([`${root}/App.slnx`]);
  });
});
