import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCheckoutDiff } from "./checkout-git.js";

/**
 * A user's git config is theirs, and none of it may reach the patch the daemon
 * parses. Each case below emptied every diff in the Changes view before the
 * invocation was pinned: the file list and its +/- counts survive on
 * `--name-status` and `--numstat`, while the patch stops being parseable.
 */
describe("checkout diff against personal git config", () => {
  let repoDir = "";

  function configure(key: string, value: string): void {
    execFileSync("git", ["config", key, value], { cwd: repoDir });
  }

  async function readSingleFileDiff() {
    const diff = await getCheckoutDiff(repoDir, { mode: "uncommitted", includeStructured: true });
    expect(diff.structured).toHaveLength(1);
    return diff.structured![0];
  }

  beforeEach(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "checkout-git-user-config-")));
    execFileSync("git", ["init", "-q", "."], { cwd: repoDir });
    configure("user.email", "test@example.com");
    configure("user.name", "Test");
    writeFileSync(join(repoDir, "notes.md"), "one\ntwo\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: repoDir });
    writeFileSync(join(repoDir, "notes.md"), "one\ntwo\nthree\n");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("renders hunks with diff.mnemonicPrefix enabled", async () => {
    configure("diff.mnemonicPrefix", "true");

    const file = await readSingleFileDiff();

    expect(file.path).toBe("notes.md");
    expect(file.hunks).toHaveLength(1);
    expect(
      file.hunks[0].lines.some((line) => line.type === "add" && line.content === "three"),
    ).toBe(true);
  });

  it("renders hunks with custom diff prefixes", async () => {
    configure("diff.srcPrefix", "before/");
    configure("diff.dstPrefix", "after/");

    const file = await readSingleFileDiff();

    expect(file.path).toBe("notes.md");
    expect(file.hunks).toHaveLength(1);
  });

  it("renders hunks with an external diff driver configured", async () => {
    configure("diff.external", "echo EXTERNAL");

    const file = await readSingleFileDiff();

    expect(file.path).toBe("notes.md");
    expect(file.hunks).toHaveLength(1);
  });

  it("renders hunks with color.ui forced on", async () => {
    configure("color.ui", "always");

    const file = await readSingleFileDiff();

    expect(file.path).toBe("notes.md");
    expect(file.hunks).toHaveLength(1);
  });
});
