// Puts the agent lane's OTTO_HOME into a known starting state, so an agent does
// not have to click through setup on every run. Idempotent - safe to re-run.
//
// Usage: node scripts/dev-agent-bootstrap.mjs [--stage <stage>] [options]
//
//   --stage fresh|defaults|project|workspace|chat   (or 1..5; default: defaults)
//   --from <home>      home to copy provider config from (default: the dev home)
//   --force            overwrite config values that are already set
//   --template <name>  boilerplate project from the shared corpus (see --list)
//   --branch <name>    back the workspace with an otto worktree on this branch
//   --verify           run the template's declared build and test
//   --keep             compose onto existing state instead of starting clean
//   --list             print the available templates and exit
//   --project <path>   directory to register (default: the lane's sandbox repo)
//   --model <alias>    haiku | sonnet | opus | qwen, or a raw model id
//   --provider <id>    only needed with a raw --model id
//   --prompt <text>    initial prompt for the created chat (default: none)
//   --host <host:port> daemon to drive (default: the agent lane's own)
//
// The five stages are cumulative - each is the previous one plus one more step -
// so they answer "what state do I want Otto to be in before I start looking at
// it?" See docs/development.md → "Playbooks: starting states".
//
// **Every run starts from a clean slate.** Stages that touch the daemon first tear
// down the lane's chats, workspaces, projects and sandbox, so a scenario is never
// reached with the previous one still in the way. `--keep` opts out and composes
// instead. Clean-slate is the default because the alternative - remembering a flag
// - fails silently and leaves you debugging leftover state instead of the feature.
//
//   fresh      no providers, no wizard flags, no projects → the first-run experience
//   defaults   providers and keys seeded, wizard and tour flags set
//   project    + a project registered
//   workspace  + a workspace on that project
//   chat       + a chat (agent session) in that workspace, on a chosen model
//
// `fresh` and `defaults` are pure file writes and need no daemon. The last three
// drive the *running* daemon over its WebSocket, because a project, a workspace
// and an agent are daemon-owned records - hand-writing them into $OTTO_HOME
// would duplicate registry logic that already exists and would rot the first time
// it changed.
//
// What this script copies is the *durable, machine-local* half of a source home's
// config.json - provider endpoints and API keys, model tier overrides,
// personalities, teams, feature flags. It deliberately does NOT copy `daemon.*`:
// the lane's listen address and CORS allowlist are its own, and inheriting the
// source's `daemon.listen` is exactly how a lane ends up answering on someone
// else's port (see scripts/seed-dev-daemon-config.mjs).
//
// The other half of a bootstrap is device-local app settings (the first-run
// wizard and tour flags), which live in the *client's* AsyncStorage - for Expo
// web that is localStorage on the Metro origin, not anywhere under OTTO_HOME.
// This script cannot reach it, so it prints the one-liner to run in the browser.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  listBranches,
  listTemplates,
  materializeTemplate,
  runTemplateChecks,
} from "./playbook-projects.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devStateDir = path.join(repoRoot, "packages", "desktop", ".dev");

// Cumulative, in order. Index comparison is the whole gating mechanism: a stage
// runs every step whose stage index is <= the requested one.
const STAGES = ["fresh", "defaults", "project", "workspace", "chat"];

