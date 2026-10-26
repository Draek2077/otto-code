import path from "node:path";
import { expect, test } from "vitest";
import { nativeContextPlan } from "./native-plan.js";
import type { ClaudeContextSettings } from "./native-config.js";

const fixture = path.resolve("native-plan-fixture");
const root = path.join(fixture, "home", "project");
const cwd = path.join(root, "packages", "app");
const location = {
  root,
  cwd,
  userHome: path.join(fixture, "home"),
  managedDirectory: path.join(fixture, "managed"),
  ancestorBoundary: fixture,
};
const claude: ClaudeContextSettings = {
  instructionMode: null,
  memoryEnabled: true,
  memoryDirectory: null,
  excludes: [],
  enabledPlugins: {},
};

test("Codex uses one first-nonempty slot per directory with override and configured fallback priority", () => {
  const configDirectory = path.join(fixture, "codex-home");
  const plan = nativeContextPlan({
    ...location,
    provider: "codex",
    configDirectory,
    settings: { fallbackNames: ["TEAM.md"], maxBytes: 65536, disabledSkillPaths: [] },
  });
  expect(plan.loadPoints.map((entry) => entry.candidates)).toEqual([
    ["AGENTS.override.md", "AGENTS.md"].map((name) => path.join(configDirectory, name)),
    ...[root, path.join(root, "packages"), cwd].map((directory) =>
      ["AGENTS.override.md", "AGENTS.md", "TEAM.md"].map((name) => path.join(directory, name)),
    ),
  ]);
  expect(plan.loadPoints.every((entry) => entry.firstNonempty)).toBe(true);
  expect(plan.instructionBytes).toBe(65536);
});
test("Codex neither invents @ imports nor silently assumes subdirectory autoload", () => {
  const plan = nativeContextPlan({
    ...location,
    provider: "codex",
    configDirectory: path.join(fixture, "codex"),
    settings: {
      fallbackNames: [],
      maxBytes: 0,
      disabledSkillPaths: [path.join(fixture, "disabled")],
    },
  });
  expect(plan).toMatchObject({
    imports: false,
    conditionalRoot: null,
    instructionBytes: 0,
    disabledSkillPaths: [path.join(fixture, "disabled")],
  });
  expect(
    plan.rosterRoots.some(
      (entry) => entry.directory === path.join(location.userHome, ".agents", "skills"),
    ),
  ).toBe(true);
});
test("Claude distinguishes managed/global sources from primary/fallback directory instruction gates", () => {
  const plan = nativeContextPlan({
    ...location,
    provider: "claude",
    configDirectory: path.join(location.userHome, ".claude"),
    memoryDirectory: path.join(fixture, "memory"),
    settings: claude,
  });
  expect(plan.loadPoints[0]).toMatchObject({ label: "Managed", gate: "always" });
  expect(plan.loadPoints[1]).toMatchObject({ label: "Global", gate: "always" });
  expect(
    plan.loadPoints.find((entry) => entry.candidates[0] === path.join(root, "CLAUDE.md")),
  ).toMatchObject({ gate: "claude-primary", label: "Project" });
  expect(
    plan.loadPoints.find((entry) => entry.candidates[0] === path.join(root, "AGENTS.md")),
  ).toMatchObject({ gate: "claude-fallback", label: "Project" });
  expect(plan.loadPoints.find((entry) => entry.category === "memory_index")).toMatchObject({
    memoryIndex: true,
    candidates: [path.join(fixture, "memory", "MEMORY.md")],
  });
  expect(plan).toMatchObject({
    imports: true,
    importDepth: 4,
    conditionalRoot: cwd,
    confidence: "convention",
  });
});
test("Claude managed-only intent excludes startup project/user instructions and disabled memory", () => {
  const plan = nativeContextPlan({
    ...location,
    provider: "claude",
    configDirectory: path.join(fixture, "claude"),
    memoryDirectory: path.join(fixture, "memory"),
    settings: { ...claude, instructionMode: "managed-only", memoryEnabled: false },
  });
  expect(plan.loadPoints).toHaveLength(1);
  expect(plan.loadPoints[0]?.label).toBe("Managed");
  expect(plan.conditionalNames).not.toContain("AGENTS.md");
});
test("OpenCode V2 uses the documented nearest-first chain without old CLAUDE fallback rules", () => {
  const configDirectory = path.join(fixture, "opencode");
  const plan = nativeContextPlan({
    ...location,
    provider: "opencode",
    configDirectory,
    projectConfigDisabled: false,
    settings: { instructions: ["docs/*.md"], skillPaths: [] },
  });
  expect(plan.loadPoints.map((entry) => entry.candidates[0])).toEqual(
    [configDirectory, cwd, path.dirname(cwd), root, location.userHome].map((directory) =>
      path.join(directory, "AGENTS.md"),
    ),
  );
  expect(plan.conditionalNames).toEqual(["AGENTS.md"]);
  expect(plan.imports).toBe(false);
  expect(plan.configuredInstructions[0]).toEqual({
    pattern: "docs/*.md",
    directories: [cwd, path.dirname(cwd), root],
  });
});
test("OpenCode project-discovery disablement retains global and explicitly configured sources", () => {
  const configDirectory = path.join(fixture, "opencode");
  const plan = nativeContextPlan({
    ...location,
    provider: "opencode",
    configDirectory,
    projectConfigDisabled: true,
    settings: { instructions: ["global.md"], skillPaths: [] },
  });
  expect(plan.loadPoints.map((entry) => entry.candidates[0])).toEqual([
    path.join(configDirectory, "AGENTS.md"),
  ]);
  expect(plan.conditionalRoot).toBeNull();
  expect(plan.configuredInstructions).toEqual([
    { pattern: "global.md", directories: [configDirectory] },
  ]);
});
test("native discovery refuses a working directory outside the owning root instead of walking foreign trees", () => {
  expect(() =>
    nativeContextPlan({
      ...location,
      cwd: path.join(fixture, "other"),
      provider: "codex",
      configDirectory: path.join(fixture, "codex"),
      settings: { fallbackNames: [], maxBytes: 32768, disabledSkillPaths: [] },
    }),
  ).toThrow("outside its selected root");
});
