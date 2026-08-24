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
import { createOttoDaemon, type OttoDaemonConfig } from "../src/server/bootstrap.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import { DaemonClient } from "../src/server/test-utils/daemon-client.js";
import type { AgentTimelineItem } from "../src/server/agent/agent-sdk-types.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

type ProfileKey = "luna" | "sonnet" | "qwen38";

interface Args {
  home: string;
  cwd: string;
  timeoutMs: number;
  profiles: ProfileKey[];
  scenarios?: string[];
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
  maxExpectedCalls?: number;
  /**
   * Chats that exist before the evaluated chat starts. Their tool traces are
   * scored too, so this can prove a hand-off rather than only its first hop.
   */
  existingChats?: readonly ExistingChatScenario[];
  costly?: boolean;
}

interface ExistingChatScenario {
  title: string;
  expected: readonly string[];
  forbidden?: readonly string[];
}

interface CaseResult {
  profile: ProfileKey;
  personality: string;
  provider: string;
  model: string | null;
  scenario: string;
  expected: readonly string[];
  toolCalls: string[];
  toolCallIds: string[];
  existingChats?: Array<{
    title: string;
    expected: readonly string[];
    toolCalls: string[];
    toolCallIds: string[];
  }>;
  failures?: string[];
  passed: boolean;
  finalMessage: string | null;
  error?: string;
}

