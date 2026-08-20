import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LSP_SERVER_ROWS,
  resolveServerCommand,
  rowsForExtension,
  type LspServerRow,
} from "./registry.js";
import { isPlatform } from "../../test-utils/platform.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "otto-lsp-registry-"));
  tempRoots.push(dir);
  return dir;
}

async function installWorkspaceBin(rootPath: string, bin: string): Promise<string> {
  const binDir = path.join(rootPath, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  const fileName = isPlatform("win32") ? `${bin}.cmd` : bin;
  const filePath = path.join(binDir, fileName);
  await writeFile(filePath, isPlatform("win32") ? "@echo off\n" : "#!/bin/sh\n");
  if (!isPlatform("win32")) {
    await chmod(filePath, 0o755);
  }
  return filePath;
}

function row(overrides: Partial<LspServerRow> = {}): LspServerRow {
  return {
    id: "test-server",
    languageIds: ["plaintext"],
    extensions: [".fake"],
    bin: "otto-nonexistent-language-server",
    args: ["--stdio"],
    discovery: ["workspaceBin", "bundled", "path"],
    defaultEnabled: true,
    indexCost: "none",
    ...overrides,
  };
}

describe("server discovery", () => {
  it("finds the workspace's own copy first", async () => {
    const rootPath = await createRoot();
    const installed = await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(row(), rootPath);

    expect(resolved).toEqual({
      command: installed,
      args: ["--stdio"],
      rung: "workspaceBin",
    });
  });

  it("returns null when no rung can supply the server", async () => {
    const rootPath = await createRoot();

    expect(await resolveServerCommand(row(), rootPath)).toBeNull();
  });

  it("skips a rung the row does not declare", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(row({ discovery: ["path"] }), rootPath);

    expect(resolved).toBeNull();
  });

  it("answers host-wide without a root, skipping the workspace rung", async () => {
    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["workspaceBin", "bundled"] }),
      null,
    );

    expect(resolved?.rung).toBe("bundled");
  });

  it("has nothing to say host-wide about a row only a project can supply", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    expect(await resolveServerCommand(row({ discovery: ["workspaceBin"] }), null)).toBeNull();
  });

  it("finds our bundled copy when the workspace has none", async () => {
    const rootPath = await createRoot();

    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["bundled"] }),
      rootPath,
    );

    expect(resolved?.rung).toBe("bundled");
    expect(resolved?.command).toContain("typescript-language-server");
  });

  it("prefers the workspace copy over our bundled one", async () => {
    const rootPath = await createRoot();
    const installed = await installWorkspaceBin(rootPath, "typescript-language-server");

    const resolved = await resolveServerCommand(
      row({ bin: "typescript-language-server", discovery: ["workspaceBin", "bundled"] }),
      rootPath,
    );

    expect(resolved?.command).toBe(installed);
  });

  it("substitutes the workspace root into args as a forward-slash path", async () => {
    const rootPath = await createRoot();
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");

    const resolved = await resolveServerCommand(
      row({ args: ["--stdio", "--tsProbeLocations", "{root}/node_modules"] }),
      rootPath,
    );

    const expectedRoot = rootPath.replace(/\\/g, "/");
    expect(resolved?.args).toEqual([
      "--stdio",
      "--tsProbeLocations",
      `${expectedRoot}/node_modules`,
    ]);
  });
});

/**
 * The C# row is the one row whose args depend on the workspace, because csharp-ls left to its own
 * discovery in a repo holding several solutions logs "no or multiple .sln files found" and falls
 * back to loading every `.csproj` separately - measured at roughly 4s per project, so minutes on a
 * large repo rather than the ~34s the same solution takes loaded as a unit.
 */
