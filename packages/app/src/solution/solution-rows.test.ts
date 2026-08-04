import { describe, expect, it } from "vitest";
import type {
  SolutionProjectContents,
  SolutionTree,
} from "@otto-code/client/internal/daemon-client";
import { buildSolutionRows, collapsedKey, type SolutionRow } from "./solution-rows";

const tree: SolutionTree = {
  solutionPath: "App.slnx",
  name: "App",
  format: "slnx",
  folders: [
    { path: "/Src/", name: "Src", parentPath: null },
    { path: "/Tests/", name: "Tests", parentPath: null },
    { path: "/Src/Internal/", name: "Internal", parentPath: "/Src/" },
  ],
  projects: [
    {
      id: "p-core",
      name: "Core",
      path: "src/Core/Core.csproj",
      outsideWorkspace: false,
      folderPath: "/Src/",
    },
    {
      id: "p-hidden",
      name: "Hidden",
      path: "src/Hidden/Hidden.csproj",
      outsideWorkspace: false,
      folderPath: "/Src/Internal/",
    },
    {
      id: "p-tests",
      name: "Core.Tests",
      path: "tests/Core.Tests/Core.Tests.csproj",
      outsideWorkspace: false,
      folderPath: "/Tests/",
    },
    {
      id: "p-loose",
      name: "Loose",
      path: "Loose/Loose.csproj",
      outsideWorkspace: false,
      folderPath: null,
    },
  ],
  buildTypes: ["Debug", "Release"],
  platforms: ["Any CPU"],
};

function contents(overrides: Partial<SolutionProjectContents> = {}): SolutionProjectContents {
  return {
    projectPath: "src/Core/Core.csproj",
    status: "ok",
    nodes: [],
    projectReferences: [],
    packageReferences: [],
    targetFrameworks: ["net8.0"],
    outputType: "Library",
    isSdkStyle: true,
    error: null,
    ...overrides,
  };
}

function shape(rows: SolutionRow[]): string[] {
  return rows.map((row) => `${"  ".repeat(row.depth)}${row.node.kind}:${row.node.name}`);
}

function names(rows: SolutionRow[]): string[] {
  return rows.map((row) => row.node.name);
}

function nodeNamed(rows: SolutionRow[], name: string): SolutionRow["node"] | undefined {
  return rows.find((row) => row.node.name === name)?.node;
}

