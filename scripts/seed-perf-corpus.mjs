#!/usr/bin/env node
// Seeds the performance-test conversation corpus into a running dev daemon, and
// leaves it there.
//
// This is the half of the corpus you open by hand. The soak measures numbers; this
// one exists so the slowness can be *felt* - several projects in the sidebar, each
// with worktree workspaces, each holding a dozen chats hundreds of messages long,
// which is the shape users describe when they say Otto gets slow with a lot open.
//
// Usage:
//   node scripts/seed-perf-corpus.mjs                 # full default corpus
//   node scripts/seed-perf-corpus.mjs --smoke         # 1x1x1, to check the wiring
//   node scripts/seed-perf-corpus.mjs --clean         # remove a previous corpus first
//   OTTO_CORPUS_CHATS=4 node scripts/seed-perf-corpus.mjs
//
// Port: OTTO_DAEMON_PORT, else OTTO_DEV_DAEMON_PORT, else 6788. Never 6868 - that
// is the installed app's daemon over ~/.otto, and seeding hundreds of synthetic
// chats into the daemon that manages someone's real agents is not recoverable by
// undo. The guard below refuses it outright rather than warning.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import {
  DEFAULT_CORPUS_SCALE,
  SMOKE_CORPUS_SCALE,
  scaleFromEnv,
  seedPerfCorpus,
} from "./perf-corpus.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The repos live beside the dev home rather than in a temp dir, so re-running is
// cheap and the projects stay where you left them.
//
// **The conversations are NOT durable, only the repos are.** Agent timelines live
// in daemon memory and nothing restores them on startup, so bouncing the daemon
// leaves every chat empty while the agent records remain on disk. Plan around it:
// seed, then measure without restarting the daemon. If you do restart, re-seed --
// and the seeder will tell you, because it now verifies content instead of
// assuming an agent that exists has messages.
const CORPUS_ROOT = path.join(repoRoot, "packages", "desktop", ".dev", "perf-corpus");

const PROJECT_NAMES = [
  "atlas-api",
  "beacon-web",
  "cirrus-worker",
  "delta-mobile",
  "echo-tooling",
  "fathom-docs",
  "gantry-infra",
  "harbor-cli",
];

function resolveDaemonPort() {
  const port = process.env.OTTO_DAEMON_PORT ?? process.env.OTTO_DEV_DAEMON_PORT ?? "6788";
  if (port === "6868") {
    throw new Error(
      "Refusing to seed the corpus into port 6868: that is the installed app's daemon over ~/.otto. " +
        "Start a dev daemon and set OTTO_DAEMON_PORT to its port.",
    );
  }
  return port;
}

function loadAppVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Missing version in the root package.json");
  }
  return packageJson.version;
}

async function connectDaemonClient(port) {
  const clientPath = path.join(repoRoot, "packages", "client", "dist", "daemon-client.js");
  if (!existsSync(clientPath)) {
    throw new Error(`${clientPath} is missing. Run \`npm run build:client\` first.`);
  }
  const { DaemonClient } = await import(pathToFileURL(clientPath).href);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId: `perf-corpus-${randomUUID()}`,
    clientType: "cli",
    appVersion: loadAppVersion(),
    webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
  });
  await client.connect();
  return client;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A project the file tree, editor and diff views have something to chew on, but
// no build: the corpus measures how Otto handles conversation and workspace
// volume, and a real toolchain would only add minutes of setup to every run.
function writeProjectFiles(dir, name) {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "README.md"),
    `# ${name}\n\nA synthetic project in Otto's performance-test corpus.\nSee docs/client-performance.md.\n`,
  );
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0", private: true }, null, 2)}\n`,
  );
  for (let index = 0; index < 6; index += 1) {
    writeFileSync(
      path.join(dir, "src", `module-${index}.ts`),
      `export interface Module${index}Options {\n  id: string;\n  retries: number;\n}\n\n` +
        `export function runModule${index}(options: Module${index}Options): string {\n` +
        `  return \`\${options.id}:\${options.retries}\`;\n}\n`,
    );
  }
}

