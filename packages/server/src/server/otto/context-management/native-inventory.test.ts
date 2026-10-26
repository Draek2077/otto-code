import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { nativeContextPlan, type NativeContextPlan } from "./native-plan.js";
import { inspectNativeContext } from "./native-inventory.js";
import { NativeContextFiles } from "./native-files.js";
import { memoryIndexHead, nativeReferences } from "./native-text.js";
const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await mkdir(temporary, { recursive: true });
  const created = await mkdtemp(path.join(temporary, "native-context-"));
  fixtures.push(created);
  const directory = await realpath(created);
  const root = path.join(directory, "project"),
    home = path.join(directory, "home"),
    config = path.join(home, "provider");
  const cwd = path.join(root, "child");
  await mkdir(cwd, { recursive: true });
  await mkdir(config, { recursive: true });
  const location = {
    root,
    cwd,
    userHome: home,
    managedDirectory: null,
    ancestorBoundary: directory,
  };
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  const codex = (maxBytes = 32768) =>
    nativeContextPlan({
      ...location,
      provider: "codex",
      configDirectory: config,
      settings: { fallbackNames: ["TEAM.md"], maxBytes, disabledSkillPaths: [] },
    });
  const claude = () =>
    nativeContextPlan({
      ...location,
      provider: "claude",
      configDirectory: config,
      memoryDirectory: path.join(config, "memory"),
      settings: {
        instructionMode: null,
        memoryEnabled: true,
        memoryDirectory: null,
        excludes: [],
        enabledPlugins: {},
      },
    });
  const inspect = (plan: NativeContextPlan, files?: NativeContextFiles) =>
    inspectNativeContext({ plan, root, userHome: home, readableRoots: [config], files });
  return { directory, root, cwd, home, config, location, write, codex, claude, inspect };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});
