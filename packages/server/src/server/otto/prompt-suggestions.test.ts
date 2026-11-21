import { expect, it } from "vitest";
import { claudePromptSuggestionsEnabled, toClaudePromptSuggestion } from "./prompt-suggestions.js";

it.each([
  [true, undefined, true, true],
  [undefined, " true ", true, true],
  [undefined, undefined, true, true],
  [true, "FALSE", true, false],
  [false, "true", true, false],
  [true, "true", false, false],
] as const)(
  "respects the saved preference and explicit kill switch (%s, %s, %s)",
  (configured, environment, ordinaryChat, expected) => {
    expect(claudePromptSuggestionsEnabled({ configured, environment, ordinaryChat })).toBe(
      expected,
    );
  },
);

it("projects only usable composer text", () => {
  expect(toClaudePromptSuggestion("  Try the tests  ")).toEqual({
    type: "prompt_suggestion",
    provider: "claude",
    suggestion: "Try the tests",
  });
  expect(toClaudePromptSuggestion(" ")).toBeNull();
  expect(toClaudePromptSuggestion("a".repeat(4097))).toBeNull();
});
