import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  analyzeIntegrations,
  normalizeBrand,
  resolveModule,
} from "./merge-integration-analysis.mjs";
import { EXCLUSIONS, MOUNT_CONTRACTS, SKILL_OWNERS } from "./merge-integration-contracts.mjs";
import { Repository, captureBaseline, checkBaseline, run } from "./merge-orphan-guard.mjs";

const root = "packages/app/src/app/_layout.tsx";
const sidebar = "packages/app/src/components/left-sidebar.tsx";
const catalog = "packages/app/src/plugins/catalog-sync.tsx";
const command = "packages/app/src/plugins/command-center/registration.tsx";
const sidebarItems = "packages/app/src/plugins/sidebar-items.tsx";
const migration = SKILL_OWNERS.migration.file;
const startup = SKILL_OWNERS.startup.file;
const bootstrap = SKILL_OWNERS.bootstrap.file;
const parserFixture = () =>
  new Map([
    [
      root,
      `import { PluginCatalogSync } from "@/plugins";
import { PluginCommandCenterActions as Actions } from "@/plugins/command-center/registration";
import { SessionProvider } from "@/contexts/session-context";
import { CommandCenterProvider as Commands } from "@/command-center/provider";
import { LegacyAgentSkillsMigration } from "@/agent-skills/legacy-migration";
function ProvidersWrapper() { return <HostSessionManager />; }
function HostSessionManager() { return <>{hosts.map(host => <ManagedDaemonSession host={host}/>)}</>; }
function ManagedDaemonSession({daemon}) { const client = useClient(daemon.serverId); return <SessionProvider><PluginCatalogSync serverId={daemon.serverId} client={client}/></SessionProvider>; }
function AppContainer() {
 const surface = <><Actions/><LegacyAgentSkillsMigration/></>;
 const content = compact ? <View>{surface}</View> : surface;
 return <Commands>{content}</Commands>;
}`,
    ],
    [
      sidebar,
      `import { memo } from "react";
import { PluginSidebarItems as Items } from "@/plugins";
export const LeftSidebar = memo(function LeftSidebar() { return compact ? <MobileSidebar/> : <DesktopSidebar/>; });
function MobileSidebar({closeSidebar}) { return <Items onBeforeNavigate={closeSidebar}/>; }
function DesktopSidebar() { return <Items/>; }`,
    ],
    [
      "packages/app/src/plugins/index.ts",
      'export { PluginCatalogSync } from "./catalog-sync"; export { PluginSidebarItems } from "./sidebar-items";',
    ],
    [catalog, "export function PluginCatalogSync() { return null; }"],
    [command, "export function PluginCommandCenterActions() { return null; }"],
    [sidebarItems, "export function PluginSidebarItems() { return null; }"],
    [
      "packages/app/src/contexts/session-context.tsx",
      "export function SessionProvider({children}) { return children; }",
    ],
    [
      "packages/app/src/command-center/provider.tsx",
      "export function CommandCenterProvider({children}) { return children; }",
    ],
    [
      migration,
      `import { useEffect } from "react";
import { createLegacyMigrationController as createMigration } from "./legacy-migration-controller";
import { getDesktopDaemonStatus as status, readLegacySkillSelection as read, deleteLegacySkillSelection as remove } from "@/desktop/daemon/desktop-daemon";
export function LegacyAgentSkillsMigration() {
 useEffect(() => { createMigration({ getLocalStatus: status, getConnectedClient(id) { return client; }, read: read, remove: remove }); }, []);
 return null;
}`,
    ],
    [
      SKILL_OWNERS.controller.file,
      "export function createLegacyMigrationController(ports) { return { refresh() {}, dispose() {} }; }",
    ],
    [
      SKILL_OWNERS.ports.read.file,
      "export function getDesktopDaemonStatus() {} export function readLegacySkillSelection() {} export function deleteLegacySkillSelection() {}",
    ],
    [
      bootstrap,
      `import { createStartupOrchestrationSkills as createStartup } from "./orchestration-skills/startup.js";
export async function createOttoDaemon(store) {
 const orchestrationSkills = createStartup(store, {desktopManaged: true});
 void orchestrationSkills.autoUpdate();
 const stop = async () => { await orchestrationSkills.dispose(); };
 return {stop};
}`,
    ],
    [
      startup,
      `export function createStartupOrchestrationSkills(configStore, options) {
 const skills = createOrchestrationSkills(configStore);
 let release = () => {};
 const selectionReady = options.desktopManaged ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
 configStore.onChange(config => { if (config.skills.selection === undefined) return; release(); });
 return { ...skills, autoUpdate() { return selectionReady.then(() => { return skills.autoUpdate(); }); }, dispose() { release(); } };
}`,
    ],
  ]);
