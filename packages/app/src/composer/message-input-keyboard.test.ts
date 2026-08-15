import { describe, expect, it } from "vitest";
import { resolveNonAgentMessageInputKeyboardAction } from "./message-input-keyboard-actions";

describe("resolveNonAgentMessageInputKeyboardAction", () => {
  it("keeps room shortcuts to sending and dictation", () => {
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.send")).toBe("send");
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.dictation-toggle")).toBe(
      "dictation-toggle",
    );
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.dictation-cancel")).toBe(
      "dictation-cancel",
    );
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.dictation-confirm")).toBe(
      "dictation-confirm",
    );
  });

  it("does not route agent controls through a communications room", () => {
    expect(resolveNonAgentMessageInputKeyboardAction("agent.interrupt")).toBeNull();
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.voice-toggle")).toBeNull();
    expect(resolveNonAgentMessageInputKeyboardAction("message-input.voice-mute-toggle")).toBeNull();
  });
});
