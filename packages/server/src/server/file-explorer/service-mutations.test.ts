import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createExplorerEntry, deleteExplorerEntry, renameExplorerEntry } from "./service.js";

const OUTSIDE_MESSAGE = "Access outside of workspace is not allowed";
const ROOT_MESSAGE = "The workspace root cannot be created, renamed, or deleted";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await createTempDir("otto-file-mutations-");
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The guard is the security surface of this whole feature, so it is tested
 * against the escape routes rather than only against the happy path: `..`
 * traversal, absolute paths, `~`, and the workspace root itself. Symlinked
 * parents get their own POSIX-only file, where symlinks can actually be made.
 */
describe("file mutation path guard", () => {
  it("refuses to create outside the workspace via ..", async () => {
    await withRoot(async (root) => {
      const outside = await createTempDir("otto-file-mutations-outside-");
      try {
        await expect(
          createExplorerEntry({
            root,
            relativePath: path.join("..", path.basename(outside), "planted.txt"),
            kind: "file",
          }),
        ).rejects.toThrow(OUTSIDE_MESSAGE);
        expect(existsSync(path.join(outside, "planted.txt"))).toBe(false);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses to delete an absolute path outside the workspace", async () => {
    await withRoot(async (root) => {
      const outside = await createTempDir("otto-file-mutations-outside-");
      const victim = path.join(outside, "victim.txt");
      try {
        await writeFile(victim, "keep me\n", "utf-8");

        await expect(deleteExplorerEntry({ root, relativePath: victim })).rejects.toThrow(
          OUTSIDE_MESSAGE,
        );
        expect(await readFile(victim, "utf-8")).toBe("keep me\n");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses a home-relative path that escapes the workspace", async () => {
    await withRoot(async (root) => {
      await expect(
        createExplorerEntry({ root, relativePath: "~/otto-planted.txt", kind: "file" }),
      ).rejects.toThrow(OUTSIDE_MESSAGE);
      expect(existsSync(path.join(os.homedir(), "otto-planted.txt"))).toBe(false);
    });
  });

  it("refuses to rename to a destination outside the workspace", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");

      await expect(
        renameExplorerEntry({
          root,
          relativePath: "a.txt",
          newRelativePath: path.join("..", "escaped.txt"),
        }),
      ).rejects.toThrow(OUTSIDE_MESSAGE);
      expect(existsSync(path.join(root, "a.txt"))).toBe(true);
    });
  });

  it("refuses to target the workspace root itself", async () => {
    await withRoot(async (root) => {
      await expect(deleteExplorerEntry({ root, relativePath: "." })).rejects.toThrow(ROOT_MESSAGE);
      await expect(
        renameExplorerEntry({ root, relativePath: ".", newRelativePath: "renamed" }),
      ).rejects.toThrow(ROOT_MESSAGE);
      expect(existsSync(root)).toBe(true);
    });
  });

  it("refuses an empty path", async () => {
    await withRoot(async (root) => {
      await expect(
        createExplorerEntry({ root, relativePath: "   ", kind: "file" }),
      ).rejects.toThrow("path is required");
    });
  });

  it("refuses when the parent directory does not exist", async () => {
    await withRoot(async (root) => {
      await expect(
        createExplorerEntry({ root, relativePath: "missing/child.txt", kind: "file" }),
      ).rejects.toThrow("Parent directory does not exist");
    });
  });
});

describe("createExplorerEntry", () => {
  it("creates an empty file and reports its identity", async () => {
    await withRoot(async (root) => {
      const result = await createExplorerEntry({
        root,
        relativePath: "notes.txt",
        kind: "file",
      });

      expect(result).toMatchObject({ status: "ok", path: "notes.txt", kind: "file", size: 0 });
      expect(await readFile(path.join(root, "notes.txt"), "utf-8")).toBe("");
    });
  });

  it("creates a directory in a nested parent and normalizes the echoed path", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "src"));

      const result = await createExplorerEntry({
        root,
        relativePath: path.join("src", "components"),
        kind: "directory",
      });

      expect(result).toMatchObject({ status: "ok", path: "src/components", kind: "directory" });
      expect((await stat(path.join(root, "src", "components"))).isDirectory()).toBe(true);
    });
  });

  it("reports `exists` without touching an existing file", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");

      const result = await createExplorerEntry({ root, relativePath: "a.txt", kind: "file" });

      expect(result).toEqual({ status: "exists" });
      expect(await readFile(path.join(root, "a.txt"), "utf-8")).toBe("alpha\n");
    });
  });
});

