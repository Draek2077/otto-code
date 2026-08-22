import { describe, expect, it } from "vitest";
import { resolveComposerInputMode } from "./input-mode";

describe("resolveComposerInputMode", () => {
  it("keeps usage and dictation controls in chat", () => {
    const mode = resolveComposerInputMode("chat");

    expect(mode.showUsageMeter).toBe(true);
    expect(mode.showAutoSpeechButton).toBe(true);
    expect(mode.showVoice).toBe(true);
  });

  it("hides usage and dictation controls for terminal prompts", () => {
    const mode = resolveComposerInputMode("terminal");

    expect(mode.showUsageMeter).toBe(false);
    expect(mode.showAutoSpeechButton).toBe(false);
    expect(mode.showVoice).toBe(false);
  });
});