test("Codex first nonempty override wins and the combined byte cap truncates without splitting UTF-8", async () => {
  const f = await fixture();
  await f.write(path.join(f.config, "AGENTS.override.md"), "  \n");
  await f.write(path.join(f.config, "AGENTS.md"), "GLOBAL");
  await f.write(path.join(f.root, "AGENTS.override.md"), "ééé");
  await f.write(path.join(f.root, "AGENTS.md"), "SHADOWED");
  await f.write(path.join(f.cwd, "TEAM.md"), "LEAF");
  const result = await f.inspect(f.codex(9));
  expect(result.entries.map((entry) => entry.countedText)).toEqual(["GLOBAL", "é", "L"]);
  expect(result.entries.some((entry) => entry.text === "SHADOWED")).toBe(false);
  expect(result.notes.some((note) => note.includes("truncates"))).toBe(true);
});
test("Codex does not count filename-like @mentions as imports or scan conditional child rules", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "AGENTS.md"), "@other.md");
  await f.write(path.join(f.root, "other.md"), "NOT_LOADED");
  await f.write(path.join(f.cwd, "deeper", "AGENTS.md"), "NOT_AUTOMATIC");
  const result = await f.inspect(f.codex());
  expect(result.entries).toHaveLength(1);
  expect(result.dependencies).toEqual([]);
});
test("Claude primary instructions suppress AGENTS fallback throughout the startup chain", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "AGENTS.md"), "FALLBACK");
  await f.write(path.join(f.cwd, "CLAUDE.local.md"), "PRIMARY");
  const result = await f.inspect(f.claude());
  expect(result.entries.map((entry) => entry.text)).toEqual(["PRIMARY"]);
});
test("Claude explicit combined mode retains both and exclusions apply before costing", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "AGENTS.md"), "FALLBACK");
  await f.write(path.join(f.root, "CLAUDE.md"), "PRIMARY");
  await f.write(path.join(f.cwd, "CLAUDE.local.md"), "EXCLUDED");
  const plan = f.claude();
  plan.instructionMode = "claude-md-and-agents-md";
  plan.excludes = ["**/CLAUDE.local.md"];
  const result = await f.inspect(plan);
  expect(result.entries.map((entry) => entry.text).sort()).toEqual(["FALLBACK", "PRIMARY"]);
});
test("Claude imports non-Markdown and escaped-space files once, soft links stay outside fixed weight", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.root, "CLAUDE.md"),
    "[Optional](optional.md)\n@rules.txt\n@two\\ words.txt\n@optional.md",
  );
  await f.write(path.join(f.root, "rules.txt"), "RULES");
  await f.write(path.join(f.root, "two words.txt"), "TWO");
  await f.write(path.join(f.root, "optional.md"), "PROMOTED");
  const result = await f.inspect(f.claude());
  expect(result.entries).toHaveLength(4);
  expect(result.entries.find((entry) => entry.text === "PROMOTED")?.costClass).toBe("fixed");
  expect(result.dependencies).toHaveLength(4);
});
test("conditional instructions and soft dependency bodies do not inflate fixed context", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "CLAUDE.md"), "[Optional](optional.md)");
  await f.write(path.join(f.root, "optional.md"), "ON_DEMAND");
  await f.write(path.join(f.cwd, "deeper", "CLAUDE.md"), "CONDITIONAL");
  const result = await f.inspect(f.claude());
  expect(
    result.entries.find((entry) => entry.file === path.join(f.root, "optional.md")),
  ).toMatchObject({
    costClass: "referenced",
    countedText: "",
    text: "",
  });
  expect(result.entries.find((entry) => entry.text === "CONDITIONAL")).toMatchObject({
    costClass: "conditional",
    scope: "subdirectory",
  });
});
test("cycles, missing imports and external approval boundaries remain visible without reading unrelated files", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "CLAUDE.md"), "@rules.md\n@missing.md\n@../outside.md");
  await f.write(path.join(f.root, "rules.md"), "@CLAUDE.md");
  await f.write(path.join(f.directory, "outside.md"), "OUTSIDE");
  const result = await f.inspect(f.claude());
  expect(result.entries).toHaveLength(2);
  expect(result.notes.join("\n")).toContain("Import cycle");
  expect(result.notes.join("\n")).toContain("Missing or unavailable");
  expect(result.notes.join("\n")).toContain("requires provider approval");
  expect(result.dependencies.map((entry) => [entry.target, entry.resolution])).toEqual([
    ["rules.md", "resolved"],
    ["CLAUDE.md", "resolved"],
    ["missing.md", "missing"],
    ["../outside.md", "outside"],
  ]);
});

test("excluded and depth-capped dependencies retain metadata without reading their bodies", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "CLAUDE.md"), "@excluded.md\n@level1.md");
  await f.write(path.join(f.root, "excluded.md"), "EXCLUDED_BODY");
  for (let index = 1; index <= 5; index++)
    await f.write(path.join(f.root, `level${index}.md`), `@level${index + 1}.md`);
  const plan = f.claude();
  plan.excludes = ["**/excluded.md"];
  const result = await f.inspect(plan);
  expect(result.dependencies.find((entry) => entry.target === "excluded.md")).toMatchObject({
    resolution: "excluded",
  });
  expect(result.dependencies.find((entry) => entry.target === "level5.md")).toMatchObject({
    resolution: "depth_capped",
  });
  expect(
    result.entries.find((entry) => entry.file === path.join(f.root, "excluded.md")),
  ).toMatchObject({ text: "", countedText: "", costClass: "referenced" });
  expect(
    result.entries.find((entry) => entry.file === path.join(f.root, "level5.md")),
  ).toMatchObject({ text: "", countedText: "", costClass: "referenced" });
  expect(result.dependencies.some((entry) => entry.target === "level6.md")).toBe(false);
});

