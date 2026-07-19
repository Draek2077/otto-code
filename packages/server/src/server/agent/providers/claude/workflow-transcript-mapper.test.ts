import { describe, expect, it } from "vitest";

import { WorkflowSubagentTranscriptMapper } from "./workflow-transcript-mapper.js";

// Real on-disk workflow-subagent transcript shapes (see the captured run in
// projects/workflow-decomposition/workflow-decomposition.md): a rich envelope
// plus a nested `message`. One assistant turn is split across lines sharing one
// message.id; tool_use (name+input) and tool_result (output, keyed by
// tool_use_id) live on separate lines.

function userPrompt(text: string, uuid = "u1") {
  return { type: "user", uuid, message: { role: "user", content: text } };
}

function assistantText(text: string, uuid: string, messageId: string, outputTokens: number) {
  return {
    type: "assistant",
    uuid,
    message: {
      id: messageId,
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { input_tokens: 3, output_tokens: outputTokens },
    },
  };
}

function assistantToolUse(
  toolUseId: string,
  name: string,
  input: unknown,
  uuid: string,
  messageId: string,
  outputTokens: number,
) {
  return {
    type: "assistant",
    uuid,
    message: {
      id: messageId,
      role: "assistant",
      content: [{ type: "tool_use", id: toolUseId, name, input }],
      usage: { input_tokens: 3, output_tokens: outputTokens },
    },
  };
}

// A frame carrying an explicit usage block (and optional model), for exercising
// the full in/out/cache accounting — shapes mirror the real on-disk transcript.
function usageFrame(opts: {
  uuid: string;
  messageId: string;
  model?: string;
  usage: {
    input_tokens?: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}) {
  return {
    type: "assistant",
    uuid: opts.uuid,
    message: {
      id: opts.messageId,
      role: "assistant",
      ...(opts.model ? { model: opts.model } : {}),
      content: [{ type: "text", text: "…" }],
      usage: opts.usage,
    },
  };
}

function toolResult(toolUseId: string, content: string, isError = false) {
  return {
    type: "user",
    uuid: `r-${toolUseId}`,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  };
}

describe("WorkflowSubagentTranscriptMapper", () => {
  it("maps the initial user prompt to a user_message", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    const items = mapper.mapEntry(userPrompt("Read packages/protocol and report the schemas."));
    expect(items).toEqual([
      {
        type: "user_message",
        text: "Read packages/protocol and report the schemas.",
        messageId: "u1",
      },
    ]);
  });

  it("maps assistant text to an assistant_message stamped with the entry uuid", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    const items = mapper.mapEntry(assistantText("I'll search for the file.", "a1", "msg_1", 1));
    expect(items).toEqual([
      { type: "assistant_message", text: "I'll search for the file.", messageId: "a1" },
    ]);
  });

  it("maps a tool_use block to a running tool_call, then its tool_result to a completed one", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    const running = mapper.mapEntry(
      assistantToolUse("toolu_1", "Read", { file_path: "/repo/x.ts" }, "a2", "msg_2", 1),
    );
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({
      type: "tool_call",
      callId: "toolu_1",
      name: "Read",
      status: "running",
    });

    const completed = mapper.mapEntry(toolResult("toolu_1", "1\timport x"));
    expect(completed).toHaveLength(1);
    // Name + input are recovered from the earlier tool_use line via the mapper's cache.
    expect(completed[0]).toMatchObject({
      type: "tool_call",
      callId: "toolu_1",
      name: "Read",
      status: "completed",
    });
  });

  it("maps an is_error tool_result to a failed tool_call", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    mapper.mapEntry(assistantToolUse("toolu_2", "Bash", { command: "false" }, "a3", "msg_3", 1));
    const failed = mapper.mapEntry(toolResult("toolu_2", "boom", true));
    expect(failed[0]).toMatchObject({ type: "tool_call", callId: "toolu_2", status: "failed" });
    expect((failed[0] as { error: unknown }).error).toBeTruthy();
  });

  it("maps thinking blocks to reasoning items", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    const entry = {
      type: "assistant",
      uuid: "a4",
      message: {
        id: "msg_4",
        role: "assistant",
        content: [{ type: "thinking", thinking: "Let me plan." }],
      },
    };
    expect(mapper.mapEntry(entry)).toEqual([{ type: "reasoning", text: "Let me plan." }]);
  });

  it("ignores attachment lines (no message)", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    const attachment = {
      type: undefined,
      attachment: { type: "skill_listing", names: ["a", "b"] },
    };
    expect(mapper.mapEntry(attachment)).toEqual([]);
  });

  it("accumulates output tokens, deduped by message.id (max per turn, summed)", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    // Turn 1: text line (out=1) then tool_use line (out=102) share msg_A → count 102.
    mapper.mapEntry(assistantText("thinking", "a5", "msg_A", 1));
    mapper.mapEntry(assistantToolUse("toolu_3", "Read", {}, "a6", "msg_A", 102));
    // Turn 2: a second message → out=50.
    mapper.mapEntry(assistantText("done", "a7", "msg_B", 50));
    expect(mapper.cumulativeOutputTokens()).toBe(152);
  });

  it("sums the full in/out/cache split, deduped by message.id (final frame wins)", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    // msg_A streams twice (values from the real captured Haiku transcript): the
    // final frame (out=913) carries the authoritative cache split, not the first.
    mapper.mapEntry(
      usageFrame({
        uuid: "a1",
        messageId: "msg_A",
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_creation_input_tokens: 7178,
          cache_read_input_tokens: 13644,
        },
      }),
    );
    mapper.mapEntry(
      usageFrame({
        uuid: "a2",
        messageId: "msg_A",
        usage: {
          input_tokens: 4,
          output_tokens: 913,
          cache_creation_input_tokens: 726,
          cache_read_input_tokens: 68161,
        },
      }),
    );
    // A second message adds on top of the first.
    mapper.mapEntry(
      usageFrame({
        uuid: "a3",
        messageId: "msg_B",
        usage: { input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 100 },
      }),
    );

    expect(mapper.usageTotals()).toEqual({
      inputTokens: 4 + 2,
      cacheCreationInputTokens: 726 + 0,
      cacheReadInputTokens: 68161 + 100,
      outputTokens: 913 + 40,
    });
  });

  it("treats missing cache fields as zero", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    mapper.mapEntry(
      usageFrame({ uuid: "a1", messageId: "m1", usage: { input_tokens: 10, output_tokens: 7 } }),
    );
    expect(mapper.usageTotals()).toEqual({
      inputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 7,
    });
  });

  it("captures the sub-agent's model (first seen wins)", () => {
    const mapper = new WorkflowSubagentTranscriptMapper();
    expect(mapper.model()).toBeUndefined();
    mapper.mapEntry(
      usageFrame({
        uuid: "a1",
        messageId: "m1",
        model: "claude-haiku-4-5-20251001",
        usage: { output_tokens: 1 },
      }),
    );
    mapper.mapEntry(
      usageFrame({
        uuid: "a2",
        messageId: "m2",
        model: "claude-sonnet-5",
        usage: { output_tokens: 5 },
      }),
    );
    expect(mapper.model()).toBe("claude-haiku-4-5-20251001");
  });
});