function materializeProjects(count) {
  mkdirSync(CORPUS_ROOT, { recursive: true });
  const projects = [];
  for (let index = 0; index < count; index += 1) {
    const name =
      PROJECT_NAMES[index % PROJECT_NAMES.length] +
      (index >= PROJECT_NAMES.length ? `-${index}` : "");
    const rootPath = path.join(CORPUS_ROOT, name);
    // An existing repo is left alone. Re-running the seeder should add chats to a
    // corpus, not spend a minute rebuilding directories that did not change.
    if (!existsSync(path.join(rootPath, ".git"))) {
      mkdirSync(rootPath, { recursive: true });
      writeProjectFiles(rootPath, name);
      git(rootPath, "init", "-b", "main");
      git(rootPath, "add", "-A");
      git(
        rootPath,
        "-c",
        "user.name=Otto Perf Corpus",
        "-c",
        "user.email=perf@otto.local",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        `feat: ${name} scaffold`,
      );
    }
    projects.push({ rootPath, label: name });
  }
  return projects;
}

// --clean has to reach the daemon as well as the disk. Removing only the repos
// leaves the workspace and agent records behind, and the next run adopts those
// orphans as if they were corpus chats -- so a "clean" run would silently
// measure against the previous corpus. Scoped to workspaces under CORPUS_ROOT so
// nothing outside the corpus can be caught by it.
async function removeCorpusFromDaemon(client) {
  const corpusPrefix = CORPUS_ROOT.replaceAll("\\", "/").toLowerCase();
  const workspaces = await client.fetchWorkspaces().catch(() => ({ entries: [] }));
  const projectIds = new Set();
  for (const entry of workspaces?.entries ?? []) {
    const root = (entry.projectRootPath ?? "").replaceAll("\\", "/").toLowerCase();
    const directory = (entry.workspaceDirectory ?? "").replaceAll("\\", "/").toLowerCase();
    if (root.startsWith(corpusPrefix) || directory.startsWith(corpusPrefix)) {
      projectIds.add(entry.projectId);
    }
  }
  for (const projectId of projectIds) {
    await client.removeProject(projectId).catch(() => undefined);
  }
  if (projectIds.size > 0) {
    console.log(`Removed ${projectIds.size} corpus project(s) from the daemon`);
  }
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const smoke = flags.has("--smoke");
  const clean = flags.has("--clean");
  const port = resolveDaemonPort();

  const scale = scaleFromEnv(process.env, smoke ? SMOKE_CORPUS_SCALE : DEFAULT_CORPUS_SCALE);
  const expectedChats = scale.projects * scale.workspacesPerProject * scale.chatsPerWorkspace;
  console.log(
    `Seeding ${scale.projects} projects x ${scale.workspacesPerProject} workspaces x ` +
      `${scale.chatsPerWorkspace} chats x ${scale.turnsPerChat} turns of ${scale.itemsPerTurn} items ` +
      `(${expectedChats} chats, ~${(expectedChats * scale.turnsPerChat * scale.itemsPerTurn).toLocaleString()} items) ` +
      `into the daemon on :${port}`,
  );

  const client = await connectDaemonClient(port);
  try {
    if (clean) {
      await removeCorpusFromDaemon(client);
      if (existsSync(CORPUS_ROOT)) {
        rmSync(CORPUS_ROOT, { recursive: true, force: true });
        console.log(`Removed ${CORPUS_ROOT}`);
      }
    }

    const projects = materializeProjects(scale.projects);
    const corpus = await seedPerfCorpus({
      client,
      projects,
      scale,
      concurrency: Number(process.env.OTTO_CORPUS_CONCURRENCY ?? "6"),
      onProgress: (event) => {
        if (event.level === "warn") {
          console.warn(`  ! ${event.detail}`);
          return;
        }
        if (event.phase === "project") {
          console.log(`  [${event.done}/${event.total}] ${event.detail}`);
          return;
        }
        if (event.phase === "chat" && event.done % 10 === 0) {
          console.log(`      ${event.detail}: ${event.done}/${event.total} chats`);
        }
      },
    });

    const { totals } = corpus;
    console.log(
      `\nCorpus: ${totals.chats} chats across ${totals.workspaces} workspaces in ` +
        `${totals.projects} projects (~${totals.items.toLocaleString()} timeline items).`,
    );
    console.log(
      `This run created ${totals.chatsCreated} chats (${totals.turnsDriven} turns, ` +
        `${totals.itemsCreated.toLocaleString()} items) and adopted ${totals.chatsAdopted} ` +
        `in ${formatDuration(corpus.elapsedMs)}.`,
    );
    console.log(
      `Corpus seed ${corpus.corpusSeed}; re-seeding the same scale reproduces it exactly.`,
    );
    console.log(`Repos: ${CORPUS_ROOT}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
