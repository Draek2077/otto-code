import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { isCompactionActive } from "./compaction-state";

const loading: StreamItem = {
  kind: "compaction",
  id: "compact-1",
  timestamp: new Date(0),
  status: "loading",
};

describe("isCompactionActive", () => {
  it("recognizes the in-flight compaction marker on an active turn", () => {
    expect(isCompactionActive([loading], true)).toBe(true);
  });

  it("settles when the marker is terminal or the turn has closed", () => {
    expect(isCompactionActive([{ ...loading, status: "completed" }], true)).toBe(false);
    expect(isCompactionActive([loading], false)).toBe(false);
  });

  it("does not mistake ordinary agent work for compaction", () => {
    const userMessage: StreamItem = {
      kind: "user_message",
      id: "message-1",
      text: "ordinary work",
      timestamp: new Date(0),
    };
    expect(isCompactionActive([userMessage], true)).toBe(false);
  });
});
