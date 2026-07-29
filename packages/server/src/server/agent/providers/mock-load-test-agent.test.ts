import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentManager } from "../agent-manager.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent-sdk-types.js";
import {
  MOCK_LOAD_TEST_DEFAULT_MODEL_ID,
  MockLoadTestAgentClient,
} from "./mock-load-test-agent.js";

type PermissionRequestedEvent = Extract<AgentStreamEvent, { type: "permission_requested" }>;

function expectSinglePermissionRequest(events: AgentStreamEvent[]): PermissionRequestedEvent {
  const permissions = events.filter(
    (event): event is PermissionRequestedEvent => event.type === "permission_requested",
  );
  expect(permissions).toHaveLength(1);
  const [permission] = permissions;
  if (!permission) {
    throw new Error("permission request missing");
  }
  return permission;
}

// Runs one count-bounded synthetic-history turn and returns the *generated* text
// it emitted, in order.
//
// Two exclusions, both load-bearing. Ids are per-turn UUIDs, so comparing them
// would report every turn as different and prove nothing. The user_message item
// is the prompt echoed back, so including it would make this assert that the two
// prompts were equal rather than that the two conversations were.
async function runSyntheticTurnText(prompt: string): Promise<string> {
  const client = new MockLoadTestAgentClient();
  const session = await client.createSession({
    provider: "mock",
    cwd: process.cwd(),
    model: "synthetic-history",
  });
  const events: AgentStreamEvent[] = [];
  const unsubscribe = session.subscribe((event) => events.push(event));
  const completed = session.run(prompt);
  await vi.advanceTimersByTimeAsync(60_000);
  await completed;
  unsubscribe();

  return events
    .filter((event): event is Extract<AgentStreamEvent, { type: "timeline" }> => {
      return event.type === "timeline";
    })
    .map((event) => event.item as AgentTimelineItem & { text?: string; name?: string })
    .filter((item) => item.type !== "user_message")
    .map((item) => item.text ?? item.name ?? item.type)
    .join("");
}

