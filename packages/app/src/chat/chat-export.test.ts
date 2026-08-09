import { describe, expect, it } from "vitest";
import { formatChatExport } from "./chat-export";
import type { StreamItem } from "@/types/stream";

const items: StreamItem[] = [
  {
    kind: "user_message",
    id: "u1",
    text: "Hello",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    kind: "assistant_message",
    id: "a1",
    text: "Hi <there>",
    timestamp: new Date("2026-01-01T00:00:01.000Z"),
  },
];

describe("formatChatExport", () => {
  it("keeps structured stream data in JSON", () => {
    expect(JSON.parse(formatChatExport("Chat", items, "json")).items).toEqual(
      JSON.parse(JSON.stringify(items)),
    );
  });
  it("renders markdown and escapes HTML", () => {
    expect(formatChatExport("Chat", items, "markdown")).toContain("## Assistant");
    expect(formatChatExport("Chat", items, "html")).toContain("Hi &lt;there&gt;");
  });
});
