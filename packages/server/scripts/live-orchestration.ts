// Loop B - parameterized live orchestration harness.
//
// Stands up an in-process daemon on the CURRENT source with REAL providers,
// seeded from an existing Otto home's config (personalities + teams + provider
// auth), activates a team, spawns a conductor personality that drives start_workflow,
// and reports the full circle (conductor's final message + every persisted Run).
// In-process teardown - no supervisor, no orphan daemon, random free port, so it
// never touches the main daemon on 6868 or the desktop daemon on 6788.
//
// Usage (from repo root):
//   npm run live:orchestration -- --prompt "Use start_workflow: ..." [options]
//
// Options:
//   --prompt <text>       Conductor task (default: a haiku→note 2-phase plan)
//   --personality <name>  Conductor personality (default: Atlas)
//   --team <substr>       Active team name substring (default: "crew")
//   --cwd <path>          Working dir for the run (default: repo root)
//   --home <path>         Source Otto home to seed config from
//                         (default: packages/desktop/.dev/otto-home)
//   --timeout <seconds>   Max wait for the conductor (default: 300)
//   --bootstrap-sonnet    Add an ephemeral Sonnet 5 low-effort conductor +
//                         researcher team to the copied harness config
//   --bootstrap-codex-luna Add an ephemeral Codex Luna low-effort conductor
//                         team to the copied harness config
//   --bootstrap-openai-compatible-fixture Add a deterministic loopback
//                         OpenAI-compatible conductor + worker team. This is
//                         a no-cost adapter proof, not local-model evidence.
//   --approve-gate        Approve the first declared attended gate before the
//                         isolated daemon reports its terminal run
//   --keep                Keep the temp home for inspection (prints its path)
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createOttoDaemon } from "../src/server/bootstrap.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import { DaemonClient } from "../src/server/test-utils/daemon-client.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

interface Args {
  prompt: string;
  personality: string;
  team: string;
  cwd: string;
  home: string;
  timeoutMs: number;
  bootstrapSonnet: boolean;
  bootstrapCodexLuna: boolean;
  bootstrapOpenAICompatibleFixture: boolean;
  approveGate: boolean;
  keep: boolean;
}

const LIVE_SONNET_CONDUCTOR_NAME = "Workflow T3 Sonnet Conductor";
const LIVE_SONNET_RESEARCHER_NAME = "Workflow T3 Sonnet Researcher";
const LIVE_SONNET_TEAM_NAME = "Workflow T3 Sonnet";
const LIVE_CODEX_LUNA_CONDUCTOR_NAME = "Workflow T4 Codex Luna Conductor";
const LIVE_CODEX_LUNA_TEAM_NAME = "Workflow T4 Codex Luna";
const LOCAL_OPENAI_COMPAT_CONDUCTOR_NAME = "Workflow Local OpenAI Conductor";
const LOCAL_OPENAI_COMPAT_RESEARCHER_NAME = "Workflow Local OpenAI Researcher";
const LOCAL_OPENAI_COMPAT_TEAM_NAME = "Workflow Local OpenAI Compatible";
const LOCAL_OPENAI_COMPAT_PROVIDER_ID = "workflow-local-openai-compatible";
const LOCAL_OPENAI_COMPAT_CONDUCTOR_MODEL = "workflow-local-conductor";
const LOCAL_OPENAI_COMPAT_RESEARCHER_MODEL = "workflow-local-researcher";

