import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractToolPathCandidates,
  resolveTouchedSubtreeDirectories,
} from "./openai-compat-subtree-instructions.js";

describe("extractToolPathCandidates", () => {
  it("takes the path argument of a builtin file tool", () => {
    expect(extractToolPathCandidates({ path: "packages/app/src/foo.ts" })).toEqual([
      "packages/app/src/foo.ts",
    ]);
  });

  /**
   * `run_command` hides its paths in a shell string, which is exactly the case
   * a `path`-argument reader would miss - and running a command in a subtree is
   * working in it as much as editing a file there is.
   */
  it("finds paths inside a shell command", () => {
    expect(
      extractToolPathCandidates({ command: "npm run build -- packages/app/src", timeout: 30 }),
    ).toEqual(["packages/app/src"]);
  });

  /**
   * Otto catalog and MCP tools have argument shapes the loop cannot know, so
   * the walk is shape-agnostic rather than a list of known key names.
   */
  it("walks nested arguments of a tool it knows nothing about", () => {
    expect(
      extractToolPathCandidates({
        target: { files: ["packages/app/a.ts", "packages/server/b.ts"] },
      }),
    ).toEqual(["packages/app/a.ts", "packages/server/b.ts"]);
  });

  /**
   * A token with no separator is either a file in cwd - whose directory carries
   * no conditional weight - or not a path. Nothing that could trigger an
   * injection is lost by ignoring it, so the noise is dropped at the cheapest
   * point.
   */
  it("ignores prose, bare names and URLs", () => {
    expect(
      extractToolPathCandidates({
        query: "how do I make the tests pass",
        name: "README.md",
        url: "https://example.com/docs/guide",
      }),
    ).toEqual([]);
  });

  it("strips quotes and trailing punctuation from a token", () => {
    expect(extractToolPathCandidates({ command: 'cat "packages/app/a.ts",' })).toEqual([
      "packages/app/a.ts",
    ]);
  });
});

describe("resolveTouchedSubtreeDirectories", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "otto-subtree-"));
    await fs.mkdir(path.join(cwd, "packages", "app", "src"), { recursive: true });
    await fs.writeFile(path.join(cwd, "packages", "app", "src", "foo.ts"), "x", "utf8");
    await fs.writeFile(path.join(cwd, "root.txt"), "x", "utf8");
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  /**
   * A touched file contributes its whole chain, outermost first: working on
   * `packages/app/src/foo.ts` is working under `packages/app` too, and the
   * most specific rules have to land last to read as the most authoritative.
   */
  it("returns the whole chain below cwd, outermost first", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["packages/app/src/foo.ts"], cwd }),
    ).resolves.toEqual([
      path.join(cwd, "packages"),
      path.join(cwd, "packages", "app"),
      path.join(cwd, "packages", "app", "src"),
    ]);
  });

  it("gives a directory candidate itself, not its parent", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["packages/app"], cwd }),
    ).resolves.toEqual([path.join(cwd, "packages"), path.join(cwd, "packages", "app")]);
  });

  /** cwd is fixed weight already, so a file sitting in it adds no subtree. */
  it("returns nothing for a file directly in cwd", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["./root.txt"], cwd }),
    ).resolves.toEqual([]);
  });

  it("refuses paths outside the workspace", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["../elsewhere/file.ts", "/etc/hosts"], cwd }),
    ).resolves.toEqual([]);
  });

  /**
   * A path the model just deleted, or a build output that was never there, still
   * names a real directory - the parent is the claim worth testing.
   */
  it("falls back to the parent directory of a path that does not exist", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["packages/app/src/gone.ts"], cwd }),
    ).resolves.toEqual([
      path.join(cwd, "packages"),
      path.join(cwd, "packages", "app"),
      path.join(cwd, "packages", "app", "src"),
    ]);
  });

  it("drops a token whose parent is not a directory in the workspace", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({ candidates: ["nope/never/here.ts"], cwd }),
    ).resolves.toEqual([]);
  });

  it("lists each directory once however many candidates reach it", async () => {
    await expect(
      resolveTouchedSubtreeDirectories({
        candidates: [
          "packages/app/src/foo.ts",
          "packages/app/src",
          path.join(cwd, "packages", "app", "src", "foo.ts"),
        ],
        cwd,
      }),
    ).resolves.toEqual([
      path.join(cwd, "packages"),
      path.join(cwd, "packages", "app"),
      path.join(cwd, "packages", "app", "src"),
    ]);
  });
});