const reader = (files, renames = new Map()) => ({
  files: new Set(files.keys()),
  read: (file) => files.get(file),
  mapPath: (file) => (files.has(file) ? file : (renames.get(file) ?? file)),
});
const inspect = (files, options) => analyzeIntegrations(reader(files), options);
const statuses = (result) =>
  Object.fromEntries(result.results.map((item) => [item.id, item.status]));
const replace = (files, file, from, to) => {
  assert.ok(files.get(file).includes(from), `fixture must contain ${from}`);
  files.set(file, files.get(file).replace(from, to));
};

test("retained owner chains follow aliases, barrel exports, returned variables and host maps", () => {
  const result = inspect(parserFixture());
  assert.deepEqual(Object.values(statuses(result)), Array(8).fill("pass"));
  const commandResult = result.results.find((item) => item.id === "plugin-command");
  assert.equal(commandResult.edges[0].evidence[0].conditional, true);
  assert.ok(result.parsedModules.length < 20);
});

for (const [label, file, mount, id] of [
  [
    "catalog",
    root,
    "<PluginCatalogSync serverId={daemon.serverId} client={client}/>",
    "plugin-catalog",
  ],
  ["command", root, "<Actions/>", "plugin-command"],
  [
    "compact sidebar",
    sidebar,
    "<Items onBeforeNavigate={closeSidebar}/>",
    "plugin-sidebar-compact",
  ],
  ["wide sidebar", sidebar, "<Items/>", "plugin-sidebar-wide"],
  ["migration", root, "<LegacyAgentSkillsMigration/>", "skills-renderer"],
])
  test(`missing ${label} mount fails despite its import and helper test`, () => {
    const files = parserFixture();
    replace(files, file, mount, "null");
    files.set(file + ".test.tsx", `test("helper", () => (${mount}));`);
    const result = inspect(files);
    assert.equal(statuses(result)[id], "violation");
    assert.ok(
      result.results
        .find((item) => item.id === id)
        .edges.some((edge) => edge.status === "violation" && edge.owner.name),
    );
    assert.equal(
      Object.values(statuses(result)).filter((status) => status === "violation").length,
      1,
    );
  });

test("unused helper, type-only import and false branch cannot satisfy a mount", () => {
  for (const change of [
    (files) => replace(files, root, "<Actions/>", "{false && <Actions/>}"),
    (files) => {
      replace(files, root, "<Actions/>", "");
      files.set(root, files.get(root) + "\nfunction Unused() { return <Actions/>; }");
    },
    (files) =>
      replace(
        files,
        root,
        "import { PluginCommandCenterActions as Actions }",
        "import type { PluginCommandCenterActions as Actions }",
      ),
  ]) {
    const files = parserFixture();
    change(files);
    assert.equal(statuses(inspect(files))["plugin-command"], "violation");
  }
});

