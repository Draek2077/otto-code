// POSIX-only: symlink fixtures
/* eslint-disable max-nested-callbacks */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  deleteExplorerEntry,
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
} from "./service.js";
import { isPlatform } from "../../test-utils/platform.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe.skipIf(isPlatform("win32"))("service POSIX-only", () => {
  it("lists directory entries even when a dangling symlink exists", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      await mkdir(path.join(root, "packages", "server"), { recursive: true });
      const serverDir = path.join(root, "packages", "server");
      await writeFile(path.join(serverDir, "README.md"), "# server\n", "utf-8");
      await symlink("CLAUDE.md", path.join(serverDir, "AGENTS.md"));

      const result = await listDirectoryEntries({
        root,
        relativePath: "packages/server",
      });

      expect(result.path).toBe("packages/server");
      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("README.md");
      expect(names).not.toContain("AGENTS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked files that resolve outside the workspace", async () => {
    const root = await createTempDir("otto-file-explorer-");
    const outsideRoot = await createTempDir("otto-file-explorer-outside-");

    try {
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      await expect(
        readExplorerFile({
          root,
          relativePath: "secret-link.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("skips listed symlink entries that resolve outside the workspace", async () => {
    const root = await createTempDir("otto-file-explorer-");
    const outsideRoot = await createTempDir("otto-file-explorer-outside-");

    try {
      await writeFile(path.join(root, "visible.txt"), "visible\n", "utf-8");
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      const result = await listDirectoryEntries({ root });

      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("visible.txt");
      expect(names).not.toContain("secret-link.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("uses canonical paths for downloadable symlink targets inside the workspace", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      const target = path.join(root, "safe.txt");
      const link = path.join(root, "safe-link.txt");
      await writeFile(target, "safe\n", "utf-8");
      await symlink("safe.txt", link);

      const file = await readExplorerFile({
        root,
        relativePath: "safe-link.txt",
      });
      const info = await getDownloadableFileInfo({
        root,
        relativePath: "safe-link.txt",
      });

      expect(file.path).toBe("safe-link.txt");
      expect(file.content).toBe("safe\n");
      expect(info.path).toBe("safe-link.txt");
      expect(info.fileName).toBe("safe-link.txt");
      expect(info.absolutePath).toBe(await realpath(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The three specs below are why mutations resolve the *parent* rather than the
  // target: a read may follow a symlink to what it points at, but a delete that
  // did so would destroy the target instead of the link — and a symlinked parent
  // directory is a traversal the lexical `..` check cannot see.
  it("deletes a symlink itself, leaving its target alone", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      const target = path.join(root, "safe.txt");
      await writeFile(target, "safe\n", "utf-8");
      await symlink("safe.txt", path.join(root, "safe-link.txt"));

      const result = await deleteExplorerEntry({ root, relativePath: "safe-link.txt" });

      expect(result).toEqual({ status: "ok", path: "safe-link.txt", kind: "file" });
      expect(existsSync(path.join(root, "safe-link.txt"))).toBe(false);
      expect(await readFile(target, "utf-8")).toBe("safe\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to delete through a symlinked parent directory", async () => {
    const root = await createTempDir("otto-file-explorer-");
    const outsideRoot = await createTempDir("otto-file-explorer-outside-");

    try {
      const victim = path.join(outsideRoot, "secret.txt");
      await writeFile(victim, "top secret\n", "utf-8");
      await symlink(outsideRoot, path.join(root, "escape"));

      await expect(
        deleteExplorerEntry({ root, relativePath: "escape/secret.txt" }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
      expect(await readFile(victim, "utf-8")).toBe("top secret\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("deletes a symlinked directory as a link, not as its contents", async () => {
    const root = await createTempDir("otto-file-explorer-");
    const outsideRoot = await createTempDir("otto-file-explorer-outside-");

    try {
      await writeFile(path.join(outsideRoot, "keep.txt"), "keep\n", "utf-8");
      await symlink(outsideRoot, path.join(root, "linked-dir"));

      // lstat sees a link, not a directory, so this is an unlink — no `recursive`
      // needed and nothing inside the target is touched.
      const result = await deleteExplorerEntry({ root, relativePath: "linked-dir" });

      expect(result).toEqual({ status: "ok", path: "linked-dir", kind: "file" });
      expect((await stat(outsideRoot)).isDirectory()).toBe(true);
      expect(await readFile(path.join(outsideRoot, "keep.txt"), "utf-8")).toBe("keep\n");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
