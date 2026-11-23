import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import {
  readContextReport,
  readContextPreview,
  changeContextEdge,
} from "@getpaseo/plugin/otto/context-management";
import { readNativeContext } from "./native-reader.js";
import { nativeContextGraph } from "./native-graph.js";
import { ContextManagementService } from "./host.js";
const temporary = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
const fixtures: string[] = [];
async function fixture() {
  await mkdir(temporary, { recursive: true });
  const created = await mkdtemp(path.join(temporary, "native-reader-"));
  fixtures.push(created);
  const directory = await realpath(created);
  const root = path.join(directory, "project"),
    userHome = path.join(directory, "home"),
    config = path.join(userHome, "provider"),
    ottoHome = path.join(directory, "otto-home");
  for (const folder of [root, config, ottoHome]) await mkdir(folder, { recursive: true });
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  await write(path.join(root, ".git"), "fixture");
  const location = {
    root,
    cwd: root,
    userHome,
    managedDirectory: null,
    ancestorBoundary: directory,
  };
  const read = (provider: "claude" | "codex" | "opencode") =>
    readNativeContext({
      ...location,
      provider,
      environment: { CODEX_HOME: config, CLAUDE_CONFIG_DIR: config, OPENCODE_CONFIG_DIR: config },
    });
  const invoke = vi.fn();
  const host = new ContextManagementService({
    hostId: "host",
    home: ottoHome,
    workspaces: { get: async () => ({ workspaceId: "workspace", cwd: root, archivedAt: null }) },
    agents: {
      list: () => [],
      get: () => ({
        id: "chat",
        provider: "codex",
        workspaceId: "workspace",
        title: null,
        sessionId: null,
        internal: false,
        cwd: root,
      }),
    },
    providerOwner: () => undefined,
    invoke,
    nativeInspection: async () => read("codex"),
  });
  const selection = {
    hostId: "host",
    workspaceId: "workspace",
    agentId: "chat",
    windowTokens: 200000,
  };
  return { ...location, config, write, read, host, invoke, selection };
}
afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    if (!directory.startsWith(temporary)) throw Error("Fixture boundary");
    await rm(directory, { recursive: true, force: true });
  }
});
test("native reader projects actual TOML discovery settings without exposing secret-bearing config", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.config, "config.toml"),
    'project_doc_fallback_filenames=["TEAM.md"]\napi_key="SECRET_CONFIG_VALUE"',
  );
  await f.write(path.join(f.root, "TEAM.md"), "TEAM_RULES");
  const result = await f.read("codex");
  expect(result.entries.map((entry) => entry.text)).toEqual(["TEAM_RULES"]);
  expect(JSON.stringify(result)).not.toContain("SECRET_CONFIG_VALUE");
});
test("invalid native settings stay unchanged and produce a sanitized partial-input notice", async () => {
  const f = await fixture();
  await f.write(path.join(f.config, "config.toml"), 'api_key="SECRET_BAD_VALUE\n{');
  const result = await f.read("codex");
  expect(result.notes.join("\n")).toContain("may omit configured input");
  expect(JSON.stringify(result)).not.toContain("SECRET_BAD_VALUE");
});
test("recorded enabled plugin installations contribute only matching project/user roster descriptors", async () => {
  const f = await fixture();
  const plugin = path.join(f.config, "plugins", "installed-version");
  const wrong = path.join(f.config, "plugins", "other-project");
  await f.write(
    path.join(f.config, "settings.json"),
    JSON.stringify({ enabledPlugins: { "example@local": true }, apiKey: "PRIVATE" }),
  );
  await f.write(
    path.join(f.config, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "example@local": [
          { scope: "user", installPath: plugin },
          { scope: "project", projectPath: path.join(f.root, "foreign"), installPath: wrong },
        ],
      },
    }),
  );
  for (const [folder, name] of [
    [plugin, "Included"],
    [wrong, "Excluded"],
  ])
    await f.write(
      path.join(folder!, "skills", "tool", "SKILL.md"),
      `---\nname: ${name}\ndescription: A tool\n---\nIMPLEMENTATION`,
    );
  const result = await f.read("claude");
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]?.countedText).toContain("Included");
  expect(JSON.stringify(result.notes)).not.toContain("PRIVATE");
});
test("a large skill body does not prevent descriptor-only inventory or inflate its startup weight", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.config, "skills", "large", "SKILL.md"),
    "---\nname: Large\ndescription: Small roster\n---\n" + "LONG_BODY".repeat(30000),
  );
  const result = await f.read("claude");
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]?.countedText.length).toBeLessThan(1000);
  expect(result.entries[0]?.text.length).toBeLessThanOrEqual(16384);
});
test("native graph category preview uses exactly the text counted, leaving linked bodies on demand", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "AGENTS.md"), "ROOT [Optional](optional.md)");
  await f.write(path.join(f.root, "optional.md"), "UNCOUNTED_BODY".repeat(15000));
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!report.ok) throw Error(report.error.message);
  expect(report.value.categories.filter((row) => row.visibility === "convention")).toHaveLength(3);
  expect(report.value.categories.find((row) => row.category === "mcp_tools")).toMatchObject({
    visibility: "not_visible",
    estimatedTokens: null,
  });
  expect(report.value.preparedRequest).toBeNull();
  const preview = readContextPreview.output.parse(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      revision: report.value.revision,
      category: "context_files",
      nodeId: null,
    }),
  );
  if (!preview.ok) throw Error(preview.error.message);
  expect(preview.value.text).toBe("ROOT [Optional](optional.md)");
  expect(report.value.categories[0]?.estimatedTokens).toBe(
    Math.ceil(preview.value.text.length / 4),
  );
  expect(report.value.nodes.find((node) => node.label === "optional.md")).toMatchObject({
    costClass: "referenced",
    estimatedTokens: 0,
  });
  expect(f.invoke).not.toHaveBeenCalled();
});
test("native non-importing provider links cannot be converted into fabricated autoload syntax", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "AGENTS.md"), "[Optional](optional.md)");
  await f.write(path.join(f.root, "optional.md"), "BODY");
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!report.ok) throw Error(report.error.message);
  expect(report.value.edges[0]?.editable).toBe(false);
  const result = await f.host.invoke(changeContextEdge.name, {
    ...f.selection,
    revision: report.value.revision,
    edgeId: report.value.edges[0]!.id,
    mode: "import",
  });
  expect(result).toMatchObject({ ok: false });
});
test("owning native catalog can preview a global instruction without exposing arbitrary client path reads", async () => {
  const f = await fixture();
  await f.write(path.join(f.config, "AGENTS.md"), "GLOBAL_RULES");
  const report = readContextReport.output.parse(
    await f.host.invoke(readContextReport.name, f.selection),
  );
  if (!report.ok) throw Error(report.error.message);
  const node = report.value.nodes[0]!;
  expect(node).toMatchObject({ scope: "host", editable: false });
  const preview = await f.host.invoke(readContextPreview.name, {
    ...f.selection,
    revision: report.value.revision,
    category: null,
    nodeId: node.id,
  });
  expect(preview).toMatchObject({ ok: true, value: { text: "GLOBAL_RULES" } });
  expect(
    await f.host.invoke(readContextPreview.name, {
      ...f.selection,
      revision: report.value.revision,
      category: null,
      nodeId: "client-guessed-file",
    }),
  ).toMatchObject({ ok: false });
});
test("native descriptor sources retain a metadata revision and are pulled in full only on selection", async () => {
  const f = await fixture();
  const file = path.join(f.config, "skills", "sample", "SKILL.md");
  const text = "---\nname: Test\ndescription: Descriptor\n---\nBODY";
  await f.write(file, text);
  const inventory = await f.read("claude");
  const graph = nativeContextGraph(inventory, f.root);
  expect([...graph.sources.values()][0]).toMatchObject({ loaded: false, native: true });
  expect(graph.sections.skills_roster).not.toContain("BODY");
});
test("Claude unconditional rules cost only the body while path-scoped and deeper rules remain conditional", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, ".claude", "rules", "all.md"), "---\nname: General\n---\nALWAYS");
  await f.write(
    path.join(f.root, ".claude", "rules", "typescript.md"),
    '---\npaths: ["**/*.ts"]\n---\nWHEN_TYPESCRIPT',
  );
  await f.write(path.join(f.root, "nested", ".claude", "rules", "deep.md"), "WHEN_DEEPER");
  const inventory = await f.read("claude");
  const graph = nativeContextGraph(inventory, f.root);
  expect(graph.sections.context_files).toBe("ALWAYS");
  expect(
    inventory.entries
      .filter((entry) => entry.costClass === "conditional")
      .map((entry) => entry.countedText)
      .sort(),
  ).toEqual(["WHEN_DEEPER", "WHEN_TYPESCRIPT"]);
});
test("rule frontmatter removal keeps dependency source spans bound to the original file", async () => {
  const f = await fixture();
  const file = path.join(f.root, ".claude", "rules", "imports.md");
  const text = "---\nname: General\n---\n@target.md";
  await f.write(file, text);
  await f.write(path.join(f.root, ".claude", "rules", "target.md"), "TARGET");
  const inventory = await f.read("claude");
  const edge = inventory.dependencies[0]!;
  expect(text.slice(edge.start, edge.end)).toBe("@target.md");
  expect(nativeContextGraph(inventory, f.root).edits.size).toBe(1);
});
test("invalid rule path metadata remains visible as unknown rather than unconditional fixed context", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.root, ".claude", "rules", "bad.md"),
    "---\npaths: true\n---\nDO_NOT_ASSUME_ALWAYS",
  );
  const inventory = await f.read("claude");
  expect(inventory.entries).toEqual([]);
  expect(inventory.notes.join("\n")).toContain("their cost is unknown");
});
test("OpenCode V2 reads skills arrays, flat/grouped descriptors and later ID overrides without fetching catalogs", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.config, "opencode.jsonc"),
    JSON.stringify({ skills: ["./extra", "https://example.invalid/skills/"] }),
  );
  await f.write(
    path.join(f.config, "skills", "same", "SKILL.md"),
    "---\nname: Old\ndescription: Shadowed\n---\nBODY",
  );
  await f.write(path.join(f.root, "extra", "same.md"), "---\ndescription: Selected\n---\nBODY");
  await f.write(
    path.join(f.root, "extra", "group", "nested", "SKILL.md"),
    "---\nname: Nested\ndescription: Grouped\n---\nBODY",
  );
  const inventory = await f.read("opencode");
  const fixed = inventory.entries
    .filter((entry) => entry.costClass === "fixed")
    .map((entry) => entry.countedText)
    .join("\n");
  expect(fixed).toContain("Selected");
  expect(fixed).toContain("Grouped");
  expect(fixed).not.toContain("Shadowed");
  expect(inventory.notes.join("\n")).toContain("Remote skill catalogs are not fetched");
});
test("OpenCode hidden invocation metadata preserves manual availability without adding fixed roster cost", async () => {
  const f = await fixture();
  await f.write(
    path.join(f.config, "skills", "hidden", "SKILL.md"),
    "---\ndescription: Hidden\nmetadata:\n  opencode/autoinvoke: false\n---\nBODY",
  );
  const inventory = await f.read("opencode");
  expect(inventory.entries).toHaveLength(1);
  expect(inventory.entries[0]?.costClass).toBe("conditional");
  expect(nativeContextGraph(inventory, f.root).sections.skills_roster).toBe("");
});
test("Codex disabled SKILL.md paths are honored before descriptor inventory", async () => {
  const f = await fixture();
  const file = path.join(f.userHome, ".agents", "skills", "disabled", "SKILL.md");
  await f.write(file, "---\nname: Disabled\ndescription: Must not advertise\n---\nBODY");
  await f.write(
    path.join(f.config, "config.toml"),
    `[[skills.config]]\npath=${JSON.stringify(file.split(path.sep).join("/"))}\nenabled=false`,
  );
  expect((await f.read("codex")).entries).toEqual([]);
});
test("managed Claude instruction policy overrides user mode without adding excluded startup roots as conditional files", async () => {
  const f = await fixture();
  const managedDirectory = path.join(f.root, "managed");
  await f.write(
    path.join(f.config, "settings.json"),
    JSON.stringify({
      autoMemoryEnabled: false,
      pluginConfigs: {
        "cc-plugin-agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } },
      },
    }),
  );
  await f.write(
    path.join(managedDirectory, "managed-settings.json"),
    JSON.stringify({
      pluginConfigs: {
        "cc-plugin-agents-md@builtin": { options: { instructionFiles: "managed-only" } },
      },
    }),
  );
  await f.write(path.join(managedDirectory, "CLAUDE.md"), "MANAGED");
  await f.write(path.join(f.root, "CLAUDE.md"), "EXCLUDED_ROOT");
  await f.write(path.join(f.root, "AGENTS.md"), "EXCLUDED_FALLBACK");
  const inventory = await readNativeContext({
    ...f,
    provider: "claude",
    managedDirectory,
    environment: { CLAUDE_CONFIG_DIR: f.config },
  });
  expect(
    inventory.entries
      .filter((entry) => entry.costClass === "fixed")
      .map((entry) => entry.countedText),
  ).toEqual(["MANAGED"]);
  expect(
    inventory.entries.some(
      (entry) => entry.text === "EXCLUDED_ROOT" || entry.text === "EXCLUDED_FALLBACK",
    ),
  ).toBe(false);
});
test("suppressed root AGENTS fallback does not return as a conditional source", async () => {
  const f = await fixture();
  await f.write(path.join(f.root, "CLAUDE.md"), "PRIMARY");
  await f.write(path.join(f.root, "AGENTS.md"), "SUPPRESSED");
  expect((await f.read("claude")).entries.map((entry) => entry.text)).toEqual(["PRIMARY"]);
});
