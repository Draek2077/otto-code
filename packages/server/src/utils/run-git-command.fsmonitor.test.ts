import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runGitCommand } from "./run-git-command.js";
import { renameExplorerEntry } from "../server/file-explorer/otto-file-mutations.js";

const fixtureRoot = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
const fixtureDirectories: string[] = [];

async function createRepository() {
  for (const key of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    if (process.env[key]) {
      throw new Error(`Git fixture cannot run with inherited ${key}`);
    }
  }
  mkdirSync(fixtureRoot, { recursive: true });
  const cwd = mkdtempSync(path.join(fixtureRoot, "git-fsmonitor-"));
  fixtureDirectories.push(cwd);
  const envOverlay = {
    GIT_CONFIG_GLOBAL: path.join(cwd, "empty.gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
  };
  await runGitCommand(["init", "--template="], { cwd, envOverlay });
  writeFileSync(path.join(cwd, "tracked.txt"), "fixture\n");
  await runGitCommand(["add", "tracked.txt"], { cwd, envOverlay });
  return { cwd, envOverlay };
}

async function configureMonitor(options: Awaited<ReturnType<typeof createRepository>>) {
  const marker = path.join(options.cwd, "fsmonitor-ran");
  const hook = path.join(options.cwd, "fsmonitor-hook.cjs");
  writeFileSync(
    hook,
    'require("node:fs").writeFileSync(require("node:path").join(__dirname, "fsmonitor-ran"), "ran");\nprocess.stdout.write("1\\0");\n',
  );
  // Git executes configured hooks through its POSIX shell, including Git for Windows.
  const quoteForGitShell = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const command = `${quoteForGitShell(process.execPath.replaceAll("\\", "/"))} ${quoteForGitShell(hook.replaceAll("\\", "/"))}`;
  await runGitCommand(["config", "core.fsmonitor", command], options);
  return marker;
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    const relative = path.relative(fixtureRoot, path.resolve(directory));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to remove a fixture outside the worktree scratch directory");
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("daemon Git fsmonitor isolation", () => {
  it("does not run a repository fsmonitor command that ordinary Git executes", async () => {
    const options = await createRepository();
    const marker = await configureMonitor(options);

    // Negative control: the fixture must actually exercise Git's execution path.
    execFileSync("git", ["status", "--porcelain"], {
      cwd: options.cwd,
      env: { ...process.env, ...options.envOverlay },
      windowsHide: true,
      timeout: 10_000,
    });
    expect(existsSync(marker)).toBe(true);
    unlinkSync(marker);

    const result = await runGitCommand(["status", "--porcelain"], options);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("A  tracked.txt");
    expect(existsSync(marker)).toBe(false);
  });

  it("overrides repository fsmonitor settings without changing their stored value", async () => {
    const options = await createRepository();
    await runGitCommand(["config", "core.fsmonitor", "true"], options);

    const effective = await runGitCommand(["config", "--get", "core.fsmonitor"], options);
    const persisted = await runGitCommand(
      ["config", "--local", "--get", "core.fsmonitor"],
      options,
    );

    expect(effective.stdout.trim()).toBe("false");
    expect(persisted.stdout.trim()).toBe("true");
  });

  it("renames a tracked Explorer file without executing the repository monitor", async () => {
    const options = await createRepository();
    const marker = await configureMonitor(options);

    const result = await renameExplorerEntry({
      root: options.cwd,
      relativePath: "tracked.txt",
      newRelativePath: "renamed.txt",
    });

    expect(result).toEqual({ status: "ok", from: "tracked.txt", to: "renamed.txt", kind: "file" });
    expect(existsSync(path.join(options.cwd, "tracked.txt"))).toBe(false);
    expect(existsSync(path.join(options.cwd, "renamed.txt"))).toBe(true);
    expect(existsSync(marker)).toBe(false);
    const tracked = await runGitCommand(["ls-files"], options);
    expect(tracked.stdout.trim()).toBe("renamed.txt");
  });
});
