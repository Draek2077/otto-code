import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentProvider,
  AgentRunOptions,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  ProviderCatalog,
} from "./agent-sdk-types.js";

/**
 * Contract for the tool-emission stall guard as wired into AgentManager.
 *
 * The pure counting rules live in agent-stall-guard.test.ts. What is proved
 * here is the wiring: that live assistant messages and tool calls actually
 * reach the guard (they arrive through the stream coalescer, not the plain
 * timeline path), that a trip stops the run through the ordinary cancel path,
 * and that it says why in the transcript.
 */

const THRESHOLD = 15;

const TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

const AGENT_ID = "00000000-0000-4000-8000-000000000001";

class TestAgentSession implements AgentSession {
  readonly capabilities = TEST_CAPABILITIES;
  readonly id: string;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    readonly provider: AgentProvider,
    private readonly config: AgentSessionConfig,
    sessionId: string,
  ) {
    this.id = sessionId;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(_prompt: AgentPromptInput, _options?: AgentRunOptions) {
    return { turnId: "turn-1" };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  pushEvent(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      callback(event);
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class TestAgentClient implements AgentClient {
  readonly capabilities = TEST_CAPABILITIES;
  private sessionCounter = 0;
  readonly sessions = new Map<string, TestAgentSession>();

  constructor(readonly provider: AgentProvider = "codex") {}

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const session = new TestAgentSession(
      config.provider,
      config,
      `${config.provider}-session-${++this.sessionCounter}`,
    );
    this.sessions.set(config.cwd, session);
    return session;
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return this.createSession({
      provider: this.provider,
      cwd: config?.cwd ?? process.cwd(),
      ...config,
    });
  }

  async fetchCatalog(): Promise<ProviderCatalog> {
    return {
      models: [{ provider: this.provider, id: "test-model", label: "Test Model", isDefault: true }],
      modes: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getSession(cwd: string): TestAgentSession {
    const session = this.sessions.get(cwd);
    if (!session) {
      throw new Error(`No test session for cwd ${cwd}`);
    }
    return session;
  }
}

interface Harness {
  manager: AgentManager;
  session: TestAgentSession;
  agentId: string;
  cleanup: () => void;
}

async function createHarness(options?: { stallGuardThreshold?: number }): Promise<Harness> {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-stall-guard-"));
  const client = new TestAgentClient();
  const manager = new AgentManager({
    clients: { [client.provider]: client },
    idFactory: () => AGENT_ID,
    logger: createTestLogger(),
    // Flush the stream coalescer as soon as the event loop turns, so a test
    // does not have to wait out the production 60ms window per burst.
    agentStreamCoalesceWindowMs: 0,
    agentBehaviors: {
      stallGuardThreshold: options?.stallGuardThreshold ?? THRESHOLD,
    },
  });
  await manager.createAgent({ provider: client.provider, cwd: workdir }, AGENT_ID, {
    workspaceId: undefined,
  });
  return {
    manager,
    session: client.getSession(workdir),
    agentId: AGENT_ID,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

function assistant(text: string, messageId: string): AgentStreamEvent {
  return {
    type: "timeline",
    provider: "codex",
    turnId: "turn-1",
    item: { type: "assistant_message", text, messageId },
  };
}

function toolCall(callId: string): AgentStreamEvent {
  return {
    type: "timeline",
    provider: "codex",
    turnId: "turn-1",
    item: {
      type: "tool_call",
      callId,
      name: "shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "printf ok", output: "ok", exitCode: 0 },
    },
  };
}

function userMessage(text: string): AgentStreamEvent {
  return {
    type: "timeline",
    provider: "codex",
    turnId: "turn-1",
    item: { type: "user_message", text },
  };
}

/** Let the coalescer's zero-delay flush timer and the manager's queue drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function stallErrors(
  manager: AgentManager,
  agentId: string,
): Promise<Extract<AgentTimelineItem, { type: "error" }>[]> {
  const rows = await manager.getTimelineRows(agentId);
  return rows
    .map((row) => row.item)
    .filter(
      (item): item is Extract<AgentTimelineItem, { type: "error" }> =>
        item.type === "error" && item.message.includes("consecutive messages"),
    );
}

describe("agent manager stall guard", () => {
  test("stops the run and says why after a text-only burst", async () => {
    const harness = await createHarness();
    try {
      const cancel = vi.spyOn(harness.manager, "cancelAgentRun");

      for (let index = 0; index < 40; index += 1) {
        harness.session.pushEvent(assistant("Let me produce the three tool calls.", `m-${index}`));
      }
      await settle();

      const errors = await stallErrors(harness.manager, harness.agentId);
      // One stop, not one per message past the threshold.
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain(`no tool calls in ${THRESHOLD} consecutive messages`);
      // Stopped through the ordinary cancel path, not by throwing.
      expect(cancel).toHaveBeenCalledWith(harness.agentId);
    } finally {
      harness.cleanup();
    }
  });

  test("leaves a long working stream alone because tool calls reset the count", async () => {
    const harness = await createHarness();
    try {
      const cancel = vi.spyOn(harness.manager, "cancelAgentRun");

      for (let round = 0; round < 60; round += 1) {
        harness.session.pushEvent(assistant(`Step ${round}, part one.`, `m-${round}a`));
        harness.session.pushEvent(assistant(`Step ${round}, part two.`, `m-${round}b`));
        harness.session.pushEvent(assistant(`Step ${round}, part three.`, `m-${round}c`));
        harness.session.pushEvent(toolCall(`call-${round}`));
      }
      await settle();

      expect(await stallErrors(harness.manager, harness.agentId)).toEqual([]);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      harness.cleanup();
    }
  });

  test("leaves ordinary conversation alone because user prompts reset the count", async () => {
    const harness = await createHarness();
    try {
      for (let turn = 0; turn < 40; turn += 1) {
        harness.session.pushEvent(userMessage(`Question ${turn}?`));
        harness.session.pushEvent(assistant(`Answer ${turn}.`, `m-${turn}`));
      }
      await settle();

      expect(await stallErrors(harness.manager, harness.agentId)).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  test("does nothing when the threshold is 0", async () => {
    const harness = await createHarness({ stallGuardThreshold: 0 });
    try {
      const cancel = vi.spyOn(harness.manager, "cancelAgentRun");

      for (let index = 0; index < 200; index += 1) {
        harness.session.pushEvent(assistant("Going.", `m-${index}`));
      }
      await settle();

      expect(await stallErrors(harness.manager, harness.agentId)).toEqual([]);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      harness.cleanup();
    }
  });
});
