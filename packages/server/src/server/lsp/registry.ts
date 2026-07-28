import { access, constants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which language servers exist, and how to find one on this machine. A language
 * is a row here — not code — so adding Go or Rust later is a table entry.
 *
 * Resolution is workspace-first, always: a server that type-checks the project
 * must be the version the project itself installs, or its answers disagree with
 * the project's own build. Angular makes that mandatory rather than merely
 * correct, since `ngserver` has to match the app's Angular version.
 */

export type LspDiscoveryRung = "workspaceBin" | "bundled" | "path";

export interface LspServerRow {
  id: string;
  /** LSP `languageId` values this server expects on didOpen. */
  languageIds: readonly string[];
  extensions: readonly string[];
  /** Executable name without a platform suffix; discovery adds `.cmd` on Windows. */
  bin: string;
  /** `{root}` is replaced with the workspace root at resolve time. */
  args: readonly string[];
  discovery: readonly LspDiscoveryRung[];
  initializationOptions?: unknown;
  /**
   * Whether this row is on when the host config says nothing about it. The three
   * acceptance-criteria languages are on — a release that needs to be switched on
   * before it works has not shipped them. Rows whose index cost is heavy enough to
   * notice (rust-analyzer, clangd) or that are not finished (Angular) are off, so
   * nobody pays for a language they never open.
   */
  defaultEnabled: boolean;
  /** Plain-words index cost, shown next to the toggle so the trade is honest. */
  indexCost: string;
}

export interface ResolvedLspServer {
  command: string;
  args: readonly string[];
  rung: LspDiscoveryRung;
}

/**
 * TypeScript, Python and C# are the acceptance criteria, not a tier list. Angular
 * is here in Phase 1 only because it is the row that proves a document can bind
 * to more than one server; its own phase makes it work.
 */
export const LSP_SERVER_ROWS: readonly LspServerRow[] = [
  {
    id: "typescript",
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    bin: "typescript-language-server",
    args: ["--stdio"],
    discovery: ["workspaceBin", "bundled", "path"],
    defaultEnabled: true,
    indexCost: "Seconds to about half a minute on first use in a large repo; 1-4 GB while running.",
  },
  {
    id: "python",
    languageIds: ["python"],
    extensions: [".py", ".pyi"],
    bin: "pyright-langserver",
    args: ["--stdio"],
    discovery: ["workspaceBin", "bundled", "path"],
    defaultEnabled: true,
    indexCost: "A few seconds on first use.",
  },
  {
    id: "csharp",
    // `dotnet tool install -g csharp-ls`, so PATH is the only rung that can ever
    // supply it. Verified 2026-07-24 to need no `solution/open` bootstrap: it
    // initializes as a plain stdio server against a loose folder, a classic
    // `.sln`, and .NET 10's new `.slnx` alike, and loads the project itself.
    // Stdio is its default mode — it has no `--stdio` flag.
    languageIds: ["csharp"],
    extensions: [".cs", ".csx"],
    bin: "csharp-ls",
    args: [],
    discovery: ["path"],
    defaultEnabled: true,
    indexCost:
      "Loads the solution on first use; seconds on a small project, longer on a large one.",
  },
  {
    id: "oxlint",
    // `oxlint --lsp` is a real LSP server (verified 2026-07-25: serverInfo
    // `oxlint 1.61.0`, publishes diagnostics on didOpen, offers quickfix and
    // `source.fixAll.oxc` code actions). Diagnostics only — no definition, hover,
    // references or rename — which is exactly why the fan-out filters on advertised
    // capability instead of asking every bound server everything.
    //
    // This is the first row that binds a *second* server to a file the TypeScript
    // server already holds, so it is the multi-server design's first production use.
    // Angular was only ever the test-stub proof of it.
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    bin: "oxlint",
    args: ["--lsp"],
    // Workspace-only, deliberately, for the same reason as Angular but a different
    // one: a linter's rules are the project's own opinion. Falling back to our
    // bundled copy would lint a repo that never chose oxlint, inventing an opinion
    // on the author's behalf and filling their gutter with rules they never adopted.
    discovery: ["workspaceBin"],
    defaultEnabled: true,
    indexCost: "None — it lints the open file only, with no project model to build.",
  },
  {
    id: "angular",
    // Must come from the project's own node_modules so its Angular version
    // matches the app's; there is deliberately no bundled or PATH rung.
    languageIds: ["typescript", "html"],
    extensions: [".ts", ".html"],
    bin: "ngserver",
    args: [
      "--stdio",
      "--tsProbeLocations",
      "{root}/node_modules",
      "--ngProbeLocations",
      "{root}/node_modules",
    ],
    discovery: ["workspaceBin"],
    // Off until Phase 4 finishes it; the row exists to prove multi-server binding.
    defaultEnabled: false,
    indexCost: "Runs alongside the TypeScript server, so it roughly doubles that cost.",
  },
];

/**
 * The `languageId` a document is announced with on `didOpen`. One canonical value
 * per extension rather than one per server: the servers that share a file agree on
 * it (both `tsserver` and `ngserver` expect `typescript` for `.ts`), and a document
 * with two identities in two servers is a bug waiting to happen.
 */
const LANGUAGE_ID_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".cs": "csharp",
  ".csx": "csharp",
  ".html": "html",
};