test("legitimate local wrapper and createElement wiring are accepted", () => {
  const files = parserFixture();
  replace(files, root, "const surface = <><Actions/>", "const surface = <><LocalActions/>");
  files.set(root, files.get(root) + "\nfunction LocalActions() { return <Actions/>; }");
  assert.equal(statuses(inspect(files))["plugin-command"], "pass");
  replace(
    files,
    root,
    "function LocalActions() { return <Actions/>; }",
    "function LocalActions() { return h(Actions, null); }",
  );
  files.set(root, 'import { createElement as h } from "react";\n' + files.get(root));
  assert.equal(statuses(inspect(files))["plugin-command"], "pass");
});

test("namespace alias and relocated target behind a barrel keep symbol identity", () => {
  const files = parserFixture();
  replace(
    files,
    root,
    'import { PluginCommandCenterActions as Actions } from "@/plugins/command-center/registration";',
    'import * as CommandsModule from "@/plugins/command-center/registration";',
  );
  replace(files, root, "<Actions/>", "<CommandsModule.PluginCommandCenterActions/>");
  assert.equal(statuses(inspect(files))["plugin-command"], "pass");
  const moved = command.replace("registration", "relocated");
  files.set(moved, files.get(command));
  files.delete(command);
  replace(
    files,
    root,
    'from "@/plugins/command-center/registration"',
    'from "@/plugins/command-center/relocated"',
  );
  const result = analyzeIntegrations(reader(files, new Map([[command, moved]])));
  assert.equal(statuses(result)["plugin-command"], "pass");
});

test("renamed exports in a reviewed barrel resolve to their original symbol", () => {
  const files = parserFixture();
  replace(
    files,
    "packages/app/src/plugins/index.ts",
    "export { PluginCatalogSync }",
    "export { PluginCatalogSync as HostCatalog }",
  );
  replace(
    files,
    root,
    "import { PluginCatalogSync }",
    "import { HostCatalog as PluginCatalogSync }",
  );
  assert.equal(statuses(inspect(files))["plugin-catalog"], "pass");
});

test("mutable render aliases and unreachable returns cannot certify a mount", () => {
  const files = parserFixture();
  replace(files, root, "const content = compact", "let content = compact");
  replace(
    files,
    root,
    "return <Commands>{content}</Commands>;",
    "content = null; return <Commands>{content}</Commands>;",
  );
  assert.equal(statuses(inspect(files))["plugin-command"], "error");
  files.set(
    root,
    parserFixture().get(root).replace("const surface =", "return null; const surface ="),
  );
  assert.equal(statuses(inspect(files))["plugin-command"], "violation");
});

test("literal short circuits cannot certify an unreachable mount", () => {
  for (const expression of [
    "true || <Actions/>",
    "false && <Actions/>",
    "false ?? <Actions/>",
    "1 || <Actions/>",
  ]) {
    const files = parserFixture();
    replace(files, root, "<Actions/>", "{" + expression + "}");
    assert.equal(statuses(inspect(files))["plugin-command"], "violation");
  }
});

test("local declarations and parameters cannot impersonate imported components or providers", () => {
  for (const declaration of [
    "const Actions = () => null;",
    "const Commands = ({children}) => children;",
  ]) {
    const files = parserFixture();
    replace(files, root, "function AppContainer() {", "function AppContainer() { " + declaration);
    assert.equal(statuses(inspect(files))["plugin-command"], "error");
  }
  const files = parserFixture();
  replace(files, root, "function AppContainer()", "function AppContainer(Actions)");
  assert.equal(statuses(inspect(files))["plugin-command"], "error");
});

test("catalog and compact sidebar require actual owner prop bindings", () => {
  for (const [file, from, to, id] of [
    [root, "serverId={daemon.serverId}", "serverId={other.serverId}", "plugin-catalog"],
    [root, "client={client}", "client={undefined}", "plugin-catalog"],
    [
      sidebar,
      "onBeforeNavigate={closeSidebar}",
      "onBeforeNavigate={undefined}",
      "plugin-sidebar-compact",
    ],
    [
      sidebar,
      "onBeforeNavigate={closeSidebar}",
      "onBeforeNavigate={() => {}}",
      "plugin-sidebar-compact",
    ],
  ]) {
    const files = parserFixture();
    replace(files, file, from, to);
    assert.equal(statuses(inspect(files))[id], "violation");
  }
});