describe("the Solution lens's row builder", () => {
  it("renders nothing before the tree arrives", () => {
    expect(buildSolutionRows({ tree: null, projects: new Map(), expandedIds: new Set() })).toEqual(
      [],
    );
  });

  it("puts solution folders first, then loose projects, each alphabetical", () => {
    const rows = buildSolutionRows({ tree, projects: new Map(), expandedIds: new Set() });

    expect(shape(rows)).toEqual(["folder:Src", "folder:Tests", "solutionProject:Loose"]);
  });

  it("nests projects inside the solution folder that owns them", () => {
    // The organisational payload of the whole view, and the thing `dotnet sln list` cannot report
    // - it returns a flat list of project paths.
    const rows = buildSolutionRows({
      tree,
      projects: new Map(),
      expandedIds: new Set(["/Src/", "/Src/Internal/", "/Tests/"]),
    });

    expect(shape(rows)).toEqual([
      "folder:Src",
      "  folder:Internal",
      "    solutionProject:Hidden",
      "  solutionProject:Core",
      "folder:Tests",
      "  solutionProject:Core.Tests",
      "solutionProject:Loose",
    ]);
  });

  it("calls a project that has not been asked for `unloaded`, not empty", () => {
    const rows = buildSolutionRows({
      tree,
      projects: new Map(),
      expandedIds: new Set(["/Src/"]),
    });

    expect(nodeNamed(rows, "Core")).toMatchObject({ kind: "solutionProject", status: "unloaded" });
  });

  it("carries MSBuild's own message on a project it refused", () => {
    // One bad project must not blank the tree: the failure lives on that node, and every sibling
    // still renders.
    const rows = buildSolutionRows({
      tree,
      projects: new Map([
        [
          "src/Core/Core.csproj",
          contents({ status: "failed", error: "MSB4025: The project file could not be loaded." }),
        ],
      ]),
      expandedIds: new Set(["/Src/", "src/Core/Core.csproj"]),
    });

    expect(nodeNamed(rows, "Core")).toMatchObject({
      status: "failed",
      error: "MSB4025: The project file could not be loaded.",
    });
    expect(shape(rows)).toContain("folder:Tests");
  });

  describe("an expanded project", () => {
    const loaded = contents({
      nodes: [
        {
          kind: "directory",
          id: "d-models",
          parentId: null,
          name: "Models",
          path: "src/Core/Models",
          outsideWorkspace: false,
        },
        {
          kind: "file",
          id: "f-widget",
          parentId: "d-models",
          name: "Widget.cs",
          path: "src/Core/Models/Widget.cs",
          outsideWorkspace: false,
          itemType: "Compile",
          isImplicit: true,
        },
        {
          kind: "file",
          id: "f-program",
          parentId: null,
          name: "Program.cs",
          path: "src/Core/Program.cs",
          outsideWorkspace: false,
          itemType: "Compile",
          isImplicit: true,
        },
      ],
    });
    const projects = new Map([["src/Core/Core.csproj", loaded]]);

    it("shows its evaluated membership, directories expanded by default", () => {
      // No listing has to be fetched - the whole project arrived in one payload - so collapsing by
      // default would hide files for no saving at all.
      const rows = buildSolutionRows({
        tree,
        projects,
        expandedIds: new Set(["/Src/", "src/Core/Core.csproj"]),
      });

      expect(shape(rows)).toEqual([
        "folder:Src",
        // Collapsed, so its own project stays hidden - folders before projects at each level.
        "  folder:Internal",
        "  solutionProject:Core",
        "    directory:Models",
        "      file:Widget.cs",
        "    file:Program.cs",
        "folder:Tests",
        "solutionProject:Loose",
      ]);
    });

    it("collapses a directory only when it is explicitly collapsed", () => {
      const rows = buildSolutionRows({
        tree,
        projects,
        expandedIds: new Set(["/Src/", "src/Core/Core.csproj", collapsedKey("d-models")]),
      });

      expect(shape(rows)).toContain("    directory:Models");
      expect(shape(rows)).not.toContain("      file:Widget.cs");
    });

    it("has no bin or obj node, because no evaluated item lives there", () => {
      // The one thing a filesystem tree structurally cannot do - and it needs no gitignore rule
      // and no filter, because build output simply is not in the project.
      const rows = buildSolutionRows({
        tree,
        projects,
        expandedIds: new Set(["/Src/", "src/Core/Core.csproj"]),
      });

      expect(names(rows)).not.toContain("obj");
      expect(names(rows)).not.toContain("bin");
    });

    it("keeps the item type and the implicit flag on each file", () => {
      const rows = buildSolutionRows({
        tree,
        projects,
        expandedIds: new Set(["/Src/", "src/Core/Core.csproj"]),
      });

      expect(nodeNamed(rows, "Program.cs")).toMatchObject({
        itemType: "Compile",
        isImplicit: true,
      });
    });

    it("renders nothing extra while the project's contents are still in flight", () => {
      const rows = buildSolutionRows({
        tree,
        projects: new Map(),
        expandedIds: new Set(["/Src/", "src/Core/Core.csproj"]),
      });

      expect(shape(rows)).toEqual([
        "folder:Src",
        "  folder:Internal",
        "  solutionProject:Core",
        "folder:Tests",
        "solutionProject:Loose",
      ]);
    });
  });

  it("marks an out-of-workspace project without hiding it", () => {
    // Settled policy: shown and opened like any other, warned on edit, absent from git surfaces.
    const rows = buildSolutionRows({
      tree: {
        ...tree,
        folders: [],
        projects: [
          {
            id: "p-shared",
            name: "Shared",
            path: "/elsewhere/Shared/Shared.csproj",
            outsideWorkspace: true,
            folderPath: null,
          },
        ],
      },
      projects: new Map(),
      expandedIds: new Set(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].node).toMatchObject({ name: "Shared", outsideWorkspace: true });
  });
});
