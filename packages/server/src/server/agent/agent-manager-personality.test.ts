import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ProjectKnowledgeService } from "./project-knowledge/project-knowledge-service.js";
import type { ResolvedProfileSnapshot } from "./agent-profiles.js";
import type {
  AgentClient,
  AgentMode,
  AgentPersonalityUpdate,
  AgentProviderNotice,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

interface SessionBehavior {
  failSetModeWith?: Error;
  applyPersonalityDelayMs?: number;
  /** Default (absent) is an empty roster, which no mode rule can act on. */
  availableModes?: AgentMode[];
}

class PersonalityTestSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  readonly id = randomUUID();
  readonly calls: string[] = [];
  readonly personalityUpdates: AgentPersonalityUpdate[] = [];
  currentMode: string | null = null;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    readonly config: AgentSessionConfig,
    private readonly behavior: SessionBehavior = {},
  ) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.currentMode,
    };
  }

  async getAvailableModes() {
    return this.behavior.availableModes ?? [];
  }

  async getCurrentMode() {
    return this.currentMode;
  }

  async setMode(modeId: string): Promise<void | AgentProviderNotice> {
    if (this.behavior.failSetModeWith) {
      this.calls.push(`setMode:throw:${modeId}`);
      throw this.behavior.failSetModeWith;
    }
    this.calls.push(`setMode:${modeId}`);
    this.currentMode = modeId;
  }

  async setModel(modelId: string | null): Promise<void> {
    this.calls.push(`setModel:${modelId ?? "null"}`);
    this.config.model = modelId ?? undefined;
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void | AgentProviderNotice> {
    this.calls.push(`setThinkingOption:${thinkingOptionId ?? "null"}`);
    this.config.thinkingOptionId = thinkingOptionId ?? undefined;
  }

  async applyPersonality(update: AgentPersonalityUpdate): Promise<void | AgentProviderNotice> {
    this.calls.push("applyPersonality:enter");
    if (this.behavior.applyPersonalityDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.behavior.applyPersonalityDelayMs));
    }
    this.personalityUpdates.push(update);
    this.config.profileSnapshot = update.profileSnapshot;
    this.config.systemPrompt = update.systemPrompt;
    this.config.daemonAppendSystemPrompt = update.daemonAppendSystemPrompt;
    this.calls.push("applyPersonality:exit");
  }

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class PersonalityTestClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  lastSession: PersonalityTestSession | null = null;

  constructor(private readonly behavior: SessionBehavior = {}) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.lastSession = new PersonalityTestSession(config, this.behavior);
    return this.lastSession;
  }

  async fetchCatalog() {
    return {
      models: [
        { provider: "codex" as const, id: "gpt-5.4", label: "GPT-5.4", isDefault: true },
        { provider: "codex" as const, id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      ],
      modes: [],
    };
  }

  async resumeSession(): Promise<AgentSession> {
    throw new Error("unused");
  }
}

const logger = createTestLogger();

function buildSnapshot(overrides: Partial<ResolvedProfileSnapshot> = {}): ResolvedProfileSnapshot {
  return {
    profileId: "personality-vera",
    name: "Vera",
    provider: "codex",
    model: "gpt-5.4-mini",
    modeId: "auto",
    thinkingOptionId: "high",
    effortDegraded: false,
    systemPrompt: "You are Vera.",
    ...overrides,
  };
}

interface Harness {
  manager: AgentManager;
  client: PersonalityTestClient;
  workdir: string;
  spawnedPersonalityIds: string[];
  cleanup: () => void;
}

