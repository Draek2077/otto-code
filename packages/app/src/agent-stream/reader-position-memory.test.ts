import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReaderPositions,
  forgetReaderPosition,
  MAX_REMEMBERED_READER_POSITIONS,
  pruneReaderPositions,
  readReaderPosition,
  rememberReaderPosition,
  type ReaderPosition,
} from "./reader-position-memory";

describe("reader position memory", () => {
  beforeEach(() => {
    clearReaderPositions();
  });

  it("returns the remembered anchor for a chat", () => {
    rememberReaderPosition("agent-a", { rowId: "row-7", viewportOffset: -120 });
    expect(readReaderPosition("agent-a")).toEqual({ rowId: "row-7", viewportOffset: -120 });
  });

  it("has nothing for a chat the reader never detached in", () => {
    expect(readReaderPosition("agent-b")).toBeNull();
  });

  // Returning to the bottom is an explicit request to follow output again, so
  // the next open of that chat must not be pulled back up the transcript.
  it("forgets a chat once the reader returns to the bottom", () => {
    rememberReaderPosition("agent-a", { rowId: "row-7", viewportOffset: -120 });
    forgetReaderPosition("agent-a");
    expect(readReaderPosition("agent-a")).toBeNull();
  });

  it("keeps only the latest anchor for a chat", () => {
    rememberReaderPosition("agent-a", { rowId: "row-7", viewportOffset: -120 });
    rememberReaderPosition("agent-a", { rowId: "row-9", viewportOffset: -4 });
    expect(readReaderPosition("agent-a")).toEqual({ rowId: "row-9", viewportOffset: -4 });
  });

  it("ignores a missing agent id rather than keying on the empty string", () => {
    rememberReaderPosition("", { rowId: "row-1", viewportOffset: 0 });
    expect(readReaderPosition("")).toBeNull();
  });

  // The cap is what keeps a day-long session from accumulating one entry per
  // chat it ever scrolled.
  it("evicts the oldest write past the cap", () => {
    for (let index = 0; index <= MAX_REMEMBERED_READER_POSITIONS; index += 1) {
      rememberReaderPosition(`agent-${index}`, { rowId: `row-${index}`, viewportOffset: 0 });
    }
    expect(readReaderPosition("agent-0")).toBeNull();
    expect(readReaderPosition("agent-1")).not.toBeNull();
    expect(readReaderPosition(`agent-${MAX_REMEMBERED_READER_POSITIONS}`)).not.toBeNull();
  });

  // A chat the reader keeps coming back to must not age out behind chats they
  // only scrolled once.
  it("treats a rewrite as the newest entry", () => {
    for (let index = 0; index < MAX_REMEMBERED_READER_POSITIONS; index += 1) {
      rememberReaderPosition(`agent-${index}`, { rowId: `row-${index}`, viewportOffset: 0 });
    }
    rememberReaderPosition("agent-0", { rowId: "row-0b", viewportOffset: -10 });
    rememberReaderPosition("agent-new", { rowId: "row-new", viewportOffset: 0 });
    expect(readReaderPosition("agent-0")).toEqual({ rowId: "row-0b", viewportOffset: -10 });
    expect(readReaderPosition("agent-1")).toBeNull();
  });

  it("prunes an oversized map down to the limit", () => {
    const positions = new Map<string, ReaderPosition>([
      ["a", { rowId: "1", viewportOffset: 0 }],
      ["b", { rowId: "2", viewportOffset: 0 }],
      ["c", { rowId: "3", viewportOffset: 0 }],
    ]);
    pruneReaderPositions(positions, 2);
    expect([...positions.keys()]).toEqual(["b", "c"]);
  });
});
