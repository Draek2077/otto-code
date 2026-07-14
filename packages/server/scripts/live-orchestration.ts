// Loop B — parameterized live orchestration harness.
//
// Stands up an in-process daemon on the CURRENT source with REAL providers,
// seeded from an existing Otto home's config (personalities + teams + provider
// auth), activates a team, spawns a conductor personality that drives start_run,
// and reports the full circle (conductor's final message + every persisted Run).
// In-process teardown — no supervisor, no orphan daemon, random free port, so it
// never touches the main daemon on 6868 or the desktop daemon on 6788.
//
// Usage (from repo root):
//   npm run live:orchestration -- --prompt "Use start_run: ..." [options]
//
// Options:
//   --prompt <text>       Conductor task (default: a haiku→note 2-phase plan)
//   --personality <name>  Conductor personality (default: Atlas)
//   --team <substr>       Active team name substring (default: "crew")
//   --cwd <path>          Working dir for the run (default: repo root)
//   --home <path>         Source Otto home to seed config from
//                         (default: packages/desktop/.dev/otto-home)
//   --timeout <seconds>   Max wait for the conductor (default: 300)
//   --keep                Keep the temp home for inspection (prints its path)
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createOttoDaemon } from "../src/server/bootstrap.js";
import { DaemonClient } from "../src/server/test-utils/daemon-client.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

interface Args {
  prompt: string;
  personality: string;
  team: string;
  cwd: string;
  home: string;
  timeoutMs: number;
  keep: boolean;
}

const DEFAULT_PROMPT =
  "Use the start_run tool to run this plan: phase 1 implement — write a haiku about caching; " +
  "phase 2 deliver (depends on phase 1) — combine it into a short note. " +
  "After the run finishes, report the run id and paste the final note verbatim.";

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    prompt: get("--prompt") ?? DEFAULT_PROMPT,
    personality: get("--personality") ?? "Atlas",
    team: get("--team") ?? "crew",
    cwd: get("--cwd") ?? REPO_ROOT,
    home: get("--home") ?? path.join(REPO_ROOT, "packages/desktop/.dev/otto-home"),
    timeoutMs: Number(get("--timeout") ?? "300") * 1000,
    keep: argv.includes("--keep"),
  };
}