function createHarness(
  options: {
    behavior?: SessionBehavior;
    appendSystemPrompt?: string;
    /** Stands in for the personality-memory service's brief resolver. */
    memoryBrief?: string | null;
    knowledgeBrief?: string | null;
  } = {},
): Harness {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-personality-test-"));
  const client = new PersonalityTestClient(options.behavior);
  const spawnedPersonalityIds: string[] = [];
  const manager = new AgentManager({
    clients: { codex: client },
    logger,
    appendSystemPrompt: options.appendSystemPrompt,
    onPersonalitySpawn: (personalityId) => {
      spawnedPersonalityIds.push(personalityId);
    },
    ...(options.memoryBrief !== undefined
      ? { resolvePersonalityMemoryBrief: async () => options.memoryBrief ?? null }
      : {}),
    ...(options.knowledgeBrief !== undefined
      ? { resolveProjectKnowledgeBrief: async () => options.knowledgeBrief ?? null }
      : {}),
  });
  return {
    manager,
    client,
    workdir,
    spawnedPersonalityIds,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

test("setAgentPersonality applies mode before model before thinking, prompt last", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());

    const session = harness.client.lastSession!;
    expect(session.calls).toEqual([
      "setMode:auto",
      "setModel:gpt-5.4-mini",
      "setThinkingOption:high",
      "applyPersonality:enter",
      "applyPersonality:exit",
    ]);
    expect(agent.config.profileSnapshot?.profileId).toBe("personality-vera");
    expect(agent.config.model).toBe("gpt-5.4-mini");
    expect(agent.config.modeId).toBe("auto");
    expect(agent.config.thinkingOptionId).toBe("high");
    expect(agent.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});

// A mode that picks the model itself would swallow the personality's model just
// as it swallows an explicit pick, so binding one leaves that mode too.
const MODEL_PICKING_MODES: AgentMode[] = [
  { id: "router", label: "Router", selectsModel: true },
  { id: "standard", label: "Standard" },
  { id: "plan", label: "Plan" },
];

test("a personality carrying a model but no mode leaves a model-picking mode", async () => {
  const harness = createHarness({ behavior: { availableModes: MODEL_PICKING_MODES } });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentMode(agent.id, "router");
    expect(harness.manager.getAgent(agent.id)?.currentModeId).toBe("router");

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({ modeId: undefined, model: "gpt-5.4-mini" }),
    );

    const session = harness.client.lastSession!;
    expect(session.calls).toContain("setModel:gpt-5.4-mini");
    expect(session.calls).toContain("setMode:standard");
    expect(agent.config.model).toBe("gpt-5.4-mini");
    expect(agent.config.modeId).toBe("standard");
    expect(harness.manager.getAgent(agent.id)?.currentModeId).toBe("standard");
  } finally {
    harness.cleanup();
  }
});

test("a personality that names a model-picking mode keeps it", async () => {
  const harness = createHarness({ behavior: { availableModes: MODEL_PICKING_MODES } });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentMode(agent.id, "standard");

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({ modeId: "router", model: "gpt-5.4-mini" }),
    );

    // The personality asked for this mode explicitly; that stands, exactly as a
    // chat created in Auto with a model keeps both.
    expect(agent.config.modeId).toBe("router");
    expect(harness.manager.getAgent(agent.id)?.currentModeId).toBe("router");
    expect(agent.config.model).toBe("gpt-5.4-mini");
  } finally {
    harness.cleanup();
  }
});

test("a setMode failure aborts the switch before any brain state changes", async () => {
  const harness = createHarness({ behavior: { failSetModeWith: new Error("auto ineligible") } });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const modelBefore = agent.config.model;

    await expect(harness.manager.setAgentPersonality(agent.id, buildSnapshot())).rejects.toThrow(
      "auto ineligible",
    );

    const session = harness.client.lastSession!;
    expect(session.calls).toEqual(["setMode:throw:auto"]);
    expect(agent.config.model).toBe(modelBefore);
    expect(agent.config.profileSnapshot).toBeUndefined();
    expect(agent.config.systemPrompt).toBeUndefined();
  } finally {
    harness.cleanup();
  }
});

test("clearing a personality keeps the brain and removes the personality-owned prompt", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());
    const session = harness.client.lastSession!;
    session.calls.length = 0;

    await harness.manager.setAgentPersonality(agent.id, null);

    // Clear applies no brain setters - only the prompt half.
    expect(session.calls).toEqual(["applyPersonality:enter", "applyPersonality:exit"]);
    expect(agent.config.profileSnapshot).toBeUndefined();
    expect(agent.config.systemPrompt).toBeUndefined();
    expect(agent.config.model).toBe("gpt-5.4-mini");
    expect(agent.config.modeId).toBe("auto");
  } finally {
    harness.cleanup();
  }
});

test("a caller-authored system prompt survives switch and clear", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir, systemPrompt: "caller prompt" },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());
    expect(agent.config.systemPrompt).toBe("caller prompt");

    await harness.manager.setAgentPersonality(agent.id, null);
    expect(agent.config.systemPrompt).toBe("caller prompt");
  } finally {
    harness.cleanup();
  }
});

test("respectGlobalAppendPrompt=false drops the daemon append; default keeps it", async () => {
  const harness = createHarness({ appendSystemPrompt: "GLOBAL RULES" });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const session = harness.client.lastSession!;

    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());
    expect(session.personalityUpdates.at(-1)?.daemonAppendSystemPrompt).toBe("GLOBAL RULES");

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({ respectGlobalAppendPrompt: false }),
    );
    expect(session.personalityUpdates.at(-1)?.daemonAppendSystemPrompt).toBeUndefined();
  } finally {
    harness.cleanup();
  }
});

