import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_VOICE_CUES,
  __resetAgentVoiceCueThrottleForTests,
  pickAgentVoiceCue,
} from "./use-agent-voice-cues";

describe("pickAgentVoiceCue", () => {
  it("uses the stock line when a personality has no voice cues", () => {
    __resetAgentVoiceCueThrottleForTests();

    expect(pickAgentVoiceCue(undefined, "join", "agent:join")).toBe("Starting!");
    expect(pickAgentVoiceCue(undefined, "thinking", "agent:thinking")).toBe("Thinking...");
    expect(pickAgentVoiceCue(undefined, "waiting", "agent:waiting")).toBe("Waiting...");
    expect(pickAgentVoiceCue(undefined, "done", "agent:done")).toBe("Complete!");
  });

  it("keeps personality-authored cues and fills an empty moment from defaults", () => {
    __resetAgentVoiceCueThrottleForTests();

    expect(pickAgentVoiceCue({ join: ["Let's go!"], thinking: [] }, "join", "agent:join")).toBe(
      "Let's go!",
    );
    expect(
      pickAgentVoiceCue({ join: ["Let's go!"], thinking: [] }, "thinking", "agent:thinking"),
    ).toBe(DEFAULT_AGENT_VOICE_CUES.thinking[0]);
  });
});