describe("MockLoadTestAgentClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The corpus seeder pins this so a re-seed rebuilds the same conversations.
  // Without it the seed is derived from a per-turn UUID, and two seeding runs
  // produce different corpora — which would let an A/B measurement attribute a
  // corpus difference to the code change under test.
  test("a pinned synthetic-seed reproduces the same conversation", async () => {
    vi.useFakeTimers();

    const first = await runSyntheticTurnText(
      "build history\nsynthetic-history: 40\nsynthetic-seed: 12345",
    );
    const second = await runSyntheticTurnText(
      "different wording entirely\nsynthetic-history: 40\nsynthetic-seed: 12345",
    );
    const other = await runSyntheticTurnText(
      "build history\nsynthetic-history: 40\nsynthetic-seed: 999",
    );

    expect(first.length).toBeGreaterThan(0);
    // Same seed and count: identical generated content, even though the prompt
    // text differs. The prompt selects the corpus slice; it is not the content.
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  test("an unpinned synthetic-history turn still varies between turns", async () => {
    vi.useFakeTimers();

    const first = await runSyntheticTurnText("build history\nsynthetic-history: 40");
    const second = await runSyntheticTurnText("build history\nsynthetic-history: 40");

    expect(first).not.toBe(second);
  });

  test("default model is a five minute foreground stream with token-rate intervals", async () => {
    const client = new MockLoadTestAgentClient();

    const { models } = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/mock-models",
      force: false,
    });

    expect(models[0]).toMatchObject({
      id: MOCK_LOAD_TEST_DEFAULT_MODEL_ID,
      isDefault: true,
      metadata: {
        durationMs: 300_000,
        intervalMs: 40,
      },
    });
  });

  test("returns schema-shaped JSON for structured branch-name generation", async () => {
    vi.useFakeTimers();
    const client = new MockLoadTestAgentClient();
    const session = await client.createSession({
      provider: "mock",
      cwd: process.cwd(),
      model: "ten-second-stream",
    });

    const resultPromise = session.run(
      [
        "Generate a title and a git branch name for a coding agent from the user prompt and attachments.",
        "Title: a short human-readable sentence-case label for the task (no slug rules, max 80 characters).",
        "Branch: concise lowercase slug using letters, numbers, hyphens, and slashes only.",
        "Return JSON only with fields 'title' and 'branch'.",
        "",
        "<user-prompt>",
        "Fix login bug",
        "</user-prompt>",
      ].join("\n"),
    );
    await vi.advanceTimersByTimeAsync(0);

    await expect(resultPromise).resolves.toMatchObject({
      sessionId: session.id,
      finalText: JSON.stringify({ title: "Fix login bug", branch: "fix-login-bug" }),
      canceled: false,
    });
  });

  test("emits sub-word tokens, reasoning, and sequential tool calls during a foreground turn", async () => {
    vi.useFakeTimers();
    const client = new MockLoadTestAgentClient();
    const session = await client.createSession({
      provider: "mock",
      cwd: process.cwd(),
      model: "ten-second-stream",
    });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    const resultPromise = session.run("Exercise the app while terminals are busy.");

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;
    unsubscribe();

    expect(
      events.map((event) => event.type).filter((type) => type === "turn_started"),
    ).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "turn_completed",
      provider: "mock",
    });
    expect(result).toMatchObject({
      sessionId: session.id,
      finalText: "Synthetic load test complete",
      canceled: false,
    });

    const timelineItems = events.flatMap((event): AgentTimelineItem[] =>
      event.type === "timeline" ? [event.item] : [],
    );

    const assistantTokens = timelineItems.filter((item) => item.type === "assistant_message");
    const reasoningTokens = timelineItems.filter((item) => item.type === "reasoning");
    const toolCalls = timelineItems.filter((item) => item.type === "tool_call");

    // Many small token deltas, not a few big chunks.
    expect(assistantTokens.length).toBeGreaterThan(200);
    expect(reasoningTokens.length).toBeGreaterThan(20);

    // Average token length should be sub-word (a few characters).
    const avgTokenLength =
      assistantTokens.reduce(
        (sum, item) => sum + (item.type === "assistant_message" ? item.text.length : 0),
        0,
      ) / assistantTokens.length;
    expect(avgTokenLength).toBeLessThan(10);

    // First assistant token starts the cycle header.
    expect(assistantTokens[0]).toMatchObject({
      type: "assistant_message",
      text: expect.stringContaining("##"),
    });

    // Sequential tool calls fire: read, grep, edit, bash.
    const toolNames = toolCalls
      .filter((item) => item.type === "tool_call" && item.status === "running")
      .map((item) => (item.type === "tool_call" ? item.name : ""));
    expect(toolNames.slice(0, 4)).toEqual(["read", "grep", "edit", "bash"]);

    // Each tool transitions running → completed.
    const completedNames = toolCalls
      .filter((item) => item.type === "tool_call" && item.status === "completed")
      .map((item) => (item.type === "tool_call" ? item.name : ""));
    expect(completedNames).toContain("read");
    expect(completedNames).toContain("grep");
    expect(completedNames).toContain("edit");
    expect(completedNames).toContain("bash");
  });

  test("interrupt cancels the active foreground turn and stops future chunks", async () => {
    vi.useFakeTimers();
    const client = new MockLoadTestAgentClient();
    const session = await client.createSession({
      provider: "mock",
      cwd: process.cwd(),
      model: "ten-second-stream",
    });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    await session.startTurn("Cancel the synthetic stream.");
    await vi.advanceTimersByTimeAsync(0);

    await session.interrupt();
    const eventCountAfterInterrupt = events.length;
    await vi.advanceTimersByTimeAsync(10_000);
    unsubscribe();

    expect(events.at(-1)).toMatchObject({
      type: "turn_canceled",
      provider: "mock",
      reason: "Interrupted",
    });
    expect(events).toHaveLength(eventCountAfterInterrupt);
  });

  test("emits the free-write question scenario selected by prompt", async () => {
    vi.useFakeTimers();
    const client = new MockLoadTestAgentClient();
    const session = await client.createSession({
      provider: "mock",
      cwd: process.cwd(),
      model: "ten-second-stream",
    });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    const resultPromise = session.run("Emit synthetic questions: two free-write questions.");
    await vi.advanceTimersByTimeAsync(0);

    const permission = expectSinglePermissionRequest(events);
    expect(permission.request).toMatchObject({
      provider: "mock",
      name: "MockQuestions",
      kind: "question",
      input: {
        questions: [
          {
            question: "What is the GitHub private repo URL to push to?",
            header: "repoUrl",
            options: [],
            multiSelect: false,
          },
          {
            question: "What should the first commit message be?",
            header: "commitMessage",
            options: [],
            multiSelect: false,
          },
        ],
      },
    });

    await session.respondToPermission(permission.request.id, {
      behavior: "allow",
      updatedInput: {
        answers: {
          repoUrl: "git@github.com:user/private-repo.git",
          commitMessage: "Initialize private repo",
        },
      },
    });
    await expect(resultPromise).resolves.toMatchObject({
      sessionId: session.id,
      finalText: "Synthetic questions resolved",
      canceled: false,
    });
    unsubscribe();
  });

  test("agent manager coalesces adjacent assistant tokens into fewer messages", async () => {
    vi.useFakeTimers();
    const workdir = mkdtempSync(join(tmpdir(), "otto-mock-load-test-"));
    try {
      const client = new MockLoadTestAgentClient();
      const manager = new AgentManager({
        clients: { mock: client },
        idFactory: () => "00000000-0000-4000-8000-000000000001",
        logger: createTestLogger(),
      });
      const agent = await manager.createAgent(
        {
          provider: "mock",
          cwd: workdir,
          model: "ten-second-stream",
        },
        "00000000-0000-4000-8000-000000000001",
        { workspaceId: undefined },
      );

      const resultPromise = manager.runAgent(
        agent.id,
        "Stress the agent stream while terminal panes are active.",
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await resultPromise;

      const timeline = manager.getTimeline(agent.id);
      const assistantMessages = timeline.filter((item) => item.type === "assistant_message");
      const toolCalls = timeline.filter((item) => item.type === "tool_call");

      // The provider streams sub-word tokens; the coalescer batches them within
      // its flush window, so the timeline must contain materially fewer messages
      // than the underlying token deltas would suggest, and each message must
      // hold multiple tokens worth of text.
      expect(assistantMessages.length).toBeGreaterThan(0);
      const totalAssistantChars = assistantMessages.reduce(
        (sum, item) => sum + (item.type === "assistant_message" ? item.text.length : 0),
        0,
      );
      const avgMessageLength = totalAssistantChars / assistantMessages.length;
      expect(avgMessageLength).toBeGreaterThan(8);
      const longestMessage = assistantMessages
        .map((item) => (item.type === "assistant_message" ? item.text.length : 0))
        .reduce((max, length) => Math.max(max, length), 0);
      expect(longestMessage).toBeGreaterThan(20);

      // First message includes the cycle header.
      expect(assistantMessages[0]).toMatchObject({
        type: "assistant_message",
        text: expect.stringContaining("## Cycle 1"),
      });

      // Tool calls land in expected order at least once.
      const runningTools = toolCalls
        .filter((item) => item.type === "tool_call" && item.status === "completed")
        .map((item) => (item.type === "tool_call" ? item.name : ""));
      expect(runningTools).toEqual(expect.arrayContaining(["read", "grep", "edit", "bash"]));
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
