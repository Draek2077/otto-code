import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { EditorHost } from "../service.js";
import {
  readEditorSettings,
  saveEditorSettings,
  EditorSettings,
} from "@getpaseo/plugin/otto/editor";
import {
  listEditorSolutions,
  readEditorSolution,
  readEditorSolutionProject,
} from "@getpaseo/plugin/otto/editor-solution";

describe("real read-only .NET solution integration", () => {
  it("does no directory or SDK discovery while disabled, then reads real .slnx projects and evaluated membership", async () => {
    const base = path.resolve("../../.tmp/editor-solution-fixtures");
    await mkdir(base, { recursive: true });
    const home = await mkdtemp(path.join(base, "host-"));
    const root = path.join(home, "workspace");
    await cp(path.resolve("../dotnet-probe/fixtures/sample"), root, { recursive: true });
    const host = new EditorHost(home, () => "host", pino({ level: "silent" }));
    try {
      const disabled = await host.invoke(
        listEditorSolutions.name,
        { hostId: "host", root: path.join(home, "not-present") },
        "client",
      );
      expect(disabled).toEqual({ enabled: false, solutions: [] });
      const settings = EditorSettings.parse(
        await host.invoke(readEditorSettings.name, { hostId: "host" }, "client"),
      );
      await host.invoke(
        saveEditorSettings.name,
        { hostId: "host", expectedRevision: settings.revision, patch: { solutionEnabled: true } },
        "client",
      );
      const listed = listEditorSolutions.output.parse(
        await host.invoke(listEditorSolutions.name, { hostId: "host", root }, "client"),
      );
      expect(listed.solutions.map((solution) => solution.path)).toEqual(["Sample.slnx"]);
      const tree = readEditorSolution.output.parse(
        await host.invoke(
          readEditorSolution.name,
          { hostId: "host", root, solutionPath: "Sample.slnx" },
          "client",
        ),
      );
      const core = tree.projects.find((project) => project.name === "Core");
      expect(core).toBeDefined();
      if (!core) throw new Error("Fixture Core project is missing.");
      const project = readEditorSolutionProject.output.parse(
        await host.invoke(
          readEditorSolutionProject.name,
          { hostId: "host", root, solutionPath: "Sample.slnx", projectPath: core.path },
          "client",
        ),
      );
      expect(project.status).toBe("ok");
      expect(project.targetFrameworks).toEqual(["net8.0"]);
      expect(
        project.nodes.filter((node) => node.kind === "file").map((node) => node.name),
      ).toContain("Widget.cs");
      expect(project.nodes.filter((node) => node.kind === "file")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemType: "Compile", isImplicit: true }),
        ]),
      );
      const classic = readEditorSolution.output.parse(
        await host.invoke(
          readEditorSolution.name,
          { hostId: "host", root, solutionPath: "Sample.sln" },
          "client",
        ),
      );
      expect(classic.projects.map((item) => item.name).sort()).toEqual(
        tree.projects.map((item) => item.name).sort(),
      );
    } finally {
      await host.close();
      await rm(home, { recursive: true, force: true });
    }
  }, 30000);
});