describe("deleteExplorerEntry", () => {
  it("deletes a file permanently", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");

      const result = await deleteExplorerEntry({ root, relativePath: "a.txt" });

      expect(result).toEqual({ status: "ok", path: "a.txt", kind: "file" });
      expect(existsSync(path.join(root, "a.txt"))).toBe(false);
    });
  });

  it("reports `not_found` for a path that is not there", async () => {
    await withRoot(async (root) => {
      expect(await deleteExplorerEntry({ root, relativePath: "ghost.txt" })).toEqual({
        status: "not_found",
      });
    });
  });

  it("refuses a non-empty directory unless the request is recursive", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "pkg"));
      await writeFile(path.join(root, "pkg", "index.ts"), "export {};\n", "utf-8");

      expect(await deleteExplorerEntry({ root, relativePath: "pkg" })).toEqual({
        status: "not_empty",
      });
      expect(existsSync(path.join(root, "pkg", "index.ts"))).toBe(true);

      expect(await deleteExplorerEntry({ root, relativePath: "pkg", recursive: true })).toEqual({
        status: "ok",
        path: "pkg",
        kind: "directory",
      });
      expect(existsSync(path.join(root, "pkg"))).toBe(false);
    });
  });

  it("deletes an empty directory without the recursive flag", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "empty"));

      expect(await deleteExplorerEntry({ root, relativePath: "empty" })).toEqual({
        status: "ok",
        path: "empty",
        kind: "directory",
      });
      expect(existsSync(path.join(root, "empty"))).toBe(false);
    });
  });
});

describe("renameExplorerEntry", () => {
  it("renames a file within its directory", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");

      const result = await renameExplorerEntry({
        root,
        relativePath: "a.txt",
        newRelativePath: "b.txt",
      });

      expect(result).toEqual({ status: "ok", from: "a.txt", to: "b.txt", kind: "file" });
      expect(await readFile(path.join(root, "b.txt"), "utf-8")).toBe("alpha\n");
    });
  });

  it("moves a file into another directory", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");

      const result = await renameExplorerEntry({
        root,
        relativePath: "a.txt",
        newRelativePath: path.join("src", "a.txt"),
      });

      expect(result).toEqual({ status: "ok", from: "a.txt", to: "src/a.txt", kind: "file" });
      expect(existsSync(path.join(root, "a.txt"))).toBe(false);
    });
  });

  it("never clobbers an occupied destination", async () => {
    await withRoot(async (root) => {
      await writeFile(path.join(root, "a.txt"), "alpha\n", "utf-8");
      await writeFile(path.join(root, "b.txt"), "beta\n", "utf-8");

      expect(
        await renameExplorerEntry({ root, relativePath: "a.txt", newRelativePath: "b.txt" }),
      ).toEqual({ status: "exists" });
      expect(await readFile(path.join(root, "b.txt"), "utf-8")).toBe("beta\n");
      expect(await readFile(path.join(root, "a.txt"), "utf-8")).toBe("alpha\n");
    });
  });

  it("reports `not_found` when the source is missing", async () => {
    await withRoot(async (root) => {
      expect(
        await renameExplorerEntry({ root, relativePath: "ghost.txt", newRelativePath: "b.txt" }),
      ).toEqual({ status: "not_found" });
    });
  });

  it("refuses to move a folder into itself", async () => {
    await withRoot(async (root) => {
      await mkdir(path.join(root, "pkg"));

      await expect(
        renameExplorerEntry({
          root,
          relativePath: "pkg",
          newRelativePath: path.join("pkg", "nested"),
        }),
      ).rejects.toThrow("Cannot move a folder into itself");
      expect(existsSync(path.join(root, "pkg"))).toBe(true);
    });
  });
});
