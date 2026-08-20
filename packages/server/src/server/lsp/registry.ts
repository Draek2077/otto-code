import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which language servers exist, and how to find one on this machine. A language
 * is a row here - not code - so adding Go or Rust later is a table entry.
 *
 * Resolution is workspace-first, always: a server that type-checks the project
 * must be the version the project itself installs, or its answers disagree with
 * the project's own build. Angular makes that mandatory rather than merely
 * correct, since `ngserver` has to match the app's Angular version.
 */

export type LspDiscoveryRung = "workspaceBin" | "bundled" | "path";

/** How much of a .NET workspace the C# server loads. See `lsp.csharpProjectScope`. */
export type CsharpProjectScope = "solution" | "allProjects";

/** Host settings a row may need to derive its args. Absent fields take the row's own default. */
export interface LspResolveContext {
  csharpProjectScope?: CsharpProjectScope;
}

/**
 * One step of installing a missing server on the daemon's host: an argv array, never a
 * shell string. `display` is the exact string the user must be able to read (and confirm,
 * for a terminal run) - the daemon renders it, so the client never joins argv itself.
 */
export interface LspInstallStep {
  command: string;
  args: readonly string[];
  /** e.g. `npm install -g pyright` - the exact text the confirm dialog and the row show. */
  display: string;
  /** Plain-words caveat, shown under the command (a note, not an error). */
  note?: string;
}

/**
 * How a missing server can be installed on the daemon's host, when it can at all.
 *
 * A row WITHOUT an `install` block is project-supplied (oxlint, angular): its only
 * discovery rung is `workspaceBin`, so a host that lacks it is not missing anything -
 * the project brings it. Those rows deliberately never get an install command.
 *
 * `command` routes run in the daemon's shell, in order. `steps` is normally one entry;
 * the C# server needs two when the .NET SDK is absent (bootstrap the SDK, then install the
 * tool). A `manual` route has no command - only an official installer link.
 *
 * The route is a *row field*: adding Go or Rust later is a table entry, not a code path.
 */
export type LspInstallRoute =
  | { kind: "command"; steps: readonly LspInstallStep[] }
  | { kind: "manual"; url: string; note?: string };

