import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";
import { removeTempDir } from "../../test-utils/remove-temp-dir.js";

// Use gpt-5.4-mini with low thinking preset for faster test execution
const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

describe("daemon E2E", () => {
  let ctx: DaemonTestContext;
  let collector: MessageCollector;
  const tempRoots: string[] = [];

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    collector = createMessageCollector(ctx.client);
  });

  afterEach(async () => {
    collector.unsubscribe();
    await ctx.cleanup();
    for (const tempRoot of tempRoots.splice(0)) {
      removeTempDir(tempRoot);
    }
  }, 60000);

  test("creates agent and receives response", async () => {
    // A real directory from the OS temp root. Hardcoding "/tmp" made the daemon
    // resolve it to "C:\tmp" on Windows, so the echoed cwd never matched.
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "agent-basics-")));
    tempRoots.push(cwd);

    // Create a Codex agent
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd,
      title: "Test Agent",
    });

    expect(agent.id).toBeTruthy();
    expect(agent.provider).toBe("codex");
    expect(agent.status).toBe("idle");
    // Title may or may not be set depending on timing
    expect(agent.cwd).toBe(cwd);

    // Send a simple message
    await ctx.client.sendMessage(agent.id, "Say 'hello world' and nothing else");

    // Wait for the agent to complete
    const finalState = await ctx.client.waitForFinish(agent.id, 120000);

    // Verify agent completed without error
    expect(finalState.status).toBe("idle");
    expect(finalState.final?.lastError).toBeUndefined();
    expect(finalState.final?.id).toBe(agent.id);

    // Verify we received some stream events
    const queue = collector.messages;
    const streamEvents = queue.filter(
      (m) => m.type === "agent_stream" && m.payload.agentId === agent.id,
    );
    expect(streamEvents.length).toBeGreaterThan(0);

    // Verify there was a turn_started event
    const hasTurnStarted = streamEvents.some(
      (m) => m.type === "agent_stream" && m.payload.event.type === "turn_started",
    );
    expect(hasTurnStarted).toBe(true);

    // Verify there was a turn_completed event
    const hasTurnCompleted = streamEvents.some(
      (m) => m.type === "agent_stream" && m.payload.event.type === "turn_completed",
    );
    expect(hasTurnCompleted).toBe(true);

    // Verify there was an assistant message in the timeline
    const hasAssistantMessage = streamEvents.some((m) => {
      if (m.type !== "agent_stream" || m.payload.event.type !== "timeline") {
        return false;
      }
      const item = m.payload.event.item;
      return item.type === "assistant_message" && item.text.length > 0;
    });
    expect(hasAssistantMessage).toBe(true);
  }, 180000); // 3 minute timeout for E2E test

  test("fails to create agent with non-existent cwd", async () => {
    // Built from the OS temp root so the path the daemon echoes back in the
    // error is the same string we assert on, on POSIX and Windows alike.
    const nonExistentCwd = path.join(tmpdir(), "this-path-does-not-exist-12345");

    await expect(
      ctx.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd: nonExistentCwd,
        title: "Should Fail Agent",
      }),
    ).rejects.toThrow(nonExistentCwd);
  });
});