test("migration ports retain their IPC import identities", () => {
  for (const [from, to] of [
    ["getLocalStatus: status", "getLocalStatus: remoteStatus"],
    ["read: read", "read: undefined"],
    ["remove: remove", "remove: () => {}"],
  ]) {
    const files = parserFixture();
    replace(files, migration, from, to);
    assert.equal(statuses(inspect(files))["skills-migration-controller"], "violation");
  }
});

test("a provider outside the returned command subtree does not satisfy ancestry", () => {
  const files = parserFixture();
  replace(
    files,
    root,
    "return <Commands>{content}</Commands>;",
    "return <><Commands/>{content}</>;",
  );
  assert.equal(statuses(inspect(files))["plugin-command"], "violation");
});

test("unsupported render calls and syntax errors remain errors with other obligations reported", () => {
  for (const replacement of ["{unknownFactory(() => <Actions/>)}", "{<Actions"]) {
    const files = parserFixture();
    replace(files, root, "<Actions/>", replacement);
    const result = inspect(files);
    assert.equal(statuses(result)["plugin-command"], "error");
    assert.equal(statuses(result)["plugin-sidebar-wide"], "pass");
    assert.equal(result.results.length, 8);
  }
});

test("missing historical startup helper is a violation; an actual broken import is an error", () => {
  const files = parserFixture();
  files.delete(startup);
  files.set(
    bootstrap,
    "export function createOttoDaemon() { const skills = createOrchestrationSkills(); skills.autoUpdate(); }",
  );
  let result = statuses(inspect(files));
  assert.equal(result["skills-daemon-startup"], "violation");
  assert.equal(result["skills-maintenance-release"], "violation");
  files.set(bootstrap, parserFixture().get(bootstrap));
  result = statuses(inspect(files));
  assert.equal(result["skills-daemon-startup"], "error");
});

test("mount-only skill repair fails when startup or persistence notification is disconnected", () => {
  for (const [file, from, to, id] of [
    [bootstrap, "void orchestrationSkills.autoUpdate();", "", "skills-daemon-startup"],
    [bootstrap, "await orchestrationSkills.dispose();", "", "skills-daemon-startup"],
    [startup, "release(); });", " });", "skills-maintenance-release"],
    [startup, "return skills.autoUpdate();", "return [];", "skills-maintenance-release"],
  ]) {
    const files = parserFixture();
    replace(files, file, from, to);
    const result = statuses(inspect(files));
    assert.equal(result["skills-renderer"], "pass");
    assert.equal(result[id], "violation");
  }
});

test("reasoned exclusions do not hide an unrelated missing required mount", () => {
  const files = parserFixture();
  for (const exclusion of EXCLUSIONS) {
    assert.ok(exclusion.reason.length > 40);
    files.set(
      exclusion.path.endsWith("/") ? exclusion.path + "inert.ts" : exclusion.path,
      "export const retained = true;",
    );
  }
  replace(files, root, "<Actions/>", "");
  assert.equal(statuses(inspect(files))["plugin-command"], "violation");
});

test("brand normalization and ambiguous platform resolution are explicit", () => {
  assert.equal(
    normalizeBrand("@getpaseo/paseo PASEO_HOME sh.paseo.desktop 6767\r\n"),
    "@otto-code/otto OTTO_HOME ai.ottocode.desktop 6868\n",
  );
  assert.throws(
    () =>
      resolveModule("./view", "src/root.ts", new Set(["src/view.web.tsx", "src/view.native.tsx"])),
    /Ambiguous platform/,
  );
  assert.throws(
    () => resolveModule("./view", "src/root.ts", new Set(["src/view.tsx", "src/view.web.tsx"])),
    /Ambiguous generic\/platform/,
  );
});

const scratchRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.tmp/agent-06");
const cli = fileURLToPath(new URL("./merge-orphan-guard.mjs", import.meta.url));
function gitFixture(t) {
  mkdirSync(scratchRoot, { recursive: true });
  const cwd = mkdtempSync(resolve(scratchRoot, "fixture-"));
  t.after(() => {
    assert.equal(
      dirname(resolve(cwd)),
      scratchRoot,
      "cleanup target must remain a direct fixture child",
    );
    rmSync(cwd, { recursive: true, force: true });
  });
  const repo = new Repository(cwd);
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  const write = (file, content) => {
    mkdirSync(dirname(resolve(cwd, file)), { recursive: true });
    writeFileSync(resolve(cwd, file), content);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Draekz");
  git("config", "user.email", "draekz@gmail.com");
  git("config", "core.hooksPath", ".fixture-no-hooks"); // Synthetic repository has no project hooks.
  write("README.md", "synthetic fixture\n");
  write("upstream-shared.ts", "export const upstreamFeature = 42;\n");
  git("add", ".");
  git("commit", "-m", "Common ancestor");
  const common = repo.commit("HEAD");
  // Real Otto sources use a literal NUL separator in strings. It is valid TS,
  // even though Git's text merge heuristic classifies such blobs as binary.
  write("otto-feature.ts", 'export const ownFeature = 42;\nexport const separator = "\0";\n');
  write("test-documents/broken.ts", "export function intentionally broken (");
  write(
    "entry.ts",
    'import { ownFeature } from "./otto-feature"; export const value = ownFeature;\n',
  );
  git("add", ".");
  git("commit", "-m", "Premerge Otto feature");
  const before = repo.commit("HEAD");
  git("switch", "-c", "upstream", common);
  git("mv", "upstream-shared.ts", "upstream-renamed.ts");
  for (const [file, content] of parserFixture()) write(file, content);
  git("add", ".");
  git("commit", "-m", "New upstream integrations");
  const target = repo.commit("HEAD");
  git("update-ref", "refs/upstream-tags/v0.6.1", target);
  git("tag", "v0.6.1", before);
  git("switch", "main");
  git("merge", "--no-ff", "upstream", "-m", "Integrated fixture");
  const after = repo.commit("HEAD");
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "Fixture mutation");
    return repo.commit("HEAD");
  };
  return { repo, cwd, before, target, after, write, commit, git };
}

test("CLI compares refs without checkout, detects a new upstream integration and avoids tag collision", (t) => {
  const fixture = gitFixture(t);
  const args = [
    "--integrations",
    "--before",
    fixture.before,
    "--at",
    "v0.6.1",
    "--after",
    fixture.after,
    "--json",
  ];
  const clear = run(args, fixture.repo);
  assert.equal(clear.exitCode, 0);
  assert.equal(clear.report.refs.target, fixture.target);
  fixture.write(root, parserFixture().get(root).replace("<Actions/>", ""));
  const broken = fixture.commit();
  const result = run([...args.slice(0, -2), broken, "--json"], fixture.repo);
  assert.equal(result.exitCode, 1);
  assert.equal(statuses(result.report)["plugin-command"], "violation");
  assert.equal(fixture.repo.commit("HEAD"), broken);
  assert.equal(run(args, fixture.repo).exitCode, 0);
});