test("a snapshot without an effort clears the previous thinking option", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());
    expect(agent.config.thinkingOptionId).toBe("high");

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({
        profileId: "personality-dash",
        name: "Dash",
        thinkingOptionId: undefined,
      }),
    );

    const session = harness.client.lastSession!;
    expect(session.calls).toContain("setThinkingOption:null");
    expect(agent.config.thinkingOptionId).toBeUndefined();
  } finally {
    harness.cleanup();
  }
});

test("concurrent personality mutations on one agent serialize", async () => {
  const harness = createHarness({ behavior: { applyPersonalityDelayMs: 20 } });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const session = harness.client.lastSession!;

    await Promise.all([
      harness.manager.setAgentPersonality(agent.id, null),
      harness.manager.setAgentPersonality(agent.id, null),
    ]);

    // Serialized: each apply fully enters and exits before the next starts.
    expect(session.calls).toEqual([
      "applyPersonality:enter",
      "applyPersonality:exit",
      "applyPersonality:enter",
      "applyPersonality:exit",
    ]);
  } finally {
    harness.cleanup();
  }
});

test("a live switch recomposes against the frozen born team, not the current one", async () => {
  const harness = createHarness();
  try {
    // Spawned as an active-team member: systemPrompt is the composed stack and
    // teamSnapshot is frozen onto the config (as the spawn paths do).
    const agent = await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        teamSnapshot: { teamId: "team-crew", name: "Shipping crew", teamPrompt: "Team frame." },
        systemPrompt: "Team frame.\n\nYou are Vera.",
      },
      undefined,
      { workspaceId: undefined },
    );

    // Switching personalities - even to one outside the born team - keeps the
    // frozen team prompt ahead of the incoming personality prompt.
    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({
        profileId: "personality-dash",
        name: "Dash",
        systemPrompt: "You are Dash.",
      }),
    );
    expect(agent.config.systemPrompt).toBe("Team frame.\n\nYou are Dash.");
    expect(agent.config.teamSnapshot?.teamId).toBe("team-crew");
  } finally {
    harness.cleanup();
  }
});

test("clearing the personality keeps the born team prompt and drops the personality prompt", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        teamSnapshot: { teamId: "team-crew", name: "Shipping crew", teamPrompt: "Team frame." },
        systemPrompt: "Team frame.\n\nYou are Vera.",
      },
      undefined,
      { workspaceId: undefined },
    );

    await harness.manager.setAgentPersonality(agent.id, null);

    expect(agent.config.profileSnapshot).toBeUndefined();
    expect(agent.config.systemPrompt).toBe("Team frame.");
    expect(agent.config.teamSnapshot?.teamId).toBe("team-crew");
  } finally {
    harness.cleanup();
  }
});

test("a caller-authored prompt survives switches on a team-born agent", async () => {
  const harness = createHarness();
  try {
    const agent = await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        teamSnapshot: { teamId: "team-crew", name: "Shipping crew", teamPrompt: "Team frame." },
        systemPrompt: "caller prompt",
      },
      undefined,
      { workspaceId: undefined },
    );

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({ profileId: "personality-dash", name: "Dash" }),
    );
    expect(agent.config.systemPrompt).toBe("caller prompt");

    await harness.manager.setAgentPersonality(agent.id, null);
    expect(agent.config.systemPrompt).toBe("caller prompt");
  } finally {
    harness.cleanup();
  }
});

test("a pre-teams agent (bare personality prompt) still reads as personality-owned", async () => {
  const harness = createHarness();
  try {
    // Simulates an agent spawned before teams shipped: personality-owned prompt
    // with no teamSnapshot. The switch must recognize ownership and swap it.
    const agent = await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        systemPrompt: "You are Vera.",
      },
      undefined,
      { workspaceId: undefined },
    );

    await harness.manager.setAgentPersonality(
      agent.id,
      buildSnapshot({
        profileId: "personality-dash",
        name: "Dash",
        systemPrompt: "You are Dash.",
      }),
    );
    expect(agent.config.systemPrompt).toBe("You are Dash.");
  } finally {
    harness.cleanup();
  }
});

