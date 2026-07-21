import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRepoRelativeFilePath,
  getFileBlame,
  getFileCommitDiff,
  getFileHistory,
  getFileOriginCommit,
  InvalidGitFilePathError,
  InvalidGitRevisionError,
  assertCommitSha,
  parseBlamePorcelain,
} from "./git-file-history.js";

let tempDir: string;
let repoDir: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repoDir,
    encoding: "utf8",
  });
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-m", message);
}

beforeEach(() => {
  tempDir = realpathSync.native(mkdtempSync(join(tmpdir(), "git-file-history-test-")));
  repoDir = join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  git("init", "-b", "main");
  git("config", "user.email", "test@test.com");
  git("config", "user.name", "Test Author");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  writeFileSync(join(repoDir, path), content);
}

describe("path and revision validation", () => {
  it("rejects absolute paths and parent traversal", () => {
    expect(() => assertRepoRelativeFilePath("/etc/passwd")).toThrow(InvalidGitFilePathError);
    expect(() => assertRepoRelativeFilePath("C:\\Windows\\system.ini")).toThrow(
      InvalidGitFilePathError,
    );
    expect(() => assertRepoRelativeFilePath("../outside.txt")).toThrow(InvalidGitFilePathError);
    expect(() => assertRepoRelativeFilePath("")).toThrow(InvalidGitFilePathError);
    expect(() => assertRepoRelativeFilePath("src/a.ts")).not.toThrow();
  });

  it("accepts only object names as revisions", () => {
    expect(() => assertCommitSha("HEAD@{1}")).toThrow(InvalidGitRevisionError);
    expect(() => assertCommitSha("main..HEAD")).toThrow(InvalidGitRevisionError);
    expect(() => assertCommitSha("abc123")).not.toThrow();
  });
});

describe("getFileHistory", () => {
  it("lists commits that touched the file, newest first", async () => {
    write("a.txt", "one\n");
    commit("add a");
    write("b.txt", "unrelated\n");
    commit("add b");
    write("a.txt", "one\ntwo\n");
    commit("extend a");

    const result = await getFileHistory(repoDir, { path: "a.txt" });

    expect(result.entries.map((entry) => entry.subject)).toEqual(["extend a", "add a"]);
    expect(result.hasMore).toBe(false);
    const [newest] = result.entries;
    expect(newest?.authorName).toBe("Test Author");
    expect(newest?.authorEmail).toBe("test@test.com");
    expect(newest?.authoredAt).toBeGreaterThan(0);
    expect(newest?.isMerge).toBe(false);
    expect(newest?.shortSha.length).toBeGreaterThan(0);
  });

  // --follow is the whole point of file history: without it the log stops at
  // the rename, which is exactly when someone opens this tool.
  it("follows renames", async () => {
    write("old-name.txt", "first\n");
    commit("create under old name");
    git("mv", "old-name.txt", "new-name.txt");
    commit("rename to new name");
    write("new-name.txt", "first\nsecond\n");
    commit("edit after rename");

    const result = await getFileHistory(repoDir, { path: "new-name.txt" });

    expect(result.entries.map((entry) => entry.subject)).toEqual([
      "edit after rename",
      "rename to new name",
      "create under old name",
    ]);
    // The entry for a pre-rename commit carries the name the file had then, so a
    // diff request built from it still resolves.
    expect(result.entries.at(-1)?.path).toBe("old-name.txt");
    const renameEntry = result.entries[1];
    expect(renameEntry?.previousPath).toBe("old-name.txt");
    expect(renameEntry?.path).toBe("new-name.txt");
    expect(renameEntry?.changeKind).toBe("R");
  });

  it("pages with limit/offset and reports hasMore", async () => {
    for (let index = 0; index < 4; index += 1) {
      write("a.txt", `line ${index}\n`);
      commit(`change ${index}`);
    }

    const firstPage = await getFileHistory(repoDir, { path: "a.txt", limit: 2 });
    expect(firstPage.entries.map((entry) => entry.subject)).toEqual(["change 3", "change 2"]);
    expect(firstPage.hasMore).toBe(true);

    const lastPage = await getFileHistory(repoDir, { path: "a.txt", limit: 2, offset: 2 });
    expect(lastPage.entries.map((entry) => entry.subject)).toEqual(["change 1", "change 0"]);
    expect(lastPage.hasMore).toBe(false);
  });

  it("restricts history to a line range", async () => {
    write("a.txt", "one\ntwo\nthree\n");
    commit("seed");
    write("a.txt", "one\ntwo\nthree CHANGED\n");
    commit("touch line three");
    write("a.txt", "one CHANGED\ntwo\nthree CHANGED\n");
    commit("touch line one");

    const result = await getFileHistory(repoDir, { path: "a.txt", startLine: 1, endLine: 1 });

    expect(result.entries.map((entry) => entry.subject)).toEqual(["touch line one", "seed"]);
  });

  it("preserves multi-line commit bodies", async () => {
    write("a.txt", "one\n");
    git("add", "-A");
    git("commit", "-m", "subject line", "-m", "body line one\nbody line two");

    const result = await getFileHistory(repoDir, { path: "a.txt" });

    expect(result.entries[0]?.subject).toBe("subject line");
    expect(result.entries[0]?.body).toBe("body line one\nbody line two");
  });
});

describe("getFileCommitDiff", () => {
  it("returns what one commit did to one file", async () => {
    write("a.txt", "one\n");
    write("b.txt", "other\n");
    commit("seed");
    write("a.txt", "one\ntwo\n");
    write("b.txt", "other changed\n");
    commit("edit both");
    const sha = git("rev-parse", "HEAD").trim();

    const result = await getFileCommitDiff(repoDir, { path: "a.txt", sha });

    expect(result.diff).toContain("+two");
    // Scoped to the requested file, not the whole commit.
    expect(result.diff).not.toContain("other changed");
    expect(result.truncated).toBe(false);
  });

  it("shows the real edits across a rename instead of the whole file as new", async () => {
    // The bug this guards: a pathspec is applied before git's rename detection,
    // so asking for the commit's own patch at the new name reports the file as
    // brand new and every line reads as an addition. Diffing the file's previous
    // revision blob-to-blob is what makes a rename legible.
    write("old-name.txt", "keep\nchange me\nkeep too\n");
    commit("seed");
    git("mv", "old-name.txt", "new-name.txt");
    write("new-name.txt", "keep\nchanged\nkeep too\n");
    commit("rename and edit");
    const sha = git("rev-parse", "HEAD").trim();

    const result = await getFileCommitDiff(repoDir, { path: "new-name.txt", sha });

    expect(result.diff).toContain("-change me");
    expect(result.diff).toContain("+changed");
    expect(result.diff).not.toContain("new file mode");
    // Unchanged lines stay context, so the reader sees one edit, not a rewrite.
    expect(result.diff).not.toContain("+keep too");
    expect(result.previousPath).toBe("old-name.txt");
  });

  it("names the previous revision of the file, not the commit's parent", async () => {
    write("a.txt", "one\n");
    commit("touches the file");
    const older = git("rev-parse", "HEAD").trim();
    write("unrelated.txt", "x\n");
    commit("does not touch the file");
    write("a.txt", "one\ntwo\n");
    commit("touches the file again");
    const sha = git("rev-parse", "HEAD").trim();

    const result = await getFileCommitDiff(repoDir, { path: "a.txt", sha });

    // The commit's parent is the unrelated commit; the file's previous revision
    // is the one before that, and that is the honest left-hand side.
    expect(result.previousSha).toBe(older);
  });

  it("reports no previous revision for the commit that created the file", async () => {
    write("a.txt", "one\n");
    commit("seed");
    const sha = git("rev-parse", "HEAD").trim();

    const result = await getFileCommitDiff(repoDir, { path: "a.txt", sha });

    expect(result.previousSha).toBeUndefined();
    expect(result.diff).toContain("+one");
  });

  it("still returns the patch for the commit that deleted the file", async () => {
    write("a.txt", "one\n");
    commit("seed");
    git("rm", "a.txt");
    commit("delete it");
    const sha = git("rev-parse", "HEAD").trim();

    // The post-image blob does not exist, so the blob-to-blob diff fails and the
    // commit's own patch has to stand in.
    const result = await getFileCommitDiff(repoDir, { path: "a.txt", sha });

    expect(result.diff).toContain("-one");
  });

  it("rejects a non-object revision before reaching git", async () => {
    write("a.txt", "one\n");
    commit("seed");

    await expect(getFileCommitDiff(repoDir, { path: "a.txt", sha: "HEAD^{/x}" })).rejects.toThrow(
      InvalidGitRevisionError,
    );
  });
});

describe("getFileBlame", () => {
  it("attributes each line to the commit that last touched it", async () => {
    write("a.txt", "one\ntwo\n");
    commit("seed");
    const seedSha = git("rev-parse", "HEAD").trim();
    write("a.txt", "one\ntwo CHANGED\n");
    commit("change second line");
    const headSha = git("rev-parse", "HEAD").trim();

    const result = await getFileBlame(repoDir, { path: "a.txt" });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ line: 1, sha: seedSha });
    expect(result.lines[1]).toMatchObject({ line: 2, sha: headSha });
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(2);
    expect(result.reachedEndOfFile).toBe(true);

    const seedCommit = result.commits.find((entry) => entry.sha === seedSha);
    expect(seedCommit?.summary).toBe("seed");
    expect(seedCommit?.authorName).toBe("Test Author");
    expect(seedCommit?.authorEmail).toBe("test@test.com");
  });

  it("pages a range and reports when more lines remain", async () => {
    write("a.txt", Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n") + "\n");
    commit("seed");

    const page = await getFileBlame(repoDir, { path: "a.txt", startLine: 3, lineCount: 4 });

    expect(page.lines.map((entry) => entry.line)).toEqual([3, 4, 5, 6]);
    expect(page.reachedEndOfFile).toBe(false);
  });

  // Paging past EOF is normal, not an error — git exits 128 and we report empty.
  it("reports an empty page past the end of the file", async () => {
    write("a.txt", "one\n");
    commit("seed");

    const page = await getFileBlame(repoDir, { path: "a.txt", startLine: 500, lineCount: 100 });

    expect(page.lines).toEqual([]);
    expect(page.reachedEndOfFile).toBe(true);
    expect(page.endLine).toBe(499);
  });
});

