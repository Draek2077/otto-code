/**
 * Live, provider-neutral evaluation of Otto tool selection.
 *
 * Starts an isolated in-process daemon from a copy of an existing Otto home,
 * sends the same intent prompts through selected personality profiles, and
 * scores the actual Otto tool calls in each chat timeline. It never contacts
 * the installed daemon and deletes its temporary daemon home afterwards.
 *
 * Usage:
 *   npm run eval:otto-tools -- --home C:\\Users\\you\\.otto
 *   npm run eval:otto-tools -- --profiles luna,sonnet,qwen38 --timeout 180
 *   npm run eval:otto-tools -- --include-costly --keep --output .tmp/otto-tool-eval.json
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createOttoDaemon } from "../src/server/bootstrap.js";
import { DaemonClient } from "../src/server/test-utils/daemon-client.js";
import type { AgentTimelineItem } from "../src/server/agent/agent-sdk-types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

type ProfileKey = "luna" | "sonnet" | "qwen38";

interface Args {
  home: string;
  cwd: string;
  timeoutMs: number;
  profiles: ProfileKey[];
  includeCostly: boolean;
  keep: boolean;
  output?: string;
}

interface Personality {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
}

interface Scenario {
  id: string;
  prompt: string;
  expected: readonly string[];
  forbidden?: readonly string[];
  costly?: boolean;
}

interface CaseResult {
  profile: ProfileKey;
  personality: string;
  provider: string;
  model: string | null;
  scenario: string;
  expected: readonly string[];
  toolCalls: string[];
  passed: boolean;
  finalMessage: string | null;
  error?: string;
}

const PROFILE_MATCHERS: Record<ProfileKey, { provider: string; model: RegExp }> = {
  luna: { provider: "codex", model: /luna/i },
  sonnet: { provider: "claude", model: /sonnet/i },
  qwen38: { provider: "otto-brain", model: /qwen3\.8/i },
};

const SAFE_SCENARIOS: readonly Scenario[] = [
  {
    id: "deferred-follow-up",
    prompt:
      "The parser documentation is out of scope. Create a deferred follow-up for adding it, but do not start a separate chat and do not edit files. Use the appropriate Otto tool now.",
    expected: ["suggest_task"],
    forbidden: ["create_chat", "start_orchestration"],
  },
  {
    id: "direct-work",
    prompt:
      "Reply with exactly: acknowledged. Do not create a task, start a chat, schedule anything, or delegate work.",
    expected: [],
    forbidden: [
      "suggest_task",
      "create_chat",
      "create_schedule",
      "create_heartbeat",
      "start_orchestration",
    ],
  },
  {
    id: "personality-discovery",
    prompt:
      "Before choosing someone for a code review, show me the available personality profiles for researcher or judger work. Do not start a chat.",
    expected: ["list_personalities"],
    forbidden: ["create_chat", "start_orchestration"],
  },
  {
    id: "independent-chat",
    prompt:
      "Start an independent Otto chat for a future parser investigation. Do not make it a deferred task and do not begin implementation.",
    expected: ["create_chat"],
    forbidden: ["suggest_task", "start_orchestration"],
  },
  {
    id: "reminder-not-chat",
    prompt:
      "Set a reminder for tomorrow morning to review parser documentation. Do not start a chat or create a task card.",
    expected: ["create_heartbeat"],
    forbidden: ["create_chat", "suggest_task", "create_schedule"],
  },
];

const COSTLY_SCENARIOS: readonly Scenario[] = [
  {
    id: "scheduled-chat",
    prompt:
      "Create a daily background chat that reviews parser TODOs and reports a concise summary. Do not create a reminder-only heartbeat.",
    expected: ["create_schedule"],
    forbidden: ["create_heartbeat"],
    costly: true,
  },
  {
    id: "managed-orchestration",
    prompt:
      "Research the parser boundary, draft a plan, have a reviewer judge it, and pause before implementation for approval. Use managed orchestration rather than one separate chat.",
    expected: ["start_orchestration"],
    forbidden: ["create_chat"],
    costly: true,
  },
];

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const requested = (get("--profiles") ?? "luna,sonnet,qwen38")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const profiles = requested.map((value) => {
    if (!(value in PROFILE_MATCHERS)) {
      throw new Error(`Unknown profile "${value}". Use luna, sonnet, qwen38.`);
    }
    return value as ProfileKey;
  });
  return {
    home: get("--home") ?? path.join(os.homedir(), ".otto"),
    cwd: get("--cwd") ?? REPO_ROOT,
    timeoutMs: Number(get("--timeout") ?? "180") * 1000,
    profiles,
    includeCostly: argv.includes("--include-costly"),
    keep: argv.includes("--keep"),
    ...(get("--output") ? { output: path.resolve(get("--output")!) } : {}),
  };
}

function isTerminal(status: string): boolean {
  return status === "idle" || status === "error";
}

function ottoToolName(item: AgentTimelineItem): string | null {
  if (item.type !== "tool_call") return null;
  const name = item.name;
  if (name.startsWith("mcp__otto__")) return name.slice("mcp__otto__".length);
  if (name.startsWith("otto.")) return name.slice("otto.".length);
  return name;
}

function scoreScenario(scenario: Scenario, toolCalls: readonly string[]): boolean {
  const allExpectedPresent = scenario.expected.every((tool) => toolCalls.includes(tool));
  const noForbiddenCall = !(scenario.forbidden ?? []).some((tool) => toolCalls.includes(tool));
  return allExpectedPresent && noForbiddenCall;
}

async function seedHome(
  sourceHome: string,
): Promise<{ root: string; ottoHome: string; staticDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "otto-tool-selection-"));
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
  const port = target?.type === "tcp" ? target.port : null;
  if (!port) throw new Error("Evaluation daemon did not bind a TCP port");
  return { daemon, port };
}

function resolvePersonality(profiles: readonly Personality[], key: ProfileKey): Personality {
  const matcher = PROFILE_MATCHERS[key];
  const personality = profiles.find(
    (candidate) =>
      candidate.provider === matcher.provider && matcher.model.test(candidate.model ?? ""),
  );
  if (!personality) {
    throw new Error(
      `No ${key} personality found. Expected ${matcher.provider}/${matcher.model}; available: ${profiles
        .map((profile) => `${profile.name} (${profile.provider}/${profile.model ?? "default"})`)
        .join(", ")}`,
    );
  }
  return personality;
}

async function runCase(input: {
  client: DaemonClient;
  daemon: Awaited<ReturnType<typeof startDaemon>>["daemon"];
  personality: Personality;
  profile: ProfileKey;
  scenario: Scenario;
  cwd: string;
  timeoutMs: number;
}): Promise<CaseResult> {
  const { client, daemon, personality, profile, scenario, cwd, timeoutMs } = input;
  let agentId: string | undefined;
  try {
    const agent = await client.createAgent({
      provider: personality.provider,
      ...(personality.model ? { model: personality.model } : {}),
      personality: personality.id,
      ...(personality.modeId ? { modeId: personality.modeId } : {}),
      ...(personality.thinkingOptionId ? { thinkingOptionId: personality.thinkingOptionId } : {}),
      cwd,
      title: `Tool selection: ${profile} / ${scenario.id}`,
      initialPrompt: scenario.prompt,
    });
    agentId = agent.id;
    await client.waitForAgentUpsert(agent.id, (snapshot) => isTerminal(snapshot.status), timeoutMs);
    const toolCalls = daemon.agentManager
      .getTimeline(agent.id)
      .map(ottoToolName)
      .filter((name): name is string => Boolean(name));
    const finalMessage = await daemon.agentManager.getLastAssistantMessage(agent.id);
    return {
      profile,
      personality: personality.name,
      provider: personality.provider,
      model: personality.model ?? null,
      scenario: scenario.id,
      expected: scenario.expected,
      toolCalls,
      passed: scoreScenario(scenario, toolCalls),
      finalMessage,
    };
  } catch (error) {
    return {
      profile,
      personality: personality.name,
      provider: personality.provider,
      model: personality.model ?? null,
      scenario: scenario.id,
      expected: scenario.expected,
      toolCalls: [],
      passed: false,
      finalMessage: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (agentId) await client.deleteAgent(agentId).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = [...SAFE_SCENARIOS, ...(args.includeCostly ? COSTLY_SCENARIOS : [])];
  const { root, ottoHome, staticDir } = await seedHome(args.home);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "otto-tool-selection-workspace-"));
  const { daemon, port } = await startDaemon(ottoHome, staticDir);
  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.8.12" });

  try {
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "tool-selection-eval" } });
    const { config } = await client.getDaemonConfig();
    const personalities = (config.agentPersonalities?.personalities ?? []) as Personality[];
    const results: CaseResult[] = [];
    for (const profile of args.profiles) {
      const personality = resolvePersonality(personalities, profile);
      for (const scenario of scenarios) {
        results.push(
          await runCase({
            client,
            daemon,
            personality,
            profile,
            scenario,
            cwd: workspace,
            timeoutMs: args.timeoutMs,
          }),
        );
      }
    }
    const report = {
      generatedAt: new Date().toISOString(),
      home: args.home,
      workspace,
      scenarios: scenarios.map(({ id, expected, costly }) => ({
        id,
        expected,
        costly: Boolean(costly),
      })),
      results,
      summary: {
        total: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
      },
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.output) {
      await mkdir(path.dirname(args.output), { recursive: true });
      await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    process.exitCode = report.summary.failed === 0 ? 0 : 1;
  } finally {
    await client.close().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    await rm(workspace, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    if (!args.keep)
      await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    else process.stderr.write(`Kept isolated Otto home: ${ottoHome}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Otto tool-selection evaluation failed: ${String(error)}\n`);
  process.exitCode = 1;
});
