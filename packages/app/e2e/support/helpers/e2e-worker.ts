import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forkOttoHomeMetadata, resolveOttoHomePath } from "./otto-home-fork";
import { stopRegisteredRestartedTestDaemon } from "./daemon-restart";
import { startIsolatedHostDaemon } from "./isolated-host-daemon";
import { injectLocalAiProvider, readLocalAiEnv } from "./local-ai-preflight";

export interface E2EWorker {
  close(): Promise<void>;
}

function resolveOptionalHome(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return resolveOttoHomePath(trimmed === "current" ? "~/.otto" : trimmed);
}

async function createFakeEditorBin(): Promise<string> {
  const binDir = await mkdtemp(path.join(tmpdir(), "otto-e2e-editor-bin-"));
  let realGhPath = "";
  try {
    realGhPath = execSync("which gh").toString().trim();
  } catch {
    // The local GitHub fixture remains usable without a system gh binary.
  }

  const fakeEditorSource = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const recordPath = process.env.OTTO_E2E_EDITOR_RECORD_PATH;
if (recordPath) {
  fs.appendFileSync(recordPath, JSON.stringify({
    command: path.basename(process.argv[1]),
    args: process.argv.slice(2),
    cwd: process.cwd(),
    at: Date.now()
  }) + "\\n");
}
`;
  for (const editorCommand of ["cursor", "code"]) {
    const editorPath = path.join(binDir, editorCommand);
    await writeFile(editorPath, fakeEditorSource);
    await chmod(editorPath, 0o755);
  }

  const fakeGhPath = path.join(binDir, "gh");
  const fakeGhSource = `#!/usr/bin/env node
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const fixtureRemote = "https://github.com/otto-e2e/local-fixture.git";
const origin = spawnSync("git", ["config", "--get", "remote.origin.url"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"]
}).stdout?.trim();

if (origin === fixtureRemote) {
  const command = args.slice(0, 2).join(" ");
  if (command === "auth status") process.exit(0);
  if (command === "repo view") {
    process.stdout.write(JSON.stringify({ owner: { login: "otto-e2e" }, name: "local-fixture", parent: null }));
    process.exit(0);
  }
  if (command === "issue list") {
    process.stdout.write("[]");
    process.exit(0);
  }
  if (command === "pr list" || command === "pr view") {
    const pr = {
      number: 1,
      title: "Use pasted PR as start ref",
      url: "https://github.com/otto-e2e/local-fixture/pull/1",
      state: "OPEN",
      body: null,
      labels: [],
      baseRefName: "main",
      headRefName: "pr-branch-1",
      updatedAt: "2026-01-01T00:00:00Z"
    };
    process.stdout.write(JSON.stringify(command === "pr list" ? [pr] : pr));
    process.exit(0);
  }
  if (command === "api graphql" && args.some((arg) => arg.includes("PullRequestCheckoutTarget"))) {
    process.stdout.write(JSON.stringify({
      data: { repository: { pullRequest: {
        number: 1,
        baseRefName: "main",
        headRefName: "pr-branch-1",
        isCrossRepository: false,
        headRepositoryOwner: { login: "otto-e2e" },
        headRepository: {
          sshUrl: "git@github.com:otto-e2e/local-fixture.git",
          url: fixtureRemote
        }
      } } }
    }));
    process.exit(0);
  }
  process.stderr.write("Unsupported local GitHub fixture command: " + args.join(" ") + "\\n");
  process.exit(1);
}

const realGhPath = ${JSON.stringify(realGhPath)};
if (!realGhPath) process.exit(127);
const result = spawnSync(realGhPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`;
  await writeFile(fakeGhPath, fakeGhSource);
  await chmod(fakeGhPath, 0o755);
  return binDir;
}

async function applyMetadataFork(targetHome: string, providerIds: string[]): Promise<void> {
  const sourceHome = resolveOptionalHome(process.env.E2E_FORK_OTTO_HOME_FROM);
  if (!sourceHome) return;
  const result = await forkOttoHomeMetadata({ sourceHome, targetHome });
  process.env.E2E_FORK_SOURCE_OTTO_HOME = result.sourceHome;
  process.env.E2E_FORK_TARGET_OTTO_HOME = result.targetHome;
  process.env.E2E_FORK_COPIED_FILES = String(result.copiedFiles);
  process.env.E2E_FORK_COPIED_BYTES = String(result.copiedBytes);

  if (providerIds.length === 0) return;

  const sourceConfig = JSON.parse(
    await readFile(path.join(result.sourceHome, "config.json"), "utf8"),
  );
  const sourceProviders = sourceConfig.agents?.providers ?? {};
  const providers = Object.fromEntries(
    providerIds.map((providerId: string) => {
      const provider = sourceProviders[providerId];
      if (!provider) {
        throw new Error(`E2E provider '${providerId}' is not configured in ${result.sourceHome}`);
      }
      return [providerId, provider];
    }),
  );
  await writeFile(
    path.join(targetHome, "config.json"),
    `${JSON.stringify({ version: 1, agents: { providers } }, null, 2)}\n`,
  );
}

/**
 * Starts the E2E host with an EMPTY personality roster and no teams.
 *
 * A fresh OTTO_HOME is seeded with the shipped starter team (Atlas, Sage, Dash,
 * ...), and every apply-now form surface then auto-binds its role's first
 * available personality: see `useFormRolePersonality`'s precedence ladder,
 * where tiers 1-3 outrank the device's last-used model on purpose. Those
 * builtins are all bound to Claude, which the E2E host has no credentials for,
 * so the whole suite would open its composers, schedule forms and artifact
 * sheets on an unusable provider instead of the deterministic mock one. The
 * daemon's Writer-role mini-tasks (chat auto-title) route the same way.
 *
 * The daemon only seeds when the persisted config has never carried the
 * section, so writing empty sections here is exactly the "user cleared the
 * roster" state - no seeding, no auto-bind. Specs that exercise personalities
 * and teams seed their own through `helpers/personalities.ts`, which is also
 * what makes their assertions deterministic.
 */
async function clearStarterPersonalities(targetHome: string): Promise<void> {
  const configPath = path.join(targetHome, "config.json");
  let existing: Record<string, unknown> = { version: 1 };
  if (existsSync(configPath)) {
    existing = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  }
  const agents = (existing.agents ??= {}) as Record<string, unknown>;
  agents.agentPersonalities = { personalities: [] };
  agents.agentTeams = { teams: [], activeTeamId: null };
  await writeFile(
    configPath,
    `${JSON.stringify(existing, null, 2)}
`,
  );
  console.log(`[e2e] Cleared the starter personality roster in ${configPath}`);
}

/**
 * Demo captures are recorded against an isolated, disposable host where the
 * operator has already approved browser access. Persist the two daemon gates
 * before startup so clicking Preview or Browser never interrupts a capture
 * with the normal trust dialog. Regular E2E and production hosts retain the
 * secure browser-tools-off default from docs/preview.md.
 */
async function enableDemoCaptureTools(targetHome: string): Promise<void> {
  if (process.env.E2E_DEMO_CAPTURE !== "1") {
    return;
  }

  const configPath = path.join(targetHome, "config.json");
  let existing: Record<string, unknown> = { version: 1 };
  if (existsSync(configPath)) {
    existing = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  }
  const daemon = (existing.daemon ??= {}) as Record<string, unknown>;
  const mcp = (daemon.mcp ??= {}) as Record<string, unknown>;
  mcp.injectIntoAgents = true;
  const browserTools = (daemon.browserTools ??= {}) as Record<string, unknown>;
  browserTools.enabled = true;
  await writeFile(
    configPath,
    `${JSON.stringify(existing, null, 2)}
`,
  );
  console.log(`[e2e] Enabled Browser Tools for demo capture in ${configPath}`);
}

export async function startE2EWorker(
  workerIndex: number,
  options: { forkProviders?: string[] } = {},
): Promise<E2EWorker> {
  const requestedRoot = resolveOptionalHome(process.env.E2E_OTTO_HOME);
  const ottoHome = requestedRoot
    ? path.join(requestedRoot, `worker-${workerIndex}`)
    : await mkdtemp(path.join(tmpdir(), `otto-e2e-worker-${workerIndex}-`));
  const preserveHome = Boolean(requestedRoot) || process.env.E2E_KEEP_OTTO_HOME === "1";
  const fakeEditorBin = await createFakeEditorBin();
  const editorRecordPath = path.join(ottoHome, "editor-open-records.jsonl");
  const serverId = `srv_e2e_worker_${workerIndex}`;
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";

  try {
    await applyMetadataFork(ottoHome, options.forkProviders ?? []);
    await clearStarterPersonalities(ottoHome);
    await enableDemoCaptureTools(ottoHome);
    const localAiConfig = readLocalAiEnv();
    if (localAiConfig) {
      await injectLocalAiProvider(ottoHome, localAiConfig);
    }
    const daemon = await startIsolatedHostDaemon(serverId, {
      ottoHome,
      preserveHome,
      environment: {
        NODE_ENV: "development",
        // On Windows the inherited env key is `Path`; adding a second `PATH` key
        // makes the child's resolved PATH unpredictable (git stops resolving), so
        // extend whichever key the parent process actually has.
        [pathKey]: `${fakeEditorBin}${path.delimiter}${process.env[pathKey] ?? ""}`,
        OTTO_E2E_EDITOR_RECORD_PATH: editorRecordPath,
      },
    });

    process.env.E2E_DAEMON_PORT = String(daemon.port);
    process.env.E2E_SERVER_ID = daemon.serverId;
    process.env.E2E_OTTO_HOME = daemon.ottoHome;
    process.env.E2E_EDITOR_RECORD_PATH = editorRecordPath;
    delete process.env.E2E_RELAY_PORT;
    delete process.env.E2E_RELAY_DAEMON_PUBLIC_KEY;

    console.log(
      `[e2e] Worker ${workerIndex} daemon started on port ${daemon.port}, home: ${daemon.ottoHome}`,
    );
    return {
      close: async () => {
        // A restart helper cannot update this fixture's original ChildProcess
        // handle. Reap its detached replacement only after every per-test
        // cleanup (including the dangling-project safety sweep) has run.
        await stopRegisteredRestartedTestDaemon();
        await daemon.close();
        await rm(fakeEditorBin, { recursive: true, force: true });
        console.log(`[e2e] Worker ${workerIndex} daemon stopped`);
      },
    };
  } catch (error) {
    await rm(fakeEditorBin, { recursive: true, force: true });
    if (!preserveHome) await rm(ottoHome, { recursive: true, force: true });
    throw error;
  }
}
