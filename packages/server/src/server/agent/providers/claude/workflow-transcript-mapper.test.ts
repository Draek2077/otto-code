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
});
