import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { LspConnection } from "./connection.js";
import { LSP_SERVER_ROWS, resolveServerCommand, type LspServerRow } from "./registry.js";

/**
 * Settles the charter's one deferred Phase 1 question: does the C# server need a
 * `solution/open` bootstrap after `initialize`, or is it an ordinary stdio server?
 *
 * The answer is ordinary — proven against the three project shapes a real repo can
 * have: a loose folder with no project file at all, a classic `.sln`, and .NET 10's
 * new `.slnx`. If that ever stops being true, C# needs a per-language bootstrap hook
 * and this test is where it will show up first.
 *
 * Skipped unless `csharp-ls` is installed (`dotnet tool install -g csharp-ls`), which
 * is why C# is a PATH-only row.
 */

const logger = pino({ level: "silent" });
const csharpRow: LspServerRow = LSP_SERVER_ROWS.find((row) => row.id === "csharp")!;

function isOnPath(bin: string): boolean {
  const names = process.platform === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin];
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
    .some((entry) => names.some((name) => existsSync(path.join(entry, name))));
}

const hasCsharpServer = isOnPath(csharpRow.bin);

const tempRoots: string[] = [];
const started: LspConnection[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((connection) => connection.stop()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

const PROGRAM = `public static class Greeter {
    public static string Greet(string name) => $"hello {name}";
    public static void Main() { System.Console.WriteLine(Greet("otto")); }
}
`;

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`;

const SLNX = `<Solution>
  <Project Path="App/App.csproj" />
</Solution>
`;

const CLASSIC_SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App", "App\\App.csproj", "{2E4C4B8F-0000-4000-8000-000000000001}"
EndProject
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|Any CPU = Debug|Any CPU
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
\t\t{2E4C4B8F-0000-4000-8000-000000000001}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
\t\t{2E4C4B8F-0000-4000-8000-000000000001}.Debug|Any CPU.Build.0 = Debug|Any CPU
\tEndGlobalSection
EndGlobal
`;

type ProjectShape = "loose-folder" | "classic-sln" | "slnx";

async function createCsharpWorkspace(shape: ProjectShape): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), `otto-lsp-cs-${shape}-`));
  tempRoots.push(rootPath);

  if (shape === "loose-folder") {
    await writeFile(path.join(rootPath, "Program.cs"), PROGRAM);
    return rootPath;
  }

  const appDir = path.join(rootPath, "App");
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, "App.csproj"), CSPROJ);
  await writeFile(path.join(appDir, "Program.cs"), PROGRAM);

  if (shape === "slnx") {
    await writeFile(path.join(rootPath, "Demo.slnx"), SLNX);
  } else {
    await writeFile(path.join(rootPath, "Demo.sln"), CLASSIC_SLN);
  }
  return rootPath;
}

async function startCsharpServer(rootPath: string): Promise<LspConnection> {
  const resolved = await resolveServerCommand(csharpRow, rootPath);
  expect(resolved).not.toBeNull();

  const connection = await LspConnection.start({
    spec: {
      id: csharpRow.id,
      command: resolved!.command,
      args: resolved!.args,
      rootPath,
    },
    logger,
    initializeTimeoutMs: 60000,
    requestTimeoutMs: 60000,
    onExit: () => {},
  });
  started.push(connection);
  return connection;
}

describe.skipIf(!hasCsharpServer)("csharp-ls", () => {
  it("resolves from PATH, since a dotnet global tool has no other rung", async () => {
    const rootPath = await createCsharpWorkspace("loose-folder");

    const resolved = await resolveServerCommand(csharpRow, rootPath);

    expect(resolved?.rung).toBe("path");
    // Stdio is the default mode; passing `--stdio` would be an unrecognised flag.
    expect(resolved?.args).toEqual([]);
  });

  const shapes: readonly ProjectShape[] = ["loose-folder", "classic-sln", "slnx"];

  it.each(shapes)(
    "initializes against a %s workspace with no solution/open bootstrap",
    async (shape) => {
      const rootPath = await createCsharpWorkspace(shape);

      const connection = await startCsharpServer(rootPath);

      expect(connection.capabilities.definitionProvider).toBe(true);
      expect(connection.isRunning).toBe(true);
    },
    120000,
  );

  it("advertises the capabilities Phase 5 is built on", async () => {
    const rootPath = await createCsharpWorkspace("slnx");

    const connection = await startCsharpServer(rootPath);

    expect(connection.serverInfo?.name).toBe("csharp-ls");
    expect(connection.capabilities.definitionProvider).toBe(true);
  });
});
