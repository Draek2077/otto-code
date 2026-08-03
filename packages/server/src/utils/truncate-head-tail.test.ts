import { describe, expect, it } from "vitest";
import { truncateHeadTail } from "./truncate-head-tail.js";

describe("truncateHeadTail", () => {
  it("returns text that fits the window unchanged", () => {
    const text = "a".repeat(100);
    expect(truncateHeadTail({ text, headChars: 60, tailChars: 40 })).toBe(text);
  });

  it("keeps the head and the tail and marks how much went missing", () => {
    const text = `${"h".repeat(50)}${"m".repeat(200)}${"t".repeat(50)}`;
    const result = truncateHeadTail({ text, headChars: 50, tailChars: 50 });

    expect(result.startsWith("h".repeat(50))).toBe(true);
    expect(result.endsWith("t".repeat(50))).toBe(true);
    expect(result).toContain("[... 200 characters truncated ...]");
    expect(result).not.toContain("m".repeat(200));
  });

  it("appends the note to the marker so the model knows where the rest lives", () => {
    const result = truncateHeadTail({
      text: "x".repeat(500),
      headChars: 10,
      tailChars: 10,
      note: "call get_agent_activity for the full message",
    });

    expect(result).toContain(
      "[... 480 characters truncated; call get_agent_activity for the full message ...]",
    );
  });

  it("drops the tail entirely when tailChars is 0", () => {
    // `slice(-0)` returns the whole string, so a zero tail has to be special-cased.
    const result = truncateHeadTail({ text: "abcdefghij", headChars: 3, tailChars: 0 });

    expect(result).toBe("abc\n[... 7 characters truncated ...]\n");
  });
});
