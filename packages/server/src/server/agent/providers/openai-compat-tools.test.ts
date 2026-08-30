import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executeCompatTool,
  findCompatToolSpec,
  type CompatToolOutcome,
} from "./openai-compat-tools.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "otto-compat-tools-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function seed(name: string, content: string): Promise<string> {
  const filePath = path.join(cwd, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function edit(args: Record<string, unknown>): Promise<CompatToolOutcome> {
  return executeCompatTool({ name: "edit_file", arguments: args, cwd });
}

describe("edit_file", () => {
  it("replaces a single occurrence", async () => {
    await seed("a.txt", "hello world");
    const outcome = await edit({ path: "a.txt", old_string: "world", new_string: "there" });
    expect(outcome.isError).toBeUndefined();
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("hello there");
  });

  it("refuses an ambiguous match without replace_all", async () => {
    await seed("a.txt", "x x");
    const outcome = await edit({ path: "a.txt", old_string: "x", new_string: "y" });
    expect(outcome.isError).toBe(true);
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("x x");
  });

  // An empty old_string used to reach split("")/join(), which interleaves
  // new_string between every character and rewrites the whole file - reported
  // back to the model as a successful edit. The occurrence guards could not
  // catch it: the count is the character count, it is 1 for a two-character
  // file, and it is -1 for an empty file.
  describe("empty old_string", () => {
    it("is refused with replace_all, leaving the file untouched", async () => {
      await seed("a.txt", "hello world");
      const outcome = await edit({
        path: "a.txt",
        old_string: "",
        new_string: "X",
        replace_all: true,
      });
      expect(outcome.isError).toBe(true);
      expect(outcome.output).toContain("non-empty");
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("hello world");
    });

    it("is refused for a two-character file, which the occurrence guard let through", async () => {
      await seed("a.txt", "ab");
      const outcome = await edit({ path: "a.txt", old_string: "", new_string: "X" });
      expect(outcome.isError).toBe(true);
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("ab");
    });

    it("is refused for an empty file, where the occurrence count was -1", async () => {
      await seed("a.txt", "");
      const outcome = await edit({
        path: "a.txt",
        old_string: "",
        new_string: "X",
        replace_all: true,
      });
      expect(outcome.isError).toBe(true);
      expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("");
    });

    it("is rejected by the advertised schema, so a model is told the constraint", () => {
      const spec = findCompatToolSpec("edit_file");
      const oldString = spec?.parameters.properties?.["old_string"] as
        | { minLength?: number }
        | undefined;
      expect(oldString?.minLength).toBe(1);
    });
  });

  it("does not interpret replacement patterns in new_string", async () => {
    await seed("a.txt", "keep TARGET keep");
    await edit({ path: "a.txt", old_string: "TARGET", new_string: "$&$`" });
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("keep $&$` keep");
  });
});