function log(section: string, body: unknown): void {
  console.log(`\n===== ${section} =====`);
  console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

async function seedHome(
  sourceHome: string,
): Promise<{ root: string; ottoHome: string; staticDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-liveB-"));
  const ottoHome = path.join(root, ".otto");
  const staticDir = path.join(root, "static");
  await mkdir(ottoHome, { recursive: true });
  await mkdir(staticDir, { recursive: true });
  await cp(path.join(sourceHome, "config.json"), path.join(ottoHome, "config.json"));
  return { root, ottoHome, staticDir };
}

async function startDaemon(ottoHome: string, staticDir: string) {
  const daemon = await createOttoDaemon(
    {
      listen: "127.0.0.1:0",
      ottoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      isDev: true,
      agentClients: {},
      agentStoragePath: path.join(ottoHome, "agents"),
      relayEnabled: false,
      relayEndpoint: "relay.otto-code.me:443",
      appBaseUrl: "https://app.otto-code.me",
    },
    pino({ level: "warn" }),
  );
  await daemon.start();
  const target = daemon.getListenTarget();
  const port = target && target.type === "tcp" ? target.port : null;
  if (!port) throw new Error("daemon did not bind a tcp port");
  return { daemon, port };
}

async function readRuns(ottoHome: string): Promise<Record<string, unknown>[]> {
  const runsDir = path.join(ottoHome, "runs");
  const files = await readdir(runsDir).catch(() => [] as string[]);
  const runs: Record<string, unknown>[] = [];
  for (const f of files) {
    runs.push(JSON.parse(await readFile(path.join(runsDir, f), "utf8")));
  }
  return runs;
}

// The Writer summary lands asynchronously after a run settles; poll until every
// terminal run has a summaryStatus (ready/failed) or the wait budget is spent.
async function waitForSummaries(ottoHome: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runs = await readRuns(ottoHome);
    const pending = runs.filter((r) => !r.summaryStatus || r.summaryStatus === "pending").length;
    if (pending === 0 || Date.now() >= deadline) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function reportRuns(ottoHome: string): Promise<void> {
  for (const run of await readRuns(ottoHome)) {
    const phases = (run.phases as Record<string, unknown>[]).map((ph) => {
      const candidates = ph.candidates as { summary?: string; verdict?: unknown }[] | undefined;
      return {
        id: ph.id,
        type: ph.type,
        status: ph.status,
        candidates: candidates?.length ?? 0,
        firstSummary: candidates?.[0]?.summary?.slice(0, 300),
      };
    });
    log(`RUN ${run.id} — ${run.status}`, {
      title: run.title,
      team: run.teamName,
      teamId: run.teamId,
      cwd: run.cwd,
      agentCount: run.agentCount,
      summaryStatus: run.summaryStatus,
      summary: run.summary,
      error: run.error,
      phases,
    });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  log("config", {
    personality: args.personality,
    team: args.team,
    cwd: args.cwd,
    sourceHome: args.home,
  });

  const { root, ottoHome, staticDir } = await seedHome(args.home);
  const { daemon, port } = await startDaemon(ottoHome, staticDir);
  log("daemon", `listening on 127.0.0.1:${port}`);

  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.1.70" });
  await client.connect();
  await client.fetchAgents({ subscribe: { subscriptionId: "live-orch" } });

  const { config } = await client.getDaemonConfig();
  const roster = config.agentPersonalities?.personalities ?? [];
  const conductor = roster.find((p) => p.name.toLowerCase() === args.personality.toLowerCase());
  if (!conductor) {
    throw new Error(
      `Personality "${args.personality}" not found. Roster: ${roster.map((p) => p.name).join(", ")}`,
    );
  }

  // activeTeamId is host-scoped and doesn't survive the config copy, so activate
  // the requested team explicitly (this is what gives phases their roles).
  const teams = config.agentTeams?.teams ?? [];
  const team =
    teams.find((t) => t.name.toLowerCase().includes(args.team.toLowerCase())) ?? teams[0];
  if (!team) throw new Error("no teams in the seeded config");
  await client.patchDaemonConfig({ agentTeams: { activeTeamId: team.id } });
  log("active team", `${team.name} (${team.id})`);
  log(
    "members",
    (team.memberIds ?? [])
      .map((id) => roster.find((p) => p.id === id))
      .filter((p): p is (typeof roster)[number] => Boolean(p))
      .map((p) => `${p.name} [${(p.roles ?? []).join(",")}]`)
      .join(", "),
  );

  const workspace = await client.createWorkspace({ source: { kind: "directory", path: args.cwd } });
  const agent = await client.createAgent({
    provider: conductor.provider,
    model: conductor.model,
    personality: conductor.id,
    ...(conductor.modeId ? { modeId: conductor.modeId } : {}),
    cwd: workspace.workspace?.workspaceDirectory ?? args.cwd,
    ...(workspace.workspace?.id ? { workspaceId: workspace.workspace.id } : {}),
    initialPrompt: args.prompt,
  });
  log(
    "conductor spawned",
    `${agent.id} as ${conductor.name} (${conductor.provider}/${conductor.model})`,
  );

  const final = await client.waitForAgentUpsert(
    agent.id,
    (s) => s.status === "idle" || s.status === "error",
    args.timeoutMs,
  );
  const message = await daemon.agentManager.getLastAssistantMessage(agent.id);
  log("conductor final status", final.status);
  log("CONDUCTOR FINAL MESSAGE", message ?? "(none)");
  // Give the async Writer summary a chance to land before reporting.
  await waitForSummaries(ottoHome, 45_000);
  await reportRuns(ottoHome);

  await client.close().catch(() => undefined);
  await daemon.stop().catch(() => undefined);
  if (args.keep) {
    log("kept temp home", ottoHome);
  } else {
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    log("done", "daemon stopped, temp home cleaned");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("live-orchestration FAILED:", err);
    process.exit(1);
  },
);
