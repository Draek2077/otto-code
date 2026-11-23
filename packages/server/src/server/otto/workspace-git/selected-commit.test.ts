import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { runGitCommand } from "../../../utils/run-git-command.js";
import { commitSelectedPaths } from "./selected-commit.js";
const scratch = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
let cwd: string;
const git = (args: string[]) => runGitCommand(args, { cwd });
beforeEach(async () => {
  await mkdir(scratch, { recursive: true });
  cwd = await mkdtemp(join(scratch, "manual-commit-"));
  await git(["init", "-q"]);
  await git(["config", "user.name", "Draekz"]);
  await git(["config", "user.email", "draekz@gmail.com"]);
  await git(["config", "commit.gpgsign", "false"]);
  await git(["config", "core.hooksPath", join(cwd, "hooks")]);
  await writeFile(join(cwd, "selected.txt"), "before\n");
  await writeFile(join(cwd, "other.txt"), "before\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "fixture"]);
});
afterEach(async () => {
  if (
    !resolve(cwd).startsWith(resolve(scratch) + "/") &&
    !resolve(cwd).startsWith(resolve(scratch) + "\\")
  )
    throw new Error("Fixture escaped scratch root");
  await rm(cwd, { recursive: true, force: true });
});
describe("selected-file commit", () => {
  it("commits only selected files and preserves unrelated staged work", async () => {
    await writeFile(join(cwd, "selected.txt"), "selected change\n");
    await writeFile(join(cwd, "other.txt"), "staged other change\n");
    await git(["add", "other.txt"]);
    const output = await commitSelectedPaths(cwd, "fix: selected file", ["selected.txt"]);
    expect((await git(["show", "--pretty=format:", "--name-only", "HEAD"])).stdout.trim()).toBe(
      "selected.txt",
    );
    expect((await git(["diff", "--cached", "--name-only"])).stdout.trim()).toBe("other.txt");
    expect(await readFile(join(cwd, "other.txt"), "utf8")).toBe("staged other change\n");
    expect(output).toContain("fix: selected file");
  });
  it("refuses paths outside the repository and directory-wide pathspecs", async () => {
    await writeFile(join(cwd, "selected.txt"), "change\n");
    await expect(commitSelectedPaths(cwd, "message", ["../outside.txt"])).rejects.toThrow(
      "inside this repository",
    );
    await expect(commitSelectedPaths(cwd, "message", ["."])).rejects.toThrow(
      "inside this repository",
    );
    await expect(commitSelectedPaths(cwd, "message", ["*.txt"])).rejects.toThrow("Refresh Changes");
    expect((await git(["log", "--format=%s", "-1"])).stdout.trim()).toBe("fixture");
  });
  it("retains hook failure output and never bypasses the hook", async () => {
    await mkdir(join(cwd, "hooks"));
    await writeFile(
      join(cwd, "hooks/pre-commit"),
      "#!/bin/sh\necho manual-hook-denied >&2\nexit 1\n",
      { mode: 0o755 },
    );
    await writeFile(join(cwd, "selected.txt"), "change\n");
    await expect(
      commitSelectedPaths(cwd, "must not commit", ["selected.txt"]),
    ).rejects.toMatchObject({ consoleOutput: expect.stringContaining("manual-hook-denied") });
    expect((await git(["log", "--format=%s", "-1"])).stdout.trim()).toBe("fixture");
  });
  it("includes both sides of an explicitly selected rename", async () => {
    await rename(join(cwd, "selected.txt"), join(cwd, "renamed file.txt"));
    await commitSelectedPaths(cwd, "refactor: rename", ["selected.txt", "renamed file.txt"]);
    expect((await git(["status", "--porcelain"])).stdout).toBe("");
    expect(await readFile(join(cwd, "renamed file.txt"), "utf8")).toBe("before\n");
  });
});