describe("getFileOriginCommit", () => {
  it("reports the commit that first added the file, across a rename", async () => {
    write("old-name.txt", "first\n");
    commit("original commit");
    git("mv", "old-name.txt", "new-name.txt");
    commit("rename");
    write("new-name.txt", "first\nsecond\n");
    commit("edit");

    const origin = await getFileOriginCommit(repoDir, { path: "new-name.txt" });

    expect(origin?.subject).toBe("original commit");
    expect(origin?.path).toBe("old-name.txt");
    expect(origin?.authorName).toBe("Test Author");
  });

  it("returns null for a file git has never seen", async () => {
    write("a.txt", "one\n");
    commit("seed");

    const origin = await getFileOriginCommit(repoDir, { path: "never-committed.txt" });

    expect(origin).toBeNull();
  });
});

describe("parseBlamePorcelain", () => {
  // Porcelain emits commit metadata once per sha and omits it on later lines
  // from the same commit — the reason results carry a commit dictionary.
  it("carries metadata forward for repeated commits", () => {
    const sha = "a".repeat(40);
    const stdout = [
      `${sha} 1 1 2`,
      "author Ada",
      "author-mail <ada@example.com>",
      "author-time 1700000000",
      "summary first commit",
      "filename a.txt",
      "\tline one",
      `${sha} 2 2`,
      "\tline two",
    ].join("\n");

    const result = parseBlamePorcelain(stdout);

    expect(result.lines).toEqual([
      { line: 1, sha, originalLine: 1 },
      { line: 2, sha, originalLine: 2 },
    ]);
    const commitMeta = result.commits.get(sha);
    expect(commitMeta).toMatchObject({
      shortSha: "aaaaaaaa",
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authoredAt: 1700000000,
      summary: "first commit",
      path: "a.txt",
    });
  });
});