export interface LspServerRow {
  id: string;
  /** LSP `languageId` values this server expects on didOpen. */
  languageIds: readonly string[];
  extensions: readonly string[];
  /** Executable name without a platform suffix; discovery adds `.cmd` on Windows. */
  bin: string;
  /** `{root}` is replaced with the workspace root at resolve time. */
  args: readonly string[];
  /**
   * Extra args derived from the workspace, appended after `args` at resolve time. For the one
   * case a static row cannot express: a server whose own project discovery gives a materially
   * worse answer than the workspace can supply. Skipped for the host-wide question, which has
   * no workspace to read.
   */
  argsForRoot?: (rootPath: string, context: LspResolveContext) => Promise<readonly string[]>;
  discovery: readonly LspDiscoveryRung[];
  /** How to install the server on the host, or absent when only the project can supply it. */
  install?: LspInstallRoute;
  initializationOptions?: unknown;
  /**
   * Whether this row is on when the host config says nothing about it. The three
   * acceptance-criteria languages are on - a release that needs to be switched on
   * before it works has not shipped them. Rows whose index cost is heavy enough to
   * notice (rust-analyzer, clangd) or that are not finished (Angular) are off, so
   * nobody pays for a language they never open.
   */
  defaultEnabled: boolean;
  /** Plain-words index cost, shown next to the toggle so the trade is honest. */
  indexCost: string;
  /**
   * Which runtime this server is, when that changes how Otto must manage the process.
   * `"dotnet"` routes the spawn through the shared .NET process registry, so a C# server
   * counts against the same machine-wide cap as the solution sidecar and is swept with it.
   * Omitted means an ordinary process the LSP pool's own cap is sufficient for.
   */
  runtime?: "dotnet";
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
    // The global install is platform-neutral: npm writes the right shim for whatever host it
    // runs on, so one argv answers every platform.
    install: {
      kind: "command",
      steps: [
        {
          command: "npm",
          args: ["install", "-g", "typescript-language-server", "typescript"],
          display: "npm install -g typescript-language-server typescript",
          note: "Needs Node.js and npm on this host.",
        },
      ],
    },
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
    // The npm package ships a standalone binary, so it is the same command on every platform
    // and distro - deliberately NOT pip, which varies per distro and per venv.
    install: {
      kind: "command",
      steps: [
        {
          command: "npm",
          args: ["install", "-g", "pyright"],
          display: "npm install -g pyright",
          note: "Needs Node.js and npm on this host.",
        },
      ],
    },
  },
  {
    id: "csharp",
    // `dotnet tool install -g csharp-ls`, so PATH is the only rung that can ever
    // supply it. Verified 2026-07-24 to need no `solution/open` bootstrap: it
    // initializes as a plain stdio server against a loose folder, a classic
    // `.sln`, and .NET 10's new `.slnx` alike, and loads the project itself.
    // Stdio is its default mode - it has no `--stdio` flag.
    languageIds: ["csharp"],
    extensions: [".cs", ".csx"],
    bin: "csharp-ls",
    args: [],
    // Name the root solution when there is exactly one. Left to itself in a repo holding
    // several, csharp-ls logs "no or multiple .sln files found" and falls back to globbing
    // every `.csproj` in the tree, which in a monorepo means loading hundreds of projects
    // one at a time, with no solution graph, and hover spins until it gives up.
    argsForRoot: rootSolutionArgs,
    discovery: ["path"],
    defaultEnabled: true,
    // A .NET global tool: the process is a `dotnet` host, and it loads projects through
    // MSBuild, which is where the worker nodes come from. Counted and swept accordingly.
    runtime: "dotnet",
    indexCost:
      "Loads the solution on first use; seconds on a small project, longer on a large one.",
    // The server is a .NET global tool, so the install is `dotnet tool install -g csharp-ls`.
    // That is the *server-side* step. When the daemon finds no `dotnet` on the host it
    // PREPENDS a platform-specific SDK bootstrap step (winget / brew / apt) - the row does
    // not know the host, and the client must not, either. See `resolveLspInstall` in the
    // service, which owns the platform logic.
    install: {
      kind: "command",
      steps: [
        {
          command: "dotnet",
          args: ["tool", "install", "-g", "csharp-ls"],
          display: "dotnet tool install -g csharp-ls",
          note: "Newer csharp-ls releases target .NET 9; on a .NET 8-only host pin `--version 0.16.0`.",
        },
      ],
    },
  },
  {
    id: "oxlint",
    // `oxlint --lsp` is a real LSP server (verified 2026-07-25: serverInfo
    // `oxlint 1.61.0`, publishes diagnostics on didOpen, offers quickfix and
    // `source.fixAll.oxc` code actions). Diagnostics only - no definition, hover,
    // references or rename - which is exactly why the fan-out filters on advertised
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
    indexCost: "None - it lints the open file only, with no project model to build.",
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
  context: LspResolveContext = {},
): Promise<ResolvedLspServer | null> {
  for (const rung of row.discovery) {
    if (rung === "workspaceBin" && rootPath === null) {
      continue;
    }
    const command = await resolveRung(rung, row.bin, rootPath ?? "");
    if (command !== null) {
      const derived = rootPath === null ? [] : ((await row.argsForRoot?.(rootPath, context)) ?? []);
      return {
        command,
        args: [...substituteRoot(row.args, rootPath ?? ""), ...derived],
        rung,
      };
    }
  }
  return null;
}

/**
 * Forward slashes, because a substituted Windows root would otherwise produce
 * `C:\ws` + `/node_modules` - one arg with both separators, which the servers
 * consuming these probe paths handle inconsistently.
 */
const SOLUTION_EXTENSIONS = new Set([".sln", ".slnx"]);

/**
 * `-s <file>` when the workspace root holds exactly one solution, nothing otherwise.
 *
 * Skipped entirely under `csharpProjectScope: "allProjects"`, which is the host asking for
 * csharp-ls's own glob-everything mode: complete coverage of the root at a cost of loading each
 * project separately.
 *
 * Only the root directory is read, never a walk: nested solutions belong to sub-projects and
 * naming one of those would be a guess about which half of the repo the user meant. Zero
 * solutions and several are the same answer - say nothing and let csharp-ls decide - because
 * the only case Otto knows better than the server is the unambiguous one.
 *
 * The path stays relative, which is what `--solution` documents ("relative to CWD") and what the
 * pool spawns with (`cwd: rootPath`). `.slnx` is included because .NET 10's `dotnet new sln`
 * emits it; see docs/code-intelligence.md.
 */
async function rootSolutionArgs(
  rootPath: string,
  context: LspResolveContext,
): Promise<readonly string[]> {
  if (context.csharpProjectScope === "allProjects") {
    return [];
  }

  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const solutions = entries
    .filter(
      (entry) => entry.isFile() && SOLUTION_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name);

  return solutions.length === 1 ? ["-s", solutions[0]] : [];
}

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

/**
 * Whether a bare command resolves anywhere on the host's PATH. The .NET SDK question the C#
 * install route needs ("is `dotnet` here?") is exactly this, and reusing the same rung logic
 * as server discovery means one definition of "on the host's PATH" for both.
 */
export async function commandOnPath(bin: string): Promise<boolean> {
  return (await findOnPath(bin)) !== null;
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
