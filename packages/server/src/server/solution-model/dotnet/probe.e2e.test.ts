import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { SolutionService } from "../service.js";
import { toPosixAbsolute } from "../paths.js";

/**
 * The whole stack against the real sidecar: discovery in Node, a solution read through Microsoft's
 * serializer, and MSBuild evaluation through a warm `ProjectCollection` — for both `.sln` and
 * `.slnx`.
 *
 * The unit tests stub the provider, which proves the translation and the switch but not that the
 * payload runs. This is where "the roll-forward policy got dropped and the payload no longer
 * starts on this machine" shows up, and it is the only place the two formats are proven to share
 * one code path.
 *
 * Skipped unless the payload has been built (`npm run build:dotnet-probe`), which needs a .NET
 * SDK — the same shape as `csharp-server.e2e.test.ts` skipping without `csharp-ls`.
 */

const logger = pino({ level: "silent" });

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../dotnet-probe/fixtures/sample",
);
const payload = path.resolve(fixtures, "../../dist/OttoDotnetProbe.dll");
const hasPayload = existsSync(payload) && existsSync(path.join(fixtures, "Sample.slnx"));

const services: SolutionService[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stopAll()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function enabledService(): Promise<SolutionService> {
  const service = new SolutionService({ logger });
  await service.applySettings({ enabled: true });
  services.push(service);
  return service;
}

describe.skipIf(!hasPayload)("the .NET solution sidecar, end to end", () => {
  const root = toPosixAbsolute(fixtures);

  it("offers one entry for the fixture, against real files on disk", async () => {
    // The fixture ships both formats of the same solution so the two parse paths can be compared,
    // which is exactly the shape `dotnet sln migrate` leaves behind. Discovery must offer one
    // picker entry, not two — and it must be the `.slnx`.
    const service = await enabledService();

    const solutions = await service.listSolutions(root);

    expect(solutions).toEqual([{ path: "Sample.slnx", name: "Sample", format: "slnx" }]);
  });

  it.each(["slnx", "sln"] as const)(
    "reads the same organisation out of a .%s",
    async (format) => {
      const service = await enabledService();

      const tree = await service.getTree({ root, solutionPath: `Sample.${format}` });

      expect(tree.format).toBe(format);
      // Solution folders with their nesting — the organisational payload of the whole view, and
      // the thing no CLI surface can report.
      expect(tree.folders.map((folder) => folder.path).sort()).toEqual(["/Src/", "/Tests/"]);
      expect(tree.projects.map((project) => project.name).sort()).toEqual([
        "App",
        "Core",
        "Core.Tests",
      ]);
      expect(tree.projects.every((project) => project.outsideWorkspace === false)).toBe(true);
      expect(tree.buildTypes).toEqual(["Debug", "Release"]);
      expect(tree.platforms).toEqual(["Any CPU"]);
    },
    120_000,
  );

  it("evaluates a project to the files that are actually compiled, and no others", async () => {
    const service = await enabledService();
    await service.getTree({ root, solutionPath: "Sample.slnx" });

    const project = await service.loadProject({
      root,
      solutionPath: "Sample.slnx",
      projectPath: "src/Core/Core.csproj",
    });

    expect(project.status).toBe("ok");
    // Two, not four: no generated `obj/*.AssemblyInfo.cs`. That is evaluation rather than a
    // design-time build, and it is the assertion that would fail if the engine were swapped.
    expect(project.nodes.map((node) => node.name).sort()).toEqual(["Gadget.cs", "Widget.cs"]);
    expect(project.targetFrameworks).toEqual(["net8.0"]);
    expect(project.isSdkStyle).toBe(true);
    expect(project.nodes.every((node) => node.kind === "file" && node.isImplicit)).toBe(true);
  }, 120_000);

  it("reports a project it cannot evaluate per node, without blanking the tree", async () => {
    const workspace = toPosixAbsolute(await mkdtemp(path.join(os.tmpdir(), "otto-solution-e2e-")));
    tempRoots.push(workspace);
    await writeFile(
      path.join(workspace, "Broken.slnx"),
      '<Solution>\n  <Project Path="Broken/Broken.csproj" />\n</Solution>\n',
    );
    const service = await enabledService();
    await service.getTree({ root: workspace, solutionPath: "Broken.slnx" });

    const project = await service.loadProject({
      root: workspace,
      solutionPath: "Broken.slnx",
      projectPath: "Broken/Broken.csproj",
    });

    // `failed`, not a thrown error and not an empty `ok`: the user is told which project the
    // build system refused and why, in MSBuild's own words.
    expect(project.status).toBe("failed");
    expect(project.error).toBeTruthy();
    expect(project.nodes).toEqual([]);
  }, 120_000);

  it("serves a second project from the same warm process", async () => {
    // The design's whole cost argument: N projects is one process and one SDK resolution, not
    // N of each. If this ever starts spawning per project, it is v1's rejected shape again.
    const service = await enabledService();
    await service.getTree({ root, solutionPath: "Sample.slnx" });

    const core = await service.loadProject({
      root,
      solutionPath: "Sample.slnx",
      projectPath: "src/Core/Core.csproj",
    });
    const started = Date.now();
    const app = await service.loadProject({
      root,
      solutionPath: "Sample.slnx",
      projectPath: "src/App/App.csproj",
    });

    expect(core.status).toBe("ok");
    expect(app.status).toBe("ok");
    expect(app.projectReferences).toEqual(["src/Core/Core.csproj"]);
    // Generously bounded — this is a smoke check that the collection stayed warm, not a
    // benchmark. A cold process would spend seconds here re-resolving the SDK.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 120_000);
});
