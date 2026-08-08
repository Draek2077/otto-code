import { describe, expect, it, vi } from "vitest";

import { applyDictationTranscript } from "./dictation-delivery";

function context(overrides: Partial<Parameters<typeof applyDictationTranscript>[1]> = {}) {
  return {
    value: "",
    defaultSendBehavior: "interrupt" as const,
    isAgentRunning: false,
    onQueue: vi.fn(),
    onSubmit: vi.fn(),
    onChangeText: vi.fn(),
    attachments: [],
    cwd: "C:/project",
    autoSend: true,
    ...overrides,
  };
}

describe("applyDictationTranscript", () => {
  it("submits a wake-word transcript immediately when auto-send was captured", () => {
    const ctx = context({ value: "existing" });
    applyDictationTranscript("dictated command", ctx);

    expect(ctx.onSubmit).toHaveBeenCalledWith({
      text: "existing dictated command",
      attachments: [],
      cwd: "C:/project",
      forceSend: undefined,
    });
    expect(ctx.onChangeText).not.toHaveBeenCalled();
  });

  it("queues auto-sent dictation when that is the running-agent behavior", () => {
    const ctx = context({ defaultSendBehavior: "queue", isAgentRunning: true });
    applyDictationTranscript("follow up", ctx);

    expect(ctx.onQueue).toHaveBeenCalledWith({
      text: "follow up",
      attachments: [],
      cwd: "C:/project",
    });
    expect(ctx.onChangeText).toHaveBeenCalledWith("");
    expect(ctx.onSubmit).not.toHaveBeenCalled();
  });

  it("only inserts when auto-send was not requested", () => {
    const ctx = context({ autoSend: false });
    applyDictationTranscript("draft text", ctx);

    expect(ctx.onChangeText).toHaveBeenCalledWith("draft text");
    expect(ctx.onSubmit).not.toHaveBeenCalled();
  });
});
