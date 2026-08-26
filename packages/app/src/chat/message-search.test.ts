import { describe, expect, it } from "vitest";
import { findChatMessageMatches } from "./message-search";
import type { StreamItem } from "@/types/stream";

const options = { caseSensitive: false, wholeWord: false, regexp: false };
const timestamp = new Date("2026-08-25T00:00:00Z");
const messages: StreamItem[] = [
  { kind: "user_message", id: "user", text: "Need search here", timestamp },
  { kind: "assistant_message", id: "assistant", text: "Search finds messages.", timestamp },
  { kind: "thought", id: "thought", text: "search should not count", status: "ready", timestamp },
];

describe("findChatMessageMatches", () => {
  it("searches user and assistant messages but excludes tool-like transcript rows", () => {
    expect(findChatMessageMatches(messages, "search", options)).toEqual([
      { itemId: "user", start: 5, end: 11 },
      { itemId: "assistant", start: 0, end: 6 },
    ]);
  });

  it("honors case, whole-word, and regular-expression options", () => {
    expect(
      findChatMessageMatches(messages, "Search", { ...options, caseSensitive: true }),
    ).toHaveLength(1);
    expect(findChatMessageMatches(messages, "sea", { ...options, wholeWord: true })).toEqual([]);
    expect(findChatMessageMatches(messages, "s. arch", { ...options, regexp: true })).toEqual([]);
    expect(
      findChatMessageMatches(messages, "S[a-z]+ch", { ...options, regexp: true }),
    ).toHaveLength(2);
  });

  it("treats invalid regular expressions as no matches", () => {
    expect(findChatMessageMatches(messages, "[", { ...options, regexp: true })).toEqual([]);
  });
});