test("legacy snapshot preserves import survival and follows a real Git rename", (t) => {
  const fixture = gitFixture(t);
  const refs = fixture.repo.comparison(fixture.before, fixture.target);
  const baseline = captureBaseline(fixture.repo, refs);
  assert.deepEqual(baseline.entries["otto-feature.ts"], ["entry.ts"]);
  assert.equal(
    baseline.entries["upstream-shared.ts"],
    undefined,
    "upstream rename must not look Otto-owned",
  );
  assert.ok(fixture.repo.tree(fixture.before).read("otto-feature.ts").includes("\0"));
  assert.deepEqual(checkBaseline(fixture.repo, baseline, fixture.after).findings, []);
  fixture.git("mv", "otto-feature.ts", "otto-feature-renamed.ts");
  fixture.write(
    "entry.ts",
    'import { ownFeature } from "./otto-feature-renamed"; export const value = ownFeature;\n',
  );
  const renamed = fixture.commit();
  assert.equal(
    fixture.repo.renames(fixture.before, renamed).get("otto-feature.ts"),
    "otto-feature-renamed.ts",
  );
  assert.deepEqual(checkBaseline(fixture.repo, baseline, renamed).findings, []);
  fixture.write("entry.ts", "export const value = 42;\n");
  const orphaned = fixture.commit();
  assert.deepEqual(checkBaseline(fixture.repo, baseline, orphaned).findings, [
    { category: "lost-importers", file: "otto-feature-renamed.ts", before: ["entry.ts"] },
  ]);
  fixture.write("invalid-source.ts", Buffer.from([0xff]));
  const invalid = fixture.commit();
  assert.throws(() => checkBaseline(fixture.repo, baseline, invalid), /Invalid UTF-8/);
});

test("legacy check follows staged renames during a resolved uncommitted merge", (t) => {
  const fixture = gitFixture(t);
  const baseline = captureBaseline(
    fixture.repo,
    fixture.repo.comparison(fixture.before, fixture.target),
  );
  fixture.git("switch", "-c", "uncommitted", fixture.before);
  fixture.git("merge", "--no-ff", "--no-commit", "upstream");
  fixture.git("mv", "otto-feature.ts", "otto-feature-staged.ts");
  fixture.write(
    "entry.ts",
    'import { ownFeature } from "./otto-feature-staged"; export const value = ownFeature;\n',
  );
  fixture.git("add", "entry.ts");
  assert.equal(fixture.repo.commit("MERGE_HEAD"), fixture.target);
  const result = checkBaseline(fixture.repo, baseline);
  assert.equal(result.worktree, true);
  assert.deepEqual(result.findings, []);
  assert.match(result.worktreeStatus, /otto-feature-staged/);
});

test("missing, malformed and postmerge baselines fail explicitly; explicit before works from dirty checkout", (t) => {
  const fixture = gitFixture(t);
  const execute = (...args) =>
    spawnSync(process.execPath, [cli, ...args, "--json"], { cwd: fixture.cwd, encoding: "utf8" });
  assert.equal(execute("--check").status, 2);
  fixture.write(".tmp/merge-orphan-baseline.json", "not json");
  assert.equal(execute("--check").status, 2);
  fixture.write(
    ".tmp/merge-orphan-baseline.json",
    JSON.stringify({ head: fixture.before, entries: {} }),
  );
  assert.equal(execute("--check").status, 2);
  assert.equal(execute("--baseline", "--at", fixture.target).status, 2);
  fixture.write("entry.ts", "export const changed = true;");
  const capture = execute("--baseline", "--before", fixture.before, "--at", fixture.target);
  assert.equal(capture.status, 0, capture.stdout + capture.stderr);
  const snapshot = JSON.parse(
    readFileSync(resolve(fixture.cwd, ".tmp/merge-orphan-baseline.json"), "utf8"),
  );
  assert.deepEqual(snapshot.entries["otto-feature.ts"], ["entry.ts"]);
  assert.equal(execute("--baseline", "--before", "missing-ref", "--at", fixture.target).status, 2);
  assert.equal(
    execute("--baseline", "--before", fixture.before, "--at", "refs/tags/v0.6.1").status,
    2,
  );
  assert.equal(execute("--integrations", "--after", fixture.after).status, 2);
  assert.equal(execute("--check", "--before", fixture.before).status, 2);
});

test("contract inventory names distinct plugin obligations", () => {
  assert.deepEqual(
    MOUNT_CONTRACTS.map((item) => item.id),
    [
      "plugin-catalog",
      "plugin-command",
      "plugin-sidebar-compact",
      "plugin-sidebar-wide",
      "skills-renderer",
    ],
  );
});
