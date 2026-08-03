import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DiscoveredScript,
  ScriptDiscoveryContext,
  ScriptProvider,
} from "./script-provider.js";

const PACKAGE_JSON = "package.json";

/**
 * Lockfile → the runner that should appear in the command. Ordered: the first
 * lockfile present wins, so a repo that grew a stray `package-lock.json`
 * beside its `pnpm-lock.yaml` still gets pnpm.
 */
const PACKAGE_MANAGERS: ReadonlyArray<{ lockfile: string; runner: string; label: string }> = [
  { lockfile: "pnpm-lock.yaml", runner: "pnpm", label: "pnpm" },
  { lockfile: "yarn.lock", runner: "yarn", label: "yarn" },
  { lockfile: "bun.lockb", runner: "bun", label: "bun" },
  { lockfile: "bun.lock", runner: "bun", label: "bun" },
  { lockfile: "package-lock.json", runner: "npm", label: "npm" },
];

const DEFAULT_PACKAGE_MANAGER = { runner: "npm", label: "npm" } as const;

// Anything outside this set could be reinterpreted by the shell the script
// terminal runs in, so the name gets quoted before it lands in a command.
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9._:-]+$/;

type ManifestRead =
  | { status: "absent" }
  | { status: "unreadable"; error: unknown }
  | { status: "parsed"; manifest: unknown };

async function readManifest(filePath: string): Promise<ManifestRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    // A directory without a package.json is the overwhelmingly common case and
    // is not a problem; anything else is worth a line in the log.
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "absent" }
      : { status: "unreadable", error };
  }
  try {
    return { status: "parsed", manifest: JSON.parse(raw) };
  } catch (error) {
    return { status: "unreadable", error };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePackageManager(
  workspaceDirectory: string,
): Promise<{ runner: string; label: string }> {
  for (const candidate of PACKAGE_MANAGERS) {
    if (await fileExists(path.join(workspaceDirectory, candidate.lockfile))) {
      return { runner: candidate.runner, label: candidate.label };
    }
  }
  return DEFAULT_PACKAGE_MANAGER;
}

function buildRunCommand(input: { runner: string; scriptName: string }): string {
  const name = SAFE_SCRIPT_NAME.test(input.scriptName)
    ? input.scriptName
    : `"${input.scriptName.replace(/(["\\$`])/g, "\\$1")}"`;
  return `${input.runner} run ${name}`;
}

function extractScriptNames(manifest: unknown): string[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [];
  }
  const scripts = (manifest as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return [];
  }
  const names: string[] = [];
  for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
    // A script whose body is not a non-empty string cannot be run, so offering
    // it would produce a terminal that exits immediately.
    if (typeof body !== "string" || body.trim().length === 0) {
      continue;
    }
    if (name.trim().length === 0) {
      continue;
    }
    names.push(name);
  }
  return names;
}

/**
 * Scripts declared in the workspace root's `package.json`.
 *
 * Root only, by design: the first slice proves the abstraction rather than the
 * source. Per-package discovery for npm workspaces is the next source, and the
 * `cwd` field on DiscoveredScript already carries what it will need.
 */
export function createNpmScriptProvider(): ScriptProvider {
  return {
    sourceId: "npm",
    sourceLabel: "npm",
    async discover(context: ScriptDiscoveryContext): Promise<DiscoveredScript[]> {
      const manifestPath = path.join(context.workspaceDirectory, PACKAGE_JSON);
      const read = await readManifest(manifestPath);
      if (read.status === "absent") {
        return [];
      }
      if (read.status === "unreadable") {
        // Rule 2: a broken manifest must not blank the whole dropdown.
        context.logger.warn(
          { err: read.error, manifestPath },
          "Failed to read package.json; discovering no npm scripts",
        );
        return [];
      }

      const names = extractScriptNames(read.manifest);
      if (names.length === 0) {
        return [];
      }

      const packageManager = await resolvePackageManager(context.workspaceDirectory);
      return names.map((name) => ({
        name,
        command: buildRunCommand({ runner: packageManager.runner, scriptName: name }),
        cwd: null,
        sourceFile: PACKAGE_JSON,
        sourceLabel: packageManager.label,
      }));
    },
  };
}
