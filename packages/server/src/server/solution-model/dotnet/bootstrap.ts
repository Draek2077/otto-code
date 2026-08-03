import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the sidecar lives, and whether this host can run it at all.
 *
 * Both halves are host facts, not configuration, and both are cached for the life of the daemon:
 * a machine does not gain a .NET SDK mid-session, and probing `dotnet --version` on every request
 * would spawn a process to answer a question whose answer never changes.
 *
 * **Absence is silent by design.** No SDK, or no payload, means the workspace reports no
 * solutions, which means no switcher — the same outcome as a workspace with no `.sln`. That is
 * the feature contract: no degraded mode, no half-tree, and nothing to explain to a user who has
 * never opened a .NET project in their life.
 */

const ENTRY_FILE = "OttoDotnetProbe.dll";
/** Refuse a payload whose shape we cannot read rather than guess at it. */
export const SUPPORTED_PROTOCOL_VERSION = 1;

export interface DotnetRuntimeInfo {
  /** The `dotnet` executable to spawn. */
  dotnetCommand: string;
  /** Absolute path to the payload's entry assembly. */
  entryPath: string;
}

export type DotnetBootstrapResult =
  | { status: "ready"; runtime: DotnetRuntimeInfo }
  | { status: "unavailable"; reason: string };

let cached: Promise<DotnetBootstrapResult> | null = null;

export function resolveDotnetRuntime(): Promise<DotnetBootstrapResult> {
  cached ??= probe();
  return cached;
}

/** Test hook. Nothing in production re-probes a host mid-session. */
export function resetDotnetRuntimeCache(): void {
  cached = null;
}

async function probe(): Promise<DotnetBootstrapResult> {
  const entryPath = await findPayload();
  if (entryPath === null) {
    return {
      status: "unavailable",
      // The restart half is not boilerplate: this whole result is cached for the daemon's
      // lifetime (see `cached` above), so a user who runs the build and looks again sees the
      // same message and reasonably concludes the build did not work.
      reason:
        "The .NET solution sidecar is not present in this build. Run `npm run build:dotnet-probe`, then restart the daemon: this result is cached for the daemon's lifetime.",
    };
  }

  const dotnetCommand = process.env.OTTO_DOTNET_COMMAND?.trim() || "dotnet";
  const version = await dotnetVersion(dotnetCommand);
  if (version === null) {
    return {
      status: "unavailable",
      // Reading solution structure needs only the runtime, but evaluating a project needs the
      // SDK, because that is MSBuild. We gate on the SDK rather than ship a tree whose projects
      // never open.
      reason: "No .NET SDK on this host, so solution structure cannot be read.",
    };
  }

  return { status: "ready", runtime: { dotnetCommand, entryPath } };
}

/** The directory holding the nearest `package.json`, walking up from `start`. */
function findPackageRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Candidate payload locations, most specific first: an explicit override, the payload as the
 * server package ships it, then the sibling workspace package a repo checkout builds in place.
 *
 * **Both derived candidates hang off the server package root, the directory holding
 * `package.json`, never off a count of `..` segments from this module.** The count was the bug.
 * It silently encodes how deep TypeScript emits, and it emits one level deeper than anyone
 * assumed: `outDir` is `dist/server` and `rootDir` is `src`, so this file lands at
 * `dist/server/server/solution-model/dotnet/bootstrap.js`, with a doubled `server/`. Three `..`
 * therefore resolved to `dist/server/dotnet-probe`, which nothing writes, rather than
 * `dist/dotnet-probe`, which `scripts/build-dotnet-probe.mjs` does. A repo checkout hid it for
 * good: a later fallback found the sibling `packages/dotnet-probe/dist`, which exists here and
 * does not exist in a published tarball or the installed desktop app, so the Solution view was
 * permanently unavailable everywhere except a checkout.
 *
 * The package root moves only when the package itself does, so this survives an `outDir` change
 * and a rearranged source tree alike. `bootstrap.test.ts` pins both derived candidates against
 * `scripts/dotnet-probe-paths.mjs`, the single constant the build script writes to.
 *
 * Exported for that test; production has one caller, `findPayload`.
 */
export function payloadCandidates(moduleDir: string, override: string | undefined): string[] {
  const candidates: string[] = [];

  const explicit = override?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    candidates.push(join(explicit, ENTRY_FILE));
  }

  const packageRoot = findPackageRoot(moduleDir);
  if (packageRoot !== null) {
    // The published layout, and the only candidate a tarball or the installed app can satisfy.
    candidates.push(join(packageRoot, "dist", "dotnet-probe", ENTRY_FILE));
    // A repo checkout, where the sidecar is a sibling workspace package built in place.
    candidates.push(join(dirname(packageRoot), "dotnet-probe", "dist", ENTRY_FILE));
  }

  return candidates;
}

async function findPayload(): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url));

  for (const candidate of payloadCandidates(here, process.env.OTTO_DOTNET_PROBE_DIR)) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function dotnetVersion(command: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let settled = false;
    const finish = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolvePromise(value);
      }
    };

    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    // A `dotnet` that never answers is the same to us as one that is not there, and a daemon that
    // waits forever on it is worse than one that reports the feature unavailable.
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 10_000);
    timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 && stdout.trim().length > 0 ? stdout.trim() : null);
    });
  });
}
