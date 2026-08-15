import { describe, expect, test } from "vitest";

import { parseBrainLogLine } from "./log-line";

describe("parseBrainLogLine", () => {
  test("separates a durable Brain source and subsystem tag from its message", () => {
    expect(
      parseBrainLogLine('[brain] [library] 03:08:49.000 searching Hugging Face for "vision"'),
    ).toEqual({
      timestamp: "03:08:49.000",
      source: "brain",
      area: "library",
      message: 'searching Hugging Face for "vision"',
    });
  });

  test("keeps llama-server output distinct and verbatim", () => {
    expect(parseBrainLogLine("[llama-server] 03:08:52.189 ready")).toEqual({
      timestamp: "03:08:52.189",
      source: "llama-server",
      area: null,
      message: "ready",
    });
  });

  test("leaves historical untagged rows readable", () => {
    expect(parseBrainLogLine("2026-08-15T03:08:49.000Z Brain service started")).toEqual({
      timestamp: null,
      source: null,
      area: null,
      message: "2026-08-15T03:08:49.000Z Brain service started",
    });
  });
});