const DEFAULT_PROMPT =
  "Use the start_workflow tool to run this plan: phase 1 implement - write a haiku about caching; " +
  "phase 2 deliver (depends on phase 1) - combine it into a short note. " +
  "After the run finishes, report the run id and paste the final note verbatim.";

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bootstrapSonnet = argv.includes("--bootstrap-sonnet");
  const bootstrapCodexLuna = argv.includes("--bootstrap-codex-luna");
  const bootstrapOpenAICompatibleFixture = argv.includes("--bootstrap-openai-compatible-fixture");
  if (
    [bootstrapSonnet, bootstrapCodexLuna, bootstrapOpenAICompatibleFixture].filter(Boolean).length >
    1
  ) {
    throw new Error("Choose only one live provider fixture.");
  }
  let bootstrapName = "Atlas";
  let bootstrapTeam = "crew";
  if (bootstrapSonnet) {
    bootstrapName = LIVE_SONNET_CONDUCTOR_NAME;
    bootstrapTeam = LIVE_SONNET_TEAM_NAME;
  } else if (bootstrapCodexLuna) {
    bootstrapName = LIVE_CODEX_LUNA_CONDUCTOR_NAME;
    bootstrapTeam = LIVE_CODEX_LUNA_TEAM_NAME;
  } else if (bootstrapOpenAICompatibleFixture) {
    bootstrapName = LOCAL_OPENAI_COMPAT_CONDUCTOR_NAME;
    bootstrapTeam = LOCAL_OPENAI_COMPAT_TEAM_NAME;
  }
  return {
    prompt: get("--prompt") ?? DEFAULT_PROMPT,
    personality: get("--personality") ?? bootstrapName,
    team: get("--team") ?? bootstrapTeam,
    cwd: get("--cwd") ?? REPO_ROOT,
    home: get("--home") ?? path.join(REPO_ROOT, "packages/desktop/.dev/otto-home"),
    timeoutMs: Number(get("--timeout") ?? "300") * 1000,
    bootstrapSonnet,
    bootstrapCodexLuna,
    bootstrapOpenAICompatibleFixture,
    approveGate: argv.includes("--approve-gate"),
    keep: argv.includes("--keep"),
  };
}

