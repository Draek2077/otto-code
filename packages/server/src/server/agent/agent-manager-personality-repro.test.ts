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
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

// Reproduction harness for the reported "picked Atlas, still Sprocket / cross-chat
// leak" bug. Mirrors the two starter personalities (both Claude, both chatter) and
// drives TWO agents at once, switching each independently, to prove the live switch
// is isolated per agent and that the applied id/prompt match the selected one.

const TEST_CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

class ReproSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  readonly id = randomUUID();
  currentMode: string | null = null;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(readonly config: AgentSessionConfig) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }
  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }
  subscribe(cb: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
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
  async setMode(modeId: string): Promise<void> {
    this.currentMode = modeId;
  }
  async setModel(modelId: string | null): Promise<void> {
    this.config.model = modelId ?? undefined;
  }
  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    this.config.thinkingOptionId = thinkingOptionId ?? undefined;
  }
  async applyPersonality(update: AgentPersonalityUpdate): Promise<void> {
    this.config.personalitySnapshot = update.personalitySnapshot;
    this.config.systemPrompt = update.systemPrompt;
    this.config.daemonAppendSystemPrompt = update.daemonAppendSystemPrompt;
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

class ReproClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    return new ReproSession(config);
  }
  async fetchCatalog() {
    return { models: [], modes: [] };
  }
  async resumeSession(): Promise<AgentSession> {
    throw new Error("unused");
  }
}

function sprocket(): ResolvedPersonalitySnapshot {
  return {
    personalityId: "personality_builtin_sprocket",
    name: "Sprocket",
    provider: "codex",
    model: "gpt-5.4",
    modeId: "default",
    effortDegraded: false,
    systemPrompt: "You are Sprocket.",
    respectGlobalAppendPrompt: true,
    roles: ["chatter", "coder"],
  };
}

function atlas(): ResolvedPersonalitySnapshot {
  return {
    personalityId: "personality_builtin_atlas",
    name: "Atlas",
    provider: "codex",
    model: "gpt-5.4-mini",
    modeId: "auto",
    effortDegraded: false,
    systemPrompt: "You are Atlas.",
    respectGlobalAppendPrompt: true,
    roles: ["orchestrator", "chatter"],
  };
}

function createManager() {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-personality-repro-"));
  const manager = new AgentManager({
    clients: { codex: new ReproClient() },
    logger: createTestLogger(),
  });
  return { manager, workdir, cleanup: () => rmSync(workdir, { recursive: true, force: true }) };
}

test("two open chats: switching one personality does not leak into the other", async () => {
  const { manager, workdir, cleanup } = createManager();
  try {
    // Chat A spawns as Sprocket; Chat B spawns as Atlas — the reported starting state.
    const chatA = await manager.createAgent(
      {
        provider: "codex",
        cwd: workdir,
        personalitySnapshot: sprocket(),
        systemPrompt: "You are Sprocket.",
      },
      undefined,
      { workspaceId: undefined },
    );
    const chatB = await manager.createAgent(
      {
        provider: "codex",
        cwd: workdir,
        personalitySnapshot: atlas(),
        systemPrompt: "You are Atlas.",
      },
      undefined,
      { workspaceId: undefined },
    );

    // User switches Chat A -> Atlas. Chat B must stay Sprocket-free / untouched.
    await manager.setAgentPersonality(chatA.id, atlas());

    // The applied id matches the selected id (no stale/captured id). The prompt is
    // Atlas's, with the role-focus directive appended (roles bear a directive).
    expect(chatA.config.personalitySnapshot?.personalityId).toBe("personality_builtin_atlas");
    expect(chatA.config.systemPrompt).toContain("You are Atlas.");
    expect(chatA.config.systemPrompt).not.toContain("You are Sprocket.");
    expect(chatA.config.model).toBe("gpt-5.4-mini");

    // Chat B is completely unaffected by Chat A's switch.
    expect(chatB.config.personalitySnapshot?.personalityId).toBe("personality_builtin_atlas");
    expect(chatB.config.systemPrompt).toContain("You are Atlas.");

    // Now switch Chat B -> Sprocket and re-confirm A kept Atlas.
    await manager.setAgentPersonality(chatB.id, sprocket());
    expect(chatB.config.personalitySnapshot?.personalityId).toBe("personality_builtin_sprocket");
    expect(chatB.config.systemPrompt).toContain("You are Sprocket.");
    expect(chatA.config.personalitySnapshot?.personalityId).toBe("personality_builtin_atlas");
    expect(chatA.config.systemPrompt).toContain("You are Atlas.");
    expect(chatA.config.systemPrompt).not.toContain("You are Sprocket.");
  } finally {
    cleanup();
  }
});

test("concurrent switches on two agents each apply their own selected personality", async () => {
  const { manager, workdir, cleanup } = createManager();
  try {
    const chatA = await manager.createAgent(
      {
        provider: "codex",
        cwd: workdir,
        personalitySnapshot: sprocket(),
        systemPrompt: "You are Sprocket.",
      },
      undefined,
      { workspaceId: undefined },
    );
    const chatB = await manager.createAgent(
      {
        provider: "codex",
        cwd: workdir,
        personalitySnapshot: sprocket(),
        systemPrompt: "You are Sprocket.",
      },
      undefined,
      { workspaceId: undefined },
    );

    // Fire both switches at once — the per-agent lock must keep them isolated.
    await Promise.all([
      manager.setAgentPersonality(chatA.id, atlas()),
      manager.setAgentPersonality(chatB.id, sprocket()),
    ]);

    expect(chatA.config.personalitySnapshot?.personalityId).toBe("personality_builtin_atlas");
    expect(chatA.config.systemPrompt).toContain("You are Atlas.");
    expect(chatA.config.systemPrompt).not.toContain("You are Sprocket.");
    expect(chatB.config.personalitySnapshot?.personalityId).toBe("personality_builtin_sprocket");
    expect(chatB.config.systemPrompt).toContain("You are Sprocket.");
  } finally {
    cleanup();
  }
});
