import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGitCommand } from "../../utils/run-git-command.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getExplorerFileVersion,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "./service.js";

async function createHomeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.homedir(), prefix));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("atomically writes an existing text file at the expected revision", async () => {
    const root = await createTempDir("paseo-file-write-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "before", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "after",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });

      expect(result.status).toBe("ok");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves the original file permissions across atomic replacement",
    async () => {
      const root = await createTempDir("paseo-file-mode-");
      try {
        const filePath = path.join(root, "script.sh");
        await writeFile(filePath, "before", "utf8");
        await chmod(filePath, 0o764);
        const current = await getExplorerFileVersion({ root, relativePath: "script.sh" });
        expect(current.status).toBe("ready");
        if (current.status !== "ready") return;

        const result = await writeExplorerFile({
          root,
          relativePath: "script.sh",
          content: "after",
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

        expect(result.status).toBe("ok");
        expect((await stat(filePath)).mode & 0o7777).toBe(0o764);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves a newer disk revision instead of overwriting it", async () => {
    const root = await createTempDir("paseo-file-conflict-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "newer on disk", "utf8");

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      // A conflict carries the on-disk content back with it, so the editor can
      // show the divergence without a second read.
      expect(result).toMatchObject({ status: "conflict", content: "newer on disk" });
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe(
        "newer on disk",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Otto decides staleness on the content hash, not on a revision token built
  // from mtime. That is the stronger test: mtime is only millisecond-precise on
  // some filesystems, so a rewrite inside the same tick keeps the timestamp the
  // editor last saw. The hash still differs, and the write is refused.
  it("prefers the content hash over a matching display timestamp", async () => {
    const root = await createTempDir("otto-file-revision-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "on disk", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: current.modifiedAt,
        expectedHash: "0000000000000000000000000000000000000000000000000000000000000000",
      });

      expect(result.status).toBe("conflict");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("on disk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never creates a missing file through the write API", async () => {
    const root = await createTempDir("paseo-file-missing-");
    try {
      // The editor only saves files it opened, so a missing target is refused
      // rather than quietly created. Re-creating a file the user deleted is a
      // separate, explicit intent: `allowCreate`, exercised below.
      await expect(
        writeExplorerFile({
          root,
          relativePath: "missing.txt",
          content: "new file",
          expectedModifiedAt: "2020-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow("File no longer exists on disk");

      const created = await writeExplorerFile({
        root,
        relativePath: "missing.txt",
        content: "new file",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
        allowCreate: true,
      });

      expect(created.status).toBe("ok");
      expect((await readExplorerFile({ root, relativePath: "missing.txt" })).content).toBe(
        "new file",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads .ex files as text", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      const filePath = path.join(root, "sample.ex");
      const content = "defmodule Sample do\nend\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "sample.ex",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads unknown extension text files as text", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      const filePath = path.join(root, "notes.customext");
      const content = "hello from a custom text file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "notes.customext",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies files with null bytes as binary", async () => {
    const root = await createTempDir("otto-file-explorer-");

    try {
      const filePath = path.join(root, "blob.weird");
      await writeFile(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

      const result = await readExplorerFile({
        root,
        relativePath: "blob.weird",
      });

      expect(result.kind).toBe("binary");
      expect(result.encoding).toBe("none");
      expect(result.content).toBeUndefined();
      expect(result.mimeType).toBe("application/octet-stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file grows after its revision is advertised", async () => {
    const root = await createTempDir("paseo-file-stream-growth-");

    try {
      const filePath = path.join(root, "growing.log");
      const initial = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, initial);
      await expect(
        streamExplorerFile({ root, relativePath: "growing.log" }, async (file) => {
          await appendFile(filePath, Buffer.alloc(300 * 1024, 0x62));
          for await (const _chunk of file.chunks) {
            // Consume through the advertised prefix before validating the revision.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file shrinks below its advertised size", async () => {
    const root = await createTempDir("paseo-file-stream-truncate-");

    try {
      const filePath = path.join(root, "shrinking.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));

      await expect(
        streamExplorerFile({ root, relativePath: "shrinking.log" }, async (file) => {
          await truncate(filePath, 100 * 1024);
          for await (const _chunk of file.chunks) {
            // Consume until the stream detects the premature EOF.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file is overwritten in place", async () => {
    const root = await createTempDir("paseo-file-stream-overwrite-");

    try {
      const filePath = path.join(root, "changing.log");
      const initial = Buffer.alloc(600 * 1024, 0x61);
      await writeFile(filePath, initial);

      await expect(
        streamExplorerFile({ root, relativePath: "changing.log" }, async (file) => {
          let chunkIndex = 0;
          for await (const _chunk of file.chunks) {
            chunkIndex += 1;
            if (chunkIndex === 1) {
              const replacement = Buffer.alloc(initial.byteLength, 0x62);
              await writeFile(filePath, replacement);
            }
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies sampled text when UTF-8 crosses the sample boundary", async () => {
    const root = await createTempDir("paseo-file-stream-utf8-");

    try {
      const content = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("€"), Buffer.from("z")]);
      await writeFile(path.join(root, "sample.txt"), content);
      let kind: string | undefined;
      let encoding: string | undefined;

      await streamExplorerFile({ root, relativePath: "sample.txt" }, async (file) => {
        kind = file.kind;
        encoding = file.encoding;
      });

      expect(kind).toBe("text");
      expect(encoding).toBe("utf-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete UTF-8 when the whole file was sampled", async () => {
    const root = await createTempDir("paseo-file-stream-invalid-utf8-");

    try {
      await writeFile(path.join(root, "invalid.txt"), Buffer.from([0x61, 0xe2, 0x82]));
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "invalid.txt" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary bytes beyond the initial classification block", async () => {
    const root = await createTempDir("paseo-file-stream-late-binary-");

    try {
      const content = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff])]);
      await writeFile(path.join(root, "late-binary.unknown"), content);
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "late-binary.unknown" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands a ~ prefix in relative paths against the user home directory", async () => {
    const root = await createHomeTempDir(".otto-file-explorer-home-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root,
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.content).toBe("hello from home\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows home to be the scoped root for tilde file previews", async () => {
    const root = await createHomeTempDir(".otto-file-explorer-home-root-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home root\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root: "~",
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.path).toBe(path.relative(os.homedir(), filePath).split(path.sep).join("/"));
      expect(result.content).toBe("hello from home root\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ~-prefixed paths that resolve outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "otto-file-explorer-outside-home-"));

    try {
      await expect(
        readExplorerFile({
          root,
          relativePath: "~/some/file.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates files and directories, refusing duplicates and escapes", async () => {
    const root = await createTempDir("paseo-entry-create-");
    try {
      const file = await createExplorerEntry({ root, relativePath: "notes.txt", kind: "file" });
      expect(file).toMatchObject({ status: "ok", path: "notes.txt", kind: "file" });
      expect((await stat(path.join(root, "notes.txt"))).isFile()).toBe(true);

      const dir = await createExplorerEntry({ root, relativePath: "docs", kind: "directory" });
      expect(dir).toMatchObject({ status: "ok", path: "docs", kind: "directory" });
      const nested = await createExplorerEntry({
        root,
        relativePath: "docs/guide.md",
        kind: "file",
      });
      expect(nested).toMatchObject({ status: "ok", path: "docs/guide.md", kind: "file" });

      const duplicate = await createExplorerEntry({
        root,
        relativePath: "notes.txt",
        kind: "file",
      });
      expect(duplicate).toEqual({ status: "exists" });

      await expect(
        createExplorerEntry({ root, relativePath: "../escape", kind: "directory" }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("duplicates files and folders with collision-free sibling names", async () => {
    const root = await createTempDir("paseo-entry-duplicate-");
    try {
      await writeFile(path.join(root, "notes.txt"), "original", "utf8");
      const firstFileCopy = await duplicateExplorerEntry({
        root,
        relativePath: "notes.txt",
      });
      expect(firstFileCopy).toEqual({ status: "ok", path: "notes copy.txt" });
      expect(await readFile(path.join(root, "notes copy.txt"), "utf8")).toBe("original");

      const secondFileCopy = await duplicateExplorerEntry({
        root,
        relativePath: "notes.txt",
      });
      expect(secondFileCopy).toEqual({ status: "ok", path: "notes copy 2.txt" });

      await mkdir(path.join(root, "docs"));
      await writeFile(path.join(root, "docs", "guide.md"), "guide", "utf8");
      const folderCopy = await duplicateExplorerEntry({ root, relativePath: "docs" });
      expect(folderCopy).toEqual({ status: "ok", path: "docs copy" });
      expect(await readFile(path.join(root, "docs copy", "guide.md"), "utf8")).toBe("guide");

      await expect(duplicateExplorerEntry({ root, relativePath: "." })).resolves.toMatchObject({
        status: "error",
      });
      await expect(duplicateExplorerEntry({ root, relativePath: "missing.txt" })).resolves.toEqual({
        status: "error",
        error: "File or folder no longer exists",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames tracked entries with Git and untracked entries on the filesystem", async () => {
    const root = await createTempDir("paseo-entry-rename-");
    try {
      await runGitCommand(["init"], { cwd: root });
      await writeFile(path.join(root, "tracked.txt"), "tracked", "utf8");
      await mkdir(path.join(root, "tracked-folder"));
      await writeFile(path.join(root, "tracked-folder", "inside.txt"), "tracked", "utf8");
      await runGitCommand(["add", "."], { cwd: root });
      await runGitCommand(
        ["-c", "user.name=Paseo Test", "-c", "user.email=test@paseo.local", "commit", "-m", "base"],
        { cwd: root },
      );

      const tracked = await renameExplorerEntry({
        root,
        relativePath: "tracked.txt",
        newRelativePath: "renamed.txt",
      });
      expect(tracked).toEqual({
        status: "ok",
        from: "tracked.txt",
        to: "renamed.txt",
        kind: "file",
      });
      expect((await runGitCommand(["status", "--short"], { cwd: root })).stdout.trim()).toBe(
        "R  tracked.txt -> renamed.txt",
      );

      const trackedFolder = await renameExplorerEntry({
        root,
        relativePath: "tracked-folder",
        newRelativePath: "renamed-folder",
      });
      expect(trackedFolder).toEqual({
        status: "ok",
        from: "tracked-folder",
        to: "renamed-folder",
        kind: "directory",
      });
      const gitStatus = (await runGitCommand(["status", "--short"], { cwd: root })).stdout;
      expect(gitStatus).toContain("tracked-folder/inside.txt -> renamed-folder/inside.txt");

      await writeFile(path.join(root, "untracked.txt"), "untracked", "utf8");
      const untracked = await renameExplorerEntry({
        root,
        relativePath: "untracked.txt",
        newRelativePath: "moved.txt",
      });
      expect(untracked).toEqual({
        status: "ok",
        from: "untracked.txt",
        to: "moved.txt",
        kind: "file",
      });
      expect((await stat(path.join(root, "moved.txt"))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports case-only renames for tracked and untracked files", async () => {
    const root = await createTempDir("paseo-entry-case-rename-");
    try {
      await runGitCommand(["init"], { cwd: root });
      await writeFile(path.join(root, "Tracked.txt"), "tracked", "utf8");
      await writeFile(path.join(root, "Loose.txt"), "untracked", "utf8");
      await runGitCommand(["add", "Tracked.txt"], { cwd: root });
      await runGitCommand(
        ["-c", "user.name=Paseo Test", "-c", "user.email=test@paseo.local", "commit", "-m", "base"],
        { cwd: root },
      );

      await expect(
        renameExplorerEntry({ root, relativePath: "Tracked.txt", newRelativePath: "tracked.txt" }),
      ).resolves.toEqual({ status: "ok", from: "Tracked.txt", to: "tracked.txt", kind: "file" });
      expect((await stat(path.join(root, "tracked.txt"))).isFile()).toBe(true);

      await expect(
        renameExplorerEntry({ root, relativePath: "Loose.txt", newRelativePath: "loose.txt" }),
      ).resolves.toEqual({ status: "ok", from: "Loose.txt", to: "loose.txt", kind: "file" });
      expect((await stat(path.join(root, "loose.txt"))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses invalid renames, existing targets, and the workspace root", async () => {
    const root = await createTempDir("paseo-entry-rename-errors-");
    try {
      await writeFile(path.join(root, "source.txt"), "source", "utf8");
      await writeFile(path.join(root, "existing.txt"), "existing", "utf8");

      await expect(
        renameExplorerEntry({ root, relativePath: "source.txt", newRelativePath: "existing.txt" }),
      ).resolves.toEqual({ status: "exists" });
      await expect(
        renameExplorerEntry({
          root,
          relativePath: "source.txt",
          newRelativePath: "../outside.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
      await expect(
        renameExplorerEntry({ root, relativePath: ".", newRelativePath: "renamed-root" }),
      ).rejects.toThrow("The workspace root cannot be created, renamed, or deleted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes files and directories but never the workspace root or outside paths", async () => {
    const root = await createTempDir("paseo-entry-delete-");
    try {
      await writeFile(path.join(root, "doomed.txt"), "bye", "utf8");
      const removedFile = await deleteExplorerEntry({ root, relativePath: "doomed.txt" });
      expect(removedFile).toEqual({ status: "ok", path: "doomed.txt", kind: "file" });
      await expect(stat(path.join(root, "doomed.txt"))).rejects.toThrow();

      await createExplorerEntry({ root, relativePath: "nested", kind: "directory" });
      await writeFile(path.join(root, "nested", "inner.txt"), "hi", "utf8");
      const removedDir = await deleteExplorerEntry({
        root,
        relativePath: "nested",
        recursive: true,
      });
      expect(removedDir).toEqual({ status: "ok", path: "nested", kind: "directory" });
      await expect(stat(path.join(root, "nested"))).rejects.toThrow();

      await expect(deleteExplorerEntry({ root, relativePath: "." })).rejects.toThrow(
        "The workspace root cannot be created, renamed, or deleted",
      );

      await expect(deleteExplorerEntry({ root, relativePath: "../outside" })).rejects.toThrow(
        "Access outside of workspace is not allowed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