function log(section: string, body: unknown): void {
  console.log(`\n===== ${section} =====`);
  console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

async function seedHome(
  sourceHome: string,
  bootstrapSonnet: boolean,
  bootstrapCodexLuna: boolean,
  localOpenAICompatibleBaseUrl: string | null,
): Promise<{ root: string; ottoHome: string; staticDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-liveB-"));
  const ottoHome = path.join(root, ".otto");
  const staticDir = path.join(root, "static");
  await mkdir(ottoHome, { recursive: true });
  await mkdir(staticDir, { recursive: true });
  const configPath = path.join(ottoHome, "config.json");
  // The no-cost adapter fixture must not inherit a developer's provider,
  // connector, MCP, or Brain configuration. The paid fixtures intentionally
  // copy that configuration because they need the owner's provider auth.
  if (localOpenAICompatibleBaseUrl) {
    await writeFile(configPath, "{}\n");
  } else {
    await cp(path.join(sourceHome, "config.json"), configPath);
  }
  if (bootstrapSonnet) {
    await bootstrapSonnetConfig(configPath);
  }
  if (bootstrapCodexLuna) {
    await bootstrapCodexLunaConfig(configPath);
  }
  if (localOpenAICompatibleBaseUrl) {
    await bootstrapLocalOpenAICompatibleConfig(configPath, localOpenAICompatibleBaseUrl);
  }
  return { root, ottoHome, staticDir };
}

async function startDaemon(ottoHome: string, staticDir: string) {
  const persisted = loadPersistedConfig(ottoHome);
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
      ...(persisted.daemon?.agentProfiles ? { agentProfiles: persisted.daemon.agentProfiles } : {}),
      ...(persisted.agents?.agentTeams ? { agentTeams: persisted.agents.agentTeams } : {}),
      ...(persisted.agents?.providers ? { providerOverrides: persisted.agents.providers } : {}),
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

async function waitForPausedGate(
  client: DaemonClient,
  timeoutMs: number,
): Promise<{ runId: string; phaseId: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = (await client.getRunsSnapshot()).find((candidate) => candidate.status === "paused");
    const phase = run?.phases.find(
      (candidate) => candidate.type === "gate" && candidate.status === "blocked",
    );
    if (run && phase) return { runId: run.id, phaseId: phase.id };
    if (Date.now() >= deadline) throw new Error("timed out waiting for an attended Workflow gate");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitForTerminalRun(
  client: DaemonClient,
  runId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = (await client.getRunsSnapshot()).find((candidate) => candidate.id === runId);
    if (run && ["done", "failed", "canceled"].includes(run.status)) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for terminal run ${runId}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
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
    log(`RUN ${run.id} - ${run.status}`, {
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

/**
 * The live proof must not depend on a developer's saved team. This opt-in
 * fixture is written only to the copied home used by this process, then removed
 * with it. Keeping it in the harness makes the paid proof repeatable while
 * leaving both the installed and development daemons untouched.
 */
async function bootstrapSonnetConfig(configPath: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const agents = (config.agents as Record<string, unknown> | undefined) ?? {};
  const existingProfiles = (daemon.agentProfiles as unknown[] | undefined) ?? [];
  const existingTeams = (agents.agentTeams as { teams?: unknown[] } | undefined)?.teams ?? [];
  const conductorId = "live-workflow-t3-sonnet-conductor";
  const researcherId = "live-workflow-t3-sonnet-researcher";
  const teamId = "live-workflow-t3-sonnet";
  const profiles = existingProfiles.filter(
    (profile) =>
      typeof profile !== "object" ||
      profile === null ||
      ((profile as { id?: unknown }).id !== conductorId &&
        (profile as { id?: unknown }).id !== researcherId),
  );
  const teams = existingTeams.filter(
    (team) => typeof team !== "object" || team === null || (team as { id?: unknown }).id !== teamId,
  );

  daemon.agentProfiles = [
    ...profiles,
    {
      id: conductorId,
      name: LIVE_SONNET_CONDUCTOR_NAME,
      provider: "claude",
      model: "claude-sonnet-5",
      effortLevel: "low",
      roles: ["orchestrator"],
      personalityPrompt:
        "You are the isolated Workflow proof conductor. Follow the user's explicit test instruction exactly. Do not perform the work yourself: use Otto's start_workflow tool once to declare the requested plan, then relay its outcome.",
    },
    {
      id: researcherId,
      name: LIVE_SONNET_RESEARCHER_NAME,
      provider: "claude",
      model: "claude-sonnet-5",
      effortLevel: "low",
      roles: ["researcher"],
      personalityPrompt:
        "You are a concise Workflow research worker in an isolated proof. Complete only the assigned task, do not edit files, do not launch agents, and return the requested result directly.",
    },
  ];
  agents.agentTeams = {
    ...(agents.agentTeams as Record<string, unknown> | undefined),
    teams: [
      ...teams,
      { id: teamId, name: LIVE_SONNET_TEAM_NAME, memberIds: [conductorId, researcherId] },
    ],
    activeTeamId: teamId,
  };
  config.daemon = daemon;
  config.agents = agents;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function bootstrapCodexLunaConfig(configPath: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const agents = (config.agents as Record<string, unknown> | undefined) ?? {};
  const existingProfiles = (daemon.agentProfiles as unknown[] | undefined) ?? [];
  const existingTeams = (agents.agentTeams as { teams?: unknown[] } | undefined)?.teams ?? [];
  const conductorId = "live-workflow-t4-codex-luna-conductor";
  const teamId = "live-workflow-t4-codex-luna";
  daemon.agentProfiles = [
    ...existingProfiles.filter(
      (profile) =>
        typeof profile !== "object" ||
        profile === null ||
        (profile as { id?: unknown }).id !== conductorId,
    ),
    {
      id: conductorId,
      name: LIVE_CODEX_LUNA_CONDUCTOR_NAME,
      provider: "codex",
      model: "gpt-5.6-luna",
      modeId: "full-access",
      effortLevel: "low",
      roles: ["orchestrator"],
      personalityPrompt:
        "You are the isolated Workflow proof conductor. Follow the user's explicit test instruction exactly. Do not perform the work yourself: use Otto's start_workflow tool once to declare the requested plan, then relay its outcome.",
    },
  ];
  agents.agentTeams = {
    ...(agents.agentTeams as Record<string, unknown> | undefined),
    teams: [
      ...existingTeams.filter(
        (team) =>
          typeof team !== "object" || team === null || (team as { id?: unknown }).id !== teamId,
      ),
      { id: teamId, name: LIVE_CODEX_LUNA_TEAM_NAME, memberIds: [conductorId] },
    ],
    activeTeamId: teamId,
  };
  config.daemon = daemon;
  config.agents = agents;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

interface LocalOpenAICompatibleFixture {
  baseUrl: string;
  completionRequests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

function writeSse(res: import("node:http").ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function startLocalOpenAICompatibleFixture(): Promise<LocalOpenAICompatibleFixture> {
  const completionRequests: Array<Record<string, unknown>> = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            { id: LOCAL_OPENAI_COMPAT_CONDUCTOR_MODEL },
            { id: LOCAL_OPENAI_COMPAT_RESEARCHER_MODEL },
          ],
        }),
      );
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    completionRequests.push(request);
    res.writeHead(200, { "Content-Type": "text/event-stream" });

    if (request.model === LOCAL_OPENAI_COMPAT_CONDUCTOR_MODEL) {
      const messages = Array.isArray(request.messages) ? request.messages : [];
      const hasToolResult = messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { role?: unknown }).role === "tool",
      );
      if (!hasToolResult) {
        writeSse(res, {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_local_workflow",
                    function: {
                      name: "start_workflow",
                      arguments: JSON.stringify({
                        title: "Local OpenAI-compatible Workflow proof",
                        description: "No-cost isolated daemon-owned declaration fixture.",
                        phases: [
                          {
                            id: "local-research",
                            type: "research",
                            title: "Local worker completion",
                            task: "Return exactly LOCAL WORKFLOW WORKER COMPLETED.",
                            fanOut: 1,
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      } else {
        writeSse(res, { choices: [{ delta: { content: "Workflow declaration accepted." } }] });
      }
    } else if (request.model === LOCAL_OPENAI_COMPAT_RESEARCHER_MODEL) {
      writeSse(res, {
        choices: [{ delta: { content: "LOCAL WORKFLOW WORKER COMPLETED" } }],
      });
    } else {
      writeSse(res, { choices: [{ delta: { content: "Unexpected fixture model." } }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    completionRequests,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function bootstrapLocalOpenAICompatibleConfig(
  configPath: string,
  baseUrl: string,
): Promise<void> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const agents = (config.agents as Record<string, unknown> | undefined) ?? {};
  const existingProfiles = (daemon.agentProfiles as unknown[] | undefined) ?? [];
  const existingTeams = (agents.agentTeams as { teams?: unknown[] } | undefined)?.teams ?? [];
  const conductorId = "workflow-local-openai-compatible-conductor";
  const researcherId = "workflow-local-openai-compatible-researcher";
  const teamId = "workflow-local-openai-compatible";
  daemon.agentProfiles = [
    ...existingProfiles.filter(
      (profile) =>
        typeof profile !== "object" ||
        profile === null ||
        ((profile as { id?: unknown }).id !== conductorId &&
          (profile as { id?: unknown }).id !== researcherId),
    ),
    {
      id: conductorId,
      name: LOCAL_OPENAI_COMPAT_CONDUCTOR_NAME,
      provider: LOCAL_OPENAI_COMPAT_PROVIDER_ID,
      model: LOCAL_OPENAI_COMPAT_CONDUCTOR_MODEL,
      modeId: "bypassPermissions",
      roles: ["orchestrator"],
      personalityPrompt:
        "You are an isolated no-cost Workflow proof conductor. Use start_workflow exactly once and relay the result.",
    },
    {
      id: researcherId,
      name: LOCAL_OPENAI_COMPAT_RESEARCHER_NAME,
      provider: LOCAL_OPENAI_COMPAT_PROVIDER_ID,
      model: LOCAL_OPENAI_COMPAT_RESEARCHER_MODEL,
      modeId: "bypassPermissions",
      roles: ["researcher"],
      personalityPrompt: "Return the assigned proof result directly.",
    },
  ];
  agents.providers = {
    ...(agents.providers as Record<string, unknown> | undefined),
    [LOCAL_OPENAI_COMPAT_PROVIDER_ID]: {
      extends: "openai-compatible",
      label: "Workflow Local OpenAI Compatible Fixture",
      env: { OPENAI_BASE_URL: baseUrl },
      maxToolRounds: 4,
    },
  };
  agents.agentTeams = {
    ...(agents.agentTeams as Record<string, unknown> | undefined),
    teams: [
      ...existingTeams.filter(
        (team) =>
          typeof team !== "object" || team === null || (team as { id?: unknown }).id !== teamId,
      ),
      // Deliberately omit the researcher role. The fixture proves the
      // recoverable branch without asking a real local model to produce a
      // worker answer or waiting on unrelated profile snapshot work.
      { id: teamId, name: LOCAL_OPENAI_COMPAT_TEAM_NAME, memberIds: [conductorId] },
    ],
    activeTeamId: teamId,
  };
  config.daemon = daemon;
  config.agents = agents;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function assertLocalOpenAICompatibleFixtureProof(input: {
  runs: readonly Record<string, unknown>[];
  completionRequests: readonly Record<string, unknown>[];
}): void {
  if (input.runs.length !== 1) {
    throw new Error(`Expected exactly one durable Workflow record, found ${input.runs.length}.`);
  }
  const [run] = input.runs;
  const phases = Array.isArray(run?.phases) ? run.phases : [];
  const phase = phases[0] as Record<string, unknown> | undefined;
  const candidates = Array.isArray(phase?.candidates) ? phase.candidates : [];
  const candidate = candidates[0] as Record<string, unknown> | undefined;
  const toolCallWasIssued = input.completionRequests.some((request) => {
    const tools = Array.isArray(request.tools) ? request.tools : [];
    return tools.some(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        (tool as { function?: { name?: unknown } }).function?.name === "start_workflow",
    );
  });
  if (
    run?.kind !== "ai" ||
    run?.status !== "failed" ||
    run?.agentCount !== 0 ||
    phase?.id !== "local-research" ||
    phase?.status !== "failed" ||
    candidate !== undefined ||
    !String(run?.error).includes("researcher") ||
    !toolCallWasIssued
  ) {
    throw new Error(
      "Local OpenAI-compatible fixture did not retain the declared Workflow and managed worker completion.",
    );
  }
}

async function waitForLocalFixtureTerminal(
  ottoHome: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runs = await readRuns(ottoHome);
    if (runs.length === 1 && ["done", "failed", "canceled"].includes(String(runs[0]?.status))) {
      return runs;
    }
    if (Date.now() >= deadline) return runs;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// The harness intentionally branches by provider fixture and preservation mode.
// oxlint-disable-next-line complexity
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const localOpenAICompatibleFixture = args.bootstrapOpenAICompatibleFixture
    ? await startLocalOpenAICompatibleFixture()
    : null;
  log("config", {
    personality: args.personality,
    team: args.team,
    cwd: args.cwd,
    sourceHome: args.home,
    bootstrapSonnet: args.bootstrapSonnet,
    bootstrapCodexLuna: args.bootstrapCodexLuna,
    bootstrapOpenAICompatibleFixture: args.bootstrapOpenAICompatibleFixture,
    approveGate: args.approveGate,
  });

  try {
    const { root, ottoHome, staticDir } = await seedHome(
      args.home,
      args.bootstrapSonnet,
      args.bootstrapCodexLuna,
      localOpenAICompatibleFixture?.baseUrl ?? null,
    );
    const { daemon, port } = await startDaemon(ottoHome, staticDir);
    log("daemon", `listening on 127.0.0.1:${port}`);

    const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.1.70" });
    await client.connect();
    if (!localOpenAICompatibleFixture) {
      await client.fetchAgents({ subscribe: { subscriptionId: "live-orch" } });
    }

    if (args.bootstrapSonnet) {
      log("bootstrap", "ephemeral Sonnet 5 low-effort Workflow team seeded into copied home");
    }
    if (args.bootstrapCodexLuna) {
      log("bootstrap", "ephemeral Codex Luna low-effort Workflow team seeded into copied home");
    }
    if (args.bootstrapOpenAICompatibleFixture) {
      log("bootstrap", "no-cost loopback OpenAI-compatible Workflow team seeded into copied home");
    }

    const { config } = await client.getDaemonConfig();
    const roster = config.agentProfiles ?? [];
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

    // The loopback proof is deliberately host- and provider-isolated. It does
    // not need a durable workspace record, and avoiding one avoids a catalog
    // warm-up for unrelated providers copied into ordinary paid fixtures.
    const workspace = localOpenAICompatibleFixture
      ? null
      : await client.createWorkspace({ source: { kind: "directory", path: args.cwd } });
    const agent = localOpenAICompatibleFixture
      ? await daemon.agentManager.createAgent(
          {
            provider: conductor.provider,
            model: conductor.model,
            modeId: conductor.modeId,
            cwd: args.cwd,
          },
          undefined,
          { workspaceId: undefined, initialTitle: conductor.name },
        )
      : await client.createAgent({
          provider: conductor.provider,
          model: conductor.model,
          personality: conductor.id,
          ...(conductor.modeId ? { modeId: conductor.modeId } : {}),
          cwd: workspace?.workspace?.workspaceDirectory ?? args.cwd,
          ...(workspace?.workspace?.id ? { workspaceId: workspace.workspace.id } : {}),
          initialPrompt: args.prompt,
        });
    if (localOpenAICompatibleFixture) {
      await daemon.agentManager.runAgent(agent.id, args.prompt);
    }
    log(
      "conductor spawned",
      `${agent.id} as ${conductor.name} (${conductor.provider}/${conductor.model})`,
    );

    let approvedGateRunId: string | null = null;
    if (args.approveGate) {
      const gate = await waitForPausedGate(client, args.timeoutMs);
      const accepted = await client.respondToRunGate({
        ...gate,
        approved: true,
        note: "Approved by the isolated live-provider proof.",
      });
      if (!accepted) throw new Error(`gate response was not accepted for ${gate.runId}`);
      approvedGateRunId = gate.runId;
      log("gate approved", gate);
    }

    const final = localOpenAICompatibleFixture
      ? daemon.agentManager.getAgent(agent.id)
      : await client.waitForAgentUpsert(
          agent.id,
          (s) => s.status === "idle" || s.status === "error",
          args.timeoutMs,
        );
    const message = await daemon.agentManager.getLastAssistantMessage(agent.id);
    log("conductor final status", final.status);
    log("CONDUCTOR FINAL MESSAGE", message ?? "(none)");
    if (approvedGateRunId) {
      await waitForTerminalRun(client, approvedGateRunId, args.timeoutMs);
    }
    // The deterministic loopback fixture proves declaration and worker lifecycle,
    // not summary-model behavior. Skipping the Writer keeps it entirely local.
    if (!localOpenAICompatibleFixture) {
      await waitForSummaries(ottoHome, 45_000);
    }
    const runs = localOpenAICompatibleFixture
      ? await waitForLocalFixtureTerminal(ottoHome, args.timeoutMs)
      : await readRuns(ottoHome);
    if (localOpenAICompatibleFixture) {
      assertLocalOpenAICompatibleFixtureProof({
        runs,
        completionRequests: localOpenAICompatibleFixture.completionRequests,
      });
      log(
        "fixture assertion",
        "one durable AI Workflow declaration and managed worker completion retained",
      );
    }
    await reportRuns(ottoHome);

    await client.close().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    if (args.keep) {
      log("kept temp home", ottoHome);
    } else {
      await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
      log("done", "daemon stopped, temp home cleaned");
    }
  } finally {
    await localOpenAICompatibleFixture?.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("live-orchestration FAILED:", err);
    process.exit(1);
  },
);
