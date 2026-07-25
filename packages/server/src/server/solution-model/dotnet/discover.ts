import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { SolutionFormat } from "@otto-code/protocol/messages";
import type { SolutionRefAbsolute } from "../provider.js";
import { toPosixAbsolute } from "../paths.js";

/**
 * Finding the solutions in a workspace.
 *
 * **Deliberately in Node, not in the sidecar.** This answer decides whether the view switcher
 * appears at all, so it runs for every workspace the user opens — and the overwhelmingly common
 * answer is "none". Spawning a .NET process to glob for `*.sln` would make it the single most
 * expensive thing in the feature, paid mostly by workspaces that will never show it. The sidecar
 * is reached only once a tree is actually requested.
 *
 * The walk is bounded on purpose. Solutions live near the top of a repository in practice, and an
 * unbounded walk of a monorepo with a `node_modules` in it is a workspace-open stall. A solution
 * buried six directories deep is not found, and that is the right trade: the cost of the miss is
 * "no switcher", the cost of the walk is paid by everyone.
 */

const SOLUTION_EXTENSIONS = new Map<string, SolutionFormat>([
  [".sln", "sln"],
  [".slnx", "slnx"],
]);

/**
 * Directories that never contain a solution worth showing and frequently contain thousands of
 * files. `bin` and `obj` are also here because a build output tree can hold a copied solution.
 */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".vs",
  ".idea",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "packages",
  "artifacts",
  "dist",
  "out",
  "target",
  "vendor",
]);

const DEFAULT_MAX_DEPTH = 3;
/** Enough for any real repository; a guard against a pathological tree, not a product limit. */
const MAX_DIRECTORIES_VISITED = 512;

export interface DiscoverOptions {
  maxDepth?: number;
}

export async function discoverSolutions(
  root: string,
  options: DiscoverOptions = {},
): Promise<SolutionRefAbsolute[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found: SolutionRefAbsolute[] = [];
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_DIRECTORIES_VISITED) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    visited += 1;

    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      // An unreadable directory is a fact about this machine, not an error worth surfacing: the
      // user asked to browse a workspace, not to be told about a permission boundary inside it.
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (current.depth < maxDepth && !SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
          queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const format = SOLUTION_EXTENSIONS.get(extname(entry.name).toLowerCase());
      if (format === undefined) {
        continue;
      }
      const path = toPosixAbsolute(join(current.path, entry.name));
      found.push({ path, name: basename(entry.name, extname(entry.name)), format });
    }
  }

  return dedupeSlnxOverSln(found);
}

/**
 * `dotnet sln migrate` leaves the classic `.sln` beside the new `.slnx`, so a migrated repository
 * has two files describing one solution. Showing both would put two identical entries in the
 * picker and let the user pick the stale one. `.slnx` wins — it is the format the toolchain is
 * moving to, and the one `migrate` just wrote.
 */
function dedupeSlnxOverSln(found: readonly SolutionRefAbsolute[]): SolutionRefAbsolute[] {
  const slnxKeys = new Set(
    found.filter((ref) => ref.format === "slnx").map((ref) => ref.path.slice(0, -".slnx".length)),
  );
  return found
    .filter((ref) => ref.format === "slnx" || !slnxKeys.has(ref.path.slice(0, -".sln".length)))
    .sort((left, right) => left.path.localeCompare(right.path));
}
