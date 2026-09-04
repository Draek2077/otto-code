import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { startAgentRun } from "./agent-prompt.js";
import type {
  AgentClient,
  AgentPromptInput,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const logger = createTestLogger();

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

/**
 * Stands in for Codex's `/compact`: the provider handles it out of band - no
 * turn is allocated, so the provider never echoes the prompt back - and emits a
 * compaction row of its own.
 */
class OutOfBandSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  private subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(private readonly config: AgentSessionConfig) {}

  tryHandleOutOfBand(prompt: AgentPromptInput) {
    if (prompt !== "/compact") return null;
    return {
      run: async ({ emit }: { emit: (event: AgentStreamEvent) => void }) => {
        emit({
          type: "timeline",
          provider: this.provider,
          item: { type: "compaction", status: "completed", trigger: "manual" },
        });
      },
    };
  }

  async run() {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn() {
    return { turnId: `turn-${randomUUID()}` };
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

  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class OutOfBandClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    return new OutOfBandSession(config);
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async resumeSession(): Promise<AgentSession> {
    throw new Error("not used");
  }
}

async function createHarness() {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-out-of-band-"));
  const manager = new AgentManager({
    clients: { codex: new OutOfBandClient() },
    registry: new AgentStorage(join(workdir, "agents"), logger),
    logger,
  });
  const agent = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  return {
    manager,
    agentId: agent.id,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

// A slash command the provider takes out of band allocates no turn, so nothing
// on the provider side ever echoes the prompt back onto the timeline. Left
// unrecorded, the typed "/compact" existed only as the client's optimistic row:
// it vanished on reload, and every rehydration rebuilt the transcript from the
// persisted rows alone - which put the compaction separator ABOVE the command
// the reader had just typed.
test("an out-of-band command records the user's prompt before the rows it emits", async () => {
  const { manager, agentId, cleanup } = await createHarness();
  try {
    const result = await startAgentRun(manager, agentId, "/compact", logger, {
      runOptions: { clientMessageId: "composer-msg-1" },
    });
    expect(result.disposition).toBe("out_of_band");

    // The handler runs on a detached promise; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = manager.fetchTimeline(agentId, { direction: "tail", limit: 0 });
    expect(timeline.rows.map((row) => row.item.type)).toEqual(["user_message", "compaction"]);

    const userRow = timeline.rows[0];
    expect(userRow?.item).toMatchObject({
      type: "user_message",
      text: "/compact",
      clientMessageId: "composer-msg-1",
    });
    // Lower seq than the separator, so a rehydration can never reorder them.
    expect(userRow?.seq).toBeLessThan(timeline.rows[1]?.seq ?? 0);
  } finally {
    cleanup();
  }
});

test("a prompt the provider does not take out of band is left to the normal turn path", async () => {
  const { manager, agentId, cleanup } = await createHarness();
  try {
    const result = await startAgentRun(manager, agentId, "/goal ship it", logger);
    expect(result.disposition).not.toBe("out_of_band");
  } finally {
    cleanup();
  }
});