test("onPersonalitySpawn fires once per personality-bound createAgent", async () => {
  const harness = createHarness();
  try {
    await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir, profileSnapshot: buildSnapshot() },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.createAgent({ provider: "codex", cwd: harness.workdir }, undefined, {
      workspaceId: undefined,
    });

    expect(harness.spawnedPersonalityIds).toEqual(["personality-vera"]);
  } finally {
    harness.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Personality memory injection (docs/agent-personalities.md § Memory)
// ---------------------------------------------------------------------------

test("a personality's accrued lessons ride the launch prompt but never the stored one", async () => {
  const harness = createHarness({
    memoryBrief: "## What you have learned\n\n1. Rebuild protocol first.",
  });
  try {
    // Spawn callers compose the personality prompt into `systemPrompt` before
    // they reach AgentManager (session.ts, otto-tools, schedules all do), so
    // that is what the brief has to stack under.
    const agent = await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        systemPrompt: "You are Vera.",
      },
      undefined,
      { workspaceId: undefined },
    );

    // The provider sees the lessons...
    expect(harness.client.lastSession!.config.systemPrompt).toContain("Rebuild protocol first.");
    expect(harness.client.lastSession!.config.systemPrompt).toContain("You are Vera.");
    // ...and the persisted config does not. Baking memory into the stored prompt
    // would break the live-switch ownership check the moment a personality
    // learned anything, and would freeze the lessons as of spawn time.
    expect(agent.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});

test("an agent with no personality is never handed a memory brief", async () => {
  const harness = createHarness({ memoryBrief: "## What you have learned\n\n1. Something." });
  try {
    await harness.manager.createAgent({ provider: "codex", cwd: harness.workdir }, undefined, {
      workspaceId: undefined,
    });
    expect(harness.client.lastSession!.config.systemPrompt).toBeUndefined();
  } finally {
    harness.cleanup();
  }
});

test("nothing to remember leaves the launch prompt byte-identical", async () => {
  const harness = createHarness({ memoryBrief: null });
  try {
    await harness.manager.createAgent(
      {
        provider: "codex",
        cwd: harness.workdir,
        profileSnapshot: buildSnapshot(),
        systemPrompt: "You are Vera.",
      },
      undefined,
      { workspaceId: undefined },
    );
    expect(harness.client.lastSession!.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});

test("every chat receives project knowledge discovery without persisting the catalog", async () => {
  const harness = createHarness({
    knowledgeBrief: "## Project knowledge catalog\n\n- [[daemon-owns-memory]]",
  });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir, systemPrompt: "Project instructions." },
      undefined,
      { workspaceId: undefined },
    );
    expect(harness.client.lastSession!.config.systemPrompt).toContain("[[daemon-owns-memory]]");
    expect(harness.client.lastSession!.config.systemPrompt).toContain("Project instructions.");
    expect(agent.config.systemPrompt).toBe("Project instructions.");
  } finally {
    harness.cleanup();
  }
});

test("a new chat can discover active truth, read it, and record a proposal", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-project-knowledge-test-"));
  const client = new PersonalityTestClient();
  const knowledge = new ProjectKnowledgeService({
    resolveProjectRoot: async () => workdir,
    logger,
  });
  try {
    await knowledge.record({
      cwd: workdir,
      kind: "decision",
      title: "Daemon owns project memory",
      statement: "Project knowledge writes go through the daemon.",
      status: "confirmed",
    });
    const manager = new AgentManager({
      clients: { codex: client },
      logger,
      resolveProjectKnowledgeBrief: async ({ cwd }) =>
        cwd ? (await knowledge.briefForCwd(cwd)).text : null,
    });

    await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
      workspaceId: undefined,
    });

    expect(client.lastSession?.config.systemPrompt).toContain("[[daemon-owns-project-memory]]");
    expect((await knowledge.get(workdir, "daemon-owns-project-memory"))?.statement).toContain(
      "writes go through the daemon",
    );
    const proposal = await knowledge.record({
      cwd: workdir,
      kind: "constraint",
      title: "Proposals need review",
      statement: "New durable claims stay inactive until a user confirms them.",
      evidence: "Established during the lifecycle integration test.",
    });
    expect(proposal.status).toBe("proposed");
    expect((await knowledge.briefForCwd(workdir)).includedIds).not.toContain(proposal.id);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("a live personality switch re-resolves the incoming personality's lessons", async () => {
  const harness = createHarness({ memoryBrief: "## What you have learned\n\n1. Vera knows this." });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await harness.manager.setAgentPersonality(agent.id, buildSnapshot());

    const update = harness.client.lastSession!.personalityUpdates.at(-1)!;
    // Switching to a personality mid-chat has to bring what it has learned, or
    // you get its prompt and its brain but not its experience.
    expect(update.systemPrompt).toContain("Vera knows this.");
    // The stored prompt stays memory-free so the ownership check keeps matching.
    expect(agent.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});
