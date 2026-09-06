import { describe, expect, it } from "vitest";
import { visibleQueuedMessageWindow } from "./queue-visible-window";

describe("visibleQueuedMessageWindow", () => {
  it("shows the first five queued messages and advances after the head leaves", () => {
    const queuedMessages = ["one", "two", "three", "four", "five", "six"];

    expect(visibleQueuedMessageWindow(queuedMessages)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
    expect(visibleQueuedMessageWindow(queuedMessages.slice(1))).toEqual([
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
  });
});