test("an exhausted body-read budget is unavailable, never a missing-target deletion candidate", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "CLAUDE.md"), "@large.md");
  await f.write(path.join(f.root, "large.md"), "LARGE".repeat(100));
  const result = await f.inspect(
    f.claude(),
    new NativeContextFiles({ bytes: 40, entries: 2048, directories: 256 }),
  );
  expect(result.dependencies.find((entry) => entry.target === "large.md")).toMatchObject({
    resolution: "unavailable",
    resolved: null,
  });
  expect(result.notes.join("\n")).toContain("partial");
});
test("skill and subagent cost includes descriptor metadata, never their implementation body", async () => {
  const f = await fixture();
  const skill = path.join(f.config, "skills", "sample", "SKILL.md");
  await f.write(
    skill,
    "---\nname: Sample\ndescription: Short description\n---\nNEVER_COUNT_SKILL_BODY",
  );
  await f.write(
    path.join(f.config, "agents", "helper.md"),
    "---\nname: Helper\ndescription: Helps\n---\nNEVER_COUNT_AGENT_BODY",
  );
  const result = await f.inspect(f.claude());
  expect(result.entries).toHaveLength(2);
  expect(result.entries.every((entry) => entry.category === "skills_roster")).toBe(true);
  expect(result.entries.map((entry) => entry.countedText).join("\n")).not.toContain("NEVER_COUNT");
  expect(result.entries[0]?.countedText).toContain("Sample");
});
test("disabled skill identity and malformed frontmatter are omitted with an honest inventory notice", async () => {
  const f = await fixture();
  const directory = path.join(f.home, ".agents", "skills", "disabled");
  await f.write(
    path.join(directory, "SKILL.md"),
    "---\nname: Disabled\ndescription: Nope\n---\nBODY",
  );
  await f.write(
    path.join(f.home, ".agents", "skills", "bad", "SKILL.md"),
    "---\nname: [wrong]\ndescription: Invalid\n---",
  );
  const plan = f.codex();
  plan.disabledSkillPaths = [directory];
  const result = await f.inspect(plan);
  expect(result.entries).toEqual([]);
  expect(result.notes.join("\n")).toContain("No valid name/description");
});
test("memory index contributes only its first 200 lines/25KB, keeping full source separately for preview", async () => {
  const f = await fixture();
  const content = "Entry\n".repeat(201) + "BODY_NOT_AT_STARTUP";
  await f.write(path.join(f.config, "memory", "MEMORY.md"), content);
  const result = await f.inspect(f.claude());
  expect(result.entries[0]).toMatchObject({
    category: "memory_index",
    text: content,
    countedText: "Entry\n".repeat(200),
  });
  expect(Buffer.byteLength(memoryIndexHead("é".repeat(20000)), "utf8")).toBe(25000);
});
test("OpenCode configured globs use the nearest matching project directory and never fetch remote instructions", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "docs", "far.md"), "FAR");
  await f.write(path.join(f.cwd, "docs", "near.md"), "NEAR");
  const plan = nativeContextPlan({
    ...f.location,
    provider: "opencode",
    configDirectory: f.config,
    projectConfigDisabled: false,
    settings: { instructions: ["docs/*.md", "https://example.invalid/rules"], skillPaths: [] },
  });
  const result = await f.inspect(plan);
  expect(result.entries.map((entry) => entry.text)).toEqual(["NEAR"]);
  expect(result.notes.join("\n")).toContain("not fetched");
});
test("bounded conditional discovery omits vendor/generated trees and reports exhausted budgets", async () => {
  const f = await fixture();
  await f.write(path.join(f.cwd, "node_modules", "nested", "CLAUDE.md"), "VENDOR");
  await f.write(path.join(f.cwd, "nested", "CLAUDE.md"), "REAL");
  const result = await f.inspect(f.claude());
  expect(result.entries.map((entry) => entry.text)).toEqual(["REAL"]);
  const partial = await f.inspect(
    f.claude(),
    new NativeContextFiles({ bytes: 1, entries: 1, directories: 1 }),
  );
  expect(partial.notes.join("\n")).toContain("partial");
});
test("native imports ignore fenced and inline examples and preserve exact source spans", () => {
  const text = "````md\n@not.txt\n```\n@still-not.md\n````\n`@inline.md`\n@two\\ words.txt\n";
  const references = nativeReferences(text, true);
  expect(references).toHaveLength(1);
  expect(references[0]?.target).toBe("two words.txt");
  expect(text.slice(references[0]!.start, references[0]!.end)).toBe("@two\\ words.txt");
});
