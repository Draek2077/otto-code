import { expect, it } from "vitest";
import { BrainEventDecoder, type BrainHostEvent } from "./event-decoder.js";

it("decodes split frames, comments, CRLF and multi-line JSON without inventing events", () => {
  const seen: BrainHostEvent[] = [];
  const decoder = new BrainEventDecoder((event) => seen.push(event));
  decoder.push(": Brain events\n\nevent: sta");
  decoder.push('tus\r\ndata: {"state":\r\ndata: "ready"}\r\n');
  expect(seen).toEqual([]);
  decoder.push('\r\nevent: log\ndata: {"line":"fixture"}\n\n: keepalive\n\n');
  expect(seen).toEqual([
    { event: "status", data: { state: "ready" } },
    { event: "log", data: { line: "fixture" } },
  ]);
});

it("rejects oversized incomplete and complete frames", () => {
  for (const suffix of ["", "\n\n"]) {
    const decoder = new BrainEventDecoder(() => {});
    expect(() => decoder.push(`data: ${"x".repeat(256 * 1024)}${suffix}`)).toThrow("byte limit");
  }
});

it("rejects invalid event bodies and propagates consumer failure", () => {
  for (const body of ["null", "[]", "false", "bad"]) {
    const decoder = new BrainEventDecoder(() => {});
    expect(() => decoder.push(`event: status\ndata: ${body}\n\n`)).toThrow();
  }
  const failure = new Error("fixture failure");
  const decoder = new BrainEventDecoder(() => {
    throw failure;
  });
  expect(() => decoder.push("event: status\ndata: {}\n\n")).toThrow(failure);
});
