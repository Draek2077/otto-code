import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// OTTO(editor): portable IL is built once and shipped with every daemon. Nix
// supplies the same payload from its fixed dependency derivation, without a
// network restore inside the npm sandbox.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const project = join(root, "packages/dotnet-probe/OttoDotnetProbe.csproj");
const build = join(root, "packages/dotnet-probe/dist");
const target = join(root, "packages/server/dist/dotnet-probe");
const scratch = join(root, ".tmp/editor-dotnet-build");
function clearOwned(directory) {
  const absolute = resolve(directory);
  if (
    ![build, target].includes(absolute) ||
    isAbsolute(relative(root, absolute)) ||
    relative(root, absolute).startsWith("..")
  )
    throw new Error(`Refusing unsafe output path: ${absolute}`);
  rmSync(absolute, { recursive: true, force: true });
  mkdirSync(absolute, { recursive: true });
}
function run(args) {
  const result = spawnSync("dotnet", args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      DOTNET_CLI_HOME: join(scratch, "home"),
      NUGET_PACKAGES: join(scratch, "nuget"),
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_PROCESSOR_COUNT: "2",
      DOTNET_NOLOGO: "1",
      DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: "1",
      MSBUILDDISABLENODEREUSE: "1",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dotnet ${args[0]} failed (${result.status}).`);
}
mkdirSync(scratch, { recursive: true });
const supplied = process.env.OTTO_DOTNET_PROBE_PAYLOAD;
let source;
if (supplied) {
  if (!isAbsolute(supplied))
    throw new Error("OTTO_DOTNET_PROBE_PAYLOAD must be an absolute build input.");
  source = supplied;
} else {
  run(["restore", project, "--locked-mode", "--disable-parallel", "--nologo"]);
  clearOwned(build);
  run([
    "publish",
    project,
    "-c",
    "Release",
    "-o",
    build,
    "--no-restore",
    "--nologo",
    "-m:1",
    "-p:UseSharedCompilation=false",
  ]);
  source = build;
}
for (const file of [
  "OttoDotnetProbe.dll",
  "OttoDotnetProbe.deps.json",
  "OttoDotnetProbe.runtimeconfig.json",
  "Microsoft.Build.Locator.dll",
  "Microsoft.VisualStudio.SolutionPersistence.dll",
]) {
  if (!existsSync(join(source, file))) throw new Error(`The .NET payload is missing ${file}.`);
}
clearOwned(target);
for (const file of readdirSync(source))
  cpSync(join(source, file), join(target, file), { recursive: true });
console.log(`Otto .NET solution payload: ${target}`);
