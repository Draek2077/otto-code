import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { AgentAttachment } from "@otto-code/protocol/messages";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { startAgentRun } from "./agent-prompt.js";
import { toAgentPayload } from "./agent-projections.js";
import { cancelAgentRunCommand } from "./lifecycle-command.js";
import { buildAgentPrompt } from "./prompt-attachments.js";
import {
  createSteerQueueEntry,
  mergeSteerQueueBatch,
  steerQueuePreview,
  steerQueuePromptParts,
  takeNextSteerQueueBatch,
} from "./steer-queue-state.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const TEST_CAPABILITIES = {
  streaming: true,
  permissions: false,
  modes: false,
  models: false,
  interrupts: true,
  resume: true,
  thinkingLevels: false,
} as const;

const logger = createTestLogger();

/** A prompt attachment block, the shape the composer sends for an upload. */
function uploadedFile(fileName: string): AgentAttachment {
  return {
    type: "uploaded_file",
    id: `file-${fileName}`,
    fileName,
    mimeType: "application/octet-stream",
    size: 1,
    path: `/tmp/${fileName}`,
  };
}

/** Identify an attachment in an assertion without narrowing the union by hand. */
function attachmentLabel(attachment: AgentAttachment): string {
  return attachment.type === "uploaded_file" ? attachment.fileName : attachment.type;
}

/**
 * A session whose turns stay open until the test completes them. The queue is
 * all about what happens WHILE a turn is in flight, so the test has to own the
 * turn boundary.
 */
class ControlledSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  readonly id = randomUUID();
  readonly prompts: AgentPromptInput[] = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnIdCounter = 0;
  private openTurnId: string | null = null;

  constructor(private readonly config: AgentSessionConfig) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(prompt);
    const turnId = `turn-${++this.turnIdCounter}`;
    this.openTurnId = turnId;
    // setTimeout so the event lands after the caller has installed its waiter.
    setTimeout(() => {
      this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
    }, 0);
    return { turnId };
  }

  completeTurn(): void {
    const turnId = this.openTurnId;
    if (!turnId) {
      throw new Error("No open turn to complete");
    }
    this.openTurnId = null;
    this.pushEvent({ type: "turn_completed", provider: this.provider, turnId });
  }

  failTurn(error: string): void {
    const turnId = this.openTurnId;
    if (!turnId) {
      throw new Error("No open turn to fail");
    }
    this.openTurnId = null;
    this.pushEvent({ type: "turn_failed", provider: this.provider, error, turnId });
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private pushEvent(event: AgentStreamEvent): void {
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
      modeId: null,
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

  async interrupt(): Promise<void> {
    if (this.openTurnId) {
      const turnId = this.openTurnId;
      this.openTurnId = null;
      this.pushEvent({
        type: "turn_canceled",
        provider: this.provider,
        reason: "interrupted",
        turnId,
      });
    }
  }

  async close(): Promise<void> {}
}

class ControlledClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = TEST_CAPABILITIES;
  session: ControlledSession | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.session = new ControlledSession(config);
    return this.session;
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    this.session = new ControlledSession({
      provider: "codex",
      cwd: config?.cwd ?? process.cwd(),
    });
    return this.session;
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

interface Harness {
  manager: AgentManager;
  agentId: string;
  session: ControlledSession;
}

async function createRunningAgent(): Promise<Harness> {
  const client = new ControlledClient();
  const manager = new AgentManager({ clients: { codex: client }, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: process.cwd() }, undefined, {
    workspaceId: undefined,
  });
  const session = client.session;
  if (!session) {
    throw new Error("Expected a created session");
  }

  startAgentRun(manager, agent.id, "first turn", logger);
  await settle();
  expect(manager.getAgent(agent.id)?.lifecycle).toBe("running");

  return { manager, agentId: agent.id, session };
}

describe("steer queue state", () => {
  test("merges consecutive user messages into one prompt and keeps FIFO order", () => {
    const queue = [
      createSteerQueueEntry({ prompt: "also update the tests", runOptions: { messageId: "m1" } }),
      createSteerQueueEntry({ prompt: "and keep the public API stable" }),
    ];

    const batch = takeNextSteerQueueBatch(queue);
    expect(batch?.entries).toHaveLength(2);
    expect(batch?.rest).toHaveLength(0);
    expect(mergeSteerQueueBatch(batch!.entries)).toEqual({
      prompt: "also update the tests\n\nand keep the public API stable",
      runOptions: { messageId: "m1" },
    });
  });

  test("never merges a system-injected message with a user one", () => {
    const queue = [
      createSteerQueueEntry({ prompt: "user note" }),
      createSteerQueueEntry({
        prompt: "<otto-system>child finished</otto-system>",
        source: "system",
      }),
      createSteerQueueEntry({ prompt: "later user note" }),
    ];

    const first = takeNextSteerQueueBatch(queue);
    expect(first?.entries.map((entry) => entry.prompt)).toEqual(["user note"]);

    const second = takeNextSteerQueueBatch(first!.rest);
    expect(second?.entries.map((entry) => entry.prompt)).toEqual([
      "<otto-system>child finished</otto-system>",
    ]);
    expect(second?.rest.map((entry) => entry.prompt)).toEqual(["later user note"]);
  });

  test("merging carries images and attachments through in order", () => {
    const batch = [
      createSteerQueueEntry({
        prompt: [
          { type: "text", text: "look at this" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      }),
      createSteerQueueEntry({ prompt: "and this too" }),
    ];

    const merged = mergeSteerQueueBatch(batch);
    expect(steerQueuePromptParts(merged.prompt)).toEqual({
      text: "look at this\n\nand this too",
      images: [{ data: "AAAA", mimeType: "image/png" }],
      attachments: [],
    });
  });

  test("merging keeps the union of every entry's attachments, in FIFO order", () => {
    const batch = [
      createSteerQueueEntry({
        prompt: [
          { type: "text", text: "start here" },
          { type: "image", data: "IMG1", mimeType: "image/png" },
          uploadedFile("one.pdf"),
        ],
      }),
      createSteerQueueEntry({
        prompt: [
          { type: "text", text: "and this" },
          uploadedFile("two.csv"),
          { type: "image", data: "IMG2", mimeType: "image/jpeg" },
        ],
      }),
      // A text-only entry in the middle must not truncate what follows it.
      createSteerQueueEntry({ prompt: "no attachments on this one" }),
      createSteerQueueEntry({
        prompt: [{ type: "text", text: "last" }, uploadedFile("three.txt")],
      }),
    ];

    const merged = mergeSteerQueueBatch(batch);
    const parts = steerQueuePromptParts(merged.prompt);

    expect(parts.text).toBe("start here\n\nand this\n\nno attachments on this one\n\nlast");
    expect(parts.images).toEqual([
      { data: "IMG1", mimeType: "image/png" },
      { data: "IMG2", mimeType: "image/jpeg" },
    ]);
    expect(parts.attachments.map(attachmentLabel)).toEqual(["one.pdf", "two.csv", "three.txt"]);
  });

  test("preview truncates long text and ignores non-text blocks", () => {
    const entry = createSteerQueueEntry({
      prompt: [
        { type: "text", text: "x".repeat(500) },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    const preview = steerQueuePreview(entry);
    expect(preview).toHaveLength(200);
    expect(preview.endsWith("…")).toBe(true);
  });

  test("the wire count covers every attachment, prose excluded", async () => {
    const { manager, agentId } = await createRunningAgent();

    startAgentRun(
      manager,
      agentId,
      buildAgentPrompt(
        "have a look",
        [{ data: "IMG1", mimeType: "image/png" }],
        [
          uploadedFile("report.pdf"),
          // An added-to-chat file rides as a text ATTACHMENT. It is still
          // something the user attached, so the row must count it.
          { type: "text", mimeType: "text/plain", title: "File · src/app.ts", text: "…" },
        ],
      ),
      logger,
      { delivery: "queue" },
    );
    startAgentRun(manager, agentId, "plain prose, nothing attached", logger, { delivery: "queue" });

    const queued = toAgentPayload(manager.getAgent(agentId)!).queuedMessages;
    expect(queued?.[0]?.attachmentCount).toBe(3);
    // Absent rather than 0, so the field stays off the wire when there is nothing to say.
    expect(queued?.[1]?.attachmentCount).toBeUndefined();
  });

  test("an empty queue has nothing to drain", () => {
    expect(takeNextSteerQueueBatch([])).toBeNull();
  });
});

describe("queued delivery", () => {
  test("a queued message waits for the running turn, then runs as the next one", async () => {
    const { manager, agentId, session } = await createRunningAgent();

    const result = startAgentRun(manager, agentId, "next, run the linter", logger, {
      delivery: "queue",
    });
    expect(result).toMatchObject({ outOfBand: false, queued: true });
    // The turn in flight is untouched, and the queue is visible on the snapshot.
    expect(session.prompts).toEqual(["first turn"]);
    expect(toAgentPayload(manager.getAgent(agentId)!).queuedMessages).toMatchObject([
      { preview: "next, run the linter" },
    ]);

    session.completeTurn();
    await settle();

    expect(session.prompts).toEqual(["first turn", "next, run the linter"]);
    expect(manager.getAgent(agentId)?.lifecycle).toBe("running");
    expect(manager.getSteerQueue(agentId)).toEqual([]);
  });

  test("the agent never reports idle between the finished turn and the queued one", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    const lifecycles: string[] = [];
    manager.subscribe(
      (event) => {
        if (event.type === "agent_state") {
          lifecycles.push(event.agent.lifecycle);
        }
      },
      { agentId, replayState: false },
    );

    startAgentRun(manager, agentId, "follow-up", logger, { delivery: "queue" });
    session.completeTurn();
    await settle();

    expect(lifecycles).not.toContain("idle");
  });

  test("several messages queued before the turn ends are delivered as one turn", async () => {
    const { manager, agentId, session } = await createRunningAgent();

    startAgentRun(manager, agentId, "use the existing helper", logger, { delivery: "queue" });
    startAgentRun(manager, agentId, "and add a test", logger, { delivery: "queue" });
    startAgentRun(manager, agentId, "then run lint", logger, { delivery: "queue" });
    expect(manager.getSteerQueue(agentId)).toHaveLength(3);

    session.completeTurn();
    await settle();

    expect(session.prompts).toEqual([
      "first turn",
      "use the existing helper\n\nand add a test\n\nthen run lint",
    ]);
    expect(manager.getSteerQueue(agentId)).toEqual([]);
  });

  test("grouped queued messages deliver every attachment they carried", async () => {
    const { manager, agentId, session } = await createRunningAgent();

    // Exactly what the composer sends: buildAgentPrompt over text + images +
    // attachments, parked with delivery "queue" while a turn is in flight.
    startAgentRun(
      manager,
      agentId,
      buildAgentPrompt(
        "review this shot",
        [{ data: "IMG1", mimeType: "image/png" }],
        [uploadedFile("one.pdf")],
      ),
      logger,
      { delivery: "queue" },
    );
    startAgentRun(
      manager,
      agentId,
      buildAgentPrompt("and this spreadsheet", undefined, [uploadedFile("two.csv")]),
      logger,
      { delivery: "queue" },
    );
    startAgentRun(
      manager,
      agentId,
      buildAgentPrompt("no attachment here", undefined, undefined),
      logger,
      { delivery: "queue" },
    );

    session.completeTurn();
    await settle();

    // One merged turn, carrying the union of everything queued.
    expect(session.prompts).toHaveLength(2);
    const delivered = steerQueuePromptParts(session.prompts[1]!);
    expect(delivered.text).toBe("review this shot\n\nand this spreadsheet\n\nno attachment here");
    expect(delivered.images).toEqual([{ data: "IMG1", mimeType: "image/png" }]);
    expect(delivered.attachments.map(attachmentLabel)).toEqual(["one.pdf", "two.csv"]);
  });

  test("queueing to an idle agent runs it immediately instead of waiting", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    session.completeTurn();
    await settle();
    expect(manager.getAgent(agentId)?.lifecycle).toBe("idle");

    const result = startAgentRun(manager, agentId, "do it now", logger, { delivery: "queue" });
    await settle();

    expect(result.queued).toBe(false);
    expect(session.prompts).toEqual(["first turn", "do it now"]);
    expect(manager.getSteerQueue(agentId)).toEqual([]);
  });

  test("interrupt delivery still clobbers the running turn", async () => {
    const { manager, agentId, session } = await createRunningAgent();

    startAgentRun(manager, agentId, "stop, do this instead", logger, { replaceRunning: true });
    await settle();

    expect(session.prompts).toEqual(["first turn", "stop, do this instead"]);
    expect(manager.getSteerQueue(agentId)).toEqual([]);
  });

  test("a failed turn holds the queue instead of running it into a broken session", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    startAgentRun(manager, agentId, "queued behind a failure", logger, { delivery: "queue" });

    session.failTurn("provider exploded");
    await settle();

    expect(manager.getAgent(agentId)?.lifecycle).toBe("error");
    expect(session.prompts).toEqual(["first turn"]);
    expect(manager.getSteerQueue(agentId).map((entry) => entry.prompt)).toEqual([
      "queued behind a failure",
    ]);
  });

  test("removing an entry hands its text back and drops it from the queue", async () => {
    const { manager, agentId } = await createRunningAgent();
    startAgentRun(manager, agentId, "first queued", logger, { delivery: "queue" });
    startAgentRun(manager, agentId, "second queued", logger, { delivery: "queue" });

    const [first] = manager.getSteerQueue(agentId);
    const removed = manager.removeSteerQueueEntry(agentId, first!.id);

    expect(removed?.prompt).toBe("first queued");
    expect(manager.getSteerQueue(agentId).map((entry) => entry.prompt)).toEqual(["second queued"]);
    expect(manager.removeSteerQueueEntry(agentId, "no-such-id")).toBeNull();
  });

  test("reordering changes which queued message runs next", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    startAgentRun(manager, agentId, "first queued", logger, {
      delivery: "queue",
      source: "system",
    });
    startAgentRun(manager, agentId, "second queued", logger, {
      delivery: "queue",
      source: "system",
    });

    const [, second] = manager.getSteerQueue(agentId);
    expect(manager.reorderSteerQueueEntry(agentId, second!.id, 0)).toBe(true);
    expect(manager.getSteerQueue(agentId).map((entry) => entry.prompt)).toEqual([
      "second queued",
      "first queued",
    ]);

    session.completeTurn();
    await settle();
    expect(session.prompts).toEqual(["first turn", "second queued"]);
  });

  test("reordering clamps out-of-range targets and no-ops on a stale id", async () => {
    const { manager, agentId } = await createRunningAgent();
    startAgentRun(manager, agentId, "a", logger, { delivery: "queue", source: "system" });
    startAgentRun(manager, agentId, "b", logger, { delivery: "queue", source: "system" });

    const [first] = manager.getSteerQueue(agentId);
    // Past the end of a queue that drained under the client's feet: clamp to
    // last rather than reject, which is what the user meant.
    expect(manager.reorderSteerQueueEntry(agentId, first!.id, 99)).toBe(true);
    expect(manager.getSteerQueue(agentId).map((entry) => entry.prompt)).toEqual(["b", "a"]);

    // Already there, and never there at all: both report "nothing moved".
    expect(manager.reorderSteerQueueEntry(agentId, first!.id, 1)).toBe(false);
    expect(manager.reorderSteerQueueEntry(agentId, "no-such-id", 0)).toBe(false);
  });

  test("stopping the run keeps the queue instead of dropping it", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    startAgentRun(manager, agentId, "then update the docs", logger, { delivery: "queue" });

    await cancelAgentRunCommand({ agentManager: manager, logger }, agentId);
    await settle();

    // Stop means stop: nothing new goes out on its own...
    expect(session.prompts).toEqual(["first turn"]);
    expect(manager.getAgent(agentId)?.lifecycle).toBe("idle");
    // ...but the queued message is still there, ready to send.
    expect(manager.getSteerQueue(agentId).map((entry) => entry.prompt)).toEqual([
      "then update the docs",
    ]);
    expect(toAgentPayload(manager.getAgent(agentId)!).queuedMessages).toMatchObject([
      { preview: "then update the docs" },
    ]);
  });

  test("the hold lasts for the cancelled turn only, so the queue runs behind the next one", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    startAgentRun(manager, agentId, "then update the docs", logger, { delivery: "queue" });
    await cancelAgentRunCommand({ agentManager: manager, logger }, agentId);
    await settle();

    startAgentRun(manager, agentId, "new direction", logger);
    await settle();
    session.completeTurn();
    await settle();

    expect(session.prompts).toEqual(["first turn", "new direction", "then update the docs"]);
    expect(manager.getSteerQueue(agentId)).toEqual([]);
  });

  test("clearing empties the queue and reports how many were dropped", async () => {
    const { manager, agentId, session } = await createRunningAgent();
    startAgentRun(manager, agentId, "a", logger, { delivery: "queue" });
    startAgentRun(manager, agentId, "b", logger, { delivery: "queue" });

    expect(manager.clearSteerQueue(agentId)).toBe(2);
    expect(manager.clearSteerQueue(agentId)).toBe(0);

    session.completeTurn();
    await settle();
    expect(session.prompts).toEqual(["first turn"]);
    expect(manager.getAgent(agentId)?.lifecycle).toBe("idle");
  });
});
