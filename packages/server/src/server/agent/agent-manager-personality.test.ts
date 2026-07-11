import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type { ResolvedPersonalitySnapshot } from "./agent-personalities.js";
import type {
  AgentClient,
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
    return [];
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
    this.config.personalitySnapshot = update.personalitySnapshot;
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

function buildSnapshot(
  overrides: Partial<ResolvedPersonalitySnapshot> = {},
): ResolvedPersonalitySnapshot {
  return {
    personalityId: "personality-vera",
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
    expect(agent.config.personalitySnapshot?.personalityId).toBe("personality-vera");
    expect(agent.config.model).toBe("gpt-5.4-mini");
    expect(agent.config.modeId).toBe("auto");
    expect(agent.config.thinkingOptionId).toBe("high");
    expect(agent.config.systemPrompt).toBe("You are Vera.");
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
    expect(agent.config.personalitySnapshot).toBeUndefined();
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

    // Clear applies no brain setters — only the prompt half.
    expect(session.calls).toEqual(["applyPersonality:enter", "applyPersonality:exit"]);
    expect(agent.config.personalitySnapshot).toBeUndefined();
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
        personalityId: "personality-dash",
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

test("onPersonalitySpawn fires once per personality-bound createAgent", async () => {
  const harness = createHarness();
  try {
    await harness.manager.createAgent(
      { provider: "codex", cwd: harness.workdir, personalitySnapshot: buildSnapshot() },
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
