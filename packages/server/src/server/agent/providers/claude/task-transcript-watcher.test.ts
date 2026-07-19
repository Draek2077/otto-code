import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";

import { claudeProjectDirSync } from "./project-dir.js";
import {
  TaskTranscriptWatcher,
  readClaudeSubagentAgentIdFromToolResult,
} from "./task-transcript-watcher.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

describe("readClaudeSubagentAgentIdFromToolResult", () => {
  test("reads the agentId from a plain string result", () => {
    expect(
      readClaudeSubagentAgentIdFromToolResult(
        "Async agent launched successfully.\nagentId: a4e02979b6c4d5625 (internal ID - do not mention to user.)",
      ),
    ).toBe("a4e02979b6c4d5625");
  });

  test("reads the agentId from a block array (sync nested completion shape)", () => {
    expect(
      readClaudeSubagentAgentIdFromToolResult([
        { type: "text", text: "20" },
        {
          type: "text",
          text: "agentId: a433687a4380684b3 (use SendMessage with to: 'a433687a4380684b3')",
        },
      ]),
    ).toBe("a433687a4380684b3");
  });

  test("returns undefined when no agentId note is present", () => {
    expect(readClaudeSubagentAgentIdFromToolResult("plain tool output")).toBeUndefined();
    expect(readClaudeSubagentAgentIdFromToolResult([{ type: "text", text: "42" }])).toBeUndefined();
    expect(readClaudeSubagentAgentIdFromToolResult(undefined)).toBeUndefined();
  });
});

describe("TaskTranscriptWatcher", () => {
  const SESSION_ID = "session-tttw";
  let tmpConfigDir: string;
  let cwd: string;
  let subagentsDir: string;
  let events: AgentStreamEvent[];
  let watcher: TaskTranscriptWatcher | null;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "otto-tttw-"));
    cwd = process.cwd();
    const projectDir = claudeProjectDirSync(cwd, { configDir: tmpConfigDir });
    subagentsDir = path.join(projectDir, SESSION_ID, "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });
    events = [];
    watcher = null;
  });

  afterEach(() => {
    watcher?.close();
    vi.useRealTimers();
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  function createWatcher(overrides?: { settleDrainMs?: number }): TaskTranscriptWatcher {
    watcher = new TaskTranscriptWatcher({
      cwd,
      configDir: tmpConfigDir,
      getSessionId: () => SESSION_ID,
      emit: (event) => events.push(event),
      logger,
      pollIntervalMs: 50,
      settleDrainMs: overrides?.settleDrainMs ?? 200,
    });
    return watcher;
  }

  function writeTranscript(agentId: string, lines: object[], append = false): void {
    const filePath = path.join(subagentsDir, `agent-${agentId}.jsonl`);
    const payload = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    if (append) {
      fs.appendFileSync(filePath, payload);
    } else {
      fs.writeFileSync(filePath, payload);
    }
  }

  function assistantFrame(messageId: string, outputTokens: number, extra?: object) {
    return {
      type: "assistant",
      uuid: `uuid-${messageId}-${outputTokens}`,
      message: {
        role: "assistant",
        id: messageId,
        model: "claude-haiku-4-5",
        usage: {
          input_tokens: 4,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 300,
          output_tokens: outputTokens,
        },
        content: [{ type: "text", text: `frame ${outputTokens}` }],
        ...extra,
      },
    };
  }

  function usageUpdates() {
    return events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "observed_subagent_updated" }> =>
        event.type === "observed_subagent_updated",
    );
  }

  test("emits the deduped usage split, model, rounds and grand total from disk", () => {
    // Two frames of one message (message_start snapshot then final) plus a
    // second message — the accumulator must keep the max-output frame per id.
    writeTranscript("agent-1-id", [
      { type: "user", uuid: "u1", message: { role: "user", content: "count the words" } },
      assistantFrame("msg_1", 2),
      assistantFrame("msg_1", 50),
      assistantFrame("msg_2", 25),
    ]);

    createWatcher().bind({ key: "toolu_1", agentId: "agent-1-id", emitTimeline: false });

    const updates = usageUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.update).toMatchObject({
      key: "toolu_1",
      status: "running",
      model: "claude-haiku-4-5",
      usageRounds: 2,
      // per message: 4 in + 100 cacheRead + 300 cacheCreation; outputs 50 + 25
      cumulativeTokens: 4 * 2 + 100 * 2 + 300 * 2 + 50 + 25,
    });
    expect(updates[0]!.update.usage).toMatchObject({
      inputTokens: 8,
      cachedInputTokens: 200,
      cacheCreationInputTokens: 600,
      outputTokens: 75,
    });
  });

  test("emits timeline items from disk only for nested keys", () => {
    writeTranscript("nested-id", [
      { type: "user", uuid: "u1", message: { role: "user", content: "count the words" } },
      assistantFrame("msg_1", 10),
    ]);
    writeTranscript("depth1-id", [
      { type: "user", uuid: "u2", message: { role: "user", content: "top level prompt" } },
      assistantFrame("msg_9", 10),
    ]);

    const w = createWatcher();
    w.bind({ key: "toolu_nested", agentId: "nested-id", emitTimeline: true });
    w.bind({ key: "toolu_depth1", agentId: "depth1-id", emitTimeline: false });

    const timeline = events.filter((event) => event.type === "observed_subagent_timeline");
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.every((event) => "key" in event && event.key === "toolu_nested")).toBe(true);
  });

  test("keeps tailing while the transcript grows, then drains after settle", () => {
    writeTranscript("grow-id", [assistantFrame("msg_1", 10)]);
    const w = createWatcher({ settleDrainMs: 100 });
    w.bind({ key: "toolu_grow", agentId: "grow-id", emitTimeline: false });
    expect(usageUpdates()).toHaveLength(1);

    // Growth between polls is picked up.
    writeTranscript("grow-id", [assistantFrame("msg_2", 30)], true);
    vi.advanceTimersByTime(60);
    expect(usageUpdates()).toHaveLength(2);
    expect(usageUpdates()[1]!.update.usage?.outputTokens).toBe(40);

    // A flush landing just after settle still books, re-asserting the settled
    // status instead of flipping the row back to running.
    w.markSettled("toolu_grow", "idle");
    writeTranscript("grow-id", [assistantFrame("msg_3", 5)], true);
    vi.advanceTimersByTime(60);
    const postSettle = usageUpdates()[2]!;
    expect(postSettle.update.status).toBe("idle");
    expect(postSettle.update.usage?.outputTokens).toBe(45);

    // After the drain window the entry is done — later writes no longer emit.
    vi.advanceTimersByTime(200);
    const countAfterDrain = usageUpdates().length;
    writeTranscript("grow-id", [assistantFrame("msg_4", 5)], true);
    vi.advanceTimersByTime(200);
    expect(usageUpdates()).toHaveLength(countAfterDrain);
  });

  test("tolerates a transcript that appears only after bind", () => {
    const w = createWatcher();
    w.bind({ key: "toolu_late", agentId: "late-id", emitTimeline: false });
    expect(usageUpdates()).toHaveLength(0);

    writeTranscript("late-id", [assistantFrame("msg_1", 12)]);
    vi.advanceTimersByTime(60);
    expect(usageUpdates()).toHaveLength(1);
    expect(usageUpdates()[0]!.update.usage?.outputTokens).toBe(12);
  });
});
