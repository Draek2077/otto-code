import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

/**
 * The gate these tests exist for: instruction files are loaded by the daemon
 * only for providers that compose their own request. Claude, Codex and OpenCode
 * each read `AGENTS.md`/`CLAUDE.md` in their own process, so loading them here
 * as well would send the repo's rules twice and bill for both.
 */
const BASE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

class TestSession implements AgentSession {
  readonly id = randomUUID();

  constructor(
    readonly provider: string,
    readonly capabilities: AgentCapabilityFlags,
    readonly config: AgentSessionConfig,
  ) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }

  subscribe(): () => void {
    return () => {};
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
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

class TestClient implements AgentClient {
  lastSession: TestSession | null = null;

  constructor(
    readonly provider: string,
    readonly capabilities: AgentCapabilityFlags,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.lastSession = new TestSession(this.provider, this.capabilities, config);
    return this.lastSession;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async resumeSession(): Promise<AgentSession> {
    throw new Error("unused");
  }
}

const logger = createTestLogger();
const INSTRUCTIONS = '<instructions path="AGENTS.md">\nNever use em-dashes.\n</instructions>';

function createHarness(options: { ownsContextPayload: boolean }) {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-instructions-test-"));
  const client = new TestClient("test-provider", {
    ...BASE_CAPABILITIES,
    ...(options.ownsContextPayload ? { ownsContextPayload: true } : {}),
  });
  const manager = new AgentManager({
    clients: { "test-provider": client } as unknown as Record<string, AgentClient>,
    logger,
    resolveInstructionFiles: async () => INSTRUCTIONS,
  });
  return {
    manager,
    client,
    workdir,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

test("a payload-owning provider receives the workspace's instruction files", async () => {
  const harness = createHarness({ ownsContextPayload: true });
  try {
    await harness.manager.createAgent(
      { provider: "test-provider", cwd: harness.workdir, systemPrompt: "You are Vera." },
      undefined,
      { workspaceId: undefined },
    );

    expect(harness.client.lastSession?.config.systemPrompt).toBe(
      `You are Vera.\n\n${INSTRUCTIONS}`,
    );
  } finally {
    harness.cleanup();
  }
});

test("a CLI-backed provider is left to read its own instruction files", async () => {
  const harness = createHarness({ ownsContextPayload: false });
  try {
    await harness.manager.createAgent(
      { provider: "test-provider", cwd: harness.workdir, systemPrompt: "You are Vera." },
      undefined,
      { workspaceId: undefined },
    );

    expect(harness.client.lastSession?.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});

/**
 * Runtime-only, exactly like personality memory and the knowledge catalog:
 * editing AGENTS.md has to reach the next session without rewriting any agent
 * record, and the stored prompt has to stay comparable for the
 * live-personality-switch ownership check.
 */
test("instruction files never reach the stored config", async () => {
  const harness = createHarness({ ownsContextPayload: true });
  try {
    const agent = await harness.manager.createAgent(
      { provider: "test-provider", cwd: harness.workdir, systemPrompt: "You are Vera." },
      undefined,
      { workspaceId: undefined },
    );

    expect(agent.config.systemPrompt).toBe("You are Vera.");
  } finally {
    harness.cleanup();
  }
});