interface ToolingConfiguration {
  mcpServerEnabled: true;
  injectIntoAgents: true;
  toolGroups: string[] | "all";
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
    maxExpectedCalls: 1,
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
    expected: ["list_agent_profiles"],
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
  {
    id: "existing-chat-research-handoff",
    prompt:
      "There are already two Otto chats in this workspace named Evaluation Research and Evaluation Execution. Do not create any chats or start an orchestration. First use list_chats to find their exact IDs. Send only Evaluation Research a background prompt asking it to research the parser boundary, then independently find Evaluation Execution and send it the resulting implementation brief. Do not prompt Evaluation Execution yourself. Wait for Evaluation Research to finish, then report that the hand-off was requested.",
    expected: ["list_chats", "send_chat_prompt", "wait_for_chats"],
    forbidden: ["create_chat", "start_orchestration"],
    existingChats: [
      {
        title: "Evaluation Research",
        expected: ["list_chats", "send_chat_prompt"],
        forbidden: ["create_chat", "start_orchestration"],
      },
      {
        title: "Evaluation Execution",
        expected: [],
      },
    ],
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
    ...(get("--scenarios")
      ? {
          scenarios: get("--scenarios")!
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
    includeCostly: argv.includes("--include-costly"),
    keep: argv.includes("--keep"),
    ...(get("--output") ? { output: path.resolve(get("--output")!) } : {}),
  };
}

function isTerminal(status: string): boolean {
  return status === "idle" || status === "error";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The MCP server is always enabled for the isolated daemon, but injecting it
 * into chats is a persisted host choice. Do not silently turn it on: an eval
 * with no Otto catalog would report model failures that are really bad setup.
 */
function verifyToolingConfiguration(config: unknown): ToolingConfiguration {
  const root = asRecord(config);
  const daemon = asRecord(root?.daemon) ?? root;
  const mcp = asRecord(daemon?.mcp);
  if (mcp?.injectIntoAgents !== true) {
    throw new Error(
      "Otto tool injection is disabled in the selected home. Set daemon.mcp.injectIntoAgents to true before running this evaluation.",
    );
  }
  const groups = Array.isArray(mcp.toolGroups)
    ? mcp.toolGroups.filter((group): group is string => typeof group === "string")
    : "all";
  return { mcpServerEnabled: true, injectIntoAgents: true, toolGroups: groups };
}

function ottoToolName(item: AgentTimelineItem): string | null {
  if (item.type !== "tool_call") return null;
  const name = item.name;
  if (name.startsWith("mcp__otto__")) return name.slice("mcp__otto__".length);
  if (name.startsWith("otto.")) return name.slice("otto.".length);
  return name;
}

function scoreToolCalls(
  expected: readonly string[],
  forbidden: readonly string[] | undefined,
  maxExpectedCalls: number | undefined,
  toolCalls: readonly string[],
): string[] {
  const failures: string[] = [];
  const missing = expected.filter((tool) => !toolCalls.includes(tool));
  if (missing.length > 0) failures.push(`missing: ${missing.join(", ")}`);
  const unexpected = (forbidden ?? []).filter((tool) => toolCalls.includes(tool));
  if (unexpected.length > 0) failures.push(`forbidden: ${unexpected.join(", ")}`);
  const expectedCalls = toolCalls.filter((tool) => expected.includes(tool)).length;
  if (maxExpectedCalls !== undefined && expectedCalls > maxExpectedCalls) {
    failures.push(`too many expected calls: ${expectedCalls} > ${maxExpectedCalls}`);
  }
  return failures;
}

function scoreScenario(
  scenario: Scenario,
  toolCalls: readonly string[],
  existingChats: ReadonlyMap<string, readonly string[]>,
): string[] {
  const failures = scoreToolCalls(
    scenario.expected,
    scenario.forbidden,
    scenario.maxExpectedCalls,
    toolCalls,
  );
  for (const chat of scenario.existingChats ?? []) {
    const chatFailures = scoreToolCalls(
      chat.expected,
      chat.forbidden,
      undefined,
      existingChats.get(chat.title) ?? [],
    );
    failures.push(...chatFailures.map((failure) => `${chat.title}: ${failure}`));
  }
  return failures;
}

function collectOttoToolCalls(timeline: readonly AgentTimelineItem[]): {
  names: string[];
  callIds: string[];
} {
  const calls = new Map<string, string>();
  for (const [index, item] of timeline.entries()) {
    const name = ottoToolName(item);
    if (!name) continue;
    const callId = item.type === "tool_call" ? item.callId : null;
    calls.set(callId || `unidentified-${index}`, name);
  }
  return { names: [...calls.values()], callIds: [...calls.keys()] };
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

function buildEvaluationDaemonConfig(ottoHome: string, staticDir: string): OttoDaemonConfig {
  // createOttoDaemon reads the persisted daemon settings itself, but the
  // personality roster and provider overrides are explicit bootstrap inputs.
  // Preserve them from the copied home rather than falling back to starter
  // personalities, which would silently evaluate the wrong provider/model.
  const persisted = loadPersistedConfig(ottoHome);
  const persistedDaemon = persisted.daemon;
  const persistedAgents = persisted.agents;
  return {
    listen: "127.0.0.1:0",
    ottoHome,
    corsAllowedOrigins: [],
    hostnames: true,
    mcpEnabled: true,
    mcpInjectIntoAgents: persistedDaemon?.mcp?.injectIntoAgents,
    mcpToolGroups: persistedDaemon?.mcp?.toolGroups,
    browserToolsEnabled: persistedDaemon?.browserTools?.enabled,
    agentBehaviors: persistedDaemon?.agentBehaviors,
    autoArchiveAfterMerge: persistedDaemon?.autoArchiveAfterMerge,
    enableTerminalAgentHooks: persistedDaemon?.enableTerminalAgentHooks,
    appendSystemPrompt: persistedDaemon?.appendSystemPrompt,
    staticDir,
    mcpDebug: false,
    isDev: true,
    agentClients: {},
    agentStoragePath: path.join(ottoHome, "agents"),
    relayEnabled: false,
    relayEndpoint: "relay.otto-code.me:443",
    appBaseUrl: "https://app.otto-code.me",
    providerOverrides: persistedAgents?.providers,
    agentPersonalities: persistedAgents?.agentPersonalities,
    agentTeams: persistedAgents?.agentTeams,
    modelTierOverrides: persistedAgents?.modelTierOverrides,
    savedProviderEndpoints: persistedAgents?.savedProviderEndpoints,
  };
}

async function startDaemon(ottoHome: string, staticDir: string) {
  const daemon = await createOttoDaemon(
    buildEvaluationDaemonConfig(ottoHome, staticDir),
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
  const existingAgents: Array<{ id: string; scenario: ExistingChatScenario }> = [];
  try {
    for (const existingChat of scenario.existingChats ?? []) {
      const agent = await client.createAgent({
        provider: personality.provider,
        ...(personality.model ? { model: personality.model } : {}),
        personality: personality.id,
        ...(personality.modeId ? { modeId: personality.modeId } : {}),
        ...(personality.thinkingOptionId ? { thinkingOptionId: personality.thinkingOptionId } : {}),
        cwd,
        title: existingChat.title,
      });
      existingAgents.push({ id: agent.id, scenario: existingChat });
    }
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
    const { names: toolCalls, callIds: toolCallIds } = collectOttoToolCalls(
      daemon.agentManager.getTimeline(agent.id),
    );
    const existingChatResults = existingAgents.map(({ id, scenario: existingChat }) => {
      const calls = collectOttoToolCalls(daemon.agentManager.getTimeline(id));
      return {
        title: existingChat.title,
        expected: existingChat.expected,
        toolCalls: calls.names,
        toolCallIds: calls.callIds,
      };
    });
    const failures = scoreScenario(
      scenario,
      toolCalls,
      new Map(existingChatResults.map((chat) => [chat.title, chat.toolCalls])),
    );
    const finalMessage = await daemon.agentManager.getLastAssistantMessage(agent.id);
    return {
      profile,
      personality: personality.name,
      provider: personality.provider,
      model: personality.model ?? null,
      scenario: scenario.id,
      expected: scenario.expected,
      toolCalls,
      toolCallIds,
      ...(existingChatResults.length > 0 ? { existingChats: existingChatResults } : {}),
      ...(failures.length > 0 ? { failures } : {}),
      passed: failures.length === 0,
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
      toolCallIds: [],
      passed: false,
      finalMessage: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (agentId) await client.deleteAgent(agentId).catch(() => undefined);
    await Promise.all(
      existingAgents.map(({ id }) => client.deleteAgent(id).catch(() => undefined)),
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const availableScenarios = [...SAFE_SCENARIOS, ...(args.includeCostly ? COSTLY_SCENARIOS : [])];
  const scenarios = args.scenarios
    ? availableScenarios.filter((scenario) => args.scenarios!.includes(scenario.id))
    : availableScenarios;
  const unknownScenarios = (args.scenarios ?? []).filter(
    (scenario) => !availableScenarios.some((available) => available.id === scenario),
  );
  if (unknownScenarios.length > 0) {
    throw new Error(
      `Unknown scenario(s): ${unknownScenarios.join(", ")}. Available: ${availableScenarios
        .map((scenario) => scenario.id)
        .join(", ")}`,
    );
  }
  const { root, ottoHome, staticDir } = await seedHome(args.home);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "otto-tool-selection-workspace-"));
  const { daemon, port } = await startDaemon(ottoHome, staticDir);
  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.8.12" });

  try {
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "tool-selection-eval" } });
    const { config } = await client.getDaemonConfig();
    const tooling = verifyToolingConfiguration(config);
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
      tooling,
      scenarios: scenarios.map(({ id, expected, existingChats, costly }) => ({
        id,
        expected,
        existingChats: existingChats?.map((chat) => ({
          title: chat.title,
          expected: chat.expected,
        })),
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