// Aliases for the models this lane is actually used to drive. A raw id still
// works via --model <id> --provider <id>; these exist so the common cases are
// one word and the ids stay in one place when a catalog entry is renamed.
const MODEL_ALIASES = {
  haiku: { provider: "claude", model: "claude-haiku-4-5", label: "Haiku 4.5" },
  sonnet: { provider: "claude", model: "claude-sonnet-5", label: "Sonnet 5" },
  opus: { provider: "claude", model: "claude-opus-5", label: "Opus 5" },
  qwen: { provider: "openai-compatible", model: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B" },
};

// Keys under `agents` worth inheriting. Anything not listed is left alone, so a
// new setting never silently leaks between lanes.
const AGENT_KEYS = [
  "savedProviderEndpoints",
  "providers",
  "modelTierOverrides",
  "agentPersonalities",
  "agentTeams",
  "metadataGeneration",
];

// Daemon-owned records a `fresh` run has to clear for the app to look untouched.
// `daemon-keypair.json` and `server-id` are pointedly NOT here: a home that mints
// a new identity is refused by any client that remembered the old one, and the
// first-run wizard is client-side state anyway, so keeping the identity costs
// nothing and saves re-pairing.
const FRESH_WIPE_ENTRIES = [
  "projects",
  "agents",
  "worktrees",
  "personality-memory",
  "orchestration-graphs",
  "activity-stats.json",
  "usage-log.json",
  "stats",
];

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (args.includes("--list")) {
  const names = listTemplates();
  console.log(names.length ? names.join("\n") : "(no templates in test-documents/projects)");
  process.exit(0);
}

function resolveStage() {
  const raw = flag("--stage") ?? "defaults";
  if (/^[1-5]$/.test(raw)) {
    return STAGES[Number(raw) - 1];
  }
  if (!STAGES.includes(raw)) {
    fail(`Unknown --stage "${raw}". Expected one of: ${STAGES.join(", ")} (or 1..5).`);
  }
  return raw;
}

const stage = resolveStage();
const stageIndex = STAGES.indexOf(stage);
function stageAtLeast(name) {
  return stageIndex >= STAGES.indexOf(name);
}

const targetHome = process.env.OTTO_DEV_HOME ?? path.join(devStateDir, "agent-home");
const sourceHome = flag("--from") ?? path.join(devStateDir, "otto-home");
const force = args.includes("--force");
const daemonPort = Number(process.env.OTTO_DEV_DAEMON_PORT ?? 6799);
const host = flag("--host") ?? `127.0.0.1:${daemonPort}`;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function isPortListening(hostPort) {
  const [hostname, port] = hostPort.split(":");
  return new Promise((resolve) => {
    const socket = net.connect(Number(port), hostname);
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

// ---------------------------------------------------------------------------
// Stage 1: fresh
// ---------------------------------------------------------------------------

function runFresh() {
  const configPath = path.join(targetHome, "config.json");
  const config = readJson(configPath);
  if (config?.agents) {
    for (const key of AGENT_KEYS) {
      delete config.agents[key];
    }
  }
  if (config) {
    delete config.features;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  const wiped = [];
  for (const entry of FRESH_WIPE_ENTRIES) {
    const target = path.join(targetHome, entry);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    wiped.push(entry);
  }

  console.log(`reset ${targetHome} to a first-run state`);
  console.log(`  cleared providers, model overrides, personalities, teams, feature flags`);
  console.log(`  removed  ${wiped.length ? wiped.join(", ") : "(nothing - already clean)"}`);
  console.log(
    `  kept     daemon.listen (${config?.daemon?.listen ?? "unset"}), daemon-keypair.json, server-id`,
  );
}

// ---------------------------------------------------------------------------
// Stage 2: defaults
// ---------------------------------------------------------------------------

function runDefaults() {
  const source = readJson(path.join(sourceHome, "config.json"));
  if (!source) {
    fail(`No readable config.json in ${sourceHome} - nothing to bootstrap from.`);
  }

  const targetConfigPath = path.join(targetHome, "config.json");
  const target = readJson(targetConfigPath) ?? { version: 1 };

  target.agents = target.agents ?? {};
  const copied = [];
  const skipped = [];
  for (const key of AGENT_KEYS) {
    if (source.agents?.[key] === undefined) continue;
    if (target.agents[key] !== undefined && !force) {
      skipped.push(key);
      continue;
    }
    target.agents[key] = source.agents[key];
    copied.push(key);
  }

  if (source.features !== undefined && (target.features === undefined || force)) {
    target.features = source.features;
    copied.push("features");
  } else if (source.features !== undefined) {
    skipped.push("features");
  }

  mkdirSync(targetHome, { recursive: true });
  writeFileSync(targetConfigPath, `${JSON.stringify(target, null, 2)}\n`);

  console.log(`bootstrapped ${targetConfigPath}`);
  console.log(`  from    ${sourceHome}`);
  console.log(`  copied  ${copied.length ? copied.join(", ") : "(nothing)"}`);
  if (skipped.length) {
    console.log(`  kept    ${skipped.join(", ")}  (already set; pass --force to overwrite)`);
  }
  console.log(
    `  daemon.listen left untouched: ${target.daemon?.listen ?? "(unset - set on launch)"}`,
  );
}

// ---------------------------------------------------------------------------
// Stages 3-5: driven against the running daemon
// ---------------------------------------------------------------------------

// A real git repo, because a workspace that is not one has no Changes view, no
// diff base and no branch - which makes it useless for exactly the flows this
// lane is used to look at.
//
// `--template` goes further: a whole boilerplate project from the shared corpus,
// with a green `main` and a `break/*` branch per error scenario. The project name
// is the template name, so Otto's project list reads as a menu of stacks.
function ensureSandboxProject() {
  const explicit = flag("--project");
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) {
      fail(`--project ${resolved} does not exist.`);
    }
    return resolved;
  }

  const templateName = flag("--template");
  if (templateName) {
    return materializeSandboxTemplate(templateName);
  }

  const sandbox = path.join(devStateDir, "agent-sandbox", "playbook-project");
  if (existsSync(path.join(sandbox, ".git"))) {
    return sandbox;
  }

  mkdirSync(sandbox, { recursive: true });
  writeFileSync(
    path.join(sandbox, "README.md"),
    [
      "# Playbook project",
      "",
      "Scratch git repo created by `scripts/dev-agent-bootstrap.mjs` so the agent",
      "lane has a project to open. Nothing here is precious - delete the folder and",
      "re-run the bootstrap to get a clean one.",
      "",
    ].join("\n"),
  );
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: sandbox, stdio: "pipe" });
  git("init", "-b", "main");
  git("add", "-A");
  // Identity is set on the repo, not globally: the machine's git identity is the
  // user's and must not be assumed present in a scripted run.
  git(
    "-c",
    "user.name=Otto Bootstrap",
    "-c",
    "user.email=bootstrap@otto.local",
    "commit",
    "-m",
    "chore: seed playbook project",
  );
  console.log(`created sandbox project ${sandbox}`);
  return sandbox;
}

// The corpus lives in one module shared with the Playwright suites, so a fixture
// authored once is available to both an agent driving Otto and a spec asserting
// about it. See test-documents/projects/README.md.
function materializeSandboxTemplate(templateName) {
  const targetDir = path.join(devStateDir, "agent-sandbox", templateName);
  let result;
  try {
    result = materializeTemplate({
      name: templateName,
      targetDir,
      force: args.includes("--force"),
    });
  } catch (error) {
    fail(error.message);
  }

  const { template, created, branches } = result;
  console.log(
    `template  ${templateName} (${template.label}) - ${created ? "materialized" : "already present"}`,
  );
  console.log(`  branches ${branches.join(", ")}`);

  if (args.includes("--verify")) {
    // Runs on whatever branch is checked out, which is `main` after a fresh
    // materialization. A break branch is expected to fail, so verifying one is
    // only meaningful with the expectation inverted - hence the branch check.
    const branch = currentBranch(targetDir);
    const expectFailure = branch.startsWith("break/");
    const checks = runTemplateChecks({ dir: targetDir, template, expectFailure });
    const steps = checks.steps.map((step) => `${step.label}:${step.status}`).join(" ") || "-";
    console.log(`  verify   ${branch} → ${checks.status}  ${steps}`);
    if (checks.status === "skipped") {
      console.log(`           ${checks.reason} (the repo is still usable, only the build is not)`);
    }
    if (checks.status === "failed" || checks.status === "unexpectedly-passed") {
      const failed = checks.steps.find((step) => step.status === "failed");
      if (failed) {
        console.log(`           ${failed.output.split("\n").slice(-3).join(" / ").slice(0, 200)}`);
      }
      fail(
        checks.status === "failed"
          ? `Template "${templateName}" does not build green on ${branch}.`
          : `Break branch ${branch} built clean - the error scenario has stopped working.`,
      );
    }
  }

  return targetDir;
}

function currentBranch(dir) {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

function resolveModelSelection() {
  const raw = flag("--model") ?? "haiku";
  const alias = MODEL_ALIASES[raw];
  if (alias) {
    return alias;
  }
  const provider = flag("--provider");
  if (!provider) {
    fail(
      `--model "${raw}" is not a known alias (${Object.keys(MODEL_ALIASES).join(", ")}). ` +
        `Pass --provider <id> alongside a raw model id.`,
    );
  }
  return { provider, model: raw, label: raw };
}

async function connectDaemonClient() {
  const clientEntry = path.join(repoRoot, "packages", "client", "dist", "daemon-client.js");
  if (!existsSync(clientEntry)) {
    fail(`Missing ${clientEntry}. Run "npm run build:client" first.`);
  }
  const { DaemonClient } = await import(pathToFileURL(clientEntry).href);
  const { WebSocket } = require("ws");
  const { version } = require(path.join(repoRoot, "package.json"));

  const client = new DaemonClient({
    url: `ws://${host}/ws`,
    clientId: `dev-agent-bootstrap-${process.pid}`,
    clientType: "cli",
    appVersion: version,
    webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
  });
  await client.connect();
  return client;
}

async function addPlaybookProject(client, projectPath) {
  const added = await client.addProject(projectPath);
  if (added.error) {
    fail(`project.add failed: ${added.error}`);
  }
  // Project descriptors key their id as `projectId`; workspace descriptors use
  // plain `id`. Easy to conflate - they are different payload schemas. A
  // project's id is its normalized root path, so only the path is worth printing.
  console.log(`project   ${added.project?.projectRootPath ?? projectPath}`);
  return added.project?.projectId ?? null;
}

// `open_project`, not `workspace.create`. The two differ in exactly the way that
// matters to a re-runnable playbook: workspace.create never deduplicates by
// directory and the daemon rejects a second workspace on a directory that already
// backs one, so a second run of this stage would fail. open_project is
// find-or-create, which is what "put Otto in this state" means.
//
// `--branch` takes the other road deliberately: an otto worktree, which is what
// makes the git surface real - a fork-point diff base, commit, rollback, file
// history, blame, branch switch, merge-into-base, archive-with-branch-cleanup.
// A worktree per branch is inherently one-per-branch, so re-running is handled by
// treating "already exists" as the state having been reached.
async function openPlaybookWorkspace(client, projectPath) {
  const branch = flag("--branch");
  if (!branch) {
    const opened = await client.openProject(projectPath);
    if (opened.error) {
      fail(`open_project failed: ${opened.error}`);
    }
    const workspaceId = opened.workspace?.id ?? null;
    console.log(`workspace ${workspaceId ?? "(no id returned)"}  (directory)`);
    return workspaceId;
  }

  // An existing ref is checked out; a new name is branched off the current base.
  const exists = listBranches(projectPath).includes(branch);
  const created = await client.createWorkspace({
    source: {
      kind: "worktree",
      cwd: projectPath,
      action: exists ? "checkout" : "branch-off",
      refName: branch,
    },
  });
  if (created.error) {
    if (/exist|already/i.test(created.error)) {
      console.log(`workspace (already on ${branch}) - ${created.error}`);
      return null;
    }
    fail(`workspace.create failed: ${created.error}`);
  }
  console.log(
    `workspace ${created.workspace?.id ?? "(no id returned)"}  ` +
      `(worktree ${exists ? "checkout" : "branch-off"} ${branch})`,
  );
  return created.workspace?.id ?? null;
}

// Custom providers (`openai-compatible`, and anything else declared under
// `agents.providers` in config.json) are turned into a provider registry once, at
// daemon startup. Seeding the config of an already-running lane therefore leaves
// the daemon unaware of them, and createAgent fails with a bare "Unknown
// provider" that gives no hint about why. Check first and say the actual fix.
async function assertProviderRegistered(client, provider) {
  const { providers } = await client.listAvailableProviders();
  const ids = (providers ?? []).map((entry) => entry.provider);
  if (ids.includes(provider)) {
    return;
  }
  const declared = readJson(path.join(targetHome, "config.json"))?.agents?.providers ?? {};
  const hint = Object.hasOwn(declared, provider)
    ? `config.json declares it, so the running daemon is stale - restart the lane ` +
      `(providers are read once, at daemon startup).`
    : `Nothing declares it. Seed it first: npm run dev:agent:bootstrap -- --force`;
  fail(`Daemon on ${host} has no provider "${provider}". Registered: ${ids.join(", ")}.\n${hint}`);
}

async function createPlaybookChat(client, projectPath, workspaceId) {
  const selection = resolveModelSelection();
  await assertProviderRegistered(client, selection.provider);
  const prompt = flag("--prompt");
  const snapshot = await client.createAgent({
    provider: selection.provider,
    cwd: projectPath,
    model: selection.model,
    ...(workspaceId ? { workspaceId } : {}),
    ...(prompt ? { initialPrompt: prompt } : {}),
  });
  // createAgent resolves to the agent snapshot itself, not a wrapper.
  const agentId = snapshot?.id ?? null;
  console.log(
    `chat      ${agentId ?? "(no id returned)"}  ${selection.provider} / ${selection.label}` +
      `${prompt ? " - prompted" : ""}`,
  );
  return agentId;
}

// A scenario has to be reachable without the previous one in the way. Reset does
// that over RPCs rather than by deleting files, which is what lets it run with the
// lane *up* - stopping and restarting a daemon to get a clean slate is the friction
// this whole script exists to remove.
//
// Order matters: agents reference workspaces, workspaces reference projects. Going
// the other way leaves the daemon reconciling records whose parents just vanished.
async function resetLaneState(client) {
  // Reset deletes. It may only ever point at a managed dev home - never `~/.otto`,
  // never a path someone passed in. This guard is the reason default-on is safe.
  const managedRoot = path.join(devStateDir, "");
  if (!path.resolve(targetHome).startsWith(path.resolve(managedRoot))) {
    fail(
      `Refusing to reset ${targetHome}: it is outside ${managedRoot}. Reset only ever ` +
        `touches a managed lane home, so it can never reach the installed app's state.`,
    );
  }

  // Enumeration failures are NOT swallowed. A reset that quietly finds nothing looks
  // like a clean slate and is not one, which is the single most confusing way this
  // could fail. Deletions below are best-effort by contrast: a record that is already
  // gone, or that a cascade removed a moment earlier, is the desired outcome.
  //
  // No `scope`: the field is the enum "active", so a default fetch is what returns
  // everything. Page limit is the schema maximum - a lane with more than 200 chats is
  // not a lane anyone is reasoning about.
  const agents = await client.fetchAgents({ page: { limit: 200 } });
  const agentIds = (agents.entries ?? []).map((entry) => entry.agent?.id).filter(Boolean);
  for (const agentId of agentIds) {
    await client.deleteAgent(agentId).catch(() => {});
  }

  const workspaces = await client.fetchWorkspaces({ page: { limit: 200 } });
  const workspaceEntries = workspaces.entries ?? [];
  for (const workspace of workspaceEntries) {
    // `delete` on the leftover branch: a worktree workspace that is archived while
    // keeping its branch leaves a ref that blocks re-cutting the same branch next run.
    await client.archiveWorkspace(workspace.id, { branchDisposition: "delete" }).catch(() => {});
  }

  const projectIds = new Set([
    ...workspaceEntries.map((workspace) => workspace.projectId),
    ...(workspaces.emptyProjects ?? []).map((project) => project.projectId),
  ]);
  for (const projectId of projectIds) {
    if (!projectId) continue;
    await client.removeProject(projectId).catch(() => {});
  }

  // The sandbox repos themselves. Templates are re-materialized from the corpus, so
  // nothing here is a loss - and leaving them means a stale worktree registration
  // can survive the daemon-side reset.
  const sandboxRoot = path.join(devStateDir, "agent-sandbox");
  if (existsSync(sandboxRoot)) {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }

  console.log(
    `reset     ${agentIds.length} chat(s), ${workspaceEntries.length} workspace(s), ` +
      `${projectIds.size} project(s), and the sandbox`,
  );
}

async function runDaemonStages() {
  if (!(await isPortListening(host))) {
    fail(
      `No daemon listening on ${host}. Stage "${stage}" creates daemon-owned records, ` +
        `so start the lane first (npm run dev:win:agent) and re-run.`,
    );
  }

  const client = await connectDaemonClient();
  if (!args.includes("--keep")) {
    await resetLaneState(client);
  }

  // Materialized after the reset, which deletes the sandbox tree.
  const projectPath = ensureSandboxProject();

  try {
    await addPlaybookProject(client, projectPath);
    const workspaceId = stageAtLeast("workspace")
      ? await openPlaybookWorkspace(client, projectPath)
      : null;
    if (stageAtLeast("chat")) {
      await createPlaybookChat(client, projectPath, workspaceId);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Client half - the printed snippet
// ---------------------------------------------------------------------------

// `fresh` clears the flags; every other stage sets them. Note they must be set
// to `true` explicitly: migrateSetupWizardFlag only treats a device as an
// upgrader when the field is *absent*, and the app writes a full settings blob
// with `false` on first boot - so seeding an empty blob does not skip the wizard.
function printClientSnippet() {
  const metroPort = process.env.OTTO_AGENT_METRO_PORT ?? "8095";
  const mutation =
    stage === "fresh"
      ? "localStorage.removeItem(k); return true;"
      : 'const s = JSON.parse(localStorage.getItem(k) || "{}");\n' +
        '    Object.assign(s, { hasCompletedSetupWizard: true, hasCompletedTutorial: true, interfaceMode: "developer" });\n' +
        "    localStorage.setItem(k, JSON.stringify(s));\n" +
        "    return s.hasCompletedSetupWizard;";

  console.log(
    [
      "",
      `Client-side half - run this once in the browser pane on http://localhost:${metroPort},`,
      stage === "fresh"
        ? "then reload. It clears the wizard and tour flags so the app boots into the"
        : "then reload. It sets the wizard and tour flags so the app skips straight to the",
      stage === "fresh"
        ? "first-run experience:"
        : "workspace. They live in localStorage, not OTTO_HOME:",
      "",
      "  (() => {",
      '    const k = "@otto:app-settings";',
      `    ${mutation}`,
      "  })()",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------

console.log(`stage: ${stage} (${stageIndex + 1}/${STAGES.length})`);

if (stage === "fresh") {
  if (await isPortListening(host)) {
    fail(
      `A daemon is listening on ${host}. Stage "fresh" deletes registries the running ` +
        `daemon holds in memory and would rewrite, so stop the lane first.`,
    );
  }
  runFresh();
} else {
  runDefaults();
  if (stageAtLeast("project")) {
    await runDaemonStages();
  }
}

printClientSnippet();

if (!existsSync(path.join(targetHome, "server-id"))) {
  console.log("Note: no server-id yet - start the lane once so the daemon mints its identity.");
}
