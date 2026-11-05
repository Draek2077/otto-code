import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { findExecutableWithoutProbing } from "../../../../executable-resolution/executable-resolution.js";

export interface ServerRow {
  id: string;
  label: string;
  languages: Readonly<Record<string, string>>;
  command: string;
  args: readonly string[];
  bundled: boolean;
  workspaceOnly: boolean;
  defaultEnabled: boolean;
  cost: string;
  install: { command: string; args: string[]; display: string } | null;
}

const webLanguages = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
};
export const SERVER_ROWS: readonly ServerRow[] = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    languages: webLanguages,
    command: "typescript-language-server",
    args: ["--stdio"],
    bundled: true,
    workspaceOnly: false,
    defaultEnabled: true,
    cost: "Loads the project on first use; large projects may use significant memory.",
    install: {
      command: "npm",
      args: ["install", "-g", "typescript-language-server", "typescript"],
      display: "npm install -g typescript-language-server typescript",
    },
  },
  {
    id: "python",
    label: "Python",
    languages: { ".py": "python", ".pyi": "python" },
    command: "pyright-langserver",
    args: ["--stdio"],
    bundled: true,
    workspaceOnly: false,
    defaultEnabled: true,
    cost: "Indexes Python imports on first use.",
    install: {
      command: "npm",
      args: ["install", "-g", "pyright"],
      display: "npm install -g pyright",
    },
  },
  {
    id: "csharp",
    label: "C#",
    languages: { ".cs": "csharp", ".csx": "csharp" },
    command: "csharp-ls",
    args: [],
    bundled: false,
    workspaceOnly: false,
    defaultEnabled: true,
    cost: "Loads the solution and its projects on first use.",
    install: {
      command: "dotnet",
      args: ["tool", "install", "-g", "csharp-ls"],
      display: "dotnet tool install -g csharp-ls",
    },
  },
  {
    id: "oxlint",
    label: "Oxlint (project)",
    languages: webLanguages,
    command: "oxlint",
    args: ["--lsp"],
    bundled: false,
    workspaceOnly: true,
    defaultEnabled: true,
    cost: "Uses the project's own Oxlint configuration.",
    install: null,
  },
];

export interface ResolvedServer {
  command: string;
  args: string[];
  source: "project" | "bundled" | "path";
  selfNode?: boolean;
}
const nodePackages: Readonly<Record<string, { name: string; entry: string }>> = {
  typescript: { name: "typescript-language-server", entry: "lib/cli.mjs" },
  python: { name: "pyright", entry: "langserver.index.js" },
  oxlint: { name: "oxlint", entry: "bin/oxlint" },
};
const require = createRequire(import.meta.url);
async function nodeEntry(row: ServerRow, root: string | null): Promise<string | null> {
  const module = nodePackages[row.id];
  if (!module) return null;
  let directory: string;
  if (root) directory = path.join(root, "node_modules", module.name);
  else {
    try {
      directory = path.dirname(require.resolve(`${module.name}/package.json`));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND")
        return null;
      throw error;
    }
  }
  const entry = path.join(directory, module.entry);
  try {
    await access(entry, constants.R_OK);
    return entry;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function executableIn(directory: string, name: string) {
  const names = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of names) {
    const file = path.join(directory, candidate);
    try {
      await access(file, constants.X_OK);
      return file;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "EACCES")
      )
        continue;
      throw error;
    }
  }
  return null;
}

async function bundledExecutable(name: string) {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  // Source, npm and unpacked desktop layouts differ. Walk actual module parents,
  // never process.cwd(), which belongs to whichever workspace the user opened.
  while (true) {
    const found = await executableIn(path.join(directory, "node_modules", ".bin"), name);
    if (found) return found;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function resolveServer(
  row: ServerRow,
  root: string | null,
  allProjects = false,
): Promise<ResolvedServer | null> {
  let command = root
    ? await executableIn(path.join(root, "node_modules", ".bin"), row.command)
    : null;
  let source: ResolvedServer["source"] = "project";
  let script = command ? await nodeEntry(row, root) : null;
  if (!command && row.bundled) {
    script = await nodeEntry(row, null);
    command = script ? process.execPath : await bundledExecutable(row.command);
    source = "bundled";
  }
  if (!command && !row.workspaceOnly) {
    command = await findExecutableWithoutProbing(row.command, { cwd: root ?? process.cwd() });
    source = "path";
  }
  if (!command && row.id === "csharp")
    command = await executableIn(path.join(homedir(), ".dotnet", "tools"), row.command);
  if (!command) return null;
  const args = [...row.args];
  if (root && row.id === "csharp" && !allProjects) {
    const files = await readdir(root, { withFileTypes: true });
    const solutions = files.filter((file) => file.isFile() && /\.slnx?$/iu.test(file.name));
    if (solutions.length === 1) args.push("-s", solutions[0].name);
  }
  if (script) return { command: process.execPath, args: [script, ...args], source, selfNode: true };
  return { command, args, source };
}

export function languageFor(row: ServerRow, file: string): string | undefined {
  return row.languages[path.extname(file).toLowerCase()];
}
