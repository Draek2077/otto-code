import { describe, expect, test } from "vitest";

import {
  formatBrainLog,
  formatLlamaServerLog,
  stripLlamaServerPrefix,
  timestampBrainLogLine,
} from "./log-format.js";

describe("Brain session log formatting", () => {
  test("marks host operations with their source and subsystem", () => {
    expect(formatBrainLog("library", "searching Hugging Face")).toBe(
      "[brain] [library] searching Hugging Face",
    );
  });

  test("removes llama.cpp's machine-oriented prefix", () => {
    expect(
      stripLlamaServerPrefix("0.00.241.268 W srv llama_server: CORS is set to allow all origins"),
    ).toBe("CORS is set to allow all origins");
    expect(formatLlamaServerLog("0.00.241.101 I srv init: The UI is disabled")).toBe(
      "[llama-server] The UI is disabled",
    );
  });

  test("does not double-tag entries relayed from another Brain component", () => {
    expect(formatBrainLog("server", "[llama-server] W load: tokenizer metadata")).toBe(
      "[llama-server] W load: tokenizer metadata",
    );
  });

  test("places source markers before timestamps in the durable log", () => {
    expect(timestampBrainLogLine("03:08:49.000", "[brain] [api] queued request")).toBe(
      "[brain] [api] 03:08:49.000 queued request",
    );
  });
});
