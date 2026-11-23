import { afterEach, expect, it } from "vitest";
import {
  clearHostPromptSuggestions,
  storePromptSuggestion,
  takePromptSuggestion,
  usePromptSuggestions,
} from "./prompt-suggestions";

afterEach(() => usePromptSuggestions.setState({ hosts: new Map() }));

it("only consumes the current prediction for the exact host and chat", () => {
  storePromptSuggestion("host-1", "chat", "older");
  storePromptSuggestion("host-1", "chat", "current");
  storePromptSuggestion("host-2", "chat", "other host");
  expect(takePromptSuggestion("host-1", "chat", "older")).toBe(false);
  expect(takePromptSuggestion("host-1", "chat", "current")).toBe(true);
  expect(takePromptSuggestion("host-1", "chat", "current")).toBe(false);
  expect(usePromptSuggestions.getState().hosts.get("host-2")?.get("chat")).toBe("other host");
  clearHostPromptSuggestions("host-2");
  expect(usePromptSuggestions.getState().hosts.size).toBe(0);
});