export function languageIdForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return LANGUAGE_ID_BY_EXTENSION[extension] ?? "plaintext";
}

export function indexRowsByExtension(rows: readonly LspServerRow[]): Map<string, LspServerRow[]> {
  const index = new Map<string, LspServerRow[]>();
  for (const row of rows) {
    for (const extension of row.extensions) {
      const normalized = extension.toLowerCase();
      const existing = index.get(normalized);
      if (existing) {
        existing.push(row);
      } else {
        index.set(normalized, [row]);
      }
    }
  }
  return index;
}

const rowsByExtension = indexRowsByExtension(LSP_SERVER_ROWS);

export function rowsForExtension(extension: string): readonly LspServerRow[] {
  return rowsByExtension.get(extension.toLowerCase()) ?? [];
}

export function rowsForPath(filePath: string): readonly LspServerRow[] {
  return rowsForExtension(path.extname(filePath));
}

/**
 * `rootPath` null asks the host-wide question: can this machine supply the server at all?
 * That is what the settings screen asks, since it is a host screen with no workspace in
 * hand. The `workspaceBin` rung is skipped rather than faked, because a project's
 * `node_modules` is the one thing a host-wide answer genuinely cannot know.
 */
export async function resolveServerCommand(
  row: LspServerRow,
  rootPath: string | null,
): Promise<ResolvedLspServer | null> {
  for (const rung of row.discovery) {
    if (rung === "workspaceBin" && rootPath === null) {
      continue;
    }
    const command = await resolveRung(rung, row.bin, rootPath ?? "");
    if (command !== null) {
      return { command, args: substituteRoot(row.args, rootPath ?? ""), rung };
    }
  }
  return null;
}

/**
 * Forward slashes, because a substituted Windows root would otherwise produce
 * `C:\ws` + `/node_modules` — one arg with both separators, which the servers
 * consuming these probe paths handle inconsistently.
 */
function substituteRoot(args: readonly string[], rootPath: string): readonly string[] {
  const normalizedRoot = rootPath.replace(/\\/g, "/");
  return args.map((arg) => arg.replaceAll("{root}", normalizedRoot));
}

async function resolveRung(
  rung: LspDiscoveryRung,
  bin: string,
  rootPath: string,
): Promise<string | null> {
  if (rung === "workspaceBin") {
    return findInBinDir(path.join(rootPath, "node_modules", ".bin"), bin);
  }
  if (rung === "bundled") {
    return findBundled(bin);
  }
  return findOnPath(bin);
}

/**
 * npm writes `<bin>.cmd` shims on Windows and extensionless scripts elsewhere,
 * so a bare name misses on Windows.
 */
function candidateNames(bin: string): readonly string[] {
  return process.platform === "win32" ? [`${bin}.cmd`, `${bin}.exe`, bin] : [bin];
}

async function findInBinDir(binDir: string, bin: string): Promise<string | null> {
  for (const name of candidateNames(bin)) {
    const candidate = path.join(binDir, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Walks up from this module looking for a `node_modules/.bin` that holds the
 * server. Walking rather than assuming a fixed depth is what makes this work
 * under npm hoisting, a packaged daemon, and the junctioned node_modules in a
 * git worktree alike.
 */
async function findBundled(bin: string): Promise<string | null> {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const found = await findInBinDir(path.join(dir, "node_modules", ".bin"), bin);
    if (found !== null) {
      return found;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

async function findOnPath(bin: string): Promise<string | null> {
  const entries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const found = await findInBinDir(entry, bin);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
