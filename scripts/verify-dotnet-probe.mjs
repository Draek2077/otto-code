#!/usr/bin/env node
/**
 * Smoke test for the built sidecar payload: spawn it, drive the real NDJSON protocol against the
 * fixture solution in both formats, and assert on what comes back.
 *
 * This runs in CI right after the publish step because the interesting failures are not compile
 * errors — they are "the payload will not start on this runtime" (a roll-forward policy that got
 * dropped) and "the payload starts but cannot find an SDK". Both produce a green build and a
 * broken feature, and neither is visible without executing the thing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(repoRoot, "packages", "dotnet-probe", "dist", "OttoDotnetProbe.dll");
const fixtures = join(repoRoot, "packages", "dotnet-probe", "fixtures", "sample");

if (!existsSync(entry)) {
  console.error(
    `verify-dotnet-probe: no payload at ${entry} — run npm run build:dotnet-probe first`,
  );
  process.exit(1);
}

const failures = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
    failures.push(label);
  }
}

/** Run one batch of requests through a single process, the way the daemon's pool does. */
function ask(requests) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("dotnet", [entry], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`timed out; stderr: ${err}`));
    }, 120_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(`exited ${code}; stderr: ${err}`));
        return;
      }
      resolvePromise(
        out
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line)),
      );
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

for (const format of ["slnx", "sln"]) {
  const solutionPath = join(fixtures, `Sample.${format}`);
  console.log(`\n${format}: ${solutionPath}`);

  const [handshake, tree, core, missing] = await ask([
    { id: "tree", method: "solution.tree", params: { solutionPath } },
    {
      id: "core",
      method: "project.load",
      params: { projectPath: join(fixtures, "src", "Core", "Core.csproj") },
    },
    {
      id: "missing",
      method: "project.load",
      params: { projectPath: join(fixtures, "nope", "Nope.csproj") },
    },
  ]);

  check(
    "handshake reports ready with an SDK",
    handshake?.ready === true && Boolean(handshake?.sdkVersion),
  );
  check("protocol version is 1", handshake?.protocolVersion === 1, JSON.stringify(handshake));
  check("tree resolved", tree?.ok === true, JSON.stringify(tree?.error));

  const result = tree?.result;
  check("format reported", result?.format === format, result?.format);
  check("3 projects", result?.projects?.length === 3, result?.projects?.length);
  check("2 solution folders", result?.folders?.length === 2, JSON.stringify(result?.folders));
  // The whole organisational payload of the view, and the thing no CLI surface can report.
  check(
    "projects carry their solution folder",
    result?.projects?.every(
      (project) => project.folderPath === "/Src/" || project.folderPath === "/Tests/",
    ),
    JSON.stringify(result?.projects?.map((project) => [project.name, project.folderPath])),
  );
  check(
    "build types",
    JSON.stringify(result?.buildTypes) === '["Debug","Release"]',
    JSON.stringify(result?.buildTypes),
  );
  check(
    "platforms",
    JSON.stringify(result?.platforms) === '["Any CPU"]',
    JSON.stringify(result?.platforms),
  );
  check(
    "paths are forward-slashed and absolute",
    result?.projects?.every(
      (project) => !project.path.includes("\\") && /^(\/|[A-Za-z]:\/)/.test(project.path),
    ),
    JSON.stringify(result?.projects?.map((project) => project.path)),
  );

  check("project evaluated", core?.ok === true, JSON.stringify(core?.error));
  // Evaluation, not a design-time build: exactly the two files on disk, with no generated
  // obj/*.AssemblyInfo.cs. This is the assertion that would fail if anyone swapped the engine.
  check(
    "2 Compile items",
    core?.result?.items?.Compile?.length === 2,
    JSON.stringify(core?.result?.items?.Compile),
  );
  check(
    "SDK default globs are marked implicit",
    core?.result?.items?.Compile?.every((item) => item.isImplicit === true),
    JSON.stringify(core?.result?.items?.Compile),
  );
  check(
    "target framework",
    JSON.stringify(core?.result?.targetFrameworks) === '["net8.0"]',
    JSON.stringify(core?.result?.targetFrameworks),
  );
  check("SDK-style detected", core?.result?.isSdkStyle === true);

  // A project that cannot be read is a per-request answer, not a dead process: one bad project
  // must not blank the tree.
  check(
    "a missing project fails without killing the process",
    missing?.ok === false && Boolean(missing?.error?.message),
  );
}

if (failures.length > 0) {
  console.error(`\nverify-dotnet-probe: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-dotnet-probe: all checks passed");
