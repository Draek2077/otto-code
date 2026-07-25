import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
      reason:
        "The .NET solution sidecar is not present in this build. Run `npm run build:dotnet-probe`.",
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

/**
 * Candidate locations, most specific first: an explicit override, the published-package layout,
 * then the repo layout found by walking up from this module.
 */
async function findPayload(): Promise<string | null> {
  const override = process.env.OTTO_DOTNET_PROBE_DIR?.trim();
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(override === undefined || override.length === 0 ? [] : [join(override, ENTRY_FILE)]),
    // `<server>/dist/server/solution-model/dotnet` → `<server>/dist/dotnet-probe`
    resolve(here, "..", "..", "..", "dotnet-probe", ENTRY_FILE),
    // Running from source in the repo: walk out of packages/server to the sibling package.
    resolve(here, "..", "..", "..", "..", "..", "dotnet-probe", "dist", ENTRY_FILE),
    resolve(here, "..", "..", "..", "..", "..", "..", "dotnet-probe", "dist", ENTRY_FILE),
  ];

  for (const candidate of candidates) {
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
