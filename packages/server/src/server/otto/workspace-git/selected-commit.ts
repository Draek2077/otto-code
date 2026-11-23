import { runGitCommand } from "../../../utils/run-git-command.js";

const MAX_OUTPUT = 64 * 1024;
const active = new Set<string>();
const environment = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" };
export class SelectedCommitError extends Error {
  constructor(
    message: string,
    readonly consoleOutput: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export function selectedCommitOutput(error: unknown): string | undefined {
  return error instanceof SelectedCommitError ? error.consoleOutput : undefined;
}
function validatePaths(paths: readonly string[]) {
  if (!paths.length || paths.length > 5000)
    throw new Error("Select between 1 and 5,000 changed files.");
  for (const path of paths) {
    if (
      !path ||
      path.includes("\0") ||
      path.includes("\\") ||
      path.includes(":") ||
      path.startsWith("/") ||
      path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
    )
      throw new Error("Commit paths must identify files inside this repository.");
  }
}
function changedPaths(status: string): Set<string> {
  const entries = status.split("\0"),
    paths = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    paths.add(entry.slice(3));
    if (entry.slice(0, 2).includes("R") || entry.slice(0, 2).includes("C")) {
      const oldPath = entries[++index];
      if (oldPath) paths.add(oldPath);
    }
  }
  return paths;
}

/** Explicit, literal per-file commit. Other staged paths stay staged and out of this commit. */
export async function commitSelectedPaths(
  cwd: string,
  message: string,
  paths: readonly string[],
): Promise<string> {
  validatePaths(paths);
  if (!message.trim()) throw new Error("Write a commit message first.");
  const root = (await runGitCommand(["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
  if (active.has(root)) throw new Error("A manual commit is already running for this repository.");
  active.add(root);
  let output = "";
  const append = (text: string) => {
    output = (output + text).slice(-MAX_OUTPUT);
  };
  try {
    const status = await runGitCommand(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root, maxOutputBytes: 1024 * 1024 },
    );
    if (status.truncated)
      throw new Error(
        "The changed-file list is too large. Commit a smaller working set from a terminal.",
      );
    const changed = changedPaths(status.stdout);
    if (paths.some((path) => !changed.has(path)))
      throw new Error(
        "The selected files changed. Refresh Changes and review the selection before committing.",
      );
    const input = Buffer.from([...new Set(paths)].join("\0") + "\0");
    append(`$ git add (${paths.length} selected paths)\n`);
    const staged = await runGitCommand(
      ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
      { cwd: root, input, timeout: 120000, envOverlay: environment, maxOutputBytes: MAX_OUTPUT },
    );
    append(staged.stdout + staged.stderr);
    append("$ git commit --only (selected files)\n");
    const result = await runGitCommand(
      [
        "--literal-pathspecs",
        "commit",
        "--only",
        "-m",
        message,
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      {
        cwd: root,
        input,
        timeout: 120000,
        envOverlay: environment,
        maxOutputBytes: MAX_OUTPUT,
        acceptExitCodes: Array.from({ length: 256 }, (_, index) => index),
      },
    );
    append(result.stdout + result.stderr);
    if (result.truncated) append("\n[Git output was truncated]\n");
    if (result.exitCode !== 0)
      throw new SelectedCommitError(
        "Commit failed. Review the console output and repository state before trying again.",
        output,
      );
    return output;
  } catch (error) {
    if (error instanceof SelectedCommitError) throw error;
    const detail =
      error instanceof Error
        ? error.message
        : "Commit outcome is unknown. Refresh Changes before another attempt.";
    throw new SelectedCommitError(detail, (output + "\n" + detail).slice(-MAX_OUTPUT), {
      cause: error,
    });
  } finally {
    active.delete(root);
  }
}