describe("the C# row's solution argument", () => {
  const csharpRow = (): LspServerRow => {
    const found = LSP_SERVER_ROWS.find((entry) => entry.id === "csharp");
    if (found === undefined) {
      throw new Error("the csharp row is missing from the registry");
    }
    // Discovery is irrelevant here and `csharp-ls` may not be installed on the machine running
    // this, so borrow a bin the test can guarantee exists.
    return { ...found, bin: "otto-nonexistent-language-server", discovery: ["workspaceBin"] };
  };

  async function resolvedArgs(
    rootPath: string,
    context: Parameters<typeof resolveServerCommand>[2],
  ): Promise<readonly string[]> {
    await installWorkspaceBin(rootPath, "otto-nonexistent-language-server");
    const resolved = await resolveServerCommand(csharpRow(), rootPath, context);
    if (resolved === null) {
      throw new Error("expected the borrowed workspace bin to resolve");
    }
    return resolved.args;
  }

  it("names the one solution sitting in the workspace root", async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, "Thing.sln"), "");

    expect(await resolvedArgs(rootPath, {})).toEqual(["-s", "Thing.sln"]);
  });

  it("says nothing when the root holds several, rather than guessing which half of the repo", async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, "One.sln"), "");
    await writeFile(path.join(rootPath, "Two.sln"), "");

    expect(await resolvedArgs(rootPath, {})).toEqual([]);
  });

  it("says nothing when the root holds none", async () => {
    const rootPath = await createRoot();

    expect(await resolvedArgs(rootPath, {})).toEqual([]);
  });

  it("ignores solutions nested below the root", async () => {
    // csharp-ls searches recursively itself; a nested solution is a sub-project's, and naming it
    // would be a guess. Only an unambiguous root solution is ours to name.
    const rootPath = await createRoot();
    await mkdir(path.join(rootPath, "apps"), { recursive: true });
    await writeFile(path.join(rootPath, "apps", "Nested.sln"), "");

    expect(await resolvedArgs(rootPath, {})).toEqual([]);
  });

  it("accepts .slnx, which .NET 10 emits instead of .sln", async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, "Thing.slnx"), "");

    expect(await resolvedArgs(rootPath, {})).toEqual(["-s", "Thing.slnx"]);
  });

  it("stands aside under allProjects, which is the host asking for csharp-ls's own glob mode", async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, "Thing.sln"), "");

    expect(await resolvedArgs(rootPath, { csharpProjectScope: "allProjects" })).toEqual([]);
  });

  it("leaves the host-wide question alone, which has no workspace to read", async () => {
    // `rootPath` null is the settings screen asking whether this machine can supply the server.
    const resolved = await resolveServerCommand(
      { ...csharpRow(), discovery: ["path"], bin: "sh" },
      null,
    );

    expect(resolved?.args).toEqual([]);
  });
});

describe("install routes on the registry rows", () => {
  function routeFor(id: string) {
    const found = LSP_SERVER_ROWS.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new Error(`no row ${id}`);
    }
    return found.install;
  }

  it("gives every host-installable row a command route with finished argv and display", () => {
    for (const id of ["typescript", "python", "csharp"]) {
      const route = routeFor(id);
      expect(route, `${id} should be host-installable`).toBeDefined();
      if (route?.kind !== "command") {
        throw new Error(`${id} should be a command route`);
      }
      expect(route.steps.length).toBeGreaterThan(0);
      for (const step of route.steps) {
        // A real argv, never a shell string: no flags glued to their command, no `;` or `&&`.
        expect(step.command).not.toMatch(/\s/);
        for (const arg of step.args) {
          expect(arg).not.toMatch(/[;&|]/);
        }
        expect(step.display).toBe(`${step.command} ${step.args.join(" ")}`);
      }
    }
  });

  it("installs the TypeScript and Python servers with npm, identically on every platform", () => {
    expect(routeFor("typescript")).toEqual({
      kind: "command",
      steps: [
        {
          command: "npm",
          args: ["install", "-g", "typescript-language-server", "typescript"],
          display: "npm install -g typescript-language-server typescript",
          note: expect.any(String),
        },
      ],
    });
    expect(routeFor("python")).toEqual({
      kind: "command",
      steps: [
        {
          command: "npm",
          args: ["install", "-g", "pyright"],
          display: "npm install -g pyright",
          note: expect.any(String),
        },
      ],
    });
  });

  it("installs the C# server with `dotnet tool install -g`, with no platform logic in the row", () => {
    // The row is platform-neutral: the .NET SDK bootstrap is the daemon's job, added at
    // resolve time when `dotnet` is not on the host. A row that hard-codes winget/brew/apt
    // would leak platform logic into the table.
    expect(routeFor("csharp")).toEqual({
      kind: "command",
      steps: [
        {
          command: "dotnet",
          args: ["tool", "install", "-g", "csharp-ls"],
          display: "dotnet tool install -g csharp-ls",
          note: expect.any(String),
        },
      ],
    });
  });

  it("gives the project-supplied rows no install route at all", () => {
    // Their only discovery rung is `workspaceBin`: a host that lacks them is not missing
    // anything, so there is no command to copy and no button to show.
    expect(routeFor("oxlint")).toBeUndefined();
    expect(routeFor("angular")).toBeUndefined();
  });
});

describe("extension routing", () => {
  it("routes a TypeScript file to the TypeScript server", () => {
    const ids = rowsForExtension(".ts").map((entry) => entry.id);

    expect(ids).toContain("typescript");
  });

  it("routes one extension to several servers, which is what Angular needs", () => {
    const ids = rowsForExtension(".ts").map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining(["typescript", "angular"]));
  });

  it("is case-insensitive about the extension", () => {
    expect(rowsForExtension(".TS").map((entry) => entry.id)).toEqual(
      rowsForExtension(".ts").map((entry) => entry.id),
    );
  });

  it("returns nothing for an unhandled extension", () => {
    expect(rowsForExtension(".unknownext")).toEqual([]);
  });

  it("covers the three languages that decide whether this shipped", () => {
    const ids = LSP_SERVER_ROWS.map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining(["typescript", "python", "csharp"]));
  });

  it("routes React files through the TypeScript server", () => {
    expect(rowsForExtension(".tsx").map((entry) => entry.id)).toContain("typescript");
  });
});
